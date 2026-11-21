package store

import (
	"math"
	"slices"
	"strings"

	"github.com/chmenegatti/zeno/wails/internal/doc"
)

// mesmos valores de src/shared/types.ts
var (
	assertSources = []string{"status", "header", "json", "body", "time"}
	assertOps     = []string{"eq", "neq", "contains", "notContains", "lt", "gt", "exists", "notExists", "matches"}
)

// num: inteiro vira int64 (o YAML sai 1795127002350, não 1.795127e+12)
func num(f float64) any {
	if f == math.Trunc(f) && math.Abs(f) < 1<<53 {
		return int64(f)
	}
	return f
}

// stripEmpty tira do primeiro nível o que o Electron não grava (undefined e "")
func stripEmpty(d *Doc) *Doc {
	out := doc.New()
	for _, k := range d.Keys() {
		v := d.Get(k)
		if v == "" || v == undef {
			continue
		}
		out.Set(k, v)
	}
	return out
}

// marcador de "undefined" (chave ausente no Electron), diferente de null
type undefined struct{}

var undef = undefined{}

func or(d *Doc, k string) any {
	if !d.Has(k) {
		return undef
	}
	return d.Get(k)
}

// sem as chaves undefined
func clean(d *Doc) *Doc {
	out := doc.New()
	for _, k := range d.Keys() {
		if v := d.Get(k); v != undef {
			out.Set(k, v)
		}
	}
	return out
}

func kvList(v any) []any {
	arr, _ := v.([]any)
	out := make([]any, 0, len(arr))
	for _, it := range arr {
		m, _ := it.(*Doc)
		out = append(out, doc.New("name", m.Str("name"), "value", m.Str("value"), "enabled", m.Get("enabled") != false))
	}
	return out
}

// pathParams (#149): só nome e valor; sem nenhum, o campo não vai pro YAML
func pathParamList(v any) any {
	arr, _ := v.([]any)
	out := []any{}
	for _, it := range arr {
		if m, ok := it.(*Doc); ok && m.Str("name") != "" {
			out = append(out, doc.New("name", m.Str("name"), "value", m.Str("value")))
		}
	}
	if len(out) == 0 {
		return undef
	}
	return out
}

func authOf(v any) any {
	if m, ok := v.(*Doc); ok && m.Has("type") {
		return m
	}
	return doc.New("type", "inherit")
}

func normScripts(v any) any {
	r, _ := v.(*Doc)
	pre, _ := r.Get("pre").(string)
	post, _ := r.Get("post").(string)
	if strings.TrimSpace(pre) == "" && strings.TrimSpace(post) == "" {
		return undef
	}
	out := doc.New()
	if strings.TrimSpace(pre) != "" {
		out.Set("pre", pre)
	}
	if strings.TrimSpace(post) != "" {
		out.Set("post", post)
	}
	return out
}

func normAssertions(v any) any {
	arr, ok := v.([]any)
	if !ok || len(arr) == 0 {
		return undef
	}
	out := []any{}
	for _, it := range arr {
		a, _ := it.(*Doc)
		if a == nil || !slices.Contains(assertSources, a.Str("source")) || !slices.Contains(assertOps, a.Str("op")) {
			continue
		}
		n := doc.New("enabled", a.Get("enabled") != false, "source", a.Get("source"))
		if a.Get("path") != nil && a.Str("path") != "" && a.Get("path") != false {
			n.Set("path", a.Str("path"))
		}
		n.Set("op", a.Get("op"))
		if a.Get("value") != nil {
			n.Set("value", a.Str("value"))
		}
		out = append(out, n)
	}
	return out
}

// normExamples (#20): respostas de exemplo do request, servidas pelo mock
// {id, name, status, headers [{name, value, enabled}], body, bodyEncoding (só base64), delayMs, default}
func normExamples(v any) any {
	arr, ok := v.([]any)
	if !ok || len(arr) == 0 {
		return undef
	}
	out := []any{}
	for _, it := range arr {
		e, _ := it.(*Doc)
		if e == nil {
			continue
		}
		id := e.Str("id")
		if id == "" {
			id = NewID("ex")
		}
		n := doc.New("id", id, "name", e.Str("name"), "status", num(e.Num("status", 200)), "headers", kvList(e.Get("headers")), "body", e.Str("body"))
		if e.Str("bodyEncoding") == "base64" {
			n.Set("bodyEncoding", "base64")
		}
		if d := e.Num("delayMs", 0); d > 0 {
			n.Set("delayMs", num(d))
		}
		if e.Get("default") == true {
			n.Set("default", true)
		}
		out = append(out, n)
	}
	return out
}

// normGrpc (#5): serviço/método escolhidos e o .proto (vazio = server reflection)
func normGrpc(v any) any {
	g, _ := v.(*Doc)
	if g == nil || (g.Str("service") == "" && g.Str("method") == "" && g.Str("protoFile") == "") {
		return undef
	}
	out := doc.New("service", g.Str("service"), "method", g.Str("method"))
	if f := g.Str("protoFile"); f != "" {
		out.Set("protoFile", f)
	}
	return out
}

// normRequest: mesmos campos e ordem de normRequest do Electron
func normRequest(raw *Doc, fallback string) *Doc {
	id := raw.Str("id")
	if id == "" {
		id = NewID("req")
	}
	name := raw.Str("name")
	if name == "" {
		name = fallback
	}
	method := strings.ToUpper(raw.Str("method"))
	if method == "" {
		method = "GET"
	}
	body := doc.New("mime", nil)
	if b := raw.Map("body"); b != nil {
		body = doc.New("mime", b.Get("mime"))
		if b.Has("text") {
			body.Set("text", b.Get("text"))
		}
		if b.Has("fields") {
			body.Set("fields", b.Get("fields"))
		}
	}
	r := doc.New("kind", "request", "id", id, "name", name)
	if d := raw.Str("description"); d != "" {
		r.Set("description", d)
	}
	r.Set("method", method)
	r.Set("url", raw.Str("url"))
	r.Set("params", kvList(raw.Get("params")))
	r.Set("pathParams", pathParamList(raw.Get("pathParams")))
	r.Set("headers", kvList(raw.Get("headers")))
	r.Set("body", body)
	r.Set("auth", authOf(raw.Get("auth")))
	r.Set("scripts", normScripts(raw.Get("scripts")))
	r.Set("assertions", normAssertions(raw.Get("assertions")))
	r.Set("examples", normExamples(raw.Get("examples")))
	r.Set("grpc", normGrpc(raw.Get("grpc")))
	r.Set("settings", normReqSettings(raw.Get("settings")))
	// só o "desligado" é gravado; ausente = ligado
	r.Set("sendCookies", undefIfNotFalse(raw.Get("sendCookies")))
	r.Set("storeCookies", undefIfNotFalse(raw.Get("storeCookies")))
	r.Set("sortKey", num(raw.Num("sortKey", 0)))
	return clean(r)
}

// normReqSettings (#151): só o que o request sobrescreve; ausente = vale o do workspace
func normReqSettings(v any) any {
	m, _ := v.(*Doc)
	out := doc.New()
	if n := m.Num("timeoutMs", -1); n >= 0 && m.Has("timeoutMs") {
		out.Set("timeoutMs", num(n))
	}
	if b, ok := m.Get("followRedirects").(bool); ok {
		out.Set("followRedirects", b)
	}
	if n := m.Num("maxRedirects", -1); n > 0 && m.Has("maxRedirects") {
		out.Set("maxRedirects", num(n))
	}
	if b, ok := m.Get("insecureTLS").(bool); ok {
		out.Set("insecureTLS", b)
	}
	if out.Len() == 0 {
		return undef
	}
	return out
}

func undefIfNotFalse(v any) any {
	if v == false {
		return false
	}
	return undef
}

// normFolder: mesmos campos e ordem de normFolder do Electron
func normFolder(raw *Doc, fallback string) *Doc {
	id := raw.Str("id")
	if id == "" {
		id = NewID("fld")
	}
	name := raw.Str("name")
	if name == "" {
		name = fallback
	}
	f := doc.New("kind", "folder", "id", id, "name", name)
	if d := raw.Str("description"); d != "" {
		f.Set("description", d)
	}
	f.Set("sortKey", num(raw.Num("sortKey", 0)))
	f.Set("headers", kvList(raw.Get("headers")))
	f.Set("auth", authOf(raw.Get("auth")))
	if v := raw.Map("vars"); v != nil {
		f.Set("vars", v)
	} else {
		f.Set("vars", doc.New())
	}
	f.Set("scripts", normScripts(raw.Get("scripts")))
	f.Set("children", []any{})
	return clean(f)
}

func normEnv(raw *Doc, fallback string) *Doc {
	id := raw.Str("id")
	if id == "" {
		id = NewID("env")
	}
	name := raw.Str("name")
	if name == "" {
		name = fallback
	}
	e := doc.New("id", id, "name", name, "parentId", raw.Get("parentId"))
	if c := raw.Str("color"); c != "" {
		e.Set("color", c)
	}
	if d := raw.Map("data"); d != nil {
		e.Set("data", d)
	} else {
		e.Set("data", doc.New())
	}
	e.Set("sortKey", num(raw.Num("sortKey", 0)))
	return e
}

// requestToYaml: sem "kind"; scripts e asserções normalizados; sem vazios no primeiro nível
func requestToYaml(r *Doc) *Doc {
	out := doc.New()
	for _, k := range r.Keys() {
		switch k {
		case "kind":
		case "scripts":
			out.Set(k, normScripts(r.Get(k)))
		case "assertions":
			out.Set(k, normAssertions(r.Get(k)))
		case "examples":
			out.Set(k, normExamples(r.Get(k)))
		default:
			out.Set(k, r.Get(k))
		}
	}
	return stripEmpty(out)
}

func folderToYaml(f *Doc) *Doc {
	out := doc.New()
	for _, k := range f.Keys() {
		switch k {
		case "kind", "children":
		case "scripts":
			out.Set(k, normScripts(f.Get(k)))
		default:
			out.Set(k, f.Get(k))
		}
	}
	return stripEmpty(out)
}
