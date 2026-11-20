package httpc

import (
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/chmenegatti/zeno/wails/internal/doc"
	"github.com/chmenegatti/zeno/wails/internal/vars"
)

func prep(method, url string) vars.Prepared {
	return vars.Prepared{Method: method, URL: url, BodyKind: "none", TimeoutMs: 5000}
}

func server(t *testing.T) *httptest.Server {
	mux := http.NewServeMux()
	mux.HandleFunc("/json", func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		w.Header().Set("Content-Type", "application/json")
		w.Header().Add("X-B", "1")
		w.Header().Add("X-B", "2")
		w.Header().Add("Set-Cookie", "a=1")
		w.Header().Add("Set-Cookie", "b=2")
		w.WriteHeader(201)
		_, _ = w.Write([]byte(`{"recebido":` + string(body) + `,"h":"` + r.Header.Get("X-Teste") + `","m":"` + r.Method + `"}`))
	})
	mux.HandleFunc("/bin", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "image/png")
		_, _ = w.Write([]byte{0x89, 'P', 'N', 'G', 0, 1, 2})
	})
	mux.HandleFunc("/login", func(w http.ResponseWriter, r *http.Request) {
		http.SetCookie(w, &http.Cookie{Name: "sessao", Value: "abc"})
		http.Redirect(w, r, "/eu", http.StatusFound)
	})
	mux.HandleFunc("/eu", func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte("cookie=" + r.Header.Get("Cookie") + " auth=" + r.Header.Get("Authorization") + " m=" + r.Method + " ct=" + r.Header.Get("Content-Type")))
	})
	mux.HandleFunc("/303", func(w http.ResponseWriter, r *http.Request) { http.Redirect(w, r, "/eu", http.StatusSeeOther) })
	mux.HandleFunc("/307", func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, "/json", http.StatusTemporaryRedirect)
	})
	mux.HandleFunc("/loop", func(w http.ResponseWriter, r *http.Request) { http.Redirect(w, r, "/loop", http.StatusFound) })
	mux.HandleFunc("/lento", func(w http.ResponseWriter, r *http.Request) {
		select {
		case <-time.After(3 * time.Second):
		case <-r.Context().Done():
		}
	})
	mux.HandleFunc("/upload", func(w http.ResponseWriter, r *http.Request) {
		_ = r.ParseMultipartForm(1 << 20)
		f, fh, err := r.FormFile("arquivo")
		if err != nil {
			_, _ = w.Write([]byte("sem arquivo"))
			return
		}
		data, _ := io.ReadAll(f)
		_, _ = w.Write([]byte(r.FormValue("nome") + "|" + fh.Filename + "|" + string(data)))
	})
	srv := httptest.NewServer(mux)
	t.Cleanup(srv.Close)
	return srv
}

func TestJSONHeadersETimeline(t *testing.T) {
	srv := server(t)
	p := prep("POST", srv.URL+"/json")
	p.Headers = [][2]string{{"X-Teste", "ok"}}
	p.BodyKind, p.Text = "text", `{"a":1}`
	r := Send("r1", p, CookieHooks{})
	if r.Get("status") != 201 || r.Str("body") != `{"recebido":{"a":1},"h":"ok","m":"POST"}` || r.Str("statusText") != "Created" {
		t.Fatalf("resposta: %v", r)
	}
	hs := r.Get("headers").([][2]string)
	want := map[string]bool{"set-cookie=a=1": true, "set-cookie=b=2": true, "x-b=1, 2": true}
	for _, h := range hs {
		delete(want, h[0]+"="+h[1])
	}
	if len(want) > 0 {
		t.Errorf("headers: %v (faltou %v)", hs, want)
	}
	tl := r.Map("timeline")
	hop := tl.List("hops")[0].(*doc.Doc)
	if !strings.HasPrefix(hop.Str("requestHead"), "POST /json HTTP/1.1\r\n") || !strings.Contains(hop.Str("requestHead"), "X-Teste: ok") {
		t.Errorf("requestHead: %q", hop.Str("requestHead"))
	}
	if tl.Str("requestBody") != `{"a":1}` || tl.Map("timing").Get("connectMs") == nil || tl.Map("remote").Str("address") != "127.0.0.1" {
		t.Errorf("timeline: %s", must(doc.Marshal(tl)))
	}
}

func must(b []byte, _ error) string { return string(b) }

func TestBinarioEGetSemBody(t *testing.T) {
	srv := server(t)
	b := Send("r2", prep("GET", srv.URL+"/bin"), CookieHooks{})
	if b.Str("bodyEncoding") != "base64" || b.Get("size") != 7 {
		t.Errorf("binário: %v", b)
	}
	p := prep("GET", srv.URL+"/json")
	p.BodyKind, p.Text = "text", "nao-vai"
	if g := Send("r3", p, CookieHooks{}); g.Str("body") != `{"recebido":,"h":"","m":"GET"}` {
		t.Errorf("GET levou body: %v", g.Get("body"))
	}
}

func TestRedirectComCookies(t *testing.T) {
	srv := server(t)
	var mu sync.Mutex
	jar := map[string]string{}
	hooks := CookieHooks{
		Header: func(u string) string { mu.Lock(); defer mu.Unlock(); return jar["c"] },
		Store: func(u string, set []string) {
			mu.Lock()
			defer mu.Unlock()
			jar["c"] = strings.Split(set[0], ";")[0]
		},
	}
	p := prep("GET", srv.URL+"/login")
	p.Headers = [][2]string{{"Authorization", "Bearer x"}, {"Cookie", "manual=1"}}
	r := Send("r4", p, hooks)
	if r.Str("body") != "cookie=manual=1; sessao=abc auth=Bearer x m=GET ct=" {
		t.Errorf("body: %s", r.Str("body"))
	}
	if !strings.HasSuffix(r.Str("url"), "/eu") || len(r.Map("timeline").List("hops")) != 2 {
		t.Errorf("saltos: %v", r.Map("timeline").List("hops"))
	}
}

func TestRedirect303ViraGETE307Mantem(t *testing.T) {
	srv := server(t)
	p := prep("POST", srv.URL+"/303")
	p.BodyKind, p.Text = "text", "x"
	p.Headers = [][2]string{{"Content-Type", "text/plain"}}
	if r := Send("r5", p, CookieHooks{}); !strings.Contains(r.Str("body"), "m=GET ct=") || strings.Contains(r.Str("body"), "text/plain") {
		t.Errorf("303: %s", r.Str("body"))
	}
	p = prep("POST", srv.URL+"/307")
	p.BodyKind, p.Text = "text", `{"k":2}`
	if r := Send("r6", p, CookieHooks{}); r.Str("body") != `{"recebido":{"k":2},"h":"","m":"POST"}` {
		t.Errorf("307: %s", r.Str("body"))
	}
	// laço: para em 10 saltos e devolve o último 302
	if r := Send("r7", prep("GET", srv.URL+"/loop"), CookieHooks{}); r.Get("status") != 302 || len(r.Map("timeline").List("hops")) != 11 {
		t.Errorf("loop: %v %d", r.Get("status"), len(r.Map("timeline").List("hops")))
	}
}

func TestOutraOrigemNaoLevaCredenciais(t *testing.T) {
	alvo := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte("auth=" + r.Header.Get("Authorization") + " cookie=" + r.Header.Get("Cookie")))
	}))
	defer alvo.Close()
	origem := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { http.Redirect(w, r, alvo.URL, http.StatusFound) }))
	defer origem.Close()
	p := prep("GET", origem.URL)
	p.Headers = [][2]string{{"Authorization", "Bearer segredo"}, {"Cookie", "s=1"}}
	if r := Send("r8", p, CookieHooks{}); r.Str("body") != "auth= cookie=" {
		t.Errorf("vazou credencial: %s", r.Str("body"))
	}
}

func TestMultipartComArquivo(t *testing.T) {
	srv := server(t)
	f := filepath.Join(t.TempDir(), "foto.png")
	_ = os.WriteFile(f, []byte("CONTEUDO"), 0o644)
	p := prep("POST", srv.URL+"/upload")
	p.BodyKind = "multipart"
	p.Multipart = []vars.Part{{Name: "nome", Value: "Ana"}, {Name: "arquivo", File: f}}
	r := Send("r9", p, CookieHooks{})
	if r.Str("body") != "Ana|foto.png|CONTEUDO" {
		t.Errorf("multipart: %s", r.Str("body"))
	}
	if rb := r.Map("timeline").Str("requestBody"); rb != "--- nome: Ana\n--- arquivo: arquivo "+f {
		t.Errorf("requestBody: %q", rb)
	}
}

func TestTLS(t *testing.T) {
	srv := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { _, _ = w.Write([]byte("seguro")) }))
	defer srv.Close()
	r := Send("t1", prep("GET", srv.URL), CookieHooks{})
	if r.Str("error") == "" || r.Map("timeline") == nil {
		t.Errorf("certificado inválido deveria falhar com linha do tempo: %v", r)
	}
	p := prep("GET", srv.URL)
	p.InsecureTLS = true
	r = Send("t2", p, CookieHooks{})
	tl := r.Map("timeline")
	ti := tl.Map("tls")
	if r.Str("body") != "seguro" || ti.Get("authorized") != false || ti.Str("error") == "" || !strings.HasPrefix(ti.Str("protocol"), "TLSv1.") || tl.Map("timing").Get("tlsMs") == nil {
		t.Errorf("tls: %s", must(doc.Marshal(ti)))
	}
	if !strings.Contains(ti.Str("fingerprint"), ":") || ti.Str("validTo") == "" {
		t.Errorf("certificado: %s", must(doc.Marshal(ti)))
	}
}

func TestTimeoutECancelar(t *testing.T) {
	srv := server(t)
	p := prep("GET", srv.URL+"/lento")
	p.TimeoutMs = 200
	if r := Send("x1", p, CookieHooks{}); r.Str("error") != "timeout de 200 ms" {
		t.Errorf("timeout: %q", r.Str("error"))
	}
	done := make(chan *doc.Doc)
	go func() { done <- Send("x2", prep("GET", srv.URL+"/lento"), CookieHooks{}) }()
	time.Sleep(150 * time.Millisecond)
	Cancel("x2")
	if r := <-done; r.Str("error") != "cancelado" {
		t.Errorf("cancelar: %q", r.Str("error"))
	}
	if r := Send("x3", prep("GET", "http://127.0.0.1:1/nada"), CookieHooks{}); r.Str("error") == "" || r.Get("status") != 0 {
		t.Errorf("conexão recusada: %v", r)
	}
}

func TestFormNaOrdemEIdUnico(t *testing.T) {
	got := FormEncode([][2]string{{"a", "1"}, {"b", "x y"}, {"a", "3~é&"}})
	if got != "a=1&b=x+y&a=3%7E%C3%A9%26" {
		t.Errorf("form: %s", got)
	}
	now := time.Now()
	if ResponseID(now) == ResponseID(now) {
		t.Error("ids iguais no mesmo ms")
	}
}
