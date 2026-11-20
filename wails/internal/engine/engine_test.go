package engine

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/chmenegatti/zeno/wails/internal/oauth2"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"

	"github.com/chmenegatti/zeno/wails/internal/cookies"
	"github.com/chmenegatti/zeno/wails/internal/doc"
	"github.com/chmenegatti/zeno/wails/internal/plugins"
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
	t.Cleanup(st.Flush)
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
	e.Store.Flush()
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

func TestScriptsEAmbientes(t *testing.T) {
	srv, _ := api(t)
	e, ws := setup(t, srv.URL)
	login, _ := doc.Find(ws, "req_login")
	req := login.Clone()
	req.Set("scripts", doc.New(
		"pre", "zeno.request.headers.add({ key: 'X-Pre', value: zeno.environment.get('base') ? 'ok' : 'nao' }); zeno.variables.set('esperado', 'T1')",
		"post", "zeno.environment.set('auth_token', zeno.response.json().token); zeno.environment.set('contador', 1); zeno.test('tem token', () => zeno.expect(zeno.response.json().token).to.equal('T1'))",
	))
	req.Set("assertions", []any{doc.New("enabled", true, "source", "json", "path", "$.token", "op", "eq", "value", "{{ esperado }}")})
	r, err := e.Execute(ws, req, "", 0)
	if err != nil {
		t.Fatal(err)
	}
	rep := r.Map("scripts")
	b, _ := doc.Marshal(rep)
	if strings.Count(string(b), `"ok":true`) != 2 || strings.Contains(string(b), `"ok":false`) {
		t.Errorf("relatório: %s", b)
	}
	hist := e.Store.GetResponses("req_login")[0].(*doc.Doc)
	if !strings.Contains(hist.Map("timeline").List("hops")[0].(*doc.Doc).Str("requestHead"), "X-Pre: ok") {
		t.Error("pré-script não mexeu no request")
	}
	// ambiente gravado: token (nome de segredo) cifrado no YAML; contador em texto
	yaml, _ := os.ReadFile(filepath.Join(e.Store.Dir, "w/_env/base.yaml"))
	// (o texto cifrado é aleatório e pode conter "T1": procura o valor em claro fora dos tokens)
	plain := regexp.MustCompile(`\$zeno\$\S+`).ReplaceAllString(string(yaml), "")
	if !strings.Contains(string(yaml), "auth_token: $zeno$v1$") || !strings.Contains(string(yaml), "contador: 1") || strings.Contains(plain, "T1") {
		t.Errorf("ambiente gravado:\n%s", yaml)
	}
	// e o valor abre de volta
	tok := e.Store.List()[0].List("environments")[0].(*doc.Doc).Map("data").Str("auth_token")
	if p, err := e.Vault.Decrypt(tok); err != nil || p != "T1" {
		t.Errorf("token: %q %v", p, err)
	}
}

func TestPreScriptComErroNaoEnvia(t *testing.T) {
	srv, logins := api(t)
	e, ws := setup(t, srv.URL)
	login, _ := doc.Find(ws, "req_login")
	req := login.Clone()
	req.Set("scripts", doc.New("pre", "throw new Error('quebrou')"))
	r, _ := e.Execute(ws, req, "", 0)
	if *logins != 0 || r.Map("response").Str("error") != "Não enviado: o script pré-request (Login): quebrou" {
		t.Errorf("%d %q", *logins, r.Map("response").Str("error"))
	}
}

func TestPluginsNoEnvio(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(r.Header.Get("X-Hook") + "|" + r.Header.Get("X-Tag")))
	}))
	defer srv.Close()
	e, ws := setup(t, srv.URL)
	pdir := filepath.Join(e.Store.Dir, "plugins", "teste")
	write(t, filepath.Join(pdir, "package.json"), `{"name":"teste","main":"index.js"}`)
	write(t, filepath.Join(pdir, "index.js"), `module.exports.templateTags = [{ name: 'grita', run: (c, s) => String(s).toUpperCase() }]
module.exports.requestHooks = [(c) => c.request.setHeader('X-Hook', c.request.getEnvironmentVariable('base') ? 'com-env' : 'sem')]
module.exports.responseHooks = [(c) => { if (c.response.getStatusCode() !== 200) throw new Error('não 200') }]`)
	e.Plugins = plugins.New(filepath.Join(e.Store.Dir, "plugins"), nil)
	e.Plugins.Load()
	login, _ := doc.Find(ws, "req_login")
	req := login.Clone()
	req.Set("url", "{{ base }}/x")
	req.Set("headers", []any{doc.New("name", "X-Tag", "value", "{% grita 'oi' %}", "enabled", true)})
	r, err := e.Execute(ws, req, "", 0)
	if err != nil {
		t.Fatal(err)
	}
	if b := e.Store.GetResponses("req_login")[0].(*doc.Doc).Str("body"); b != "com-env|OI" {
		t.Errorf("body: %q avisos %v", b, r.Get("warnings"))
	}
}

func TestCodeInput(t *testing.T) {
	srv, logins := api(t)
	e, ws := setup(t, srv.URL)
	me, _ := doc.Find(ws, "req_me")
	req := me.Clone()
	lit, _ := e.Vault.Encrypt("literal-aberto")
	req.Set("headers", append(req.List("headers"), doc.New("name", "X-Lit", "value", lit, "enabled", true)))

	// sem resolver: {{ variáveis }} como referência, segredo literal do request decifrado
	in, err := e.CodeInput(ws, req, "", false)
	if err != nil {
		t.Fatal(err)
	}
	b, _ := json.Marshal(in)
	for _, want := range []string{`{"requestId":"req_me","method":"GET","url":"{{ base }}/me","headers":[`, `["X-Key","{{ api_key }}"]`, `["X-Lit","literal-aberto"]`, `"body":{"kind":"none"},"insecureTLS":false,"timeoutMs":5000}`} {
		if !strings.Contains(string(b), want) {
			t.Errorf("sem resolver: falta %s em %s", want, b)
		}
	}
	// resolvendo: variáveis e segredos do ambiente abertos, sem enviar dependência
	in, err = e.CodeInput(ws, req, "", true)
	if err != nil {
		t.Fatal(err)
	}
	b, _ = json.Marshal(in)
	for _, want := range []string{`"url":"` + srv.URL + `/me"`, `["X-Key","chave-secreta"]`, `["X-Lit","literal-aberto"]`} {
		if !strings.Contains(string(b), want) {
			t.Errorf("resolvendo: falta %s em %s", want, b)
		}
	}
	if *logins != 0 {
		t.Error("gerar código não pode enviar dependência")
	}
}

// rede do workspace (#18): variáveis no proxy e senha do PFX decifrada só pro envio
func TestRedeDoWorkspace(t *testing.T) {
	srv, _ := api(t)
	e, ws := setup(t, srv.URL)
	tok, err := e.Vault.Encrypt("senha-pfx")
	if err != nil {
		t.Fatal(err)
	}
	ws = ws.Clone()
	ws.Set("settings", doc.New("insecureTLS", false, "timeoutMs", int64(5000),
		"proxy", doc.New("mode", "custom", "url", "{{ base }}", "noProxy", "localhost"),
		"clientCerts", []any{doc.New("host", "*.interno", "pfx", "/x/c.pfx", "passphrase", tok)}))
	p, _, err := e.PrepareOpen(ws, "req_me", "", nil)
	if err != nil {
		t.Fatal(err)
	}
	if p.Net.ProxyMode != "custom" || p.Net.ProxyURL != srv.URL || p.Net.NoProxy != "localhost" {
		t.Errorf("proxy: %+v", p.Net)
	}
	if len(p.Net.ClientCerts) != 1 || p.Net.ClientCerts[0].Passphrase != "senha-pfx" || p.Net.ClientCerts[0].Host != "*.interno" {
		t.Errorf("certificado: %+v", p.Net.ClientCerts)
	}
}

// OAuth 2.0 (#9): token no header, do cache na segunda vez, mascarado no histórico; erro não envia
func TestOAuth2NoEnvio(t *testing.T) {
	issued := 0
	as := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		u, p, _ := r.BasicAuth()
		if u != "cli" || p != "seg" {
			w.WriteHeader(401)
			w.Write([]byte(`{"error":"invalid_client"}`))
			return
		}
		issued++
		fmt.Fprintf(w, `{"access_token":"token-oauth-%d","token_type":"Bearer","expires_in":3600}`, issued)
	}))
	defer as.Close()
	var gotAuth string
	api := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotAuth = r.Header.Get("Authorization")
		w.Write([]byte("ok"))
	}))
	defer api.Close()
	e, ws := setup(t, api.URL)
	e.OAuth = &oauth2.Manager{Dir: e.Store.Dir, Vault: e.Vault}
	login, _ := doc.Find(ws, "req_login")
	req := login.Clone()
	req.Set("auth", doc.New("type", "oauth2", "grantType", "client_credentials", "tokenUrl", as.URL, "clientId", "cli", "clientSecret", "seg"))
	for i := 0; i < 2; i++ {
		r, err := e.Execute(ws, req, "", 0)
		if err != nil || r.Map("response").Get("status") != 200 {
			t.Fatalf("envio %d: %v %v", i, err, r.Map("response").Get("error"))
		}
	}
	if gotAuth != "Bearer token-oauth-1" || issued != 1 {
		t.Errorf("header %q, tokens emitidos %d", gotAuth, issued)
	}
	e.Store.Flush()
	raw, _ := os.ReadFile(e.Store.ResponsesFile("req_login"))
	if strings.Contains(string(raw), "token-oauth-1") {
		t.Error("token em claro no histórico")
	}
	// credencial errada: não envia, explica
	req.Set("auth", doc.New("type", "oauth2", "grantType", "client_credentials", "tokenUrl", as.URL, "clientId", "cli", "clientSecret", "errado"))
	gotAuth = ""
	r, _ := e.Execute(ws, req, "", 0)
	if gotAuth != "" || !strings.Contains(r.Map("response").Str("error"), "OAuth 2.0") {
		t.Errorf("erro: enviado=%q %v", gotAuth, r.Map("response").Get("error"))
	}
}

func TestIntrospectSemHistorico(t *testing.T) {
	var gotBody, gotAuth, gotCT string
	api := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		b, _ := io.ReadAll(r.Body)
		gotBody, gotAuth, gotCT = string(b), r.Header.Get("Authorization"), r.Header.Get("Content-Type")
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{"data":{"__schema":{}}}`))
	}))
	defer api.Close()
	e, ws := setup(t, api.URL)
	login, _ := doc.Find(ws, "req_login")
	req := login.Clone()
	req.Set("method", "POST")
	req.Set("auth", doc.New("type", "bearer", "token", "tk"))
	req.Set("body", doc.New("mime", "application/json", "text", `{"query":"{ __schema { types { name } } }"}`))
	r, err := e.Introspect(ws, req, "", false)
	if err != nil || r.Get("status") != 200 || r.Str("body") != `{"data":{"__schema":{}}}` {
		t.Fatalf("%v %v", r, err)
	}
	if !strings.Contains(gotBody, "__schema") || gotAuth != "Bearer tk" || gotCT != "application/json" {
		t.Errorf("body %q auth %q ct %q", gotBody, gotAuth, gotCT)
	}
	e.Store.Flush()
	if raw, _ := os.ReadFile(e.Store.ResponsesFile("req_login")); len(raw) > 0 && strings.Contains(string(raw), "__schema") {
		t.Error("introspecção foi pro histórico")
	}
}
