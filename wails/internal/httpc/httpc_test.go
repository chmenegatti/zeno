package httpc

import (
	"io"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/chmenegatti/zeno/wails/internal/doc"
	"github.com/chmenegatti/zeno/wails/internal/vars"
)

func TestSend(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		switch r.URL.Path {
		case "/json":
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(201)
			_, _ = w.Write([]byte(`{"recebido":` + string(body) + `,"h":"` + r.Header.Get("X-Teste") + `"}`))
		case "/bin":
			w.Header().Set("Content-Type", "image/png")
			_, _ = w.Write([]byte{0x89, 'P', 'N', 'G', 0, 1, 2})
		case "/redir":
			http.Redirect(w, r, "/json", http.StatusFound)
		}
	}))
	defer srv.Close()

	r := Send("r1", vars.Prepared{Method: "POST", URL: srv.URL + "/json", Headers: [][2]string{{"X-Teste", "ok"}}, BodyKind: "text", Text: `{"a":1}`, TimeoutMs: 5000})
	if r["status"] != 201 || r["body"] != `{"recebido":{"a":1},"h":"ok"}` || r["bodyEncoding"] != "utf8" {
		t.Errorf("json: %v", r)
	}
	tl := doc.Map(r, "timeline")
	if tl == nil || doc.Map(tl, "timing") == nil || doc.Str(tl, "requestBody") != `{"a":1}` {
		t.Errorf("timeline: %v", tl)
	}

	b := Send("r2", vars.Prepared{Method: "GET", URL: srv.URL + "/bin", BodyKind: "none", TimeoutMs: 5000})
	if b["bodyEncoding"] != "base64" || b["size"] != 7 {
		t.Errorf("binário: %v", b)
	}

	// protótipo: redirect não é seguido (hops na timeline vêm no #61)
	rd := Send("r3", vars.Prepared{Method: "GET", URL: srv.URL + "/redir", BodyKind: "none", TimeoutMs: 5000})
	if rd["status"] != 302 {
		t.Errorf("redirect: %v", rd["status"])
	}

	e := Send("r4", vars.Prepared{Method: "GET", URL: "http://127.0.0.1:1/nada", BodyKind: "none", TimeoutMs: 2000})
	if doc.Str(e, "error") == "" {
		t.Error("erro de conexão deveria vir em error")
	}
}
