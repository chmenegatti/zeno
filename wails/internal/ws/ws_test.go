package ws

import (
	"context"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/chmenegatti/zeno/wails/internal/httpc"
	"github.com/chmenegatti/zeno/wails/internal/vars"
	"github.com/coder/websocket"
)

func TestEco(t *testing.T) {
	var gotAuth string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotAuth = r.Header.Get("Authorization")
		c, err := websocket.Accept(w, r, nil)
		if err != nil {
			return
		}
		defer c.CloseNow()
		for {
			typ, data, err := c.Read(context.Background())
			if err != nil {
				return
			}
			_ = c.Write(context.Background(), typ, append([]byte("eco: "), data...))
		}
	}))
	defer srv.Close()
	var mu sync.Mutex
	var evs []Event
	got := make(chan Event, 10)
	m := &Manager{Emit: func(e Event) { mu.Lock(); evs = append(evs, e); mu.Unlock(); got <- e }}
	target, _ := url.Parse(srv.URL)
	client, err := httpc.NetClient(vars.Prepared{}, target)
	if err != nil {
		t.Fatal(err)
	}
	h := http.Header{"Authorization": {"Bearer x"}}
	if err := m.Connect("req_1", "ws"+strings.TrimPrefix(srv.URL, "http"), h, client); err != nil {
		t.Fatal(err)
	}
	if !m.Open("req_1") || gotAuth != "Bearer x" {
		t.Fatalf("aberto %v auth %q", m.Open("req_1"), gotAuth)
	}
	if err := m.Send("req_1", "oi"); err != nil {
		t.Fatal(err)
	}
	wait := func(kind string) Event {
		for {
			select {
			case e := <-got:
				if e.Kind == kind {
					return e
				}
			case <-time.After(3 * time.Second):
				t.Fatalf("sem evento %s", kind)
			}
		}
	}
	if e := wait("in"); e.Data != "eco: oi" {
		t.Errorf("eco %q", e.Data)
	}
	m.Close("req_1")
	if e := wait("close"); e.Code != 1000 {
		t.Errorf("close %+v", e)
	}
	if m.Open("req_1") {
		t.Error("ainda aberto")
	}
	if err := m.Send("req_1", "x"); err == nil {
		t.Error("mandou sem conexão")
	}
	mu.Lock()
	defer mu.Unlock()
	if evs[0].Kind != "open" || evs[0].Status != 101 || evs[1].Kind != "out" {
		t.Errorf("%+v", evs)
	}
}
