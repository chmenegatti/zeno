package importers

// OpenAPI 3.x e Swagger 2.0 → workspace: uma pasta por tag, um request por operação, base_url no
// ambiente Base, parâmetros de path como {id} na URL (valor do exemplo no request) e body de exemplo (port de
// src/main/import-openapi.ts).

import (
	"fmt"
	"net/url"
	"regexp"
	"slices"
	"strings"

	"github.com/chmenegatti/zeno/wails/internal/doc"
	"github.com/chmenegatti/zeno/wails/internal/i18n"
)

// IsOpenAPI: OpenAPI 3.x ou Swagger 2.0
func IsOpenAPI(v any) bool {
	d := obj(v)
	return d != nil && (isString(d.Get("openapi")) || jsString(d.Get("swagger")) == "2.0")
}

var oaMethods = []string{"get", "post", "put", "patch", "delete", "head", "options"}

// resolve $ref locais (#/components/…, #/definitions/…); refs externas ficam vazias
func resolver(root *Doc, w *warner) func(any) any {
	seen := map[string]bool{}
	lookup := func(ref string) any {
		if !strings.HasPrefix(ref, "#/") {
			if !seen[ref] {
				w.warn(i18n.T("$ref externo não resolvido: %s", ref))
			}
			seen[ref] = true
			return doc.New()
		}
		var cur any = root
		for _, p := range strings.Split(ref[2:], "/") {
			p = strings.ReplaceAll(strings.ReplaceAll(p, "~1", "/"), "~0", "~")
			d := obj(cur)
			if d == nil {
				return nil
			}
			cur = d.Get(p)
		}
		return cur
	}
	return func(node any) any {
		n := node
		for i := 0; i < 20; i++ {
			d := obj(n)
			if d == nil {
				break
			}
			ref, ok := d.Get("$ref").(string)
			if !ok {
				break
			}
			n = coalesce(lookup(ref), doc.New())
		}
		return n
	}
}

var strFormats = map[string]string{
	"date-time": "2026-01-01T00:00:00Z", "date": "2026-01-01", "email": "usuario@exemplo.com",
	"uuid": "00000000-0000-4000-8000-000000000000", "uri": "https://exemplo.com", "binary": "", "byte": "",
}

// valor de exemplo a partir do schema
func sample(schema any, deref func(any) any, depth int, stack map[*Doc]bool) any {
	s := obj(deref(schema))
	if s == nil || depth > 8 || stack[s] {
		return nil
	}
	if s.Has("example") {
		return s.Get("example")
	}
	if ex := arr(s.Get("examples")); len(ex) > 0 {
		return ex[0]
	}
	if s.Has("default") {
		return s.Get("default")
	}
	if en := arr(s.Get("enum")); len(en) > 0 {
		return en[0]
	}
	if s.Has("const") {
		return s.Get("const")
	}
	next := map[*Doc]bool{s: true}
	for k := range stack {
		next[k] = true
	}
	if all := arr(s.Get("allOf")); all != nil {
		parts := make([]any, len(all))
		allObj := true
		for i, p := range all {
			parts[i] = sample(p, deref, depth+1, next)
			if obj(parts[i]) == nil {
				allObj = false
			}
		}
		if allObj {
			out := doc.New()
			for _, p := range parts {
				for _, k := range obj(p).Keys() {
					out.Set(k, obj(p).Get(k))
				}
			}
			return out
		}
		if len(parts) == 0 {
			return nil
		}
		return parts[0]
	}
	for _, k := range []string{"oneOf", "anyOf"} {
		if l := arr(s.Get(k)); len(l) > 0 {
			return sample(l[0], deref, depth+1, next)
		}
	}
	typ := s.Get("type")
	if l := arr(typ); l != nil {
		typ = nil
		for _, t := range l {
			if t != "null" {
				typ = t
				break
			}
		}
	}
	switch {
	case typ == "object" || (typ == nil && truthy(s.Get("properties"))):
		out := doc.New()
		props := obj(s.Get("properties"))
		for _, k := range props.Keys() {
			p := obj(deref(props.Get(k)))
			if p != nil && truthy(p.Get("readOnly")) {
				continue
			}
			var pv any = p
			if p == nil {
				pv = props.Get(k)
			}
			out.Set(k, sample(pv, deref, depth+1, next))
		}
		return out
	case typ == "array":
		return []any{sample(s.Get("items"), deref, depth+1, next)}
	case typ == "integer" || typ == "number":
		return coalesce(s.Get("minimum"), int64(0))
	case typ == "boolean":
		return true
	case typ == "string":
		if f, ok := strFormats[str(s.Get("format"))]; ok {
			return f
		}
		return "string"
	}
	return nil
}

var schemeRe = regexp.MustCompile(`(?i)^[a-z]+://`)

// URL do servidor: variáveis {x} trocadas pelo default; relativa resolvida contra a URL do spec
func serverURL(d *Doc, sourceURL string) string {
	u := ""
	if truthy(d.Get("openapi")) {
		s := obj(firstOf(arr(d.Get("servers"))))
		u = str(coalesce(get(s, "url"), "/"))
		vars := obj(get(s, "variables"))
		for _, k := range vars.Keys() {
			u = strings.ReplaceAll(u, "{"+k+"}", str(get(vars.Get(k), "default")))
		}
	} else {
		scheme := str(coalesce(firstOf(arr(d.Get("schemes"))), "https"))
		if truthy(d.Get("host")) {
			u = scheme + "://" + str(d.Get("host")) + str(coalesce(d.Get("basePath"), ""))
		} else {
			u = str(coalesce(d.Get("basePath"), "/"))
		}
	}
	if !schemeRe.MatchString(u) && sourceURL != "" {
		if base, err := url.Parse(sourceURL); err == nil {
			if ref, err := url.Parse(u); err == nil {
				u = base.ResolveReference(ref).String()
			}
		}
	}
	return strings.TrimRight(u, "/")
}

// ConvertOpenAPI: spec → workspace
func ConvertOpenAPI(spec any, sourceURL string) Result {
	w := &warner{uniq: true}
	d := obj(spec)
	deref := resolver(d, w)
	v3 := truthy(d.Get("openapi"))
	title := str(get(d, "info", "title"))
	if title == "" {
		title = "API"
	}
	wsID := StableID("wrk", "openapi", title)
	baseData := doc.New("base_url", serverURL(d, sourceURL))
	if !v3 && !truthy(d.Get("host")) {
		w.warn(i18n.T("%s: spec sem host; ajuste base_url no ambiente Base", title))
	}
	if v3 && len(arr(d.Get("servers"))) == 0 {
		w.warn(i18n.T("%s: spec sem servers; ajuste base_url no ambiente Base", title))
	}

	// ---------- segurança → auth com variáveis ----------
	var schemes *Doc
	if v3 {
		schemes = obj(get(d, "components", "securitySchemes"))
	} else {
		schemes = obj(d.Get("securityDefinitions"))
	}
	addVar := func(name string, value any) string {
		if !baseData.Has(name) {
			baseData.Set(name, value)
		}
		return "{{ " + name + " }}"
	}
	bearerRe, basicRe := regexp.MustCompile(`(?i)^bearer$`), regexp.MustCompile(`(?i)^basic$`)
	authFor := func(security any) *Doc {
		if security == nil {
			return doc.New("type", "inherit")
		}
		list := arr(security)
		if len(list) == 0 {
			return doc.New("type", "none")
		}
		for _, req := range list {
			for _, name := range obj(req).Keys() {
				s := obj(deref(schemes.Get(name)))
				if s == nil {
					continue
				}
				t := s.Str("type")
				if (t == "http" && bearerRe.MatchString(s.Str("scheme"))) || t == "oauth2" || t == "openIdConnect" {
					if t != "http" {
						w.warn(i18n.T("%s: segurança %q (%s) virou Bearer {{ token }}; obtenha o token à parte", title, name, t))
					}
					return doc.New("type", "bearer", "token", addVar("token", ""))
				}
				if (t == "http" && basicRe.MatchString(s.Str("scheme"))) || t == "basic" {
					return doc.New("type", "basic", "username", addVar("username", ""), "password", addVar("password", ""))
				}
				if t == "apiKey" {
					v := addVar(strings.ToLower(regexp.MustCompile(`\W+`).ReplaceAllString(name, "_")), "")
					switch s.Get("in") {
					case "query":
						return doc.New("type", "apikey", "key", s.Get("name"), "value", v, "addTo", "query")
					case "cookie":
						return doc.New("type", "apikey", "key", "Cookie", "value", s.Str("name")+"="+v, "addTo", "header")
					}
					return doc.New("type", "apikey", "key", s.Get("name"), "value", v, "addTo", "header")
				}
				w.warn(i18n.T("%s: segurança %q (%s) não suportada", title, name, jsString(s.Get("type"))))
			}
		}
		return doc.New("type", "none")
	}

	// ---------- operações ----------
	tagDesc := map[string]any{}
	var tagOrder []string
	for _, t := range arr(d.Get("tags")) {
		tagDesc[str(get(t, "name"))] = get(t, "description")
		tagOrder = append(tagOrder, str(get(t, "name")))
	}
	folders := map[string]*Doc{}
	var folderOrder []string
	var root []*Doc
	rootAuth := authFor(d.Get("security"))
	order := 0
	paths := obj(d.Get("paths"))
	for _, path := range paths.Keys() {
		item := obj(deref(paths.Get(path)))
		for _, m := range oaMethods {
			op := obj(item.Get(m))
			if op == nil {
				continue
			}
			name := strings.TrimSuffix(strings.TrimSpace(str(op.Get("summary"))), ".")
			if name == "" {
				name = str(op.Get("operationId"))
			}
			if name == "" {
				name = strings.ToUpper(m) + " " + path
			}
			where := title + " / " + name
			params, headers := []any{}, []any{}
			// o da operação vale mais que o do path com mesmo nome/lugar
			var byKey ordered
			for _, x := range append(append([]any{}, arr(item.Get("parameters"))...), arr(op.Get("parameters"))...) {
				p := obj(deref(x))
				byKey.set(jsString(p.Get("in"))+":"+jsString(p.Get("name")), p)
			}
			body := doc.New("mime", nil)
			formFields := []any{}
			var pathParams []any
			for _, p := range byKey.list() {
				var ex any
				switch {
				case p.Get("example") != nil:
					ex = p.Get("example")
				case get(p, "schema", "example") != nil:
					ex = get(p, "schema", "example")
				case p.Get("default") != nil:
					ex = p.Get("default")
				case get(p, "schema", "default") != nil:
					ex = get(p, "schema", "default")
				case truthy(p.Get("schema")):
					ex = sample(p.Get("schema"), deref, 0, nil)
				case truthy(p.Get("type")):
					ex = sample(p, deref, 0, nil)
				default:
					ex = ""
				}
				// lista em query/header: um valor só
				if l := arr(ex); l != nil && p.Get("in") != "body" {
					ex = firstOf(l)
				}
				value := str(ex)
				blank := func() string {
					if value == "string" {
						return ""
					}
					return value
				}
				switch p.Get("in") {
				case "path":
					// {id} fica na URL (parâmetro de caminho, #149); o exemplo vira o valor
					if v := blank(); v != "" {
						pathParams = append(pathParams, doc.New("name", p.Str("name"), "value", v))
					}
				case "query":
					params = append(params, doc.New("name", p.Get("name"), "value", blank(), "enabled", truthy(p.Get("required"))))
				case "header":
					headers = append(headers, doc.New("name", p.Get("name"), "value", blank(), "enabled", truthy(p.Get("required"))))
				case "cookie":
					w.warn(i18n.T("%s: parâmetro de cookie %q ignorado", where, jsString(p.Get("name"))))
				case "body":
					text, _ := doc.MarshalIndent(sample(p.Get("schema"), deref, 0, nil))
					body = doc.New("mime", "application/json", "text", string(text))
				case "formData":
					isFile := p.Get("type") == "file"
					val := blank()
					if isFile {
						val = ""
					}
					f := doc.New("name", p.Get("name"), "value", val, "enabled", true)
					if isFile {
						f.Set("file", "")
					}
					formFields = append(formFields, f)
				}
			}
			consumes := func() []string {
				var out []string
				for _, c := range arr(coalesce(op.Get("consumes"), d.Get("consumes"), []any{})) {
					out = append(out, str(c))
				}
				return out
			}
			if len(formFields) > 0 {
				mime := "application/x-www-form-urlencoded"
				hasFile := false
				for _, f := range formFields {
					if obj(f).Has("file") {
						hasFile = true
					}
				}
				if slices.Contains(consumes(), "multipart/form-data") || hasFile {
					mime = "multipart/form-data"
				}
				body = doc.New("mime", mime, "fields", formFields)
			}
			if v3 && truthy(op.Get("requestBody")) {
				body = requestBody(obj(deref(op.Get("requestBody"))), deref, where, w)
			}
			if !v3 && body.Get("mime") == "application/json" {
				if cs := consumes(); len(cs) > 0 && !slices.ContainsFunc(cs, func(c string) bool { return strings.Contains(c, "json") }) {
					body.Set("mime", cs[0])
				}
			}
			req := doc.New("kind", "request", "id", StableID("req", wsID, m, path), "name", name)
			setDef(req, "description", orNil(str(op.Get("description"))))
			req.Set("method", strings.ToUpper(m))
			req.Set("url", "{{ base_url }}"+path)
			req.Set("params", params)
			if len(pathParams) > 0 {
				req.Set("pathParams", pathParams)
			}
			req.Set("headers", headers)
			req.Set("body", body)
			switch {
			case truthy(op.Get("security")) || arr(op.Get("security")) != nil:
				req.Set("auth", authFor(op.Get("security")))
			case rootAuth.Str("type") == "inherit":
				req.Set("auth", doc.New("type", "inherit"))
			default:
				req.Set("auth", rootAuth)
			}
			req.Set("sortKey", int64(order))
			order++
			if truthy(op.Get("deprecated")) {
				req.Set("name", req.Str("name")+" (obsoleto)")
			}
			tag := firstOf(arr(op.Get("tags")))
			if tag == nil {
				root = append(root, req)
				continue
			}
			t := str(tag)
			f := folders[t]
			if f == nil {
				sk := int64(order)
				if idx := slices.Index(tagOrder, t); idx >= 0 {
					sk = int64(idx - 10000)
				}
				f = doc.New("kind", "folder", "id", StableID("fld", wsID, t), "name", t)
				setDef(f, "description", orNil(tagDesc[t]))
				f.Set("sortKey", sk)
				f.Set("headers", []any{})
				f.Set("auth", doc.New("type", "inherit"))
				f.Set("vars", doc.New())
				f.Set("children", []any{})
				folders[t] = f
				folderOrder = append(folderOrder, t)
			}
			f.Set("children", append(f.List("children"), req))
		}
	}

	base := doc.New("id", StableID("env", wsID, "base"), "name", "Base", "parentId", nil, "data", baseData, "sortKey", int64(0))
	envs := []any{base}
	if v3 {
		for i, s := range arr(d.Get("servers")) {
			if i == 0 {
				continue
			}
			name := str(get(s, "description"))
			if name == "" {
				name = str(get(s, "url"))
			}
			envs = append(envs, doc.New("id", StableID("env", wsID, "server", fmt.Sprint(i-1)), "name", name, "parentId", base.Get("id"),
				"data", doc.New("base_url", serverURL(doc.New("openapi", "3", "servers", []any{s}), sourceURL)), "sortKey", int64(i)))
		}
	}
	var all []*Doc
	for _, t := range folderOrder {
		all = append(all, folders[t])
	}
	all = append(all, root...)
	slices.SortStableFunc(all, func(a, b *Doc) int {
		x, y := a.Num("sortKey", 0), b.Num("sortKey", 0)
		switch {
		case x < y:
			return -1
		case x > y:
			return 1
		}
		return 0
	})
	children := make([]any, len(all))
	for i, n := range all {
		children[i] = n
	}
	var desc []string
	if s := str(get(d, "info", "description")); s != "" {
		desc = append(desc, s)
	}
	if v := get(d, "info", "version"); truthy(v) {
		desc = append(desc, "Versão "+str(v))
	}
	ws := doc.New("id", wsID, "name", title)
	if len(desc) > 0 {
		ws.Set("description", strings.Join(desc, "\n\n"))
	}
	ws.Set("settings", doc.New("insecureTLS", false, "timeoutMs", int64(30000)))
	ws.Set("environments", envs)
	ws.Set("children", children)
	return Result{Workspaces: []*Doc{ws}, Warnings: w.list}
}

var jsonMime = regexp.MustCompile(`json`)

func requestBody(rb *Doc, deref func(any) any, where string, w *warner) *Doc {
	content := obj(rb.Get("content"))
	types := content.Keys()
	if len(types) == 0 {
		return doc.New("mime", nil)
	}
	pick := ""
	for _, t := range types {
		if jsonMime.MatchString(t) {
			pick = t
			break
		}
	}
	if pick == "" {
		for _, t := range types {
			if t == "application/x-www-form-urlencoded" || t == "multipart/form-data" {
				pick = t
				break
			}
		}
	}
	if pick == "" {
		pick = types[0]
	}
	media := obj(content.Get(pick))
	if media == nil {
		media = doc.New()
	}
	var first any
	hasFirst := false
	if media.Get("example") != nil {
		first, hasFirst = media.Get("example"), true
	} else if ex := obj(media.Get("examples")); ex != nil && ex.Len() > 0 {
		v := get(deref(ex.Get(ex.Keys()[0])), "value")
		first, hasFirst = v, v != nil
	}
	if pick == "application/x-www-form-urlencoded" || pick == "multipart/form-data" {
		schema := obj(deref(media.Get("schema")))
		if schema == nil {
			schema = doc.New()
		}
		ex := obj(first)
		if !hasFirst {
			ex = obj(coalesce(sample(schema, deref, 0, nil), doc.New()))
		}
		fields := []any{}
		props := obj(schema.Get("properties"))
		for _, k := range props.Keys() {
			p := obj(deref(props.Get(k)))
			isFile := p.Get("format") == "binary" || p.Get("type") == "file"
			val := ""
			if !isFile {
				val = str(ex.Get(k))
			}
			if val == "string" {
				val = ""
			}
			f := doc.New("name", k, "value", val, "enabled", true)
			if isFile {
				f.Set("file", "")
			}
			fields = append(fields, f)
		}
		return doc.New("mime", pick, "fields", fields)
	}
	if jsonMime.MatchString(pick) {
		value := first
		if !hasFirst {
			value = sample(media.Get("schema"), deref, 0, nil)
		}
		if s, ok := value.(string); ok {
			return doc.New("mime", "application/json", "text", s)
		}
		text, _ := doc.MarshalIndent(coalesce(value, doc.New()))
		return doc.New("mime", "application/json", "text", string(text))
	}
	if !hasFirst {
		w.warn(i18n.T("%s: body %s sem exemplo (ficou vazio)", where, pick))
		return doc.New("mime", pick, "text", "")
	}
	return doc.New("mime", pick, "text", str(first))
}
