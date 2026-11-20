package mock

import (
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"testing"
	"time"

	"github.com/chmenegatti/zeno/wails/internal/doc"
)

func TestPathOf(t *testing.T) {
	for in, want := range map[string]string{
		"{{ base_url }}/users/{{ id }}?x=1": "/users/{{ id }}",
		"https://api.x.com/v1/itens":        "/v1/itens",
		"https://api.x.com":                 "/",
		"api.x.com/a/:id":                   "/a/:id",
		"{{ url }}":                         "/",
		"/rel":                              "/rel",
	} {
		if got := PathOf(in); got != want {
			t.Errorf("%q → %q, quer %q", in, got, want)
		}
	}
}

func ws() *Doc {
	ex := func(status int, body string, def bool) *Doc {
		d := doc.New("id", "ex", "name", "e", "status", status, "headers", []any{doc.New("name", "X-A", "value", "1", "enabled", true)}, "body", body)
		if def {
			d.Set("default", true)
		}
		return d
	}
	return doc.New("id", "w", "children", []any{
		doc.New("kind", "folder", "id", "f", "children", []any{
			doc.New("kind", "request", "id", "r1", "name", "Usuário", "method", "GET", "url", "{{ base_url }}/users/{{ id }}", "examples", []any{ex(200, `{"id":1}`, false), ex(201, `{"id":"padrão"}`, true)}),
			doc.New("kind", "request", "id", "r2", "name", "Eu", "method", "GET", "url", "{{ base_url }}/users/me", "examples", []any{ex(200, `{"eu":true}`, false)}),
			doc.New("kind", "request", "id", "r3", "name", "Sem exemplo", "method", "GET", "url", "{{ base_url }}/x"),
			doc.New("kind", "request", "id", "r4", "name", "Lento", "method", "POST", "url", "{{ base_url }}/lento", "examples", []any{ex(202, "ok", false).Set("delayMs", 300)}),
		}),
	})
}

func freePort(t *testing.T) int {
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer ln.Close()
	return ln.Addr().(*net.TCPAddr).Port
}

func TestServidor(t *testing.T) {
	var hits []Hit
	m := &Manager{Workspace: func(id string) *Doc { return ws() }, OnHit: func(h Hit) { hits = append(hits, h) }}
	port, err := m.Start("w", freePort(t))
	if err != nil {
		t.Fatal(err)
	}
	defer m.StopAll()
	base := fmt.Sprintf("http://127.0.0.1:%d", port)
	get := func(method, path string) (*http.Response, string) {
		req, _ := http.NewRequest(method, base+path, nil)
		res, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		defer res.Body.Close()
		b, _ := io.ReadAll(res.Body)
		return res, string(b)
	}
	res, body := get("GET", "/users/1")
	if res.StatusCode != 201 || body != `{"id":"padrão"}` || res.Header.Get("X-A") != "1" || res.Header.Get("Content-Type") == "" || res.Header.Get("Access-Control-Allow-Origin") != "*" {
		t.Errorf("users/1: %d %s %v", res.StatusCode, body, res.Header)
	}
	// rota fixa ganha da com parâmetro
	if _, body = get("GET", "/users/me"); body != `{"eu":true}` {
		t.Errorf("me: %s", body)
	}
	res, body = get("GET", "/x")
	var nf struct{ Routes []string }
	if res.StatusCode != 404 || json.Unmarshal([]byte(body), &nf) != nil || len(nf.Routes) != 3 {
		t.Errorf("404: %d %s", res.StatusCode, body)
	}
	if res, _ = get("DELETE", "/users/1"); res.StatusCode != 404 {
		t.Errorf("método errado: %d", res.StatusCode)
	}
	start := time.Now()
	if res, _ = get("POST", "/lento"); res.StatusCode != 202 || time.Since(start) < 300*time.Millisecond {
		t.Errorf("atraso: %d %v", res.StatusCode, time.Since(start))
	}
	if len(hits) != 5 || hits[0].Status != 201 || hits[0].Path != "/users/1" {
		t.Errorf("hits %+v", hits)
	}
	// porta em uso
	m2 := &Manager{Workspace: m.Workspace}
	if _, err := m2.Start("w", port); err == nil {
		t.Error("porta em uso não deu erro")
	}
	m.Stop("w")
	if m.Port("w") != 0 {
		t.Error("ainda ligado")
	}
	if _, err := http.Get(base + "/users/1"); err == nil {
		t.Error("ainda responde depois de parar")
	}
}
