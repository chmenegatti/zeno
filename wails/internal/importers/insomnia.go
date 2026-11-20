package importers

// Insomnia: diretório NeDB (~/.config/Insomnia/*.db), export JSON v4 ou export YAML v5 (port de
// src/main/import-insomnia.ts).

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"runtime"
	"strconv"
	"strings"

	"github.com/chmenegatti/zeno/wails/internal/doc"
	"github.com/chmenegatti/zeno/wails/internal/tags"
)

// Dir: pasta de dados do Insomnia (mesma do appData do Electron em cada sistema)
func Dir() string {
	home, _ := os.UserHomeDir()
	switch runtime.GOOS {
	case "darwin":
		return filepath.Join(home, "Library", "Application Support", "Insomnia")
	case "windows":
		if d := os.Getenv("APPDATA"); d != "" {
			return filepath.Join(d, "Insomnia")
		}
		return filepath.Join(home, "AppData", "Roaming", "Insomnia")
	}
	if d := os.Getenv("XDG_CONFIG_HOME"); d != "" {
		return filepath.Join(d, "Insomnia")
	}
	return filepath.Join(home, ".config", "Insomnia")
}

var nedbFiles = []string{"Workspace", "RequestGroup", "Request", "Environment", "WebSocketRequest", "GrpcRequest"}

var typeFromExport = map[string]string{"workspace": "Workspace", "request_group": "RequestGroup", "request": "Request", "environment": "Environment", "websocket_request": "WebSocketRequest", "grpc_request": "GrpcRequest"}

// ordered: registros por _id na ordem em que apareceram (como um Map do JavaScript)
type ordered struct {
	keys []string
	byID map[string]*Doc
}

func (o *ordered) set(id string, d *Doc) {
	if o.byID == nil {
		o.byID = map[string]*Doc{}
	}
	if _, ok := o.byID[id]; !ok {
		o.keys = append(o.keys, id)
	}
	o.byID[id] = d
}

func (o *ordered) del(id string) {
	if _, ok := o.byID[id]; !ok {
		return
	}
	delete(o.byID, id)
	for i, k := range o.keys {
		if k == id {
			o.keys = append(o.keys[:i], o.keys[i+1:]...)
			break
		}
	}
}

func (o *ordered) list() []*Doc {
	out := make([]*Doc, 0, len(o.keys))
	for _, k := range o.keys {
		out = append(out, o.byID[k])
	}
	return out
}

// ParseNedb: NeDB é append-only: último registro de cada _id vence; $$deleted remove
func ParseNedb(text string) []*Doc {
	var o ordered
	for _, line := range strings.Split(text, "\n") {
		if strings.TrimSpace(line) == "" {
			continue
		}
		v, err := doc.FromJSON([]byte(line))
		d := obj(v)
		if err != nil || d == nil || !truthy(d.Get("_id")) {
			continue
		}
		id := str(d.Get("_id"))
		if truthy(d.Get("$$deleted")) {
			o.del(id)
		} else {
			o.set(id, d)
		}
	}
	return o.list()
}

// ReadNedbDir: registros da pasta do Insomnia
func ReadNedbDir(dir string) ([]*Doc, error) {
	var docs []*Doc
	for _, t := range nedbFiles {
		b, err := os.ReadFile(filepath.Join(dir, "insomnia."+t+".db"))
		if err == nil {
			docs = append(docs, ParseNedb(string(b))...)
		}
	}
	for _, d := range docs {
		if d.Str("type") == "Workspace" {
			return docs, nil
		}
	}
	return nil, fmt.Errorf("nenhum workspace do Insomnia em %s", dir)
}

// SkipsTLS: Insomnia com "Validate certificates" desligado?
func SkipsTLS(dir string) bool {
	b, err := os.ReadFile(filepath.Join(dir, "insomnia.Settings.db"))
	if err != nil {
		return false
	}
	for _, s := range ParseNedb(string(b)) {
		if s.Get("validateSSL") == false {
			return true
		}
	}
	return false
}

// IsV4: export JSON v4
func IsV4(raw any) bool {
	d := obj(raw)
	return d != nil && d.Get("_type") == "export" && arr(d.Get("resources")) != nil
}

// FromExportV4: registros do export v4 com o tipo do NeDB
func FromExportV4(raw any) ([]*Doc, error) {
	res, ok := get(raw, "resources").([]any)
	if !ok {
		return nil, errors.New("arquivo não é export JSON do Insomnia (v4)")
	}
	var out []*Doc
	for _, x := range res {
		r := obj(x)
		t, known := typeFromExport[r.Str("_type")]
		if r == nil || !truthy(r.Get("_type")) || !known {
			continue
		}
		d := r.Clone()
		d.Set("type", t)
		out = append(out, d)
	}
	return out, nil
}

var v5Type = regexp.MustCompile(`^(collection|spec)\.insomnia\.rest/5\.`)

// IsV5: export YAML v5
func IsV5(raw any) bool {
	d := obj(raw)
	return d != nil && v5Type.MatchString(jsString(coalesce(d.Get("type"), "")))
}

// String(v) do JavaScript (null e undefined viram texto)
func jsString(v any) string {
	if v == nil {
		return "null"
	}
	if d, ok := v.(*Doc); ok && d != nil {
		return "[object Object]"
	}
	return doc.AsStr(v)
}

var nonWord = regexp.MustCompile(`[^A-Za-z0-9_]+`)

// jsNumber: Number(v)
func jsNumber(v any) any {
	switch x := v.(type) {
	case int64, float64:
		return x
	case string:
		if strings.TrimSpace(x) == "" {
			return int64(0)
		}
		if f, err := strconv.ParseFloat(strings.TrimSpace(x), 64); err == nil {
			return num(f)
		}
	case bool:
		if x {
			return int64(1)
		}
		return int64(0)
	}
	return nil
}

func num(f float64) any {
	if f == float64(int64(f)) {
		return int64(f)
	}
	return f
}

// FromExportV5: export v5 (YAML, um workspace por arquivo) → mesmos registros do NeDB
func FromExportV5(raw any) ([]*Doc, error) {
	if !IsV5(raw) {
		return nil, errors.New("arquivo não é export do Insomnia v5")
	}
	r := obj(raw)
	var docs []*Doc
	wsID := str(coalesce(get(r, "meta", "id"), "wrk_v5_"+nonWord.ReplaceAllString(jsString(coalesce(r.Get("name"), "insomnia")), "_")))
	ws := doc.New("_id", wsID, "type", "Workspace")
	setDef(ws, "name", r.Get("name"))
	setDef(ws, "description", get(r, "meta", "description"))
	docs = append(docs, ws)
	n := 0
	meta := func(x any, prefix string) *Doc {
		id := get(x, "meta", "id")
		if id == nil {
			id = fmt.Sprintf("%s_v5_%d", prefix, n)
			n++
		}
		var sk any
		if v := get(x, "meta", "sortKey"); v != nil {
			sk = jsNumber(v)
		} else {
			sk = int64(n)
			n++
		}
		d := doc.New("_id", str(id), "metaSortKey", sk)
		setDef(d, "description", orNil(get(x, "meta", "description"), get(x, "description")))
		return d
	}
	var walk func(list []any, parentID string)
	walk = func(list []any, parentID string) {
		for _, x := range list {
			if arr(get(x, "children")) != nil {
				m := meta(x, "fld")
				m.Set("type", "RequestGroup")
				m.Set("parentId", parentID)
				for _, k := range []string{"name", "headers", "authentication", "environment"} {
					setDef(m, k, get(x, k))
				}
				setDef(m, "preRequestScript", get(x, "scripts", "preRequest"))
				setDef(m, "afterResponseScript", get(x, "scripts", "afterResponse"))
				docs = append(docs, m)
				walk(arr(get(x, "children")), m.Str("_id"))
			} else {
				m := meta(x, "req")
				m.Set("type", "Request")
				m.Set("parentId", parentID)
				for _, k := range []string{"name", "method", "url", "parameters", "headers", "body", "authentication"} {
					setDef(m, k, get(x, k))
				}
				setDef(m, "preRequestScript", get(x, "scripts", "preRequest"))
				setDef(m, "afterResponseScript", get(x, "scripts", "afterResponse"))
				docs = append(docs, m)
			}
		}
	}
	walk(arr(r.Get("collection")), wsID)
	if env := r.Get("environments"); env != nil {
		base := meta(env, "env")
		base.Set("type", "Environment")
		base.Set("parentId", wsID)
		base.Set("name", coalesce(get(env, "name"), "Base"))
		base.Set("data", coalesce(get(env, "data"), doc.New()))
		docs = append(docs, base)
		for _, sub := range arr(get(env, "subEnvironments")) {
			s := meta(sub, "env")
			s.Set("type", "Environment")
			s.Set("parentId", base.Str("_id"))
			setDef(s, "name", get(sub, "name"))
			s.Set("data", coalesce(get(sub, "data"), doc.New()))
			setDef(s, "color", get(sub, "color"))
			docs = append(docs, s)
		}
	}
	return docs, nil
}

// a || b || undefined
func orNil(vs ...any) any {
	for _, v := range vs {
		if truthy(v) {
			return v
		}
	}
	return nil
}

func insKV(list any) []any {
	out := []any{}
	for _, x := range arr(list) {
		d := obj(x)
		if d == nil || (!truthy(d.Get("name")) && !truthy(d.Get("value"))) {
			continue
		}
		out = append(out, doc.New("name", coalesce(d.Get("name"), ""), "value", coalesce(d.Get("value"), ""), "enabled", !truthy(d.Get("disabled"))))
	}
	return out
}

func insAuth(a *Doc, where string, w *warner) *Doc {
	if a == nil || !truthy(a.Get("type")) {
		return doc.New("type", "inherit")
	}
	if truthy(a.Get("disabled")) {
		return doc.New("type", "none")
	}
	s := func(k string) string {
		if v, ok := a.Get(k).(string); ok {
			return v
		}
		return ""
	}
	switch a.Get("type") {
	case "none":
		return doc.New("type", "none")
	case "basic":
		return doc.New("type", "basic", "username", s("username"), "password", s("password"))
	case "oauth2":
		clientAuth := ""
		if a.Get("credentialsInBody") == true {
			clientAuth = "body"
		}
		grant := s("grantType")
		if grant == "refresh_token" {
			grant = "authorization_code"
		}
		return oauth2Auth(grant, s("authorizationUrl"), s("accessTokenUrl"), s("clientId"), s("clientSecret"), s("scope"), s("audience"),
			s("redirectUrl"), a.Get("usePkce") == true, s("username"), s("password"), clientAuth, s("tokenPrefix"))
	case "bearer":
		d := doc.New("type", "bearer", "token", s("token"))
		if p := s("prefix"); p != "" {
			d.Set("prefix", p)
		}
		return d
	case "apikey":
		switch a.Get("addTo") {
		case "queryParams":
			return doc.New("type", "apikey", "key", s("key"), "value", s("value"), "addTo", "query")
		case "cookie":
			w.warn(where + ": API key em cookie virou header Cookie")
			return doc.New("type", "apikey", "key", "Cookie", "value", s("key")+"="+s("value"), "addTo", "header")
		}
		return doc.New("type", "apikey", "key", s("key"), "value", s("value"), "addTo", "header")
	}
	w.warn(fmt.Sprintf("%s: auth %q não suportada (ficou sem auth)", where, jsString(a.Get("type"))))
	return doc.New("type", "none")
}

func insBody(b *Doc, where string, w *warner) *Doc {
	if b == nil || (!truthy(b.Get("mimeType")) && !truthy(b.Get("text")) && len(arr(b.Get("params"))) == 0) {
		return doc.New("mime", nil)
	}
	mime := coalesce(b.Get("mimeType"), "text/plain")
	if mime == "application/x-www-form-urlencoded" || mime == "multipart/form-data" {
		fields := []any{}
		for _, x := range arr(b.Get("params")) {
			p := obj(x)
			f := doc.New("name", coalesce(p.Get("name"), ""), "value", coalesce(p.Get("value"), ""), "enabled", !truthy(p.Get("disabled")))
			if p.Get("type") == "file" {
				f.Set("file", coalesce(p.Get("fileName"), ""))
			}
			fields = append(fields, f)
		}
		return doc.New("mime", mime, "fields", fields)
	}
	return doc.New("mime", mime, "text", coalesce(b.Get("text"), ""))
}

func insScripts(d *Doc) any {
	pre, post := d.Get("preRequestScript"), d.Get("afterResponseScript")
	hasPre := isString(pre) && strings.TrimSpace(pre.(string)) != ""
	hasPost := isString(post) && strings.TrimSpace(post.(string)) != ""
	if !hasPre && !hasPost {
		return nil
	}
	s := doc.New()
	if hasPre {
		s.Set("pre", pre)
	}
	if hasPost {
		s.Set("post", post)
	}
	return s
}

// Convert: registros do Insomnia → workspaces
func Convert(docs []*Doc, insecureTLS bool) Result {
	w := &warner{}
	children := map[string][]*Doc{}
	for _, d := range docs {
		if p := d.Get("parentId"); truthy(p) {
			children[str(p)] = append(children[str(p)], d)
		}
	}
	sortKey := func(d *Doc) any {
		if v := d.Get("metaSortKey"); isNum(v) {
			return v
		}
		return int64(0)
	}
	var buildNodes func(parentID, trail string) []any
	buildNodes = func(parentID, trail string) []any {
		nodes := []any{}
		for _, d := range children[parentID] {
			name := str(or(d.Get("name"), "(sem nome)"))
			where := trail + " / " + name
			switch d.Str("type") {
			case "RequestGroup":
				f := doc.New("kind", "folder", "id", d.Get("_id"), "name", name)
				setDef(f, "description", orNil(d.Get("description")))
				f.Set("sortKey", sortKey(d))
				f.Set("headers", insKV(d.Get("headers")))
				f.Set("auth", insAuth(obj(d.Get("authentication")), where, w))
				if e := obj(d.Get("environment")); e != nil {
					f.Set("vars", e)
				} else {
					f.Set("vars", doc.New())
				}
				setDef(f, "scripts", insScripts(d))
				f.Set("children", buildNodes(d.Str("_id"), where))
				nodes = append(nodes, f)
			case "GrpcRequest":
				// gRPC (#5): host:porta vira grpc:// (grpcs:// se já vier assim); /pkg.Svc/Método vira serviço e método
				u := strings.TrimSpace(str(d.Get("url")))
				if !strings.HasPrefix(u, "grpc://") && !strings.HasPrefix(u, "grpcs://") {
					u = "grpc://" + u
				}
				svc, method := "", ""
				if pm := strings.TrimPrefix(str(d.Get("protoMethodName")), "/"); pm != "" {
					svc, method, _ = strings.Cut(pm, "/")
				}
				r := doc.New("kind", "request", "id", d.Get("_id"), "name", name)
				setDef(r, "description", orNil(d.Get("description")))
				r.Set("method", "GET")
				r.Set("url", u)
				r.Set("params", []any{})
				r.Set("headers", insKV(d.Get("metadata")))
				body := doc.New("mime", nil)
				if t := str(get(d, "body", "text")); strings.TrimSpace(t) != "" {
					body = doc.New("mime", "application/json", "text", t)
				}
				r.Set("body", body)
				r.Set("auth", doc.New("type", "inherit"))
				if svc != "" {
					r.Set("grpc", doc.New("service", svc, "method", method))
				}
				if truthy(d.Get("protoFileId")) {
					w.warn(where + ": arquivo .proto do Insomnia não vem junto; use server reflection ou escolha o .proto")
				}
				r.Set("sortKey", sortKey(d))
				nodes = append(nodes, r)
			case "Request", "WebSocketRequest":
				// WebSocket (#6): URL ws(s)://; a conexão é aberta pelo Zeno (as mensagens salvas do Insomnia ficam de fora)
				r := doc.New("kind", "request", "id", d.Get("_id"), "name", name)
				setDef(r, "description", orNil(d.Get("description")))
				r.Set("method", strings.ToUpper(str(or(d.Get("method"), "GET"))))
				r.Set("url", coalesce(d.Get("url"), ""))
				r.Set("params", insKV(d.Get("parameters")))
				r.Set("headers", insKV(d.Get("headers")))
				body := insBody(obj(d.Get("body")), where, w)
				r.Set("body", body)
				r.Set("auth", insAuth(obj(d.Get("authentication")), where, w))
				setDef(r, "scripts", insScripts(d))
				if d.Get("settingSendCookies") == false {
					r.Set("sendCookies", false)
				}
				if d.Get("settingStoreCookies") == false {
					r.Set("storeCookies", false)
				}
				r.Set("sortKey", sortKey(d))
				texts := []string{str(r.Get("url")), str(body.Get("text"))}
				for _, h := range arr(r.Get("headers")) {
					texts = append(texts, str(obj(h).Get("value")))
				}
				if unknown := unknownTags(texts); len(unknown) > 0 {
					w.warn(fmt.Sprintf("%s: usa a tag %s, que o Zeno não tem (só com plugin)", where, strings.Join(unknown, ", ")))
				}
				nodes = append(nodes, r)
			}
		}
		return sortNodes(nodes)
	}

	var workspaces []*Doc
	for _, ws := range docs {
		if ws.Str("type") != "Workspace" {
			continue
		}
		name := str(or(ws.Get("name"), "(sem nome)"))
		var envs []*Doc
		for _, base := range children[ws.Str("_id")] {
			if base.Str("type") != "Environment" {
				continue
			}
			envs = append(envs, doc.New("id", base.Get("_id"), "name", or(base.Get("name"), "Base"), "parentId", nil, "data", coalesce(base.Get("data"), doc.New()), "sortKey", sortKey(base)))
			for _, sub := range children[base.Str("_id")] {
				if sub.Str("type") != "Environment" {
					continue
				}
				e := doc.New("id", sub.Get("_id"), "name", or(sub.Get("name"), "Ambiente"), "parentId", base.Get("_id"))
				setDef(e, "color", orNil(sub.Get("color")))
				e.Set("data", coalesce(sub.Get("data"), doc.New()))
				e.Set("sortKey", sortKey(sub))
				envs = append(envs, e)
			}
		}
		// Insomnia pode ter mais de um base; o primeiro vira o base, os outros viram sub-ambientes dele
		var bases []*Doc
		for _, e := range envs {
			if e.Get("parentId") == nil {
				bases = append(bases, e)
			}
		}
		for _, extra := range bases[min(1, len(bases)):] {
			extra.Set("parentId", bases[0].Get("id"))
			w.warn(fmt.Sprintf("%s: ambiente base extra %q virou sub-ambiente", name, str(extra.Get("name"))))
		}
		envList := make([]any, len(envs))
		for i, e := range envs {
			envList[i] = e
		}
		out := doc.New("id", ws.Get("_id"), "name", name)
		setDef(out, "description", orNil(ws.Get("description")))
		out.Set("settings", doc.New("insecureTLS", insecureTLS, "timeoutMs", int64(30000)))
		out.Set("environments", sortNodes(envList))
		out.Set("children", buildNodes(ws.Str("_id"), name))
		workspaces = append(workspaces, out)
	}
	sortWorkspaces(workspaces)
	return Result{Workspaces: workspaces, Warnings: w.list}
}

func sortWorkspaces(ws []*Doc) {
	for i := 1; i < len(ws); i++ {
		for j := i; j > 0 && localeCompare(ws[j-1].Str("name"), ws[j].Str("name")) > 0; j-- {
			ws[j-1], ws[j] = ws[j], ws[j-1]
		}
	}
}

var tagRe = regexp.MustCompile(`\{%[\s\S]*?%\}`)

// tags que o Zeno tem (parseTag do shared/tagdef.ts); as outras precisam de plugin
var knownTags = map[string]bool{"uuid": true, "now": true, "response": true, "timestamp": true, "faker": true, "hash": true, "base64": true, "file": true, "prompt": true, "jsonpath": true}

// unknownTags: nomes das tags {% %} que o Zeno não tem, sem repetir, na ordem ("{% nome %}")
func unknownTags(texts []string) []string {
	var out []string
	seen := map[string]bool{}
	for _, t := range texts {
		for _, m := range tagRe.FindAllString(t, -1) {
			name, _ := tags.ParseArgs(m)
			if !knownTags[name] && !seen[name] {
				seen[name] = true
				out = append(out, "{% "+name+" %}")
			}
		}
	}
	return out
}
