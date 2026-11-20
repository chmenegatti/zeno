// Package oauth2: tokens OAuth 2.0 da auth "oauth2" (#9). Fluxos: authorization code (com PKCE),
// client credentials, password, implicit e device code. O login interativo usa o navegador do sistema
// com retorno num servidor local em 127.0.0.1 (RFC 8252), sem janela embutida. O token fica em cache
// por dono da auth (request ou pasta), cifrado no cofre em <dados>/.oauth/<dono>.json; renova sozinho
// com o refresh token e é descartado quando a configuração muda.
package oauth2

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"html"
	"net"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"

	xo "golang.org/x/oauth2"
	"golang.org/x/oauth2/clientcredentials"
)

// Config: campos da auth oauth2 já com variáveis resolvidas
type Config struct {
	// Owner: id do request ou pasta onde a auth está (chave do cache)
	Owner        string
	Grant        string // authorization_code | client_credentials | password | implicit | device_code
	AuthURL      string
	TokenURL     string
	ClientID     string
	ClientSecret string
	Scope        string
	Audience     string
	RedirectURI  string
	PKCE         bool
	Username     string
	Password     string
	// ClientAuth: "body" manda client_id/secret no corpo; senão Basic no header
	ClientAuth string
}

// Token: o que fica no cache
type Token struct {
	Access  string    `json:"access_token"`
	Refresh string    `json:"refresh_token,omitempty"`
	Type    string    `json:"token_type,omitempty"`
	Expiry  time.Time `json:"expiry,omitempty"`
	Hash    string    `json:"config"`
	Scope   string    `json:"scope,omitempty"`
}

// Valid: tem access token e não vence nos próximos 30 s
func (t *Token) Valid() bool {
	return t != nil && t.Access != "" && (t.Expiry.IsZero() || time.Until(t.Expiry) > 30*time.Second)
}

// Cipher: o cofre (vault.Vault)
type Cipher interface {
	Encrypt(string) (string, error)
	Decrypt(string) (string, error)
}

// Hooks: integração com a interface. Open abre o navegador; Wait avisa que está esperando o usuário
// (url e, no device code, o código) e Done tira o aviso.
type Hooks struct {
	Open func(url string)
	Wait func(msg, url, code string)
	Done func()
}

// Manager: tokens de todos os donos
type Manager struct {
	Dir    string
	Vault  Cipher
	Hooks  Hooks
	Client *http.Client
	// Interactive: false na CLI (sem navegador): só client credentials, password e cache
	Interactive bool
	// WaitTimeout: quanto esperar o usuário autorizar no navegador
	WaitTimeout time.Duration

	mu      sync.Mutex
	mem     map[string]*Token
	cancel  context.CancelFunc
	pending sync.Mutex
}

func (m *Manager) file(owner string) string {
	safe := regexp.MustCompile(`[^\w-]`).ReplaceAllString(owner, "_")
	return filepath.Join(m.Dir, ".oauth", safe+".json")
}

// Hash: muda quando muda algo que invalida o token
func Hash(c Config) string {
	// secret e senha entram só como parte do hash (o cache nunca guarda os dois)
	h := sha256.Sum256([]byte(strings.Join([]string{c.Grant, c.AuthURL, c.TokenURL, c.ClientID, c.ClientSecret, c.Scope, c.Audience, c.Username, c.Password, c.ClientAuth}, "\x00")))
	return hex.EncodeToString(h[:8])
}

func (m *Manager) load(owner string) *Token {
	m.mu.Lock()
	defer m.mu.Unlock()
	if t, ok := m.mem[owner]; ok {
		return t
	}
	b, err := os.ReadFile(m.file(owner))
	if err != nil || m.Vault == nil {
		return nil
	}
	plain, err := m.Vault.Decrypt(strings.TrimSpace(string(b)))
	if err != nil {
		return nil
	}
	var t Token
	if json.Unmarshal([]byte(plain), &t) != nil {
		return nil
	}
	if m.mem == nil {
		m.mem = map[string]*Token{}
	}
	m.mem[owner] = &t
	return &t
}

// save: memória sempre; disco só cifrado (sem cofre o token vale só nesta sessão)
func (m *Manager) save(owner string, t *Token) {
	m.mu.Lock()
	if m.mem == nil {
		m.mem = map[string]*Token{}
	}
	m.mem[owner] = t
	m.mu.Unlock()
	if m.Vault == nil {
		return
	}
	b, _ := json.Marshal(t)
	enc, err := m.Vault.Encrypt(string(b))
	if err != nil {
		return
	}
	f := m.file(owner)
	_ = os.MkdirAll(filepath.Dir(f), 0o700)
	_ = os.WriteFile(f, []byte(enc), 0o600)
}

// Clear apaga o token do dono
func (m *Manager) Clear(owner string) {
	m.mu.Lock()
	delete(m.mem, owner)
	m.mu.Unlock()
	_ = os.Remove(m.file(owner))
}

// Status: token em cache válido pra essa configuração (sem buscar)
func (m *Manager) Status(c Config) *Token {
	t := m.load(c.Owner)
	if t == nil || t.Hash != Hash(c) {
		return nil
	}
	return t
}

// Cancel interrompe a espera por autorização no navegador
func (m *Manager) Cancel() {
	m.mu.Lock()
	if m.cancel != nil {
		m.cancel()
	}
	m.mu.Unlock()
}

func (m *Manager) xconf(c Config) *xo.Config {
	style := xo.AuthStyleInHeader
	if c.ClientAuth == "body" {
		style = xo.AuthStyleInParams
	}
	var scopes []string
	if s := strings.TrimSpace(c.Scope); s != "" {
		scopes = strings.Fields(strings.ReplaceAll(s, ",", " "))
	}
	return &xo.Config{
		ClientID: c.ClientID, ClientSecret: c.ClientSecret, Scopes: scopes, RedirectURL: c.RedirectURI,
		Endpoint: xo.Endpoint{AuthURL: c.AuthURL, TokenURL: c.TokenURL, DeviceAuthURL: c.AuthURL, AuthStyle: style},
	}
}

func audience(c Config) []xo.AuthCodeOption {
	if c.Audience == "" {
		return nil
	}
	return []xo.AuthCodeOption{xo.SetAuthURLParam("audience", c.Audience)}
}

// Token: válido do cache, renovado pelo refresh token ou obtido de novo (force = sempre obter de novo)
func (m *Manager) Token(ctx context.Context, c Config, force bool) (*Token, error) {
	if c.TokenURL == "" && c.Grant != "implicit" {
		return nil, errors.New("OAuth 2.0: falta a URL do token")
	}
	if c.ClientID == "" {
		return nil, errors.New("OAuth 2.0: falta o client ID")
	}
	// um fluxo por vez (dois envios seguidos não abrem dois navegadores)
	m.pending.Lock()
	defer m.pending.Unlock()
	hash := Hash(c)
	if !force {
		if t := m.load(c.Owner); t != nil && t.Hash == hash {
			if t.Valid() {
				return t, nil
			}
			if t.Refresh != "" && c.TokenURL != "" {
				if nt, err := m.refresh(ctx, c, t); err == nil {
					return nt, nil
				}
			}
		}
	}
	if m.Client != nil {
		ctx = context.WithValue(ctx, xo.HTTPClient, m.Client)
	}
	var (
		xt  *xo.Token
		err error
	)
	conf := m.xconf(c)
	switch c.Grant {
	case "client_credentials":
		cc := clientcredentials.Config{ClientID: c.ClientID, ClientSecret: c.ClientSecret, TokenURL: c.TokenURL, Scopes: conf.Scopes, AuthStyle: conf.Endpoint.AuthStyle}
		if c.Audience != "" {
			cc.EndpointParams = url.Values{"audience": {c.Audience}}
		}
		xt, err = cc.Token(ctx)
	case "password":
		if c.Audience == "" {
			xt, err = conf.PasswordCredentialsToken(ctx, c.Username, c.Password)
			break
		}
		// PasswordCredentialsToken não aceita parâmetros extras: mesmo pedido, com audience
		pc := clientcredentials.Config{ClientID: c.ClientID, ClientSecret: c.ClientSecret, TokenURL: c.TokenURL, Scopes: conf.Scopes, AuthStyle: conf.Endpoint.AuthStyle,
			EndpointParams: url.Values{"grant_type": {"password"}, "username": {c.Username}, "password": {c.Password}, "audience": {c.Audience}}}
		xt, err = pc.Token(ctx)
	case "authorization_code", "":
		xt, err = m.authCode(ctx, c, conf)
	case "implicit":
		xt, err = m.implicit(ctx, c, conf)
	case "device_code":
		xt, err = m.device(ctx, c, conf)
	default:
		return nil, fmt.Errorf("OAuth 2.0: fluxo %q desconhecido", c.Grant)
	}
	if err != nil {
		return nil, fmt.Errorf("OAuth 2.0: %w", friendly(err))
	}
	t := fromX(xt, hash)
	m.save(c.Owner, t)
	return t, nil
}

func (m *Manager) refresh(ctx context.Context, c Config, old *Token) (*Token, error) {
	if m.Client != nil {
		ctx = context.WithValue(ctx, xo.HTTPClient, m.Client)
	}
	xt, err := m.xconf(c).TokenSource(ctx, &xo.Token{RefreshToken: old.Refresh, Expiry: time.Unix(1, 0)}).Token()
	if err != nil {
		return nil, err
	}
	t := fromX(xt, old.Hash)
	if t.Refresh == "" {
		t.Refresh = old.Refresh
	}
	m.save(c.Owner, t)
	return t, nil
}

func fromX(xt *xo.Token, hash string) *Token {
	t := &Token{Access: xt.AccessToken, Refresh: xt.RefreshToken, Type: xt.TokenType, Expiry: xt.Expiry, Hash: hash}
	if s, ok := xt.Extra("scope").(string); ok {
		t.Scope = s
	}
	return t
}

// erro do servidor de autorização com a descrição dele
func friendly(err error) error {
	var re *xo.RetrieveError
	if errors.As(err, &re) {
		msg := re.ErrorCode
		if re.ErrorDescription != "" {
			msg += ": " + re.ErrorDescription
		}
		if msg == "" {
			msg = fmt.Sprintf("HTTP %d", re.Response.StatusCode)
		}
		return errors.New(msg)
	}
	return err
}

func randomState() string {
	b := make([]byte, 16)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

// callback: servidor local pro retorno do navegador; redirect configurado em localhost/127.0.0.1
// (porta fixa) ou, sem redirect, 127.0.0.1 numa porta livre
func callback(redirect string) (net.Listener, string, string, error) {
	if redirect == "" {
		l, err := net.Listen("tcp", "127.0.0.1:0")
		if err != nil {
			return nil, "", "", err
		}
		return l, fmt.Sprintf("http://127.0.0.1:%d/callback", l.Addr().(*net.TCPAddr).Port), "/callback", nil
	}
	u, err := url.Parse(redirect)
	if err != nil || u.Scheme != "http" || (u.Hostname() != "127.0.0.1" && u.Hostname() != "localhost" && u.Hostname() != "[::1]") {
		return nil, "", "", fmt.Errorf("o retorno (redirect URI) precisa ser http://127.0.0.1:<porta>/… ou http://localhost:<porta>/… pra o Zeno receber a autorização; veio %q", redirect)
	}
	port := u.Port()
	if port == "" {
		port = "80"
	}
	if _, err := strconv.Atoi(port); err != nil {
		return nil, "", "", fmt.Errorf("porta inválida no redirect: %q", redirect)
	}
	l, err := net.Listen("tcp", net.JoinHostPort(u.Hostname(), port))
	if err != nil {
		return nil, "", "", fmt.Errorf("não deu pra escutar em %s (porta ocupada?): %w", u.Host, err)
	}
	path := u.Path
	if path == "" {
		path = "/"
	}
	return l, redirect, path, nil
}

const page = `<!doctype html><meta charset="utf-8"><title>Zeno</title><body style="font:15px system-ui;padding:40px;background:#00121c;color:#e4f3f8">%s</body>`

// wait: espera o resultado do navegador (com timeout e cancelar)
func (m *Manager) wait(ctx context.Context, msg, openURL, code string, got <-chan url.Values) (url.Values, error) {
	timeout := m.WaitTimeout
	if timeout == 0 {
		timeout = 5 * time.Minute
	}
	ctx, cancel := context.WithTimeout(ctx, timeout)
	m.mu.Lock()
	m.cancel = cancel
	m.mu.Unlock()
	defer func() {
		cancel()
		m.mu.Lock()
		m.cancel = nil
		m.mu.Unlock()
		if m.Hooks.Done != nil {
			m.Hooks.Done()
		}
	}()
	if m.Hooks.Wait != nil {
		m.Hooks.Wait(msg, openURL, code)
	}
	if m.Hooks.Open != nil && openURL != "" {
		m.Hooks.Open(openURL)
	}
	select {
	case v := <-got:
		if e := v.Get("error"); e != "" {
			d := v.Get("error_description")
			if d != "" {
				e += ": " + d
			}
			return nil, errors.New(e)
		}
		return v, nil
	case <-ctx.Done():
		if errors.Is(ctx.Err(), context.DeadlineExceeded) {
			return nil, errors.New("tempo esgotado esperando a autorização no navegador")
		}
		return nil, errors.New("autorização cancelada")
	}
}

func (m *Manager) needBrowser() error {
	if !m.Interactive {
		return errors.New("este fluxo precisa do navegador: obtenha o token no app (o cache vale pra CLI) ou use client credentials")
	}
	return nil
}

func (m *Manager) authCode(ctx context.Context, c Config, conf *xo.Config) (*xo.Token, error) {
	if err := m.needBrowser(); err != nil {
		return nil, err
	}
	if c.AuthURL == "" {
		return nil, errors.New("falta a URL de autorização")
	}
	l, redirect, path, err := callback(c.RedirectURI)
	if err != nil {
		return nil, err
	}
	defer l.Close()
	conf.RedirectURL = redirect
	state := randomState()
	got := make(chan url.Values, 1)
	srv := &http.Server{Handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != path {
			http.NotFound(w, r)
			return
		}
		q := r.URL.Query()
		if q.Get("state") != state && q.Get("error") == "" {
			http.Error(w, "state inválido", http.StatusBadRequest)
			return
		}
		ok := q.Get("error") == ""
		fmt.Fprintf(w, page, map[bool]string{true: "Autorizado. Pode voltar pro Zeno.", false: "Autorização recusada: " + html.EscapeString(q.Get("error"))}[ok])
		select {
		case got <- q:
		default:
		}
	})}
	go srv.Serve(l)
	defer srv.Close()
	opts := audience(c)
	var verifier string
	if c.PKCE {
		verifier = xo.GenerateVerifier()
		opts = append(opts, xo.S256ChallengeOption(verifier))
	}
	authURL := conf.AuthCodeURL(state, opts...)
	v, err := m.wait(ctx, "Autorize no navegador que abrimos.", authURL, "", got)
	if err != nil {
		return nil, err
	}
	var ex []xo.AuthCodeOption
	if verifier != "" {
		ex = append(ex, xo.VerifierOption(verifier))
	}
	return conf.Exchange(ctx, v.Get("code"), ex...)
}

// implicit: o token vem no fragmento (#access_token=…), que não chega no servidor: a página de
// retorno lê o fragmento e manda de volta pro servidor local
func (m *Manager) implicit(ctx context.Context, c Config, conf *xo.Config) (*xo.Token, error) {
	if err := m.needBrowser(); err != nil {
		return nil, err
	}
	if c.AuthURL == "" {
		return nil, errors.New("falta a URL de autorização")
	}
	l, redirect, path, err := callback(c.RedirectURI)
	if err != nil {
		return nil, err
	}
	defer l.Close()
	state := randomState()
	got := make(chan url.Values, 1)
	srv := &http.Server{Handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case path:
			fmt.Fprintf(w, page, `Recebendo o token…<script>fetch('/zeno-fragment?'+location.hash.slice(1)).then(()=>document.body.textContent='Autorizado. Pode voltar pro Zeno.')</script>`)
		case "/zeno-fragment":
			q := r.URL.Query()
			if q.Get("state") != state && q.Get("error") == "" {
				http.Error(w, "state inválido", http.StatusBadRequest)
				return
			}
			select {
			case got <- q:
			default:
			}
		default:
			http.NotFound(w, r)
		}
	})}
	go srv.Serve(l)
	defer srv.Close()
	q := url.Values{"response_type": {"token"}, "client_id": {c.ClientID}, "redirect_uri": {redirect}, "state": {state}}
	if len(conf.Scopes) > 0 {
		q.Set("scope", strings.Join(conf.Scopes, " "))
	}
	if c.Audience != "" {
		q.Set("audience", c.Audience)
	}
	sep := "?"
	if strings.Contains(c.AuthURL, "?") {
		sep = "&"
	}
	v, err := m.wait(ctx, "Autorize no navegador que abrimos.", c.AuthURL+sep+q.Encode(), "", got)
	if err != nil {
		return nil, err
	}
	t := &xo.Token{AccessToken: v.Get("access_token"), TokenType: v.Get("token_type")}
	if s, err := strconv.Atoi(v.Get("expires_in")); err == nil && s > 0 {
		t.Expiry = time.Now().Add(time.Duration(s) * time.Second)
	}
	if t.AccessToken == "" {
		return nil, errors.New("o retorno não trouxe access_token")
	}
	return t, nil
}

func (m *Manager) device(ctx context.Context, c Config, conf *xo.Config) (*xo.Token, error) {
	if err := m.needBrowser(); err != nil {
		return nil, err
	}
	if c.AuthURL == "" {
		return nil, errors.New("falta a URL de autorização do dispositivo")
	}
	resp, err := conf.DeviceAuth(ctx, audience(c)...)
	if err != nil {
		return nil, err
	}
	open := resp.VerificationURIComplete
	if open == "" {
		open = resp.VerificationURI
	}
	timeout := m.WaitTimeout
	if timeout == 0 {
		timeout = 5 * time.Minute
	}
	wctx, cancel := context.WithTimeout(ctx, timeout)
	m.mu.Lock()
	m.cancel = cancel
	m.mu.Unlock()
	defer func() {
		cancel()
		m.mu.Lock()
		m.cancel = nil
		m.mu.Unlock()
		if m.Hooks.Done != nil {
			m.Hooks.Done()
		}
	}()
	if m.Hooks.Wait != nil {
		m.Hooks.Wait("Digite o código na página que abrimos.", open, resp.UserCode)
	}
	if m.Hooks.Open != nil {
		m.Hooks.Open(open)
	}
	t, err := conf.DeviceAccessToken(wctx, resp)
	if err != nil && wctx.Err() != nil {
		if errors.Is(wctx.Err(), context.DeadlineExceeded) {
			return nil, errors.New("tempo esgotado esperando a autorização")
		}
		return nil, errors.New("autorização cancelada")
	}
	return t, err
}
