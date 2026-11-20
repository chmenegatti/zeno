// Package protect: acha valores que parecem segredo e ainda estão em texto puro (port de
// src/shared/protect.ts).
//
//  1. variável (de ambiente ou pasta, inclusive aninhada) com nome de segredo e valor literal;
//  2. senha/token/valor de auth literal (request ou pasta);
//  3. header literal com nome sensível (Authorization, X-API-Key, *token*…);
//  4. qualquer outra variável cujo valor seja IGUAL a um segredo achado acima.
//
// Segredos escritos no meio de URL/body não dá pra cifrar sem quebrar o texto: viram aviso.
package protect

import (
	"regexp"
	"strings"

	"github.com/chmenegatti/zeno/wails/internal/doc"
	"github.com/chmenegatti/zeno/wails/internal/i18n"
)

type Doc = doc.Doc

// Path: caminho do valor dentro do objeto (ex.: data.password, auth.token, headers.0.value)
type Path []any

// Spot: onde está um segredo em texto puro
type Spot struct {
	Kind, ID string // env | folder | request
	Path     Path
	Label    string
}

// Result da varredura
type Result struct {
	Spots    []Spot
	Warnings []string
}

var (
	sensitiveHeader = regexp.MustCompile(`(?i)^(authorization|proxy-authorization|cookie|x-api-key|api-key|x-auth-token)$`)
	secretName      = regexp.MustCompile(`(?i)pass|senha|secret|token|api[-_]?key|apikey|client[-_]?secret|credential|private`)
)

// LooksSecret: nome parece guardar segredo
func LooksSecret(name string) bool { return secretName.MatchString(name) }

// IsLiteral: texto literal não vazio (sem template e sem estar cifrado)
func IsLiteral(v any) bool {
	s, ok := v.(string)
	return ok && s != "" && !strings.HasPrefix(s, "$zeno$v1$") && !strings.Contains(s, "{{") && !strings.Contains(s, "{%")
}

// GetAt / SetAt: valor no caminho
func GetAt(obj any, p Path) any {
	cur := obj
	for _, k := range p {
		switch c := cur.(type) {
		case *Doc:
			cur = c.Get(k.(string))
		case []any:
			i := k.(int)
			if i < 0 || i >= len(c) {
				return nil
			}
			cur = c[i]
		default:
			return nil
		}
	}
	return cur
}

func SetAt(obj any, p Path, v any) {
	parent := GetAt(obj, p[:len(p)-1])
	switch c := parent.(type) {
	case *Doc:
		c.Set(p[len(p)-1].(string), v)
	case []any:
		c[p[len(p)-1].(int)] = v
	}
}

func eachLeaf(obj any, base Path, fn func(p Path, key string, v any)) {
	d, ok := obj.(*Doc)
	if !ok {
		return
	}
	for _, k := range d.Keys() {
		v := d.Get(k)
		p := append(append(Path{}, base...), k)
		if sub, ok := v.(*Doc); ok {
			eachLeaf(sub, p, fn)
		} else {
			fn(p, k, v)
		}
	}
}

func join(p Path) string {
	s := make([]string, len(p))
	for i, x := range p {
		s[i] = doc.AsStr(x)
	}
	return strings.Join(s, ".")
}

// Scan varre o workspace; extraKnown = segredos conhecidos de outros workspaces (ou já cifrados)
func Scan(ws *Doc, extraKnown []string) Result {
	var spots []Spot
	type other struct {
		spot  Spot
		value string
	}
	var others []other
	known := map[string]bool{}
	for _, k := range extraKnown {
		known[k] = true
	}
	add := func(s Spot, v string) {
		spots = append(spots, s)
		known[v] = true
	}
	vars := func(kind, id string, data any, base Path, where string) {
		eachLeaf(data, base, func(p Path, key string, v any) {
			if !IsLiteral(v) {
				return
			}
			s := Spot{kind, id, p, where + " · " + join(p[len(base):])}
			if LooksSecret(key) {
				add(s, v.(string))
			} else {
				others = append(others, other{s, v.(string)})
			}
		})
	}
	authAndHeaders := func(kind string, n *Doc, where string) {
		a := n.Map("auth")
		fields := map[string][]string{"basic": {"password"}, "bearer": {"token"}, "apikey": {"value"}, "oauth2": {"clientSecret", "password"}}[a.Str("type")]
		for _, field := range fields {
			if IsLiteral(a.Get(field)) {
				add(Spot{kind, n.Str("id"), Path{"auth", field}, where + " · auth " + a.Str("type")}, a.Str(field))
			}
		}
		for i, h := range n.List("headers") {
			hd, _ := h.(*Doc)
			if hd == nil {
				continue
			}
			if (sensitiveHeader.MatchString(hd.Str("name")) || LooksSecret(hd.Str("name"))) && IsLiteral(hd.Get("value")) {
				add(Spot{kind, n.Str("id"), Path{"headers", i, "value"}, where + " · header " + hd.Str("name")}, hd.Str("value"))
			}
		}
	}
	for _, e := range ws.List("environments") {
		env, _ := e.(*Doc)
		if env == nil {
			continue
		}
		where := "Base"
		if env.Get("parentId") != nil {
			where = env.Str("name")
		}
		vars("env", env.Str("id"), env.Get("data"), Path{"data"}, where)
	}
	doc.Walk(ws.List("children"), func(n *Doc) {
		if n.Str("kind") == "folder" {
			vars("folder", n.Str("id"), n.Get("vars"), Path{"vars"}, i18n.T("pasta %s", n.Str("name")))
			authAndHeaders("folder", n, i18n.T("pasta %s", n.Str("name")))
		} else {
			authAndHeaders("request", n, n.Str("name"))
		}
	})
	// regra 4: mesma senha guardada com outro nome
	for _, o := range others {
		if len(o.value) >= 6 && known[o.value] {
			o.spot.Label += " " + i18n.T("(mesmo valor de um segredo)")
			spots = append(spots, o.spot)
		}
	}
	// segredos conhecidos escritos no meio de textos
	warnings := []string{}
	var secrets []string
	for s := range known {
		if len(s) >= 6 {
			secrets = append(secrets, s)
		}
	}
	if len(secrets) > 0 {
		doc.Walk(ws.List("children"), func(n *Doc) {
			if n.Str("kind") != "request" {
				return
			}
			texts := [][2]string{{"URL", n.Str("url")}, {"body", n.Map("body").Str("text")}}
			for _, p := range n.List("params") {
				if d, _ := p.(*Doc); d != nil {
					texts = append(texts, [2]string{"param " + d.Str("name"), d.Str("value")})
				}
			}
			for _, f := range n.Map("body").List("fields") {
				if d, _ := f.(*Doc); d != nil {
					texts = append(texts, [2]string{i18n.T("campo %s", d.Str("name")), d.Str("value")})
				}
			}
			for _, h := range n.List("headers") {
				if d, _ := h.(*Doc); d != nil && !sensitiveHeader.MatchString(d.Str("name")) && !LooksSecret(d.Str("name")) {
					texts = append(texts, [2]string{"header " + d.Str("name"), d.Str("value")})
				}
			}
			for _, t := range texts {
				if t[1] == "" {
					continue
				}
				for _, s := range secrets {
					if strings.Contains(t[1], s) {
						warnings = append(warnings, n.Str("name")+" · "+t[0])
						break
					}
				}
			}
		})
	}
	if spots == nil {
		spots = []Spot{}
	}
	return Result{spots, warnings}
}

// LiteralSecrets: valores literais que já são segredo pelas regras 1–3 (pra cruzar entre workspaces)
func LiteralSecrets(ws *Doc) []string {
	var out []string
	for _, s := range Scan(ws, nil).Spots {
		if strings.HasSuffix(s.Label, i18n.T("(mesmo valor de um segredo)")) {
			continue
		}
		out = append(out, doc.AsStr(GetAt(Target(ws, s), s.Path)))
	}
	return out
}

// Target: o objeto (ambiente, pasta ou request) onde o segredo está
func Target(ws *Doc, s Spot) *Doc {
	if s.Kind == "env" {
		for _, e := range ws.List("environments") {
			if d, _ := e.(*Doc); d != nil && d.Str("id") == s.ID {
				return d
			}
		}
		return nil
	}
	n, _ := doc.Find(ws, s.ID)
	return n
}
