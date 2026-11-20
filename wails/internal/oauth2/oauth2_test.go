package oauth2

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"sync"
	"testing"
	"time"
)

// cofre de mentira (reversível, sem chaveiro)
type fakeVault struct{}

func (fakeVault) Encrypt(s string) (string, error) {
	return "$zeno$" + base64.StdEncoding.EncodeToString([]byte(s)), nil
}
func (fakeVault) Decrypt(s string) (string, error) {
	b, err := base64.StdEncoding.DecodeString(strings.TrimPrefix(s, "$zeno$"))
	return string(b), err
}

// servidor OAuth de mentira
type fakeAS struct {
	*httptest.Server
	mu        sync.Mutex
	issued    int
	challenge string
	pending   int
	lastForm  url.Values
	lastBasic string
}

func newAS(t *testing.T) *fakeAS {
	as := &fakeAS{}
	mux := http.NewServeMux()
	tok := func(w http.ResponseWriter, extra map[string]any) {
		as.issued++
		out := map[string]any{"access_token": fmt.Sprintf("tk-%d", as.issued), "token_type": "Bearer", "expires_in": 3600, "refresh_token": fmt.Sprintf("rf-%d", as.issued)}
		for k, v := range extra {
			out[k] = v
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(out)
	}
	mux.HandleFunc("/authorize", func(w http.ResponseWriter, r *http.Request) {
		q := r.URL.Query()
		as.mu.Lock()
		as.challenge = q.Get("code_challenge")
		as.mu.Unlock()
		redir, _ := url.Parse(q.Get("redirect_uri"))
		if q.Get("response_type") == "token" {
			redir.Fragment = url.Values{"access_token": {"tk-implicit"}, "token_type": {"Bearer"}, "expires_in": {"60"}, "state": {q.Get("state")}}.Encode()
		} else {
			redir.RawQuery = url.Values{"code": {"codigo-123"}, "state": {q.Get("state")}}.Encode()
		}
		http.Redirect(w, r, redir.String(), http.StatusFound)
	})
	mux.HandleFunc("/device", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{"device_code": "dev-1", "user_code": "ABCD-1234", "verification_uri": as.URL + "/ativar", "interval": 1, "expires_in": 60})
	})
	mux.HandleFunc("/token", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		as.mu.Lock()
		defer as.mu.Unlock()
		_ = r.ParseForm()
		as.lastForm = r.PostForm
		u, p, _ := r.BasicAuth()
		as.lastBasic = u + ":" + p
		id, secret := u, p
		if id == "" {
			id, secret = r.PostForm.Get("client_id"), r.PostForm.Get("client_secret")
		}
		if id != "cliente" || (secret != "segredo" && r.PostForm.Get("grant_type") != "urn:ietf:params:oauth:grant-type:device_code") {
			w.WriteHeader(401)
			_ = json.NewEncoder(w).Encode(map[string]any{"error": "invalid_client", "error_description": "cliente desconhecido"})
			return
		}
		switch r.PostForm.Get("grant_type") {
		case "client_credentials":
			tok(w, map[string]any{"refresh_token": ""})
		case "password":
			if r.PostForm.Get("username") != "ana" || r.PostForm.Get("password") != "s3" {
				w.WriteHeader(400)
				_ = json.NewEncoder(w).Encode(map[string]any{"error": "invalid_grant"})
				return
			}
			tok(w, nil)
		case "authorization_code":
			sum := sha256.Sum256([]byte(r.PostForm.Get("code_verifier")))
			if r.PostForm.Get("code") != "codigo-123" || base64.RawURLEncoding.EncodeToString(sum[:]) != as.challenge {
				w.WriteHeader(400)
				_ = json.NewEncoder(w).Encode(map[string]any{"error": "invalid_grant", "error_description": "PKCE não confere"})
				return
			}
			tok(w, nil)
		case "refresh_token":
			tok(w, nil)
		case "urn:ietf:params:oauth:grant-type:device_code":
			if as.pending > 0 {
				as.pending--
				w.WriteHeader(400)
				_ = json.NewEncoder(w).Encode(map[string]any{"error": "authorization_pending"})
				return
			}
			tok(w, nil)
		}
	})
	as.Server = httptest.NewServer(mux)
	t.Cleanup(as.Close)
	return as
}

// "navegador": segue o redirect do servidor e, no implicit, faz o que a página de retorno faria
func browser(t *testing.T) func(string) {
	return func(u string) {
		go func() {
			c := &http.Client{CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
			res, err := c.Get(u)
			if err != nil {
				t.Errorf("navegador: %v", err)
				return
			}
			res.Body.Close()
			loc, _ := url.Parse(res.Header.Get("Location"))
			if loc.Fragment != "" {
				loc.Path, loc.RawQuery, loc.Fragment = "/zeno-fragment", loc.Fragment, ""
			}
			if r2, err := http.Get(loc.String()); err == nil {
				r2.Body.Close()
			}
		}()
	}
}

func manager(t *testing.T) *Manager {
	return &Manager{Dir: t.TempDir(), Vault: fakeVault{}, Interactive: true, WaitTimeout: 5 * time.Second, Hooks: Hooks{Open: browser(t)}}
}

func TestClientCredentialsECache(t *testing.T) {
	as := newAS(t)
	m := manager(t)
	c := Config{Owner: "req_1", Grant: "client_credentials", TokenURL: as.URL + "/token", ClientID: "cliente", ClientSecret: "segredo", Scope: "a b", Audience: "api"}
	t1, err := m.Token(context.Background(), c, false)
	if err != nil || t1.Access != "tk-1" {
		t.Fatalf("%+v %v", t1, err)
	}
	if as.lastBasic != "cliente:segredo" || as.lastForm.Get("scope") != "a b" || as.lastForm.Get("audience") != "api" {
		t.Errorf("pedido: basic=%q form=%v", as.lastBasic, as.lastForm)
	}
	// cache: não pede de novo, nem noutra instância (vem do disco, cifrado)
	t2, _ := m.Token(context.Background(), c, false)
	other := &Manager{Dir: m.Dir, Vault: fakeVault{}}
	t3, _ := other.Token(context.Background(), c, false)
	if t2.Access != "tk-1" || t3.Access != "tk-1" || as.issued != 1 {
		t.Errorf("cache: %s %s emitidos=%d", t2.Access, t3.Access, as.issued)
	}
	// mudou a configuração: pede de novo
	c.Scope = "a"
	if t4, _ := m.Token(context.Background(), c, false); t4.Access != "tk-2" {
		t.Errorf("config mudou: %s", t4.Access)
	}
	// client_id/secret no corpo
	c.ClientAuth = "body"
	if _, err := m.Token(context.Background(), c, true); err != nil || as.lastBasic != ":" || as.lastForm.Get("client_secret") != "segredo" {
		t.Errorf("no corpo: %v basic=%q", err, as.lastBasic)
	}
	// erro do servidor com a descrição
	c.ClientSecret = "errado"
	if _, err := m.Token(context.Background(), c, true); err == nil || !strings.Contains(err.Error(), "cliente desconhecido") {
		t.Errorf("erro: %v", err)
	}
	m.Clear("req_1")
	if m.Status(c) != nil {
		t.Error("limpar")
	}
}

func TestPasswordERefresh(t *testing.T) {
	as := newAS(t)
	m := manager(t)
	c := Config{Owner: "fld_1", Grant: "password", TokenURL: as.URL + "/token", ClientID: "cliente", ClientSecret: "segredo", Username: "ana", Password: "s3"}
	t1, err := m.Token(context.Background(), c, false)
	if err != nil || t1.Refresh == "" {
		t.Fatalf("%+v %v", t1, err)
	}
	// venceu: renova com o refresh token, sem pedir senha de novo
	t1.Expiry = time.Now().Add(-time.Minute)
	m.save(c.Owner, t1)
	t2, err := m.Token(context.Background(), c, false)
	if err != nil || t2.Access == t1.Access || as.lastForm.Get("grant_type") != "refresh_token" || as.lastForm.Get("refresh_token") != t1.Refresh {
		t.Fatalf("refresh: %+v %v %v", t2, err, as.lastForm)
	}
}

func TestAuthorizationCodeComPKCE(t *testing.T) {
	as := newAS(t)
	m := manager(t)
	var waited string
	m.Hooks.Wait = func(msg, u, code string) { waited = msg }
	c := Config{Owner: "req_2", Grant: "authorization_code", AuthURL: as.URL + "/authorize", TokenURL: as.URL + "/token", ClientID: "cliente", ClientSecret: "segredo", PKCE: true, Scope: "perfil"}
	tk, err := m.Token(context.Background(), c, false)
	if err != nil || tk.Access == "" || waited == "" || as.challenge == "" {
		t.Fatalf("%+v %v aviso=%q challenge=%q", tk, err, waited, as.challenge)
	}
	if as.lastForm.Get("code") != "codigo-123" || as.lastForm.Get("code_verifier") == "" || !strings.HasPrefix(as.lastForm.Get("redirect_uri"), "http://127.0.0.1:") {
		t.Errorf("troca do código: %v", as.lastForm)
	}
}

func TestImplicitEDevice(t *testing.T) {
	as := newAS(t)
	m := manager(t)
	tk, err := m.Token(context.Background(), Config{Owner: "req_3", Grant: "implicit", AuthURL: as.URL + "/authorize", ClientID: "cliente"}, false)
	if err != nil || tk.Access != "tk-implicit" || tk.Expiry.IsZero() {
		t.Fatalf("implicit: %+v %v", tk, err)
	}
	as.pending = 1
	var code string
	m.Hooks = Hooks{Wait: func(_, _, c string) { code = c }, Open: func(string) {}}
	tk, err = m.Token(context.Background(), Config{Owner: "req_4", Grant: "device_code", AuthURL: as.URL + "/device", TokenURL: as.URL + "/token", ClientID: "cliente"}, false)
	if err != nil || tk.Access == "" || code != "ABCD-1234" {
		t.Fatalf("device: %+v %v código=%q", tk, err, code)
	}
}

func TestCancelarERedirectInvalido(t *testing.T) {
	as := newAS(t)
	m := manager(t)
	m.Hooks = Hooks{Open: func(string) {}, Wait: func(string, string, string) { go func() { time.Sleep(100 * time.Millisecond); m.Cancel() }() }}
	_, err := m.Token(context.Background(), Config{Owner: "r", Grant: "authorization_code", AuthURL: as.URL + "/authorize", TokenURL: as.URL + "/token", ClientID: "cliente"}, false)
	if err == nil || !strings.Contains(err.Error(), "cancelada") {
		t.Errorf("cancelar: %v", err)
	}
	_, err = m.Token(context.Background(), Config{Owner: "r", Grant: "authorization_code", AuthURL: as.URL + "/authorize", TokenURL: as.URL + "/token", ClientID: "cliente", RedirectURI: "https://app.example/cb"}, false)
	if err == nil || !strings.Contains(err.Error(), "127.0.0.1") {
		t.Errorf("redirect: %v", err)
	}
	// sem navegador (CLI): fluxos interativos avisam
	m.Interactive = false
	_, err = m.Token(context.Background(), Config{Owner: "r", Grant: "authorization_code", AuthURL: as.URL + "/authorize", TokenURL: as.URL + "/token", ClientID: "cliente"}, false)
	if err == nil || !strings.Contains(err.Error(), "navegador") {
		t.Errorf("CLI: %v", err)
	}
}
