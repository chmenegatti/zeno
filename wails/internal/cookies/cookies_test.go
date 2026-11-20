package cookies

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/chmenegatti/zeno/wails/internal/httpc"
	"github.com/chmenegatti/zeno/wails/internal/vars"
)

func hooks(c *Cookies) httpc.CookieHooks {
	return httpc.CookieHooks{
		Header: func(u string) string { return c.Header("w", u) },
		Store:  func(u string, s []string) { c.Store("w", u, s) },
	}
}

func server(t *testing.T) *httptest.Server {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/login":
			// login clássico: 302 com cookie de sessão
			w.Header().Add("Set-Cookie", "sid=abc; Path=/; HttpOnly")
			w.Header().Add("Set-Cookie", "old=1; Path=/; Expires=Thu, 01 Jan 2015 00:00:00 GMT")
			w.Header().Set("Location", "/me")
			w.WriteHeader(302)
		case "/short":
			w.Header().Add("Set-Cookie", "tmp=x; Path=/; Max-Age=1")
			_, _ = w.Write([]byte("ok"))
		default:
			_, _ = w.Write([]byte(r.Method + "|" + r.Header.Get("Cookie")))
		}
	}))
	t.Cleanup(srv.Close)
	return srv
}

func prep(method, u string) vars.Prepared {
	return vars.Prepared{Method: method, URL: u, BodyKind: "none", TimeoutMs: 5000}
}

// mesmos casos de test/cookies.test.ts
func TestLoginCom302GuardaSessao(t *testing.T) {
	srv := server(t)
	dir := t.TempDir()
	c := New(dir)
	p := prep("POST", srv.URL+"/login")
	p.BodyKind, p.Text = "text", "u=a"
	r := httpc.Send("r", p, hooks(c))
	// redirect seguido como GET, já com o cookie do 302
	if r.Str("body") != "GET|sid=abc" || r.Str("url") != srv.URL+"/me" {
		t.Fatalf("login: %s %s", r.Str("body"), r.Str("url"))
	}
	p2 := prep("GET", srv.URL+"/qualquer")
	p2.Headers = [][2]string{{"Cookie", "manual=1"}}
	if r2 := httpc.Send("r", p2, hooks(c)); r2.Str("body") != "GET|manual=1; sid=abc" {
		t.Errorf("manual + jar: %s", r2.Str("body"))
	}
	// expirado não entra; persiste no disco e volta numa instância nova
	if l := c.List("w"); len(l) != 1 || l[0].Key != "sid" || !l[0].HTTPOnly || !l[0].HostOnly {
		t.Errorf("lista: %+v", l)
	}
	if h := New(dir).Header("w", srv.URL+"/"); h != "sid=abc" {
		t.Errorf("reabrir: %q", h)
	}
}

func TestCookieQueExpiraSome(t *testing.T) {
	srv := server(t)
	c := New("")
	now := time.Now()
	c.now = func() time.Time { return now }
	httpc.Send("r", prep("GET", srv.URL+"/short"), hooks(c))
	if h := c.Header("w", srv.URL+"/"); h != "tmp=x" {
		t.Fatalf("antes: %q", h)
	}
	now = now.Add(1100 * time.Millisecond)
	if h := c.Header("w", srv.URL+"/"); h != "" || len(c.List("w")) != 0 {
		t.Errorf("depois: %q %v", h, c.List("w"))
	}
}

func TestSemHooksNaoMandaNemGuarda(t *testing.T) {
	srv := server(t)
	if r := httpc.Send("r", prep("GET", srv.URL+"/login"), httpc.CookieHooks{}); r.Str("body") != "GET|" {
		t.Errorf("body: %s", r.Str("body"))
	}
}

func TestEditarELimparPelaTela(t *testing.T) {
	c := New("")
	list := c.Replace("w", []Info{
		{Key: "a", Value: "1", Domain: "api.local", Path: "/"},
		{Key: "b", Value: "2", Domain: ".exemplo.com", Path: "/v1", Secure: true, HTTPOnly: true, Expires: "2999-01-01T00:00:00.000Z"},
		{Key: "velho", Value: "3", Domain: "api.local", Path: "/", Expires: "2001-01-01T00:00:00.000Z"},
	})
	if len(list) != 2 || list[0].Key != "a" || list[1].Key != "b" {
		t.Fatalf("lista: %+v", list)
	}
	for u, want := range map[string]string{"http://api.local/x": "a=1", "https://sub.exemplo.com/v1/y": "b=2", "http://sub.exemplo.com/v1/y": ""} {
		if h := c.Header("w", u); h != want {
			t.Errorf("%s: %q, quer %q", u, h, want)
		}
	}
	c.Clear("w")
	if len(c.List("w")) != 0 {
		t.Error("não limpou")
	}
}

// arquivo gravado pelo tough-cookie (Electron) abre aqui
func TestLeArquivoDoElectron(t *testing.T) {
	dir := t.TempDir()
	b, _ := os.ReadFile("testdata/tough.json")
	_ = os.MkdirAll(filepath.Join(dir, ".cookies"), 0o755)
	_ = os.WriteFile(filepath.Join(dir, ".cookies", "w.json"), b, 0o644)
	c := New(dir)
	// criado em 2026-11-20 01:07; pref tem Max-Age=3600 a partir daí
	c.now = func() time.Time { return time.Date(2026, 11, 20, 1, 30, 0, 0, time.UTC) }
	if h := c.Header("w", "http://127.0.0.1:4597/v1/x"); h != "sessao=abc" {
		t.Errorf("host-only: %q", h)
	}
	if h := c.Header("w", "https://api.exemplo.com/app/z"); h != "pref=1" {
		t.Errorf("domínio + caminho: %q", h)
	}
	if h := c.Header("w", "https://exemplo.com/qualquer"); h != "tema=escuro" {
		t.Errorf("host-only exemplo.com: %q", h)
	}
	c.now = func() time.Time { return time.Date(2026, 11, 20, 2, 30, 0, 0, time.UTC) }
	if h := c.Header("w", "https://api.exemplo.com/app/z"); h != "" {
		t.Errorf("Max-Age venceu: %q", h)
	}
}

func TestRegrasDeDominioECaminho(t *testing.T) {
	c := New("")
	c.Store("w", "https://a.exemplo.com/api/v1/login", []string{
		"x=1", // caminho padrão /api/v1
		"y=2; Domain=exemplo.com; Path=/",
		"z=3; Domain=outro.com", // domínio que não bate: recusado
		"s=4; Path=/; Secure",
	})
	cases := map[string]string{
		"https://a.exemplo.com/api/v1/itens": "x=1; y=2; s=4",
		"https://a.exemplo.com/api":          "y=2; s=4",
		"http://b.exemplo.com/":              "y=2",
		"https://outro.com/":                 "",
	}
	for u, want := range cases {
		if h := c.Header("w", u); h != want {
			t.Errorf("%s: %q, quer %q", u, h, want)
		}
	}
	// mesmo nome/domínio/caminho substitui
	c.Store("w", "https://a.exemplo.com/", []string{"y=novo; Domain=exemplo.com; Path=/"})
	if h := c.Header("w", "http://b.exemplo.com/"); !strings.Contains(h, "y=novo") || strings.Contains(h, "y=2") {
		t.Errorf("substituir: %q", h)
	}
}
