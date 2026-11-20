package grpcc

import (
	"context"
	"encoding/json"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/chmenegatti/zeno/wails/internal/grpcc/grpctest"
	"github.com/chmenegatti/zeno/wails/internal/httpc"
	"github.com/chmenegatti/zeno/wails/internal/vars"
	"google.golang.org/grpc/metadata"
)

func server(t *testing.T) string {
	s, addr, err := grpctest.Start("127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(s.Stop)
	return addr
}

func TestParseURL(t *testing.T) {
	for in, want := range map[string]string{"grpc://localhost:50051": "localhost:50051", "grpcs://api.x.com": "api.x.com:443", "grpc://h": "h:80"} {
		if a, _, err := ParseURL(in); err != nil || a != want {
			t.Errorf("%s → %s %v", in, a, err)
		}
	}
	if _, _, err := ParseURL("http://x"); err == nil {
		t.Error("http aceito")
	}
}

func TestDescribe(t *testing.T) {
	addr := server(t)
	conn, _ := Dial(addr, nil, nil)
	defer conn.Close()
	for name, src := range map[string]Source{"reflection": {Conn: conn}, "proto": {ProtoFile: "grpctest/loja.proto"}} {
		svcs, err := Describe(context.Background(), src)
		if err != nil || len(svcs) != 1 || svcs[0].Name != "loja.Loja" || len(svcs[0].Methods) != 4 {
			t.Fatalf("%s: %+v %v", name, svcs, err)
		}
		m := svcs[0].Methods[0]
		if m.Name != "ObterProduto" || m.ClientStream || m.ServerStream || !strings.Contains(m.Input, `"id": ""`) {
			t.Errorf("%s: %+v", name, m)
		}
		if eco := svcs[0].Methods[3]; !eco.ClientStream || !eco.ServerStream {
			t.Errorf("%s: eco %+v", name, eco)
		}
	}
}

type rec struct{ ch chan Event }

func (r rec) wait(t *testing.T, kind string) Event {
	t.Helper()
	for {
		select {
		case e := <-r.ch:
			if e.Kind == kind {
				return e
			}
		case <-time.After(3 * time.Second):
			t.Fatalf("sem evento %s", kind)
		}
	}
}

func call(t *testing.T, m *Manager, addr, method, first string) {
	t.Helper()
	conn, _ := Dial(addr, nil, nil)
	md, err := FindMethod(context.Background(), Source{Conn: conn}, "loja.Loja", method)
	if err != nil {
		t.Fatal(err)
	}
	if err := m.Start("r", conn, md, metadata.Pairs("authorization", "Bearer x"), first, 5*time.Second); err != nil {
		t.Fatal(err)
	}
}

func TestChamadas(t *testing.T) {
	addr := server(t)
	r := rec{make(chan Event, 100)}
	m := &Manager{Emit: func(e Event) { r.ch <- e }}

	// unary com metadata, headers e trailers
	call(t, m, addr, "ObterProduto", `{"id": "7"}`)
	if e := r.wait(t, "start"); e.Method != "loja.Loja/ObterProduto" || e.ClientStream {
		t.Errorf("start %+v", e)
	}
	if e := r.wait(t, "headers"); !strings.Contains(strings.Join(flat(e.Metadata), ","), "x-loja=1") {
		t.Errorf("headers %+v", e)
	}
	var p map[string]any
	if e := r.wait(t, "message"); json.Unmarshal([]byte(e.Data), &p) != nil || p["nome"] != "Caneta 7" || p["tipo"] != "ESPECIAL" || p["auth"] != "Bearer x" {
		t.Errorf("message %s", e.Data)
	}
	if e := r.wait(t, "status"); e.Code != 0 || e.CodeName != "OK" || !strings.Contains(strings.Join(flat(e.Metadata), ","), "x-fim=ok") {
		t.Errorf("status %+v", e)
	}

	// erro com código
	call(t, m, addr, "ObterProduto", `{"id": "404"}`)
	if e := r.wait(t, "status"); e.CodeName != "NOT_FOUND" || e.Data != "produto 404 não existe" {
		t.Errorf("404 %+v", e)
	}

	// mensagem que não confere com o schema
	call(t, m, addr, "ObterProduto", `{"nao": 1}`)
	if e := r.wait(t, "status"); e.Code == 0 || !strings.Contains(e.Data, "loja.ProdutoReq") {
		t.Errorf("schema %+v", e)
	}

	// server streaming: chegam aos poucos
	call(t, m, addr, "Contar", `{"ate": 3}`)
	var at []int64
	for i := 0; i < 3; i++ {
		at = append(at, r.wait(t, "message").At)
	}
	if at[2]-at[0] < 150 {
		t.Errorf("stream não chegou aos poucos: %v", at)
	}
	r.wait(t, "status")

	// client streaming
	call(t, m, addr, "Somar", "")
	if !m.Active("r") {
		t.Fatal("não ficou ativa")
	}
	for _, n := range []string{`{"n": "2"}`, `{"n": 3}`} {
		if err := m.Send("r", n); err != nil {
			t.Fatal(err)
		}
	}
	_ = m.CloseSend("r")
	if e := r.wait(t, "message"); !strings.Contains(e.Data, `"5"`) {
		t.Errorf("soma %s", e.Data)
	}
	r.wait(t, "status")

	// bidi + cancelar
	call(t, m, addr, "Eco", "")
	_ = m.Send("r", `{"n": 4}`)
	if e := r.wait(t, "message"); !strings.Contains(e.Data, `"40"`) {
		t.Errorf("eco %s", e.Data)
	}
	m.Cancel("r")
	if e := r.wait(t, "status"); e.CodeName != "CANCELED" && e.CodeName != "CANCELLED" {
		t.Errorf("cancel %+v", e)
	}
	time.Sleep(50 * time.Millisecond)
	if m.Active("r") {
		t.Error("ainda ativa")
	}
}

// pelo proxy HTTP do workspace (CONNECT)
func TestPeloProxy(t *testing.T) {
	addr := server(t)
	var tunnels atomic.Int32
	px := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodConnect {
			w.WriteHeader(405)
			return
		}
		// loopback nunca passa por proxy: o teste usa loja.test, que o proxy manda pro servidor
		_, port, _ := net.SplitHostPort(r.Host)
		up, err := net.Dial("tcp", "127.0.0.1:"+port)
		if err != nil {
			w.WriteHeader(502)
			return
		}
		tunnels.Add(1)
		c, _, _ := w.(http.Hijacker).Hijack()
		_, _ = c.Write([]byte("HTTP/1.1 200 OK\r\n\r\n"))
		go func() { _, _ = io.Copy(up, c) }()
		_, _ = io.Copy(c, up)
	}))
	defer px.Close()
	dialer, err := httpc.ProxyDialer(vars.Prepared{Net: vars.Net{ProxyMode: "custom", ProxyURL: px.URL}}, false)
	if err != nil {
		t.Fatal(err)
	}
	_, port, _ := net.SplitHostPort(addr)
	conn, _ := Dial("loja.test:"+port, nil, dialer)
	defer conn.Close()
	svcs, err := Describe(context.Background(), Source{Conn: conn})
	if err != nil || len(svcs) != 1 || tunnels.Load() == 0 {
		t.Fatalf("%v %v túneis %d", svcs, err, tunnels.Load())
	}
}

func flat(p [][2]string) []string {
	var out []string
	for _, kv := range p {
		out = append(out, kv[0]+"="+kv[1])
	}
	return out
}
