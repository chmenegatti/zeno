package cli

import (
	"bytes"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"

	"github.com/chmenegatti/zeno/wails/internal/doc"
	"github.com/chmenegatti/zeno/wails/internal/store"
	"github.com/chmenegatti/zeno/wails/internal/vault"
)

type fakeKey struct{}

func (fakeKey) Available() (bool, string, bool)  { return true, "test", false }
func (fakeKey) Protect(t string) ([]byte, error) { return []byte("P:" + t), nil }
func (fakeKey) Unprotect(b []byte) (string, error) {
	if !bytes.HasPrefix(b, []byte("P:")) {
		return "", errors.New("nope")
	}
	return string(b[2:]), nil
}

func server(t *testing.T) string {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		js := func(code int, body any) {
			w.Header().Set("content-type", "application/json")
			w.WriteHeader(code)
			_ = json.NewEncoder(w).Encode(body)
		}
		switch r.URL.Path {
		case "/login":
			js(200, map[string]any{"token": "tk-123"})
		case "/me":
			if r.Header.Get("Authorization") == "Bearer tk-123" {
				js(200, map[string]any{"id": 7, "name": "Ana"})
			} else {
				js(401, map[string]any{"error": "sem token"})
			}
		case "/items":
			js(200, map[string]any{"items": []any{1, 2}})
		case "/echo":
			js(200, map[string]any{"q": r.URL.Query().Get("q")})
		default:
			js(404, map[string]any{"error": "nada"})
		}
	}))
	t.Cleanup(srv.Close)
	return srv.URL
}

func a(source, op, value, path string) any {
	d := doc.New("enabled", true, "source", source, "op", op, "value", value)
	if path != "" {
		d.Set("path", path)
	}
	return d
}

type fixture struct {
	dir   string
	st    *store.Store
	wsID  string
	wsDir string
}

// workspace "Loja" com pasta "API" e os requests dados
func setup(t *testing.T, reqs ...*Doc) fixture {
	base := server(t)
	dir := t.TempDir()
	st := store.New(dir)
	st.Load()
	t.Cleanup(st.Flush)
	list, err := st.CreateWorkspace("Loja")
	if err != nil {
		t.Fatal(err)
	}
	ws := list[0]
	for _, e := range ws.List("environments") {
		if e := e.(*Doc); e.Get("parentId") == nil {
			e = e.Clone()
			e.Set("data", doc.New("base_url", base))
			st.SaveEnvironment(ws.Str("id"), e)
		}
	}
	_, folderID, _ := st.CreateFolder(ws.Str("id"), "API", 0)
	for i, r := range reqs {
		_, id, _ := st.CreateRequest(folderID, r.Str("name"), float64(i))
		cur, _ := doc.Find(st.Workspace(ws.Str("id")), id)
		d := cur.Clone()
		for _, k := range r.Keys() {
			d.Set(k, r.Get(k))
		}
		d.Set("id", id)
		d.Set("sortKey", int64(i))
		if err := st.SaveRequest(d); err != nil {
			t.Fatal(err)
		}
	}
	w := st.Workspace(ws.Str("id"))
	return fixture{dir: dir, st: st, wsID: w.Str("id"), wsDir: w.Map("location").Str("dir")}
}

type capture struct{ lines []string }

func (c *capture) out() Out {
	return Out{Log: func(s string) { c.lines = append(c.lines, s) }, Err: func(s string) { c.lines = append(c.lines, "ERR "+s) }}
}
func (c *capture) text() string { return strings.Join(c.lines, "\n") }

func TestCodigosDeSaidaEJUnit(t *testing.T) {
	f := setup(t,
		doc.New("name", "items", "url", "{{ base_url }}/items", "assertions", []any{a("status", "eq", "200", "")}),
		doc.New("name", "echo", "url", "{{ base_url }}/echo?q={{ q }}", "assertions", []any{a("json", "eq", "ok", "$.q")}),
	)
	junit := filepath.Join(f.dir, "out.xml")
	c := &capture{}
	if code := Run([]string{"run", "loja", "API", "--data-dir", f.dir, "--var", "q=ok", "--junit", junit}, fakeKey{}, c.out(), false); code != 0 {
		t.Fatalf("saída %d:\n%s", code, c.text())
	}
	if !regexp.MustCompile(`✓ GET +items +200`).MatchString(c.text()) {
		t.Errorf("saída:\n%s", c.text())
	}
	if b, _ := os.ReadFile(junit); !strings.Contains(string(b), `failures="0"`) {
		t.Errorf("junit: %s", b)
	}

	c = &capture{}
	if code := Run([]string{"run", "Loja", "--data-dir", f.dir, "--var=q=no"}, fakeKey{}, c.out(), false); code != 1 {
		t.Fatalf("saída %d", code)
	}
	if !strings.Contains(c.text(), "✗ $.q = ok — valor: no") {
		t.Errorf("saída:\n%s", c.text())
	}

	for _, bad := range [][]string{{"run"}, {"run", "Nada", "--data-dir", f.dir}, {"run", "Loja", "Pasta X", "--data-dir", f.dir}, {"run", "Loja", "-n", "abc"}, {"voar"}, {}} {
		c = &capture{}
		if code := Run(bad, fakeKey{}, c.out(), false); code != 2 {
			t.Errorf("%v: saída %d\n%s", bad, code, c.text())
		}
	}
	c = &capture{}
	if code := Run([]string{"run", "--help"}, fakeKey{}, c.out(), false); code != 0 || !strings.HasPrefix(c.text(), "uso: zeno run") {
		t.Errorf("help: %d", code)
	}
}

func TestRodaDaPastaSemGravar(t *testing.T) {
	f := setup(t,
		doc.New("name", "login", "method", "POST", "url", "{{ base_url }}/login", "scripts", doc.New("post", "zeno.environment.set('token', zeno.response.json().token)")),
		doc.New("name", "me", "url", "{{ base_url }}/me", "auth", doc.New("type", "bearer", "token", "{{ token }}"), "assertions", []any{a("status", "eq", "200", "")}),
	)
	envFile := func() string {
		var all []string
		es, _ := os.ReadDir(filepath.Join(f.wsDir, "_env"))
		for _, e := range es {
			b, _ := os.ReadFile(filepath.Join(f.wsDir, "_env", e.Name()))
			all = append(all, string(b))
		}
		return strings.Join(all, ",")
	}
	before := envFile()
	c := &capture{}
	// --data-dir só pro cofre/plugins: o workspace vem da pasta
	if code := Run([]string{"run", f.wsDir, "API", "--data-dir", t.TempDir()}, fakeKey{}, c.out(), false); code != 0 {
		t.Fatalf("saída %d:\n%s", code, c.text())
	}
	// token passou de um request pro outro, mas não foi gravado no YAML do repo
	if envFile() != before {
		t.Error("CLI gravou o ambiente")
	}
	ws := f.st.Workspace(f.wsID)
	login := ws.List("children")[0].(*Doc).List("children")[0].(*Doc)
	if n := len(f.st.GetResponses(login.Str("id"))); n != 0 {
		t.Errorf("histórico na pasta de dados: %d", n)
	}
}

func TestSemChaveiro(t *testing.T) {
	f := setup(t, doc.New("name", "me", "url", "{{ base_url }}/me", "auth", doc.New("type", "bearer", "token", "{{ token }}"), "assertions", []any{a("status", "eq", "200", "")}))
	enc, err := vault.New(f.dir, fakeKey{}).Encrypt("tk-123")
	if err != nil {
		t.Fatal(err)
	}
	for _, e := range f.st.Workspace(f.wsID).List("environments") {
		if e := e.(*Doc); e.Get("parentId") == nil {
			e = e.Clone()
			e.Map("data").Set("token", enc)
			f.st.SaveEnvironment(f.wsID, e)
		}
	}
	c := &capture{}
	if code := Run([]string{"run", "Loja", "--data-dir", f.dir, "--var", "token=tk-123"}, NoKeyring{}, c.out(), false); code != 0 {
		t.Fatalf("com --var: %d\n%s", code, c.text())
	}
	c = &capture{}
	if code := Run([]string{"run", "Loja", "--data-dir", f.dir}, NoKeyring{}, c.out(), false); code != 1 {
		t.Fatalf("sem --var: %d", code)
	}
	if !regexp.MustCompile(`segredo cifrado "token" não abriu[\s\S]*variável sem valor: token`).MatchString(c.text()) {
		t.Errorf("saída:\n%s", c.text())
	}
	// com chaveiro, abre normalmente
	if code := Run([]string{"run", "Loja", "--data-dir", f.dir}, fakeKey{}, (&capture{}).out(), false); code != 0 {
		t.Errorf("com chaveiro: %d", code)
	}
}

func TestCores(t *testing.T) {
	f := setup(t, doc.New("name", "items", "url", "{{ base_url }}/items"))
	c := &capture{}
	t.Setenv("NO_COLOR", "")
	Run([]string{"run", "Loja", "--data-dir", f.dir}, fakeKey{}, c.out(), true)
	if !strings.Contains(c.text(), "\x1b[32m✓\x1b[0m") {
		t.Errorf("sem cor no terminal: %q", c.text())
	}
	t.Setenv("NO_COLOR", "1")
	c = &capture{}
	Run([]string{"run", "Loja", "--data-dir", f.dir}, fakeKey{}, c.out(), true)
	if strings.Contains(c.text(), "\x1b[") {
		t.Error("NO_COLOR ignorado")
	}
}
