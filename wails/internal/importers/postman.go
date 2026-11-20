package importers

// Postman Collection v2.0/v2.1 (+ arquivos de ambiente do Postman) → workspace (port de
// src/main/import-postman.ts). Pastas viram pastas, {{variáveis}} ficam como estão (mesma sintaxe),
// variáveis da coleção vão pro Base e cada arquivo de ambiente vira um sub-ambiente.

import (
	"fmt"
	"regexp"
	"strings"

	"github.com/chmenegatti/zeno/wails/internal/doc"
)

var postmanSchema = regexp.MustCompile(`schema\.getpostman\.com/json/collection/v2`)

// IsPostmanCollection: coleção v2.x
func IsPostmanCollection(v any) bool {
	d := obj(v)
	return d != nil && truthy(d.Get("info")) && postmanSchema.MatchString(jsString(coalesce(get(d, "info", "schema"), ""))) && arr(d.Get("item")) != nil
}

// IsPostmanEnvironment: arquivo de ambiente
func IsPostmanEnvironment(v any) bool {
	d := obj(v)
	return d != nil && arr(d.Get("values")) != nil && (d.Get("_postman_variable_scope") == "environment" || (isString(d.Get("name")) && !truthy(d.Get("info"))))
}

// eventos prerequest/test do Postman → scripts (a API pm.* é aceita pelo Zeno)
func pmScripts(events any) *Doc {
	code := func(listen string) string {
		var lines []string
		for _, e := range arr(events) {
			if get(e, "listen") != listen {
				continue
			}
			if l := arr(get(e, "script", "exec")); l != nil {
				for _, x := range l {
					lines = append(lines, jsString(x))
				}
			} else {
				lines = append(lines, jsString(coalesce(get(e, "script", "exec"), "")))
			}
		}
		t := strings.Join(lines, "\n")
		if strings.TrimSpace(t) == "" {
			return ""
		}
		return t
	}
	pre, post := code("prerequest"), code("test")
	if pre == "" && post == "" {
		return nil
	}
	s := doc.New()
	if pre != "" {
		s.Set("pre", pre)
	}
	if post != "" {
		s.Set("post", post)
	}
	return s
}

// variáveis dinâmicas do Postman com equivalente no Zeno
var dynamic = map[string]string{"$guid": "{% uuid 'v4' %}", "$randomUUID": "{% uuid 'v4' %}", "$isoTimestamp": "{% now %}"}

var dynRe = regexp.MustCompile(`\{\{\s*(\$\w+)\s*\}\}`)
var pathVarRe = regexp.MustCompile(`(^|/):([A-Za-z_]\w*)`)

// ConvertPostman: coleção + ambientes → workspace
func ConvertPostman(collection any, envs []any) Result {
	w := &warner{uniq: true}
	c := obj(collection)
	title := str(get(c, "info", "name"))
	if title == "" {
		title = "Coleção Postman"
	}
	id := str(get(c, "info", "_postman_id"))
	if id == "" {
		id = title
	}
	wsID := StableID("wrk", "postman", id)
	baseData := doc.New()
	for _, x := range arr(c.Get("variable")) {
		v := obj(x)
		if v != nil && truthy(v.Get("key")) && !truthy(v.Get("disabled")) {
			baseData.Set(str(v.Get("key")), coalesce(v.Get("value"), ""))
		}
	}
	// {{$guid}} → tag; outras dinâmicas viram aviso
	fix := func(s any, where string) string {
		return dynRe.ReplaceAllStringFunc(str(s), func(whole string) string {
			name := dynRe.FindStringSubmatch(whole)[1]
			if t, ok := dynamic[name]; ok {
				return t
			}
			w.warn(fmt.Sprintf("%s: variável dinâmica %s não suportada", where, name))
			return whole
		})
	}
	auth := func(a *Doc, where string) *Doc {
		if a == nil {
			return doc.New("type", "inherit")
		}
		list := func(k string) []*Doc {
			var out []*Doc
			if l := arr(a.Get(k)); l != nil {
				for _, x := range l {
					out = append(out, obj(x))
				}
				return out
			}
			m := obj(a.Get(k))
			for _, key := range m.Keys() {
				out = append(out, doc.New("key", key, "value", m.Get(key)))
			}
			return out
		}
		getv := func(k, field string) string {
			for _, x := range list(k) {
				if x != nil && x.Get("key") == field {
					return fix(x.Get("value"), where)
				}
			}
			return fix(nil, where)
		}
		switch a.Get("type") {
		case "noauth":
			return doc.New("type", "none")
		case "inherit":
			return doc.New("type", "inherit")
		case "basic":
			return doc.New("type", "basic", "username", getv("basic", "username"), "password", getv("basic", "password"))
		case "bearer":
			return doc.New("type", "bearer", "token", getv("bearer", "token"))
		case "apikey":
			to := "header"
			if getv("apikey", "in") == "query" {
				to = "query"
			}
			return doc.New("type", "apikey", "key", getv("apikey", "key"), "value", getv("apikey", "value"), "addTo", to)
		}
		w.warn(fmt.Sprintf("%s: auth %q não suportada (ficou sem auth)", where, jsString(a.Get("type"))))
		return doc.New("type", "none")
	}
	kv := func(list any, where string) []any {
		out := []any{}
		for _, x := range arr(list) {
			h := obj(x)
			if h == nil || (!truthy(h.Get("key")) && !truthy(h.Get("value"))) {
				continue
			}
			out = append(out, doc.New("name", fix(h.Get("key"), where), "value", fix(h.Get("value"), where), "enabled", !truthy(h.Get("disabled"))))
		}
		return out
	}
	langMime := map[string]string{"json": "application/json", "xml": "application/xml", "html": "text/html", "javascript": "application/javascript"}
	body := func(b *Doc, headers []any, where string) *Doc {
		if b == nil || truthy(b.Get("disabled")) {
			return doc.New("mime", nil)
		}
		switch b.Get("mode") {
		case "raw":
			ct := ""
			for _, x := range headers {
				h := obj(x)
				if strings.EqualFold(h.Str("name"), "content-type") {
					ct = strings.TrimSpace(strings.Split(h.Str("value"), ";")[0])
					break
				}
			}
			mime := ct
			if mime == "" {
				mime = langMime[str(get(b, "options", "raw", "language"))]
			}
			if mime == "" {
				mime = "text/plain"
			}
			return doc.New("mime", mime, "text", fix(b.Get("raw"), where))
		case "urlencoded":
			return doc.New("mime", "application/x-www-form-urlencoded", "fields", kv(b.Get("urlencoded"), where))
		case "formdata":
			fields := []any{}
			for _, x := range arr(b.Get("formdata")) {
				f := obj(x)
				isFile := f.Get("type") == "file"
				val := ""
				if !isFile {
					val = fix(f.Get("value"), where)
				}
				fd := doc.New("name", fix(f.Get("key"), where), "value", val, "enabled", !truthy(f.Get("disabled")))
				if isFile {
					if l := arr(f.Get("src")); l != nil {
						fd.Set("file", str(firstOf(l)))
					} else {
						fd.Set("file", str(f.Get("src")))
					}
				}
				fields = append(fields, fd)
			}
			return doc.New("mime", "multipart/form-data", "fields", fields)
		case "graphql":
			g := doc.New("query", str(get(b, "graphql", "query")), "variables", safeJSON(get(b, "graphql", "variables")))
			text, _ := doc.MarshalIndent(g)
			return doc.New("mime", "application/json", "text", string(text))
		case "file":
			w.warn(where + ": body de arquivo binário não importado")
		}
		return doc.New("mime", nil)
	}
	description := func(v any) any {
		if d := obj(v); d != nil {
			return orNil(str(d.Get("content")))
		}
		return orNil(str(v))
	}
	request := func(item *Doc, trail string, i int) *Doc {
		where := trail + " / " + str(coalesce(item.Get("name"), "request"))
		var r *Doc
		if s, ok := item.Get("request").(string); ok {
			r = doc.New("url", s, "method", "GET")
		} else if r = obj(item.Get("request")); r == nil {
			r = doc.New()
		}
		u := r.Get("url")
		raw := ""
		if s, ok := u.(string); ok {
			raw = s
		} else {
			raw = str(get(u, "raw"))
		}
		params := []any{}
		if q := arr(get(u, "query")); obj(u) != nil && q != nil {
			var qs []any
			for _, x := range q {
				d := obj(x).Clone()
				if d == nil {
					d = doc.New()
				}
				d.Set("value", coalesce(d.Get("value"), ""))
				qs = append(qs, d)
			}
			params = kv(qs, where)
		}
		if qi := strings.Index(raw, "?"); qi >= 0 {
			if len(params) == 0 {
				for _, p := range strings.Split(raw[qi+1:], "&") {
					if p == "" {
						continue
					}
					kvs := strings.Split(p, "=")
					params = append(params, doc.New("name", kvs[0], "value", strings.Join(kvs[1:], "="), "enabled", true))
				}
			}
			raw = raw[:qi]
		}
		// :id no path vira {{ id }}; o valor do exemplo vai pro Base se ainda não existe
		if obj(u) != nil {
			for _, x := range arr(get(u, "variable")) {
				v := obj(x)
				if v != nil && truthy(v.Get("key")) && !baseData.Has(str(v.Get("key"))) {
					baseData.Set(str(v.Get("key")), coalesce(v.Get("value"), ""))
				}
			}
		}
		raw = pathVarRe.ReplaceAllStringFunc(raw, func(m string) string {
			g := pathVarRe.FindStringSubmatch(m)
			if !baseData.Has(g[2]) {
				baseData.Set(g[2], "")
			}
			return g[1] + "{{ " + g[2] + " }}"
		})
		var headers []any
		if s, ok := r.Get("header").(string); ok {
			headers = kv(parseHeaderBlock(s), where)
		} else {
			headers = kv(r.Get("header"), where)
		}
		b := body(obj(r.Get("body")), headers, where)
		name := str(item.Get("name"))
		if name == "" {
			name = raw
		}
		if name == "" {
			name = "request"
		}
		out := doc.New("kind", "request",
			"id", StableID("req", wsID, trail, jsString(coalesce(item.Get("id"), item.Get("_postman_id"), "")), fmt.Sprint(i), str(item.Get("name"))),
			"name", name)
		setDef(out, "description", description(r.Get("description")))
		out.Set("method", strings.ToUpper(str(or(r.Get("method"), "GET"))))
		out.Set("url", fix(raw, where))
		out.Set("params", params)
		out.Set("headers", headers)
		out.Set("body", b)
		out.Set("auth", auth(obj(r.Get("auth")), where))
		out.Set("scripts", nilDoc(pmScripts(item.Get("event"))))
		out.Set("sortKey", int64(i))
		return out
	}
	var items func(list []any, trail string) []*Doc
	items = func(list []any, trail string) []*Doc {
		var out []*Doc
		for i, x := range list {
			item := obj(x)
			if arr(item.Get("item")) != nil {
				where := trail + " / " + str(coalesce(item.Get("name"), "pasta"))
				name := str(item.Get("name"))
				if name == "" {
					name = "Pasta"
				}
				f := doc.New("kind", "folder",
					"id", StableID("fld", wsID, trail, jsString(coalesce(item.Get("id"), item.Get("_postman_id"), "")), fmt.Sprint(i), str(item.Get("name"))),
					"name", name)
				setDef(f, "description", description(item.Get("description")))
				f.Set("sortKey", int64(i))
				f.Set("headers", []any{})
				f.Set("auth", auth(obj(item.Get("auth")), where))
				vars := doc.New()
				for _, y := range arr(item.Get("variable")) {
					v := obj(y)
					if v != nil && truthy(v.Get("key")) {
						vars.Set(str(v.Get("key")), coalesce(v.Get("value"), ""))
					}
				}
				f.Set("vars", vars)
				f.Set("scripts", nilDoc(pmScripts(item.Get("event"))))
				children := items(arr(item.Get("item")), where)
				ch := make([]any, len(children))
				for k, c := range children {
					ch[k] = c
				}
				f.Set("children", ch)
				out = append(out, f)
				continue
			}
			out = append(out, request(item, trail, i))
		}
		return out
	}
	children := items(arr(c.Get("item")), title)
	// workspace não tem script: os da coleção vão pra cada item do primeiro nível, antes dos dele
	if root := pmScripts(c.Get("event")); root != nil {
		join := func(a, b string) string {
			var parts []string
			for _, p := range []string{a, b} {
				if p != "" {
					parts = append(parts, p)
				}
			}
			return strings.Join(parts, "\n\n")
		}
		for _, n := range children {
			cur := obj(n.Get("scripts"))
			s := doc.New()
			if p := join(root.Str("pre"), cur.Str("pre")); p != "" {
				s.Set("pre", p)
			}
			if p := join(root.Str("post"), cur.Str("post")); p != "" {
				s.Set("post", p)
			}
			n.Set("scripts", s)
		}
		w.warn(title + ": scripts da coleção copiados para cada item do primeiro nível")
	}
	// workspace não tem auth: a da coleção desce para o primeiro nível que herda
	if rootAuth := auth(obj(c.Get("auth")), title); rootAuth.Str("type") != "inherit" {
		for _, n := range children {
			if n.Map("auth").Str("type") == "inherit" {
				n.Set("auth", rootAuth)
			}
		}
	}
	base := doc.New("id", StableID("env", wsID, "base"), "name", "Base", "parentId", nil, "data", baseData, "sortKey", int64(0))
	envList := []any{base}
	for i, x := range envs {
		e := obj(x)
		key := str(e.Get("id"))
		if key == "" {
			key = str(e.Get("name"))
		}
		if key == "" {
			key = fmt.Sprint(i)
		}
		name := str(e.Get("name"))
		if name == "" {
			name = fmt.Sprintf("Ambiente %d", i+1)
		}
		data := doc.New()
		for _, y := range arr(e.Get("values")) {
			v := obj(y)
			if v != nil && truthy(v.Get("key")) && v.Get("enabled") != false {
				data.Set(str(v.Get("key")), coalesce(v.Get("value"), ""))
			}
		}
		envList = append(envList, doc.New("id", StableID("env", wsID, "postman-env", key), "name", name, "parentId", base.Get("id"), "data", data, "sortKey", int64(i+1)))
	}
	ch := make([]any, len(children))
	for i, n := range children {
		ch[i] = n
	}
	ws := doc.New("id", wsID, "name", title)
	setDef(ws, "description", description(get(c, "info", "description")))
	ws.Set("settings", doc.New("insecureTLS", false, "timeoutMs", int64(30000)))
	ws.Set("environments", envList)
	ws.Set("children", ch)
	stripUndefined(ws)
	return Result{Workspaces: []*Doc{ws}, Warnings: w.list}
}

// valor "undefined" pra chave que existe no objeto do Electron mas não vai pro JSON
type undefinedT struct{}

func nilDoc(d *Doc) any {
	if d == nil {
		return undefined
	}
	return d
}

var undefined = undefinedT{}

// stripUndefined tira as chaves "undefined" (como o JSON.stringify)
func stripUndefined(v any) {
	switch x := v.(type) {
	case *Doc:
		for _, k := range x.Keys() {
			if x.Get(k) == undefined {
				x.Del(k)
			} else {
				stripUndefined(x.Get(k))
			}
		}
	case []any:
		for _, e := range x {
			stripUndefined(e)
		}
	}
}

func firstOf(l []any) any {
	if len(l) == 0 {
		return nil
	}
	return l[0]
}

func parseHeaderBlock(s string) []any {
	var out []any
	for _, l := range strings.Split(s, "\n") {
		l = strings.TrimSpace(l)
		i := strings.Index(l, ":")
		if i < 0 {
			continue
		}
		out = append(out, doc.New("key", strings.TrimSpace(l[:i]), "value", strings.TrimSpace(l[i+1:])))
	}
	return out
}

func safeJSON(s any) any {
	t, ok := s.(string)
	if !ok || strings.TrimSpace(t) == "" {
		return doc.New()
	}
	if v, err := doc.FromJSON([]byte(t)); err == nil {
		return v
	}
	return t
}
