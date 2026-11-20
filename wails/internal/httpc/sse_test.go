package httpc

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/chmenegatti/zeno/wails/internal/vars"
)

func TestSSEEmFluxo(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		f := w.(http.Flusher)
		fmt.Fprint(w, ": ping\n\nevent: oi\ndata: a\ndata: b\nid: 1\n\n")
		f.Flush()
		time.Sleep(300 * time.Millisecond)
		fmt.Fprint(w, "data: fim\n\n")
		f.Flush()
	}))
	defer srv.Close()
	var evs []SSEEvent
	var firstAt time.Time
	start := time.Now()
	// timeout menor que o stream: depois dos headers não vale
	rec := Send("req_sse", vars.Prepared{Method: "GET", URL: srv.URL, TimeoutMs: 200}, CookieHooks{Event: func(e SSEEvent) {
		if len(evs) == 0 {
			firstAt = time.Now()
		}
		evs = append(evs, e)
	}})
	if rec.Str("error") != "" || rec.Get("status") != 200 {
		t.Fatalf("%v", rec.Get("error"))
	}
	if len(evs) != 2 || evs[0].Event != "oi" || evs[0].Data != "a\nb" || evs[0].ID != "1" || evs[1].Event != "message" || evs[1].Data != "fim" || evs[1].ID != "1" {
		t.Fatalf("%+v", evs)
	}
	if firstAt.Sub(start) > 250*time.Millisecond {
		t.Error("primeiro evento só chegou no fim")
	}
	// conexão caiu no meio: guarda o que chegou
	srv3 := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		fmt.Fprint(w, "data: 1\n\n")
		w.(http.Flusher).Flush()
		conn, _, _ := w.(http.Hijacker).Hijack()
		conn.Close()
	}))
	defer srv3.Close()
	rec = Send("req_sse3", vars.Prepared{Method: "GET", URL: srv3.URL}, CookieHooks{Event: func(SSEEvent) {}})
	if rec.Get("status") != 200 || rec.Str("body") != "data: 1\n\n" || !strings.HasPrefix(rec.Str("streamEnd"), "erro") {
		t.Fatalf("caiu: %v %q %v %v", rec.Get("status"), rec.Str("body"), rec.Get("streamEnd"), rec.Get("error"))
	}
	// cancelar no meio guarda o que chegou
	srv2 := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		fmt.Fprint(w, "data: 1\n\n")
		w.(http.Flusher).Flush()
		<-r.Context().Done()
	}))
	defer srv2.Close()
	go func() { time.Sleep(200 * time.Millisecond); Cancel("req_sse2") }()
	n := 0
	rec = Send("req_sse2", vars.Prepared{Method: "GET", URL: srv2.URL}, CookieHooks{Event: func(SSEEvent) { n++ }})
	if n != 1 || rec.Str("streamEnd") != "cancelado" || rec.Str("body") != "data: 1\n\n" || rec.Str("error") != "" {
		t.Fatalf("cancelado: %d %v %q %v", n, rec.Get("streamEnd"), rec.Str("body"), rec.Get("error"))
	}
}
