// Package tags: tags {% %} compatíveis com o Insomnia (port de src/main/tags.ts e src/shared/tagdef.ts).
//
//	{% response 'body'|'raw'|'header'|'url', 'req_id', 'b64::<filtro>'|'<filtro>', 'never'|'no-history'|'when-expired'|'always', maxAgeSeg %}
//	{% uuid 'v4' %}   {% now %}   {% timestamp %}  {% faker %}  {% hash %}  {% base64 %}  {% file %}  {% prompt %}  {% jsonpath %}
package tags

import (
	"crypto/md5"
	"crypto/rand"
	"crypto/sha1"
	"crypto/sha256"
	"crypto/sha512"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"hash"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"

	"github.com/chmenegatti/zeno/wails/internal/doc"
	"github.com/chmenegatti/zeno/wails/internal/i18n"
	"github.com/chmenegatti/zeno/wails/internal/jsonq"
)

// ---------- ler a tag ----------

var argRe = regexp.MustCompile(`'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)"|([^,\s]+)`)
var unesc = regexp.MustCompile(`\\(['"\\])`)

// ParseArgs: nome e argumentos da tag
func ParseArgs(tag string) (string, []string) {
	inner := strings.TrimSpace(strings.TrimSuffix(strings.TrimPrefix(strings.TrimSpace(tag), "{%"), "%}"))
	// {% %} vazio: nome vazio, sem argumentos (como o parseArgs do Electron), nunca panic
	name := ""
	if f := strings.Fields(inner); len(f) > 0 {
		name = f[0]
	}
	rest := inner[len(name):]
	args := []string{}
	for _, m := range argRe.FindAllStringSubmatchIndex(rest, -1) {
		var v string
		switch {
		case m[2] >= 0:
			v = rest[m[2]:m[3]]
		case m[4] >= 0:
			v = rest[m[4]:m[5]]
		default:
			v = rest[m[6]:m[7]]
		}
		args = append(args, unesc.ReplaceAllString(v, "$1"))
	}
	return name, args
}

var b64Filter = regexp.MustCompile(`^b64::([A-Za-z0-9+/=]*)(?:::\w+)?$`)

// DecodeFilter: 'b64::JC5h…::46b' (Insomnia) ou texto puro
func DecodeFilter(f string) string {
	m := b64Filter.FindStringSubmatch(f)
	if m == nil {
		return f
	}
	b, err := base64.StdEncoding.DecodeString(m[1])
	if err != nil {
		return f
	}
	return string(b)
}

// argumentos padrão de cada função (FN_SPECS do Electron)
var fnDefaults = map[string][]string{
	"timestamp": {"millis"},
	"faker":     {"randomEmail"},
	"hash":      {"sha256", "hex", ""},
	"base64":    {"encode", "normal", ""},
	"file":      {""},
	"prompt":    {"", "", "", "", "false"},
	"jsonpath":  {"", "$."},
}

// IsFn: função sem efeito em outros requests
func IsFn(name string) bool { _, ok := fnDefaults[name]; return ok }

// FnArgs: argumentos completos (aceita as formas curtas: hash/base64 com 2 args)
func FnArgs(name string, args []string) []string {
	if (name == "hash" || name == "base64") && len(args) == 2 {
		mid := "hex"
		if name == "base64" {
			mid = "normal"
		}
		args = []string{args[0], mid, args[1]}
	}
	def := fnDefaults[name]
	out := make([]string, len(def))
	for i := range def {
		if i < len(args) {
			out[i] = args[i]
		} else {
			out[i] = def[i]
		}
	}
	return out
}

// ---------- funções ----------

// Prompt: pergunta ao usuário
type Prompt struct {
	Title        string `json:"title"`
	Label        string `json:"label,omitempty"`
	DefaultValue string `json:"defaultValue,omitempty"`
	Key          string `json:"key,omitempty"`
	Mask         bool   `json:"mask"`
}

// ErrPromptCancelled: usuário cancelou a pergunta; o envio para
type ErrPromptCancelled struct{ Title string }

func (e *ErrPromptCancelled) Error() string {
	return i18n.T("envio cancelado (pergunta %q sem resposta)", e.Title)
}

// Context do envio: últimas respostas, enviar dependência, perguntar…
type Context struct {
	// Latest: última resposta do request (com body completo), nil se não há
	Latest func(requestID string) *doc.Doc
	// SendByID: envia o request (com as próprias dependências) e devolve a resposta
	SendByID func(requestID string) (*doc.Doc, error)
	// ResolveRequest: id a partir de id ou nome ("Pasta / Nome")
	ResolveRequest func(ref string) string
	// Render: resolve {{ variáveis }} dentro dos argumentos
	Render func(string) string
	// Ask: pergunta ao usuário; ok=false = cancelou
	Ask func(Prompt) (string, bool)
	// Plugin: tag de plugin ({% minha_funcao %}); ok=false = nenhum plugin tem
	Plugin func(name string, args []string) (string, bool, error)
	// NoSend: nunca reenvia (gerar código)
	NoSend bool
	// Now: relógio (testes)
	Now func() time.Time
}

func (c *Context) now() time.Time {
	if c.Now != nil {
		return c.Now()
	}
	return time.Now()
}

// EvalFn: timestamp, faker, hash, base64, file, prompt, jsonpath
func EvalFn(name string, raw []string, c *Context) (string, error) {
	a := FnArgs(name, raw)
	if c != nil && c.Render != nil {
		for i := range a {
			a[i] = c.Render(a[i])
		}
	}
	if c == nil {
		c = &Context{}
	}
	switch name {
	case "timestamp":
		t := c.now()
		switch a[0] {
		case "unix":
			return fmt.Sprint(t.Unix()), nil
		case "iso":
			return isoNow(t), nil
		}
		return fmt.Sprint(t.UnixMilli()), nil
	case "faker":
		return Fake(a[0])
	case "hash":
		var h hash.Hash
		switch strings.ToLower(a[0]) {
		case "md5":
			h = md5.New()
		case "sha1":
			h = sha1.New()
		case "sha256":
			h = sha256.New()
		case "sha512":
			h = sha512.New()
		default:
			return "", fmt.Errorf(i18n.T("algoritmo %q não suportado"), a[0])
		}
		h.Write([]byte(a[2]))
		if a[1] == "base64" {
			return base64.StdEncoding.EncodeToString(h.Sum(nil)), nil
		}
		return hex.EncodeToString(h.Sum(nil)), nil
	case "base64":
		url := a[1] == "url"
		if a[0] == "decode" {
			s := a[2]
			if url {
				s = strings.NewReplacer("-", "+", "_", "/").Replace(s)
			}
			// como Buffer.from(…, 'base64'): tolera falta de "=" e ignora lixo
			s = strings.TrimRight(s, "=")
			b, err := base64.RawStdEncoding.DecodeString(s)
			if err != nil {
				return "", errors.New(i18n.T("texto não é base64 válido"))
			}
			return string(b), nil
		}
		out := base64.StdEncoding.EncodeToString([]byte(a[2]))
		if url {
			out = strings.TrimRight(strings.NewReplacer("+", "-", "/", "_").Replace(out), "=")
		}
		return out, nil
	case "file":
		if a[0] == "" {
			return "", errors.New(i18n.T("informe o caminho do arquivo"))
		}
		f := a[0]
		if f == "~" || strings.HasPrefix(f, "~/") || strings.HasPrefix(f, `~\`) {
			home, _ := os.UserHomeDir()
			f = filepath.Join(home, f[1:])
		}
		b, err := os.ReadFile(f)
		if err != nil {
			return "", err
		}
		return string(b), nil
	case "prompt":
		p := Prompt{Title: a[0], Label: a[1], DefaultValue: a[2], Key: a[3], Mask: a[4] == "true"}
		if p.Title == "" {
			p.Title = i18n.T("Valor")
		}
		if c.Ask == nil {
			return "", fmt.Errorf(i18n.T("%q pergunta na hora de enviar (sem prévia)"), p.Title)
		}
		v, ok := c.Ask(p)
		if !ok {
			return "", &ErrPromptCancelled{p.Title}
		}
		return v, nil
	case "jsonpath":
		data, err := doc.FromJSON([]byte(a[0]))
		if err != nil {
			return "", errors.New(i18n.T("o texto não é JSON válido"))
		}
		path := a[1]
		if path == "" {
			path = "$"
		}
		v, found, err := jsonPath(data, path)
		if err != nil {
			return "", err
		}
		if !found {
			return "", fmt.Errorf(i18n.T("filtro %q não achou nada"), a[1])
		}
		return jsonq.Text(v), nil
	}
	return "", fmt.Errorf(i18n.T("tag %q não suportada"), name)
}

// filtro de body: JSONPath (mesmo das asserções)
func jsonPath(data any, path string) (any, bool, error) {
	if !strings.HasPrefix(path, "$") {
		path = "$." + path
	}
	vals, many, err := jsonq.Query(data, path)
	if err != nil || len(vals) == 0 {
		return nil, false, err
	}
	if many && len(vals) > 1 {
		return vals, true, nil
	}
	return vals[0], true, nil
}

// caminho XML mínimo: a/b/c ou /a/b/c (primeira ocorrência de cada nível)
func xmlPath(xml, path string) (string, bool) {
	cur := xml
	for _, s := range strings.Split(path, "/") {
		if s == "" {
			continue
		}
		re, err := regexp.Compile(`<` + regexp.QuoteMeta(s) + `(?:\s[^>]*)?>([\s\S]*?)</` + regexp.QuoteMeta(s) + `>`)
		if err != nil {
			return "", false
		}
		m := re.FindStringSubmatch(cur)
		if m == nil {
			return "", false
		}
		cur = m[1]
	}
	return strings.TrimSpace(cur), true
}

// Extract: campo de uma resposta (body com filtro, raw, header, url)
func Extract(res *doc.Doc, field, filterRaw string) (string, error) {
	if e := res.Str("error"); e != "" {
		return "", fmt.Errorf(i18n.T("request de origem falhou: %s"), e)
	}
	switch field {
	case "url":
		return res.Str("url"), nil
	case "raw":
		return res.Str("body"), nil
	}
	filter := DecodeFilter(filterRaw)
	if field == "header" {
		// recém-enviada: [][2]string; lida do histórico: []any
		switch hs := res.Get("headers").(type) {
		case [][2]string:
			for _, p := range hs {
				if strings.EqualFold(p[0], filter) {
					return p[1], nil
				}
			}
		case []any:
			for _, h := range hs {
				if p, ok := h.([]any); ok && len(p) == 2 && strings.EqualFold(doc.AsStr(p[0]), filter) {
					return doc.AsStr(p[1]), nil
				}
			}
		}
		return "", fmt.Errorf(i18n.T("header %q não está na resposta"), filter)
	}
	if filter == "" {
		return res.Str("body"), nil
	}
	if data, err := doc.FromJSON([]byte(res.Str("body"))); err == nil {
		v, found, err := jsonPath(data, filter)
		if err != nil {
			return "", err
		}
		if !found {
			return "", fmt.Errorf(i18n.T("filtro %q não achou nada na resposta"), filter)
		}
		return jsonq.Text(v), nil
	}
	if v, ok := xmlPath(res.Str("body"), filter); ok {
		return v, nil
	}
	return "", fmt.Errorf(i18n.T("filtro %q não achou nada na resposta"), filter)
}

func uuidV4() string {
	b := make([]byte, 16)
	_, _ = rand.Read(b)
	b[6] = b[6]&0x0f | 0x40
	b[8] = b[8]&0x3f | 0x80
	h := hex.EncodeToString(b)
	return h[0:8] + "-" + h[8:12] + "-" + h[12:16] + "-" + h[16:20] + "-" + h[20:]
}

// Resolve: valor de cada tag; erros viram avisos (menos prompt cancelado, que para o envio)
func Resolve(list []string, c *Context) (map[string]string, []string, error) {
	values := map[string]string{}
	errs := []string{}
	seen := map[string]bool{}
	for _, tag := range list {
		if seen[tag] {
			continue
		}
		seen[tag] = true
		name, args := ParseArgs(tag)
		v, err := resolveOne(name, args, c)
		if err != nil {
			var pc *ErrPromptCancelled
			if errors.As(err, &pc) {
				return nil, nil, err
			}
			short := tag
			if len([]rune(short)) > 60 {
				short = string([]rune(short)[:60])
			}
			errs = append(errs, short+"…: "+err.Error())
			continue
		}
		values[tag] = v
	}
	return values, errs, nil
}

func resolveOne(name string, args []string, c *Context) (string, error) {
	switch {
	case name == "uuid":
		return uuidV4(), nil
	case name == "now":
		return isoNow(c.now()), nil
	case IsFn(name):
		return EvalFn(name, args, c)
	case name == "response":
		get := func(i int, def string) string {
			if i < len(args) {
				return args[i]
			}
			return def
		}
		field, ref, filter, trigger, maxAge := get(0, ""), get(1, ""), get(2, ""), get(3, "never"), get(4, "")
		reqID := ref
		if c.ResolveRequest != nil {
			if id := c.ResolveRequest(ref); id != "" {
				reqID = id
			}
		}
		var res *doc.Doc
		if c.Latest != nil {
			res = c.Latest(reqID)
		}
		stale := res == nil
		if res != nil && maxAge != "" {
			var secs float64
			if _, err := fmt.Sscan(maxAge, &secs); err == nil {
				stale = float64(c.now().UnixMilli()-int64(res.Num("at", 0))) > secs*1000
			}
		}
		must := trigger == "always" || (trigger == "no-history" && res == nil) || (trigger == "when-expired" && stale)
		if must && !c.NoSend && c.SendByID != nil {
			r, err := c.SendByID(reqID)
			if err != nil {
				return "", err
			}
			res = r
		}
		if res == nil {
			return "", fmt.Errorf(i18n.T("request %s ainda não tem resposta (envie ele antes)"), reqID)
		}
		return Extract(res, field, filter)
	}
	if c.Plugin != nil {
		if v, ok, err := c.Plugin(name, args); ok {
			return v, err
		}
	}
	return "", fmt.Errorf(i18n.T("tag %q não suportada"), name)
}

// ---------- request referenciado por id ou nome ----------

// FindRequestRef: request por id ou nome ("Login", "Auth / Login"); nil = não achou ou ambíguo
func FindRequestRef(roots []any, ref string) *doc.Doc {
	type hit struct {
		node *doc.Doc
		path string
	}
	var all []hit
	var walk func(nodes []any, prefix string)
	walk = func(nodes []any, prefix string) {
		for _, x := range nodes {
			n, _ := x.(*doc.Doc)
			if n == nil {
				continue
			}
			p := n.Str("name")
			if prefix != "" {
				p = prefix + " / " + p
			}
			if n.Str("kind") == "request" {
				all = append(all, hit{n, p})
			}
			walk(n.List("children"), p)
		}
	}
	walk(roots, "")
	for _, h := range all {
		if h.node.Str("id") == ref {
			return h.node
		}
	}
	slash := regexp.MustCompile(`\s*/\s*`)
	norm := func(s string) string { return slash.ReplaceAllString(strings.ToLower(strings.TrimSpace(s)), " / ") }
	r := norm(ref)
	var hits, exact []hit
	for _, h := range all {
		p := norm(h.path)
		isPath := p == r || strings.HasSuffix(p, " / "+r)
		if isPath || norm(h.node.Str("name")) == r {
			hits = append(hits, h)
		}
		if isPath {
			exact = append(exact, h)
		}
	}
	// caminho exato vence; nome solto só se for único
	if len(exact) == 1 {
		return exact[0].node
	}
	if len(hits) == 1 {
		return hits[0].node
	}
	return nil
}
