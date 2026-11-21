// Package vars: variáveis {{ nome }}, {{ _.nome }}, {{ _['X-API-Key'] }} com herança base → sub-ambiente → pastas
// (port de src/shared/template.ts e prepare.ts; tags {% %} ficam de fora no protótipo).

package vars

import (
	"encoding/base64"
	"encoding/json"
	"github.com/chmenegatti/zeno/wails/internal/doc"
	"net/url"
	"regexp"
	"strconv"
	"strings"
)

type Doc = doc.Doc

var (
	varRe  = regexp.MustCompile(`\{\{\s*([A-Za-z0-9_$.\-\[\]'"]+)\s*\}\}`)
	tagRe  = regexp.MustCompile(`\{%.*?%\}`)
	partRe = regexp.MustCompile(`\[\s*(['"])(.*?)['"]\s*\]|\[\s*([^\]]*?)\s*\]|([^.\[\]]+)`)
	schRe  = regexp.MustCompile(`(?i)^[a-z][a-z0-9+.-]*://`)
)

// Path divide o caminho da variável: nome, _.nome, _['X-API-Key'], a.b, a[0]
func Path(p string) []string {
	parts := []string{}
	for _, m := range partRe.FindAllStringSubmatch(p, -1) {
		switch {
		case m[1] != "":
			parts = append(parts, m[2])
		case m[3] != "":
			parts = append(parts, m[3])
		default:
			parts = append(parts, m[4])
		}
	}
	if len(parts) > 1 && parts[0] == "_" {
		return parts[1:]
	}
	return parts
}

func lookup(vars *Doc, p string) (any, bool) {
	var cur any = vars
	for _, part := range Path(p) {
		switch c := cur.(type) {
		case *Doc:
			if !c.Has(part) {
				return nil, false
			}
			cur = c.Get(part)
		case []any:
			i, err := strconv.Atoi(part)
			if err != nil || i < 0 || i >= len(c) {
				return nil, false
			}
			cur = c[i]
		default:
			return nil, false
		}
	}
	return cur, true
}

type renderer struct {
	vars        *Doc
	tags        map[string]string
	missing     map[string]bool
	unsupported map[string]bool
}

// Render resolve {{ variáveis }} (tags ficam como estão), como render(text, vars).value no Electron
func Render(text string, vars *Doc) string {
	r := &renderer{vars: vars, missing: map[string]bool{}, unsupported: map[string]bool{}}
	return r.render(text, 0)
}

func (r *renderer) render(in string, depth int) string {
	if !strings.Contains(in, "{{") && !strings.Contains(in, "{%") {
		return in
	}
	// tags já resolvidas entram no lugar; as outras ficam e viram aviso
	in = tagRe.ReplaceAllStringFunc(in, func(tag string) string {
		if v, ok := r.tags[tag]; ok {
			return v
		}
		r.unsupported[tag] = true
		return tag
	})
	return varRe.ReplaceAllStringFunc(in, func(whole string) string {
		p := varRe.FindStringSubmatch(whole)[1]
		v, ok := lookup(r.vars, p)
		if !ok {
			r.missing[p] = true
			return whole
		}
		switch x := v.(type) {
		case string:
			if depth < 5 && (strings.Contains(x, "{{") || strings.Contains(x, "{%")) {
				return r.render(x, depth+1)
			}
			return x
		case nil:
			return "null"
		case *Doc, []any:
			b, _ := json.Marshal(x)
			return string(b)
		default:
			return doc.AsStr(x)
		}
	})
}

func deepMerge(a, b *Doc) *Doc {
	out := a.Clone()
	if out == nil {
		out = doc.New()
	}
	for _, k := range b.Keys() {
		v := b.Get(k)
		pa, okA := out.Get(k).(*Doc)
		pb, okB := v.(*Doc)
		if okA && okB {
			out.Set(k, deepMerge(pa, pb))
		} else {
			out.Set(k, v)
		}
	}
	return out
}

// BuildVars: base → sub-ambiente ativo → pastas (da raiz até a mais próxima)
func BuildVars(ws *Doc, envID string, folders []*Doc) *Doc {
	vars := doc.New()
	envs := ws.List("environments")
	for _, e := range envs {
		if d, _ := e.(*Doc); d != nil && d.Get("parentId") == nil {
			if data := d.Map("data"); data != nil {
				vars = deepMerge(vars, data)
			}
		}
	}
	for _, e := range envs {
		if d, _ := e.(*Doc); d != nil && envID != "" && d.Str("id") == envID && d.Get("parentId") != nil {
			if data := d.Map("data"); data != nil {
				vars = deepMerge(vars, data)
			}
		}
	}
	for _, f := range folders {
		if v := f.Map("vars"); v != nil {
			vars = deepMerge(vars, v)
		}
	}
	// valores locais (#153), que não vão pro git: os do Base e depois os do sub-ambiente ativo vencem tudo
	if lv := ws.Map("localVars"); lv != nil {
		for _, e := range envs {
			if d, _ := e.(*Doc); d != nil && d.Get("parentId") == nil {
				if m := lv.Map(d.Str("id")); m != nil {
					vars = deepMerge(vars, m)
				}
			}
		}
		for _, e := range envs {
			if d, _ := e.(*Doc); d != nil && envID != "" && d.Str("id") == envID && d.Get("parentId") != nil {
				if m := lv.Map(envID); m != nil {
					vars = deepMerge(vars, m)
				}
			}
		}
	}
	return vars
}

type kv struct{ name, value string }

func kvs(v any) []kv {
	arr, _ := v.([]any)
	out := []kv{}
	for _, it := range arr {
		m, _ := it.(*Doc)
		if m == nil || m.Get("enabled") == false || m.Str("name") == "" {
			continue
		}
		out = append(out, kv{m.Str("name"), m.Str("value")})
	}
	return out
}

// Prepared: o request pronto pra enviar
type Prepared struct {
	Method, URL string
	Headers     [][2]string
	BodyKind    string // none | text | form | multipart
	Text        string
	Form        [][2]string
	Multipart   []Part
	InsecureTLS bool
	TimeoutMs   float64
	// por request (#151): não seguir redirects; MaxRedirects 0 = padrão (10)
	NoRedirects  bool
	MaxRedirects int
	// Net: proxy, CA própria e certificados de cliente do workspace (#18)
	Net Net
	// OAuth2: auth oauth2 efetiva (do request ou herdada); o motor busca o token e põe o header (#9)
	OAuth2      *OAuth2
	Missing     []string
	Unsupported []string
}

// Net: rede do workspace. ProxyMode: "" ou "none" (sem proxy), "system" (HTTP(S)_PROXY/NO_PROXY) ou
// "custom" (ProxyURL, com NoProxy). CAFile: PEM somado às CAs do sistema.
type Net struct {
	ProxyMode, ProxyURL, NoProxy string
	CAFile                       string
	ClientCerts                  []ClientCert
}

// ClientCert: certificado de cliente (mTLS) pra um host: PEM (Cert + Key; Key vazio = no mesmo arquivo)
// ou PFX/P12 com Passphrase. Host: "api.x.com", "api.x.com:8443" ou "*.x.com".
type ClientCert struct {
	Host, Cert, Key, PFX, Passphrase string
}

// OAuth2: campos da auth oauth2 já resolvidos; Owner = id do request ou pasta onde ela está
type OAuth2 struct {
	Owner, Grant, AuthURL, TokenURL, ClientID, ClientSecret, Scope, Audience, RedirectURI string
	Username, Password, ClientAuth, Prefix                                                string
	PKCE                                                                                  bool
}

// Part: campo de multipart (File = caminho do arquivo no disco)
type Part struct {
	Name, Value, File string
}

// Prepare monta o request final: variáveis, auth e headers herdados (port de prepare.ts)
func Prepare(ws, req *Doc, anc []*Doc, envID string, tagValues map[string]string) Prepared {
	r := &renderer{vars: BuildVars(ws, envID, anc), tags: tagValues, missing: map[string]bool{}, unsupported: map[string]bool{}}
	R := func(s string) string { return r.render(s, 0) }
	// :id / {id} no path viram o valor (com variáveis); sem valor, o trecho fica como está
	pathValues := map[string]string{}
	for _, x := range req.List("pathParams") {
		if p, ok := x.(*Doc); ok {
			pathValues[p.Str("name")] = p.Str("value")
		}
	}
	u := strings.TrimSpace(R(ReplacePathParams(req.Str("url"), func(n string) (string, bool) {
		v := pathValues[n]
		return v, v != ""
	})))
	if u != "" && !schRe.MatchString(u) && !strings.HasPrefix(u, "{{") && !strings.HasPrefix(u, "{%") {
		u = "http://" + u
	}
	query := [][2]string{}
	for _, p := range kvs(req.Get("params")) {
		query = append(query, [2]string{R(p.name), R(p.value)})
	}
	// headers das pastas (raiz primeiro) + do request; request vence em nome igual
	order := []string{}
	hm := map[string]kv{}
	for _, f := range anc {
		for _, h := range kvs(f.Get("headers")) {
			k := strings.ToLower(h.name)
			if _, ok := hm[k]; !ok {
				order = append(order, k)
			}
			hm[k] = h
		}
	}
	for _, h := range kvs(req.Get("headers")) {
		k := strings.ToLower(h.name)
		if _, ok := hm[k]; !ok {
			order = append(order, k)
		}
		hm[k] = h
	}
	headers := [][2]string{}
	for _, k := range order {
		headers = append(headers, [2]string{R(hm[k].name), R(hm[k].value)})
	}
	has := func(n string) bool {
		for _, h := range headers {
			if strings.EqualFold(h[0], n) {
				return true
			}
		}
		return false
	}
	var oauthAuth *OAuth2
	auth := req.Map("auth")
	owner := req.Str("id")
	for i := len(anc) - 1; auth.Str("type") == "inherit" && i >= 0; i-- {
		auth = anc[i].Map("auth")
		owner = anc[i].Str("id")
	}
	switch auth.Str("type") {
	case "basic":
		if !has("authorization") {
			headers = append(headers, [2]string{"Authorization", "Basic " + base64.StdEncoding.EncodeToString([]byte(R(auth.Str("username"))+":"+R(auth.Str("password"))))})
		}
	case "bearer":
		if !has("authorization") {
			pre := R(auth.Str("prefix"))
			if pre == "" {
				pre = "Bearer"
			}
			headers = append(headers, [2]string{"Authorization", strings.TrimSpace(pre + " " + R(auth.Str("token")))})
		}
	case "oauth2":
		o := &OAuth2{Owner: owner, Grant: auth.Str("grantType"), PKCE: auth.Get("pkce") == true, ClientAuth: auth.Str("clientAuth")}
		for _, f := range []struct {
			dst *string
			key string
		}{{&o.AuthURL, "authUrl"}, {&o.TokenURL, "tokenUrl"}, {&o.ClientID, "clientId"}, {&o.ClientSecret, "clientSecret"}, {&o.Scope, "scope"},
			{&o.Audience, "audience"}, {&o.RedirectURI, "redirectUri"}, {&o.Username, "username"}, {&o.Password, "password"}, {&o.Prefix, "prefix"}} {
			*f.dst = strings.TrimSpace(R(auth.Str(f.key)))
		}
		if o.Prefix == "" {
			o.Prefix = "Bearer"
		}
		if !has("authorization") {
			oauthAuth = o
		}
	case "apikey":
		if auth.Str("key") != "" {
			if auth.Str("addTo") == "query" {
				query = append(query, [2]string{R(auth.Str("key")), R(auth.Str("value"))})
			} else {
				headers = append(headers, [2]string{R(auth.Str("key")), R(auth.Str("value"))})
			}
		}
	}
	if len(query) > 0 {
		parts := make([]string, len(query))
		for i, q := range query {
			parts[i] = url.QueryEscape(q[0]) + "=" + url.QueryEscape(q[1])
		}
		sep := "?"
		if strings.Contains(u, "?") {
			sep = "&"
		}
		u += sep + strings.Join(parts, "&")
	}
	p := Prepared{Method: req.Str("method"), URL: u, BodyKind: "none"}
	body := req.Map("body")
	mime := body.Str("mime")
	switch {
	case mime == "application/x-www-form-urlencoded":
		p.BodyKind = "form"
		for _, f := range kvs(body.Get("fields")) {
			p.Form = append(p.Form, [2]string{R(f.name), R(f.value)})
		}
		if !has("content-type") {
			headers = append(headers, [2]string{"Content-Type", mime})
		}
	case mime == "multipart/form-data":
		// Content-Type com o boundary vem do envio
		p.BodyKind = "multipart"
		for _, it := range body.List("fields") {
			f, _ := it.(*Doc)
			if f == nil || f.Get("enabled") == false || f.Str("name") == "" {
				continue
			}
			p.Multipart = append(p.Multipart, Part{Name: R(f.Str("name")), Value: R(f.Str("value")), File: f.Str("file")})
		}
	case mime != "":
		p.BodyKind = "text"
		p.Text = R(body.Str("text"))
		if !has("content-type") {
			ct := mime
			if mime == "application/graphql" {
				ct = "application/json"
			}
			headers = append(headers, [2]string{"Content-Type", ct})
		}
	}
	p.Headers = headers
	p.OAuth2 = oauthAuth
	settings := ws.Map("settings")
	p.InsecureTLS = settings.Get("insecureTLS") == true
	p.TimeoutMs = settings.Num("timeoutMs", 30000)
	// configurações do request (#151): o que estiver definido vale sobre o workspace
	if rs := req.Map("settings"); rs != nil {
		if rs.Has("timeoutMs") {
			p.TimeoutMs = rs.Num("timeoutMs", p.TimeoutMs)
		}
		if rs.Has("insecureTLS") {
			p.InsecureTLS = rs.Get("insecureTLS") == true
		}
		p.NoRedirects = rs.Get("followRedirects") == false
		if rs.Has("maxRedirects") {
			p.MaxRedirects = int(rs.Num("maxRedirects", 0))
		}
	}
	if px := settings.Map("proxy"); px != nil {
		p.Net.ProxyMode = px.Str("mode")
		p.Net.ProxyURL = strings.TrimSpace(R(px.Str("url")))
		p.Net.NoProxy = strings.TrimSpace(R(px.Str("noProxy")))
	}
	p.Net.CAFile = strings.TrimSpace(R(settings.Str("caFile")))
	for _, x := range settings.List("clientCerts") {
		if d, ok := x.(*Doc); ok && d != nil {
			p.Net.ClientCerts = append(p.Net.ClientCerts, ClientCert{
				Host: strings.TrimSpace(R(d.Str("host"))), Cert: strings.TrimSpace(R(d.Str("cert"))), Key: strings.TrimSpace(R(d.Str("key"))),
				PFX: strings.TrimSpace(R(d.Str("pfx"))), Passphrase: R(d.Str("passphrase")),
			})
		}
	}
	for m := range r.missing {
		p.Missing = append(p.Missing, m)
	}
	for t := range r.unsupported {
		p.Unsupported = append(p.Unsupported, t)
	}
	return p
}

// Input: o request preparado no formato SendInput do Electron (gerar código no renderer)
func (p Prepared) Input(requestID string) *Doc {
	pairs := func(kv [][2]string) []any {
		out := make([]any, len(kv))
		for i, x := range kv {
			out[i] = []any{x[0], x[1]}
		}
		return out
	}
	body := doc.New("kind", "none")
	switch p.BodyKind {
	case "text":
		body = doc.New("kind", "text", "text", p.Text)
	case "form":
		body = doc.New("kind", "form", "fields", pairs(p.Form))
	case "multipart":
		fields := make([]any, len(p.Multipart))
		for i, f := range p.Multipart {
			d := doc.New("name", f.Name, "value", f.Value)
			if f.File != "" {
				d.Set("file", f.File)
			}
			fields[i] = d
		}
		body = doc.New("kind", "multipart", "fields", fields)
	}
	return doc.New("requestId", requestID, "method", p.Method, "url", p.URL, "headers", pairs(p.Headers),
		"body", body, "insecureTLS", p.InsecureTLS, "timeoutMs", p.TimeoutMs)
}
