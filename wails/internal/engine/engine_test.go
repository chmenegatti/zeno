package engine

import (
	"bytes"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/chmenegatti/zeno/wails/internal/cookies"
	"github.com/chmenegatti/zeno/wails/internal/doc"
	"github.com/chmenegatti/zeno/wails/internal/store"
	"github.com/chmenegatti/zeno/wails/internal/tags"
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

func write(t *testing.T, p, s string) {
	t.Helper()
	_ = os.MkdirAll(filepath.Dir(p), 0o755)
	if err := os.WriteFile(p, []byte(s), 0o644); err != nil {
		t.Fatal(err)
	}
}

// API de teste: login com cookie e token; /me exige os dois; /eco devolve um header
func api(t *testing.T) (*httptest.Server, *int) {
	logins := 0
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/login":
			logins++
			http.SetCookie(w, &http.Cookie{Name: "sid", Value: "abc", Path: "/"})
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"token":"T1"}`))
		case "/me":
			if r.Header.Get("Authorization") != "Bearer T1" || !strings.Contains(r.Header.Get("Cookie"), "sid=abc") {
				w.WriteHeader(401)
				return
			}
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(map[string]any{"name": "Ana", "key": r.Header.Get("X-Key")})
		}
	}))
	t.Cleanup(srv.Close)
	return srv, &logins
}

func setup(t *testing.T, base string) (*Engine, *Doc) {
	dir := t.TempDir()
	v := vault.New(dir, fakeKey{})
	secret, err := v.Encrypt("chave-secreta")
	if err != nil {
		t.Fatal(err)
	}
	write(t, filepath.Join(dir, "w/workspace.yaml"), "id: w\nname: W\nsettings: { insecureTLS: false, timeoutMs: 5000 }\n")
	write(t, filepath.Join(dir, "w/_env/base.yaml"), "id: base\nname: Base\nparentId: null\ndata:\n  base: \""+base+"\"\n  api_key: \""+secret+"\"\nsortKey: 0\n")
	write(t, filepath.Join(dir, "w/auth/folder.yaml"), "id: fld_auth\nname: Auth\nsortKey: 0\n")
	write(t, filepath.Join(dir, "w/auth/login.yaml"), "id: req_login\nname: Login\nmethod: POST\nurl: \"{{ base }}/login\"\nsortKey: 0\n")
	write(t, filepath.Join(dir, "w/api/folder.yaml"), "id: fld_api\nname: API\nsortKey: 1\nauth:\n  type: bearer\n  token: \"{% response 'body', 'Auth / Login', '$.token', 'no-history' %}\"\n")
	write(t, filepath.Join(dir, "w/api/me.yaml"), `id: req_me
name: Eu
method: GET
url: "{{ base }}/me"
headers:
  - { name: X-Key, value: "{{ api_key }}", enabled: true }
assertions:
  - { enabled: true, source: status, op: eq, value: "200" }
  - { enabled: true, source: json, path: $.name, op: eq, value: Ana }
  - { enabled: true, source: json, path: $.key, op: eq, value: chave-secreta }
  - { enabled: false, source: status, op: eq, value: "999" }
sortKey: 0
`)
	st := store.New(dir)
	st.Load()
	e := &Engine{Store: st, Cookies: cookies.New(dir), Vault: v}
	return e, st.List()[0]
}

func TestEnvioCompleto(t *testing.T) {
	srv, logins := api(t)
	e, ws := setup(t, srv.URL)
	var added []string
	e.Hooks.Emit = func(name string, data ...any) { added = append(added, name+":"+doc.AsStr(data[0])) }
	me, _ := doc.Find(ws, "req_me")
	r, err := e.Execute(ws, me, "", 0)
	if err != nil {
		t.Fatal(err)
	}
	resp := r.Map("response")
	if resp.Get("status") != 200 {
		t.Fatalf("status %v (%s) avisos %v", resp.Get("status"), resp.Str("error"), r.Get("warnings"))
	}
	// login foi enviado sozinho (no-history), uma vez, e avisou a interface
	if *logins != 1 || len(added) != 1 || added[0] != "response:added:req_login" {
		t.Errorf("dependência: logins=%d eventos=%v", *logins, added)
	}
	// asserções: 3 ativas, todas ok
	tests := r.Map("scripts").Get("tests")
	b, _ := json.Marshal(tests)
	if strings.Count(string(b), `"ok":true`) != 3 || strings.Contains(string(b), `"ok":false`) {
		t.Errorf("testes: %s", b)
	}
	// segredo do cofre foi enviado, mas não ficou no histórico gravado
	raw, _ := os.ReadFile(e.Store.ResponsesFile("req_me"))
	if strings.Contains(string(raw), "chave-secreta\\r") || strings.Contains(string(raw), "X-Key: chave-secreta") {
		t.Error("segredo no histórico")
	}
	if !strings.Contains(string(raw), "•••••• (cofre)") {
		t.Error("máscara ausente")
	}
	// segundo envio: login já tem histórico, não reenvia
	if _, err := e.Execute(ws, me, "", 0); err != nil || *logins != 1 {
		t.Errorf("reenviou login: %d %v", *logins, err)
	}
}

func TestPromptCanceladoNaoGrava(t *testing.T) {
	srv, _ := api(t)
	e, ws := setup(t, srv.URL)
	e.Hooks.Ask = func(tags.Prompt) (string, bool) { return "", false }
	login, _ := doc.Find(ws, "req_login")
	req := login.Clone()
	req.Set("headers", []any{doc.New("name", "X-Otp", "value", "{% prompt 'Código', '', '', '', false %}", "enabled", true)})
	r, err := e.Execute(ws, req, "", 0)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(r.Map("response").Str("error"), "envio cancelado") || len(e.Store.GetResponses("req_login")) != 0 {
		t.Errorf("cancelar: %v", r.Map("response").Str("error"))
	}
}

func TestPrepareOpenNaoEnvia(t *testing.T) {
	srv, logins := api(t)
	e, ws := setup(t, srv.URL)
	p, name, err := e.PrepareOpen(ws, "req_me", "", nil)
	if err != nil || name != "Eu" {
		t.Fatal(err)
	}
	if *logins != 0 {
		t.Error("gerar código não pode enviar dependência")
	}
	var key string
	for _, h := range p.Headers {
		if h[0] == "X-Key" {
			key = h[1]
		}
	}
	if key != "chave-secreta" || p.URL != srv.URL+"/me" {
		t.Errorf("preparado: %q %q", key, p.URL)
	}
}
