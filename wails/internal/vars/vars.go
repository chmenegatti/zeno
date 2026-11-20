// Package vars: variáveis {{ nome }}, {{ _.nome }}, {{ _['X-API-Key'] }} com herança base → sub-ambiente → pastas
// (port de src/shared/template.ts e prepare.ts; tags {% %} ficam de fora no protótipo).

package vars

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
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

func lookup(vars Doc, p string) (any, bool) {
	var cur any = vars
	for _, part := range Path(p) {
		switch c := cur.(type) {
		case Doc:
			v, ok := c[part]
			if !ok {
				return nil, false
			}
			cur = v
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
	vars        Doc
	missing     map[string]bool
	unsupported map[string]bool
}

func (r *renderer) render(in string, depth int) string {
	if !strings.Contains(in, "{{") && !strings.Contains(in, "{%") {
		return in
	}
	for _, t := range tagRe.FindAllString(in, -1) {
		r.unsupported[t] = true
	}
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
		case Doc, []any:
			b, _ := json.Marshal(x)
			return string(b)
		default:
			return fmt.Sprint(x)
		}
	})
}

func deepMerge(a, b Doc) Doc {
	out := Doc{}
	for k, v := range a {
		out[k] = v
	}
	for k, v := range b {
		pa, okA := out[k].(Doc)
		pb, okB := v.(Doc)
		if okA && okB {
			out[k] = deepMerge(pa, pb)
		} else {
			out[k] = v
		}
	}
	return out
}

// BuildVars: base → sub-ambiente ativo → pastas (da raiz até a mais próxima)
func BuildVars(ws Doc, envID string, folders []Doc) Doc {
	vars := Doc{}
	envs, _ := ws["environments"].([]any)
	for _, e := range envs {
		if d := e.(Doc); d["parentId"] == nil {
			if data, ok := d["data"].(Doc); ok {
				vars = deepMerge(vars, data)
			}
		}
	}
	for _, e := range envs {
		if d := e.(Doc); envID != "" && doc.Str(d, "id") == envID && d["parentId"] != nil {
			if data, ok := d["data"].(Doc); ok {
				vars = deepMerge(vars, data)
			}
		}
	}
	for _, f := range folders {
		if v, ok := f["vars"].(Doc); ok {
			vars = deepMerge(vars, v)
		}
	}
	return vars
}

type kv struct{ name, value string }

func kvs(v any) []kv {
	arr, _ := v.([]any)
	out := []kv{}
	for _, it := range arr {
		m, _ := it.(Doc)
		if m == nil || m["enabled"] == false || doc.Str(m, "name") == "" {
			continue
		}
		out = append(out, kv{doc.Str(m, "name"), doc.Str(m, "value")})
	}
	return out
}

// Prepared: o request pronto pra enviar
type Prepared struct {
	Method, URL string
	Headers     [][2]string
	BodyKind    string // none | text | form
	Text        string
	Form        [][2]string
	InsecureTLS bool
	TimeoutMs   float64
	Missing     []string
	Unsupported []string
}

// Prepare monta o request final: variáveis, auth e headers herdados (port de prepare.ts)
func Prepare(ws, req Doc, anc []Doc, envID string) Prepared {
	r := &renderer{vars: BuildVars(ws, envID, anc), missing: map[string]bool{}, unsupported: map[string]bool{}}
	R := func(s string) string { return r.render(s, 0) }
	u := strings.TrimSpace(R(doc.Str(req, "url")))
	if u != "" && !schRe.MatchString(u) && !strings.HasPrefix(u, "{{") && !strings.HasPrefix(u, "{%") {
		u = "http://" + u
	}
	query := [][2]string{}
	for _, p := range kvs(req["params"]) {
		query = append(query, [2]string{R(p.name), R(p.value)})
	}
	// headers das pastas (raiz primeiro) + do request; request vence em nome igual
	order := []string{}
	hm := map[string]kv{}
	for _, f := range anc {
		for _, h := range kvs(f["headers"]) {
			k := strings.ToLower(h.name)
			if _, ok := hm[k]; !ok {
				order = append(order, k)
			}
			hm[k] = h
		}
	}
	for _, h := range kvs(req["headers"]) {
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
	auth, _ := req["auth"].(Doc)
	for i := len(anc) - 1; doc.Str(auth, "type") == "inherit" && i >= 0; i-- {
		auth, _ = anc[i]["auth"].(Doc)
	}
	switch doc.Str(auth, "type") {
	case "basic":
		if !has("authorization") {
			headers = append(headers, [2]string{"Authorization", "Basic " + base64.StdEncoding.EncodeToString([]byte(R(doc.Str(auth, "username"))+":"+R(doc.Str(auth, "password"))))})
		}
	case "bearer":
		if !has("authorization") {
			pre := R(doc.Str(auth, "prefix"))
			if pre == "" {
				pre = "Bearer"
			}
			headers = append(headers, [2]string{"Authorization", strings.TrimSpace(pre + " " + R(doc.Str(auth, "token")))})
		}
	case "apikey":
		if doc.Str(auth, "key") != "" {
			if doc.Str(auth, "addTo") == "query" {
				query = append(query, [2]string{R(doc.Str(auth, "key")), R(doc.Str(auth, "value"))})
			} else {
				headers = append(headers, [2]string{R(doc.Str(auth, "key")), R(doc.Str(auth, "value"))})
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
	p := Prepared{Method: doc.Str(req, "method"), URL: u, BodyKind: "none"}
	body, _ := req["body"].(Doc)
	mime := doc.Str(body, "mime")
	switch {
	case mime == "application/x-www-form-urlencoded":
		p.BodyKind = "form"
		for _, f := range kvs(body["fields"]) {
			p.Form = append(p.Form, [2]string{R(f.name), R(f.value)})
		}
		if !has("content-type") {
			headers = append(headers, [2]string{"Content-Type", mime})
		}
	case mime != "" && mime != "multipart/form-data":
		p.BodyKind = "text"
		p.Text = R(doc.Str(body, "text"))
		if !has("content-type") {
			ct := mime
			if mime == "application/graphql" {
				ct = "application/json"
			}
			headers = append(headers, [2]string{"Content-Type", ct})
		}
	}
	p.Headers = headers
	settings, _ := ws["settings"].(Doc)
	p.InsecureTLS = settings["insecureTLS"] == true
	p.TimeoutMs = doc.Num(settings, "timeoutMs", 30000)
	for m := range r.missing {
		p.Missing = append(p.Missing, m)
	}
	for t := range r.unsupported {
		p.Unsupported = append(p.Unsupported, t)
	}
	return p
}
