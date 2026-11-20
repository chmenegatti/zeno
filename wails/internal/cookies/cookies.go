// Package cookies: cookie jar por workspace (port de src/main/cookies.ts).
//
// Guarda o Set-Cookie das respostas e manda nos requests seguintes. Persiste em
// <dataDir>/.cookies/<wsId>.json no formato do tough-cookie (o mesmo arquivo abre no Electron);
// sem pasta = só memória, como na CLI. Modo tolerante como o do Electron: sem lista de sufixos
// públicos e aceitando domínios de uso especial (localhost, .local, IPs).
package cookies

import (
	"net"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"slices"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/chmenegatti/zeno/wails/internal/doc"
)

type Doc = doc.Doc

// Info: cookie como a tela de cookies mostra e edita (CookieInfo)
type Info struct {
	Key      string `json:"key"`
	Value    string `json:"value"`
	Domain   string `json:"domain"`
	Path     string `json:"path"`
	Expires  string `json:"expires,omitempty"`
	Secure   bool   `json:"secure"`
	HTTPOnly bool   `json:"httpOnly"`
	HostOnly bool   `json:"hostOnly,omitempty"`
}

// cookie guardado: os campos do tough-cookie (o *Doc preserva o que não conhecemos)
type cookie struct {
	raw *Doc
}

func (c cookie) key() string    { return c.raw.Str("key") }
func (c cookie) domain() string { return c.raw.Str("domain") }
func (c cookie) path() string   { return c.raw.Str("path") }

func parseTime(s string) (time.Time, bool) {
	t, err := time.Parse(time.RFC3339Nano, s)
	return t, err == nil
}

// expiry: quando vence (zero = cookie de sessão, nunca vence no jar)
func (c cookie) expiry() time.Time {
	switch ma := c.raw.Get("maxAge").(type) {
	case int64, float64:
		created, _ := parseTime(c.raw.Str("creation"))
		secs := c.raw.Num("maxAge", 0)
		if secs <= 0 {
			return time.Unix(0, 0)
		}
		return created.Add(time.Duration(secs * float64(time.Second)))
	case string:
		if ma == "-Infinity" {
			return time.Unix(0, 0)
		}
		if ma == "Infinity" {
			return time.Time{}
		}
	}
	if e := c.raw.Str("expires"); e != "" && e != "Infinity" {
		if t, ok := parseTime(e); ok {
			return t
		}
	}
	return time.Time{}
}

func (c cookie) expired(now time.Time) bool {
	e := c.expiry()
	return !e.IsZero() && !e.After(now)
}

// Cookies: jars de todos os workspaces
type Cookies struct {
	dir  string
	mu   sync.Mutex
	jars map[string][]cookie
	now  func() time.Time
}

// New: dir vazio = só memória
func New(dir string) *Cookies {
	return &Cookies{dir: dir, jars: map[string][]cookie{}, now: time.Now}
}

var unsafeName = regexp.MustCompile(`[^\w-]`)

func (c *Cookies) file(wsID string) string {
	return filepath.Join(c.dir, ".cookies", unsafeName.ReplaceAllString(wsID, "_")+".json")
}

func (c *Cookies) jar(wsID string) []cookie {
	if j, ok := c.jars[wsID]; ok {
		return j
	}
	j := []cookie{}
	if c.dir != "" {
		if b, err := os.ReadFile(c.file(wsID)); err == nil {
			if v, err := doc.FromJSON(b); err == nil {
				if d, ok := v.(*Doc); ok {
					for _, x := range d.List("cookies") {
						if cd, ok := x.(*Doc); ok {
							j = append(j, cookie{cd})
						}
					}
				}
			}
		}
	}
	c.jars[wsID] = j
	return j
}

// grava como o serializeSync do tough-cookie, sem os vencidos
func (c *Cookies) persist(wsID string) {
	if c.dir == "" {
		return
	}
	now := c.now()
	list := []any{}
	for _, k := range c.jar(wsID) {
		if !k.expired(now) {
			list = append(list, k.raw)
		}
	}
	data := doc.New(
		"version", "tough-cookie@6.0.2",
		"storeType", "MemoryCookieStore",
		"rejectPublicSuffixes", false,
		"enableLooseMode", true,
		"allowSpecialUseDomain", true,
		"prefixSecurity", "silent",
		"cookies", list,
	)
	b, err := doc.MarshalIndent(data)
	if err != nil {
		return
	}
	_ = os.MkdirAll(filepath.Dir(c.file(wsID)), 0o755)
	_ = os.WriteFile(c.file(wsID), b, 0o644)
}

func iso(t time.Time) string { return t.UTC().Format("2006-01-02T15:04:05.000Z") }

// ---------- regras (RFC 6265) ----------

func canonHost(h string) string {
	h = strings.ToLower(strings.TrimSuffix(h, "."))
	return strings.Trim(h, "[]")
}

// domínio do cookie vale pro host?
func domainMatch(host, domain string) bool {
	if host == domain {
		return true
	}
	if net.ParseIP(host) != nil {
		return false
	}
	return strings.HasSuffix(host, "."+domain)
}

// caminho padrão: pasta do caminho da URL
func defaultPath(p string) string {
	if p == "" || p[0] != '/' {
		return "/"
	}
	i := strings.LastIndex(p, "/")
	if i == 0 {
		return "/"
	}
	return p[:i]
}

func pathMatch(reqPath, cookiePath string) bool {
	if reqPath == cookiePath {
		return true
	}
	if strings.HasPrefix(reqPath, cookiePath) {
		return strings.HasSuffix(cookiePath, "/") || reqPath[len(cookiePath)] == '/'
	}
	return false
}

func httpDate(s string) (time.Time, bool) {
	for _, f := range []string{time.RFC1123, "Mon, 02-Jan-2006 15:04:05 MST", "Mon, 02 Jan 2006 15:04:05 -0700", time.RFC850, time.ANSIC, "Mon, 2 Jan 2006 15:04:05 MST", "Mon, 02-Jan-06 15:04:05 MST"} {
		if t, err := time.Parse(f, s); err == nil {
			return t, true
		}
	}
	return time.Time{}, false
}

// parse do Set-Cookie no modo tolerante (cookie sem "=" vira só valor, chave vazia)
func parse(sc string, u *url.URL, now time.Time) (*Doc, bool) {
	parts := strings.Split(sc, ";")
	first := strings.TrimSpace(parts[0])
	key, value := "", first
	if i := strings.Index(first, "="); i >= 0 {
		key, value = strings.TrimSpace(first[:i]), strings.TrimSpace(first[i+1:])
	}
	if key == "" && value == "" {
		return nil, false
	}
	var expires, maxAge any
	var domainAttr, pathAttr, sameSite string
	secure, httpOnly := false, false
	for _, a := range parts[1:] {
		a = strings.TrimSpace(a)
		name, val := a, ""
		if i := strings.Index(a, "="); i >= 0 {
			name, val = strings.TrimSpace(a[:i]), strings.TrimSpace(a[i+1:])
		}
		switch strings.ToLower(name) {
		case "expires":
			if t, ok := httpDate(val); ok {
				expires = iso(t)
			}
		case "max-age":
			if n, err := strconv.Atoi(val); err == nil {
				maxAge = int64(n)
			}
		case "domain":
			domainAttr = strings.ToLower(strings.TrimPrefix(val, "."))
		case "path":
			pathAttr = val
		case "secure":
			secure = true
		case "httponly":
			httpOnly = true
		case "samesite":
			sameSite = strings.ToLower(val)
		}
	}
	// prefixos (como o tough-cookie, modo "silent": recusa sem erro)
	secureOrigin := u.Scheme == "https" || u.Scheme == "wss"
	lk := strings.ToLower(key)
	if strings.HasPrefix(lk, "__secure-") && (!secure || !secureOrigin) {
		return nil, false
	}
	if strings.HasPrefix(lk, "__host-") && (!secure || !secureOrigin || domainAttr != "" || pathAttr != "/") {
		return nil, false
	}
	host := canonHost(u.Hostname())
	hostOnly := true
	domain := host
	if domainAttr != "" {
		if !domainMatch(host, domainAttr) {
			return nil, false
		}
		domain, hostOnly = domainAttr, false
	}
	path, pathIsDefault := pathAttr, false
	if path == "" || path[0] != '/' {
		path, pathIsDefault = defaultPath(u.EscapedPath()), true
	}
	d := doc.New("key", key, "value", value)
	if expires != nil {
		d.Set("expires", expires)
	}
	if maxAge != nil {
		d.Set("maxAge", maxAge)
	}
	d.Set("domain", domain)
	d.Set("path", path)
	if secure {
		d.Set("secure", true)
	}
	if httpOnly {
		d.Set("httpOnly", true)
	}
	d.Set("hostOnly", hostOnly)
	if pathIsDefault {
		d.Set("pathIsDefault", true)
	}
	d.Set("creation", iso(now))
	d.Set("lastAccessed", iso(now))
	if sameSite != "" {
		d.Set("sameSite", sameSite)
	}
	return d, true
}

func (c *Cookies) put(wsID string, d *Doc) {
	j := c.jar(wsID)
	nc := cookie{d}
	for i, old := range j {
		if old.key() == nc.key() && old.domain() == nc.domain() && old.path() == nc.path() {
			// mesmo cookie: mantém a data de criação
			if cr := old.raw.Str("creation"); cr != "" {
				d.Set("creation", cr)
			}
			j = slices.Delete(j, i, i+1)
			break
		}
	}
	if !nc.expired(c.now()) {
		j = append(j, nc)
	}
	c.jars[wsID] = j
}

// Header: valor do header Cookie pra essa URL (sem os vencidos)
func (c *Cookies) Header(wsID, rawURL string) string {
	u, err := url.Parse(rawURL)
	if err != nil || u.Host == "" {
		return ""
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	now := c.now()
	host := canonHost(u.Hostname())
	p := u.EscapedPath()
	if p == "" {
		p = "/"
	}
	secure := u.Scheme == "https" || u.Scheme == "wss"
	var match []cookie
	for _, k := range c.jar(wsID) {
		if k.expired(now) {
			continue
		}
		if k.raw.Get("hostOnly") == true {
			if host != k.domain() {
				continue
			}
		} else if !domainMatch(host, k.domain()) {
			continue
		}
		if !pathMatch(p, k.path()) || (k.raw.Get("secure") == true && !secure) {
			continue
		}
		match = append(match, k)
	}
	// caminho mais longo primeiro; empate pela criação (RFC 6265 5.4)
	slices.SortStableFunc(match, func(a, b cookie) int {
		if d := len(b.path()) - len(a.path()); d != 0 {
			return d
		}
		return strings.Compare(a.raw.Str("creation"), b.raw.Str("creation"))
	})
	out := make([]string, len(match))
	for i, k := range match {
		if k.key() == "" {
			out[i] = k.raw.Str("value")
		} else {
			out[i] = k.key() + "=" + k.raw.Str("value")
		}
	}
	return strings.Join(out, "; ")
}

// Store guarda os Set-Cookie de uma resposta; devolve quantos entraram
func (c *Cookies) Store(wsID, rawURL string, setCookies []string) int {
	if len(setCookies) == 0 {
		return 0
	}
	u, err := url.Parse(rawURL)
	if err != nil {
		return 0
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	n := 0
	now := c.now()
	for _, sc := range setCookies {
		if d, ok := parse(sc, u, now); ok {
			c.put(wsID, d)
			n++
		}
	}
	c.persist(wsID)
	return n
}

// List: cookies válidos, por domínio e nome
func (c *Cookies) List(wsID string) []Info {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.list(wsID)
}

func (c *Cookies) list(wsID string) []Info {
	now := c.now()
	out := []Info{}
	for _, k := range c.jar(wsID) {
		if k.expired(now) {
			continue
		}
		i := Info{Key: k.key(), Value: k.raw.Str("value"), Domain: k.domain(), Path: k.path(), Secure: k.raw.Get("secure") == true, HTTPOnly: k.raw.Get("httpOnly") == true, HostOnly: k.raw.Get("hostOnly") == true}
		if i.Path == "" {
			i.Path = "/"
		}
		if e := k.expiry(); !e.IsZero() {
			i.Expires = iso(e)
		}
		out = append(out, i)
	}
	slices.SortStableFunc(out, func(a, b Info) int {
		if d := strings.Compare(strings.ToLower(a.Domain), strings.ToLower(b.Domain)); d != 0 {
			return d
		}
		return strings.Compare(strings.ToLower(a.Key), strings.ToLower(b.Key))
	})
	return out
}

// Replace troca o jar inteiro pela lista editada na tela
func (c *Cookies) Replace(wsID string, list []Info) []Info {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.jars[wsID] = []cookie{}
	now := c.now()
	for _, i := range list {
		if i.Key == "" || i.Domain == "" {
			continue
		}
		d := doc.New("key", i.Key, "value", i.Value)
		if i.Expires != "" {
			if t, ok := parseTime(i.Expires); ok {
				d.Set("expires", iso(t))
			}
		}
		d.Set("domain", strings.ToLower(strings.TrimPrefix(i.Domain, ".")))
		p := i.Path
		if p == "" {
			p = "/"
		}
		d.Set("path", p)
		if i.Secure {
			d.Set("secure", true)
		}
		if i.HTTPOnly {
			d.Set("httpOnly", true)
		}
		d.Set("hostOnly", i.HostOnly)
		d.Set("creation", iso(now))
		d.Set("lastAccessed", iso(now))
		c.put(wsID, d)
	}
	c.persist(wsID)
	return c.list(wsID)
}

// Clear apaga todos os cookies do workspace
func (c *Cookies) Clear(wsID string) { c.Replace(wsID, nil) }
