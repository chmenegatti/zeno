// Package exporters: workspaces → arquivos pra levar pra outro lugar (#116): zip com os YAML do Zeno,
// export JSON v4 do Insomnia e coleção v2.1 do Postman (+ arquivos de ambiente). É o caminho inverso
// dos importers: o que eles leem, isto escreve.
package exporters

import (
	"archive/zip"
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"path"
	"path/filepath"
	"regexp"
	"strings"
	"time"

	"github.com/chmenegatti/zeno/wails/internal/doc"
	"github.com/chmenegatti/zeno/wails/internal/github"
	"github.com/chmenegatti/zeno/wails/internal/i18n"
	"github.com/chmenegatti/zeno/wails/internal/vars"
	"github.com/chmenegatti/zeno/wails/internal/vault"
)

type Doc = doc.Doc

// Result: arquivo pronto + nome sugerido + o que não deu pra levar
type Result struct {
	Data     []byte
	Name     string
	Warnings []string
}

type warner struct {
	list []string
	seen map[string]bool
}

func (w *warner) warn(m string) {
	if w.seen == nil {
		w.seen = map[string]bool{}
	}
	if !w.seen[m] {
		w.seen[m] = true
		w.list = append(w.list, m)
	}
}

var unsafeName = regexp.MustCompile(`[^\p{L}\p{N}._ -]+`)

// FileName: nome de arquivo seguro a partir do nome do workspace
func FileName(name string) string {
	n := strings.TrimSpace(unsafeName.ReplaceAllString(name, "-"))
	if n == "" {
		return "workspace"
	}
	return n
}

func baseName(ws []*Doc, single string) string {
	if len(ws) == 1 {
		return FileName(ws[0].Str("name"))
	}
	return single
}

// Zip: os YAML de cada workspace (como estão no disco: segredos continuam cifrados), um por pasta
func Zip(ws []*Doc) (Result, error) {
	var buf bytes.Buffer
	z := zip.NewWriter(&buf)
	used := map[string]bool{}
	for _, w := range ws {
		dir := w.Map("location").Str("dir")
		if dir == "" {
			return Result{}, errors.New(i18n.T("%s: pasta do workspace desconhecida", w.Str("name")))
		}
		files, err := github.WorkspaceFiles(dir)
		if err != nil {
			return Result{}, err
		}
		root := filepath.Base(dir)
		for i := 2; used[root]; i++ {
			root = fmt.Sprintf("%s-%d", filepath.Base(dir), i)
		}
		used[root] = true
		for _, f := range files {
			fw, err := z.Create(path.Join(root, f.Rel))
			if err != nil {
				return Result{}, err
			}
			if _, err := fw.Write([]byte(f.Text)); err != nil {
				return Result{}, err
			}
		}
	}
	if err := z.Close(); err != nil {
		return Result{}, err
	}
	return Result{Data: buf.Bytes(), Name: baseName(ws, "zeno-workspaces") + ".zeno.zip"}, nil
}

// Blank troca os valores cifrados do cofre por "" (fora do Zeno não abrem) e diz quantos eram
func Blank(v any) (any, int) {
	n := 0
	var walk func(any) any
	walk = func(x any) any {
		switch t := x.(type) {
		case string:
			if vault.IsEncrypted(t) {
				n++
				return ""
			}
		case []any:
			out := make([]any, len(t))
			for i, e := range t {
				out[i] = walk(e)
			}
			return out
		case *Doc:
			if t == nil {
				return t
			}
			out := doc.New()
			for _, k := range t.Keys() {
				out.Set(k, walk(t.Get(k)))
			}
			return out
		}
		return x
	}
	return walk(v), n
}

func children(d *Doc) []*Doc {
	var out []*Doc
	for _, x := range d.List("children") {
		if n, ok := x.(*Doc); ok && n != nil {
			out = append(out, n)
		}
	}
	return out
}

func kvs(d *Doc, k string) []*Doc {
	var out []*Doc
	for _, x := range d.List(k) {
		if n, ok := x.(*Doc); ok && n != nil {
			out = append(out, n)
		}
	}
	return out
}

func enabled(d *Doc) bool { return d.Get("enabled") != false }

func scriptsOf(d *Doc) (pre, post string) {
	s := d.Map("scripts")
	return strings.TrimSpace(s.Str("pre")), strings.TrimSpace(s.Str("post"))
}

func data(d *Doc) *Doc {
	if m := d.Map("data"); m != nil {
		return m
	}
	return doc.New()
}

// ---------- Insomnia (export JSON v4) ----------

func insAuth(a *Doc) *Doc {
	switch a.Str("type") {
	case "", "inherit":
		return doc.New()
	case "none":
		return doc.New("type", "none")
	case "basic":
		return doc.New("type", "basic", "username", a.Str("username"), "password", a.Str("password"))
	case "digest":
		return doc.New("type", "digest", "username", a.Str("username"), "password", a.Str("password"))
	case "awsv4":
		return doc.New("type", "iam", "accessKeyId", a.Str("accessKeyId"), "secretAccessKey", a.Str("secretAccessKey"), "sessionToken", a.Str("sessionToken"), "region", a.Str("region"), "service", a.Str("service"))
	case "bearer":
		d := doc.New("type", "bearer", "token", a.Str("token"))
		if p := a.Str("prefix"); p != "" {
			d.Set("prefix", p)
		}
		return d
	case "apikey":
		to := "header"
		if a.Str("addTo") == "query" {
			to = "queryParams"
		}
		return doc.New("type", "apikey", "key", a.Str("key"), "value", a.Str("value"), "addTo", to)
	case "oauth2":
		d := doc.New("type", "oauth2", "grantType", a.Str("grantType"))
		for _, kv := range [][2]string{{"authorizationUrl", "authUrl"}, {"accessTokenUrl", "tokenUrl"}, {"clientId", "clientId"}, {"clientSecret", "clientSecret"},
			{"scope", "scope"}, {"audience", "audience"}, {"redirectUrl", "redirectUri"}, {"username", "username"}, {"password", "password"}, {"tokenPrefix", "prefix"}} {
			if v := a.Str(kv[1]); v != "" {
				d.Set(kv[0], v)
			}
		}
		if a.Get("pkce") == true {
			d.Set("usePkce", true)
		}
		if a.Str("clientAuth") == "body" {
			d.Set("credentialsInBody", true)
		}
		return d
	}
	return doc.New()
}

func insKV(list []*Doc) []any {
	out := []any{}
	for _, h := range list {
		d := doc.New("name", h.Str("name"), "value", doc.AsStr(h.Get("value")))
		if !enabled(h) {
			d.Set("disabled", true)
		}
		out = append(out, d)
	}
	return out
}

func insBody(b *Doc) *Doc {
	mime := b.Str("mime")
	if mime == "" {
		return doc.New()
	}
	if mime == "application/x-www-form-urlencoded" || mime == "multipart/form-data" {
		params := []any{}
		for _, f := range kvs(b, "fields") {
			p := doc.New("name", f.Str("name"), "value", doc.AsStr(f.Get("value")))
			if !enabled(f) {
				p.Set("disabled", true)
			}
			if file := f.Str("file"); file != "" {
				p.Set("type", "file")
				p.Set("fileName", file)
			}
			params = append(params, p)
		}
		return doc.New("mimeType", mime, "params", params)
	}
	return doc.New("mimeType", mime, "text", b.Str("text"))
}

// Insomnia: export v4 com todos os workspaces escolhidos (o Insomnia importa vários de uma vez)
func Insomnia(ws []*Doc) (Result, error) {
	w := &warner{}
	res := []any{}
	sk := func(n *Doc) any {
		if v := n.Get("sortKey"); v != nil {
			return v
		}
		return int64(0)
	}
	scripts := func(d, n *Doc) {
		pre, post := scriptsOf(n)
		if pre != "" {
			d.Set("preRequestScript", pre)
		}
		if post != "" {
			d.Set("afterResponseScript", post)
		}
	}
	var nodes func(parent string, list []*Doc, trail string)
	nodes = func(parent string, list []*Doc, trail string) {
		for _, n := range list {
			where := trail + " / " + n.Str("name")
			if len(n.List("assertions")) > 0 {
				w.warn(i18n.T("%s: asserções não existem no Insomnia (ficaram de fora)", where))
			}
			if n.Str("kind") == "folder" {
				f := doc.New("_id", n.Str("id"), "_type", "request_group", "parentId", parent, "name", n.Str("name"), "description", n.Str("description"),
					"environment", data(doc.New("data", n.Get("vars"))), "headers", insKV(kvs(n, "headers")), "authentication", insAuth(n.Map("auth")), "metaSortKey", sk(n))
				scripts(f, n)
				res = append(res, f)
				nodes(n.Str("id"), children(n), where)
				continue
			}
			body := n.Map("body")
			if body == nil {
				body = doc.New()
			}
			r := doc.New("_id", n.Str("id"), "_type", "request", "parentId", parent, "name", n.Str("name"), "description", n.Str("description"),
				"method", n.Str("method"), "url", colonPath(n.Str("url")), "parameters", insKV(kvs(n, "params")), "headers", insKV(kvs(n, "headers")),
				"body", insBody(body), "authentication", insAuth(n.Map("auth")), "metaSortKey", sk(n),
				"settingSendCookies", n.Get("sendCookies") != false, "settingStoreCookies", n.Get("storeCookies") != false)
			if pp := pathParams(n, "name"); len(pp) > 0 {
				r.Set("pathParameters", pp)
			}
			// redirects por request (#151); o resto das configurações o Insomnia não tem por request
			if b, ok := n.Map("settings").Get("followRedirects").(bool); ok {
				r.Set("settingFollowRedirects", map[bool]string{true: "on", false: "off"}[b])
			}
			scripts(r, n)
			res = append(res, r)
		}
	}
	for _, x := range ws {
		id := x.Str("id")
		res = append(res, doc.New("_id", id, "_type", "workspace", "parentId", nil, "name", x.Str("name"), "description", x.Str("description"), "scope", "collection"))
		var base *Doc
		envs := kvs(x, "environments")
		for _, e := range envs {
			if e.Get("parentId") == nil {
				base = e
				break
			}
		}
		baseID := "env_" + strings.TrimPrefix(id, "wrk_") + "_base"
		if base != nil {
			baseID = base.Str("id")
			res = append(res, doc.New("_id", baseID, "_type", "environment", "parentId", id, "name", base.Str("name"), "data", data(base), "metaSortKey", sk(base)))
		} else {
			res = append(res, doc.New("_id", baseID, "_type", "environment", "parentId", id, "name", "Base", "data", doc.New(), "metaSortKey", int64(0)))
		}
		for _, e := range envs {
			if e == base {
				continue
			}
			d := doc.New("_id", e.Str("id"), "_type", "environment", "parentId", baseID, "name", e.Str("name"), "data", data(e), "metaSortKey", sk(e))
			if c := e.Str("color"); c != "" {
				d.Set("color", c)
			}
			res = append(res, d)
		}
		nodes(id, children(x), x.Str("name"))
	}
	out := doc.New("_type", "export", "__export_format", int64(4), "__export_date", time.Now().UTC().Format(time.RFC3339), "__export_source", "zeno", "resources", res)
	b, err := doc.MarshalIndent(out)
	return Result{Data: b, Name: baseName(ws, "zeno-workspaces") + ".insomnia.json", Warnings: w.list}, err
}

// ---------- Postman (coleção v2.1 + ambientes) ----------

var tagRe = regexp.MustCompile(`\{%.*?%\}`)
var varRe = regexp.MustCompile(`\{\{\s*(?:_\.)?([^{}\s]+)\s*\}\}`)

// {{ x }} / {{ _.x }} → {{x}}; tags {% %} não existem no Postman (aviso)
func pmText(s, where string, w *warner) string {
	if tagRe.MatchString(s) {
		w.warn(i18n.T("%s: tags {%% %%} não existem no Postman (ficaram como texto)", where))
	}
	s = strings.ReplaceAll(s, "{% uuid 'v4' %}", "{{$guid}}")
	s = strings.ReplaceAll(s, "{% now %}", "{{$isoTimestamp}}")
	return varRe.ReplaceAllString(s, "{{$1}}")
}

func pmAuth(a *Doc, where string, w *warner) *Doc {
	pairs := func(kind string, kv ...string) *Doc {
		list := []any{}
		for i := 0; i+1 < len(kv); i += 2 {
			list = append(list, doc.New("key", kv[i], "value", pmText(kv[i+1], where, w), "type", "string"))
		}
		return doc.New("type", kind, kind, list)
	}
	switch a.Str("type") {
	case "", "inherit":
		return nil
	case "none":
		return doc.New("type", "noauth")
	case "basic":
		return pairs("basic", "username", a.Str("username"), "password", a.Str("password"))
	case "digest":
		return pairs("digest", "username", a.Str("username"), "password", a.Str("password"))
	case "awsv4":
		return pairs("awsv4", "accessKey", a.Str("accessKeyId"), "secretKey", a.Str("secretAccessKey"), "sessionToken", a.Str("sessionToken"), "region", a.Str("region"), "service", a.Str("service"))
	case "bearer":
		if p := a.Str("prefix"); p != "" && !strings.EqualFold(p, "bearer") {
			w.warn(i18n.T("%s: prefixo do Bearer \"%s\" não existe no Postman", where, p))
		}
		return pairs("bearer", "token", a.Str("token"))
	case "apikey":
		in := "header"
		if a.Str("addTo") == "query" {
			in = "query"
		}
		return pairs("apikey", "key", a.Str("key"), "value", a.Str("value"), "in", in)
	case "oauth2":
		grant := map[string]string{"authorization_code": "authorization_code", "client_credentials": "client_credentials", "password": "password_credentials", "implicit": "implicit"}[a.Str("grantType")]
		if grant == "" {
			w.warn(i18n.T("%s: OAuth 2.0 device code não existe no Postman (virou authorization code)", where))
			grant = "authorization_code"
		}
		if grant == "authorization_code" && a.Get("pkce") == true {
			grant = "authorization_code_with_pkce"
		}
		kv := []string{"grant_type", grant}
		for _, p := range [][2]string{{"authUrl", "authUrl"}, {"accessTokenUrl", "tokenUrl"}, {"clientId", "clientId"}, {"clientSecret", "clientSecret"},
			{"scope", "scope"}, {"audience", "audience"}, {"redirect_uri", "redirectUri"}, {"username", "username"}, {"password", "password"}, {"headerPrefix", "prefix"}} {
			if v := a.Str(p[1]); v != "" {
				kv = append(kv, p[0], v)
			}
		}
		if a.Str("clientAuth") == "body" {
			kv = append(kv, "client_authentication", "body")
		}
		return pairs("oauth2", kv...)
	}
	return nil
}

func pmKV(list []*Doc, where string, w *warner) []any {
	out := []any{}
	for _, h := range list {
		d := doc.New("key", pmText(h.Str("name"), where, w), "value", pmText(doc.AsStr(h.Get("value")), where, w))
		if !enabled(h) {
			d.Set("disabled", true)
		}
		out = append(out, d)
	}
	return out
}

var rawLang = map[string]string{"application/json": "json", "application/xml": "xml", "text/xml": "xml", "text/html": "html", "application/javascript": "javascript"}

func pmBody(b *Doc, where string, w *warner) *Doc {
	mime := b.Str("mime")
	switch mime {
	case "":
		return nil
	case "application/x-www-form-urlencoded":
		return doc.New("mode", "urlencoded", "urlencoded", pmKV(kvs(b, "fields"), where, w))
	case "multipart/form-data":
		list := []any{}
		for _, f := range kvs(b, "fields") {
			d := doc.New("key", pmText(f.Str("name"), where, w))
			if file := f.Str("file"); file != "" {
				d.Set("type", "file")
				d.Set("src", file)
			} else {
				d.Set("value", pmText(doc.AsStr(f.Get("value")), where, w))
				d.Set("type", "text")
			}
			if !enabled(f) {
				d.Set("disabled", true)
			}
			list = append(list, d)
		}
		return doc.New("mode", "formdata", "formdata", list)
	case "application/graphql":
		var g struct {
			Query     string          `json:"query"`
			Variables json.RawMessage `json:"variables"`
		}
		text := b.Str("text")
		if json.Unmarshal([]byte(text), &g) != nil {
			g.Query = text
		}
		vars := ""
		if len(g.Variables) > 0 && string(g.Variables) != "null" {
			var v any
			if json.Unmarshal(g.Variables, &v) == nil {
				pretty, _ := json.MarshalIndent(v, "", "  ")
				vars = string(pretty)
			}
		}
		return doc.New("mode", "graphql", "graphql", doc.New("query", pmText(g.Query, where, w), "variables", pmText(vars, where, w)))
	}
	d := doc.New("mode", "raw", "raw", pmText(b.Str("text"), where, w))
	if l := rawLang[mime]; l != "" {
		d.Set("options", doc.New("raw", doc.New("language", l)))
	}
	return d
}

func pmEvents(n *Doc, where string, w *warner) []any {
	pre, post := scriptsOf(n)
	var out []any
	for _, s := range [][2]string{{"prerequest", pre}, {"test", post}} {
		if s[1] == "" {
			continue
		}
		out = append(out, doc.New("listen", s[0], "script", doc.New("type", "text/javascript", "exec", strings.Split(s[1], "\n"))))
	}
	if len(out) > 0 {
		w.warn(i18n.T("%s: scripts exportados como estão; confira se a API usada existe no Postman", where))
	}
	return out
}

func pmItems(list []*Doc, trail string, w *warner) []any {
	out := []any{}
	for _, n := range list {
		where := trail + " / " + n.Str("name")
		if len(n.List("assertions")) > 0 {
			w.warn(i18n.T("%s: asserções não existem no Postman (ficaram de fora)", where))
		}
		if n.Str("kind") == "folder" {
			f := doc.New("name", n.Str("name"))
			if d := n.Str("description"); d != "" {
				f.Set("description", d)
			}
			if len(kvs(n, "headers")) > 0 {
				w.warn(i18n.T("%s: headers da pasta não existem no Postman (ficaram de fora)", where))
			}
			if vars := n.Map("vars"); vars != nil && vars.Len() > 0 {
				vl := []any{}
				for _, k := range vars.Keys() {
					vl = append(vl, doc.New("key", k, "value", pmText(doc.AsStr(vars.Get(k)), where, w)))
				}
				f.Set("variable", vl)
			}
			if a := pmAuth(n.Map("auth"), where, w); a != nil {
				f.Set("auth", a)
			}
			if ev := pmEvents(n, where, w); len(ev) > 0 {
				f.Set("event", ev)
			}
			f.Set("item", pmItems(children(n), where, w))
			out = append(out, f)
			continue
		}
		raw := pmText(colonPath(n.Str("url")), where, w)
		q := pmKV(kvs(n, "params"), where, w)
		full := raw
		var on []string
		for _, x := range q {
			p := x.(*Doc)
			if p.Get("disabled") != true {
				on = append(on, p.Str("key")+"="+p.Str("value"))
			}
		}
		if len(on) > 0 {
			sep := "?"
			if strings.Contains(raw, "?") {
				sep = "&"
			}
			full += sep + strings.Join(on, "&")
		}
		u := doc.New("raw", full)
		if len(q) > 0 {
			u.Set("query", q)
		}
		if pv := pathParams(n, "key"); len(pv) > 0 {
			u.Set("variable", pv)
		}
		r := doc.New("method", n.Str("method"), "header", pmKV(kvs(n, "headers"), where, w), "url", u)
		if b := n.Map("body"); b != nil {
			if pb := pmBody(b, where, w); pb != nil {
				r.Set("body", pb)
			}
		}
		if a := pmAuth(n.Map("auth"), where, w); a != nil {
			r.Set("auth", a)
		}
		if d := n.Str("description"); d != "" {
			r.Set("description", d)
		}
		it := doc.New("name", n.Str("name"), "request", r)
		if ev := pmEvents(n, where, w); len(ev) > 0 {
			it.Set("event", ev)
		}
		// configurações do request (#151)
		if rs := n.Map("settings"); rs != nil {
			pb := doc.New()
			if b, ok := rs.Get("followRedirects").(bool); ok {
				pb.Set("followRedirects", b)
			}
			if rs.Has("maxRedirects") {
				pb.Set("maxRedirects", rs.Get("maxRedirects"))
			}
			if rs.Get("insecureTLS") == true {
				pb.Set("strictSSL", false)
			}
			if pb.Len() > 0 {
				it.Set("protocolProfileBehavior", pb)
			}
		}
		out = append(out, it)
	}
	return out
}

func postmanOne(x *Doc, w *warner) (coll *Doc, envs []*Doc) {
	name := x.Str("name")
	info := doc.New("_postman_id", x.Str("id"), "name", name, "schema", "https://schema.getpostman.com/json/collection/v2.1.0/collection.json")
	if d := x.Str("description"); d != "" {
		info.Set("description", d)
	}
	coll = doc.New("info", info, "item", pmItems(children(x), name, w))
	vars := []any{}
	for _, e := range kvs(x, "environments") {
		d := data(e)
		if e.Get("parentId") == nil {
			for _, k := range d.Keys() {
				vars = append(vars, doc.New("key", k, "value", pmText(doc.AsStr(d.Get(k)), name, w)))
			}
			continue
		}
		vals := []any{}
		for _, k := range d.Keys() {
			vals = append(vals, doc.New("key", k, "value", pmText(doc.AsStr(d.Get(k)), name, w), "enabled", true))
		}
		envs = append(envs, doc.New("id", e.Str("id"), "name", e.Str("name"), "values", vals, "_postman_variable_scope", "environment"))
	}
	if len(vars) > 0 {
		coll.Set("variable", vars)
	}
	return coll, envs
}

// Postman: um workspace sem sub-ambientes sai como a coleção (.json); senão um zip com as coleções e
// um arquivo por sub-ambiente (o Base vira variáveis da coleção)
func Postman(ws []*Doc) (Result, error) {
	w := &warner{}
	type file struct {
		name string
		d    *Doc
	}
	var files []file
	for _, x := range ws {
		coll, envs := postmanOne(x, w)
		fn := FileName(x.Str("name"))
		files = append(files, file{fn + ".postman_collection.json", coll})
		for _, e := range envs {
			files = append(files, file{fn + " - " + FileName(e.Str("name")) + ".postman_environment.json", e})
		}
	}
	if len(files) == 1 {
		b, err := doc.MarshalIndent(files[0].d)
		return Result{Data: b, Name: files[0].name, Warnings: w.list}, err
	}
	var buf bytes.Buffer
	z := zip.NewWriter(&buf)
	used := map[string]bool{}
	for _, f := range files {
		n := f.name
		for i := 2; used[n]; i++ {
			n = fmt.Sprintf("%d-%s", i, f.name)
		}
		used[n] = true
		b, err := doc.MarshalIndent(f.d)
		if err != nil {
			return Result{}, err
		}
		fw, err := z.Create(n)
		if err != nil {
			return Result{}, err
		}
		if _, err := fw.Write(b); err != nil {
			return Result{}, err
		}
	}
	if err := z.Close(); err != nil {
		return Result{}, err
	}
	return Result{Data: buf.Bytes(), Name: baseName(ws, "zeno-workspaces") + ".postman.zip", Warnings: w.list}, nil
}

// colonPath: Insomnia e Postman só entendem :id; {id} (OpenAPI) vira :id (#149)
func colonPath(u string) string {
	return vars.ReplacePathParams(u, func(n string) (string, bool) { return ":" + n, true })
}

// pathParams: valores dos parâmetros de caminho que estão na URL; key = "name" (Insomnia) ou "key" (Postman)
func pathParams(n *Doc, key string) []any {
	vals := map[string]string{}
	for _, x := range n.List("pathParams") {
		if p, ok := x.(*Doc); ok {
			vals[p.Str("name")] = p.Str("value")
		}
	}
	out := []any{}
	for _, name := range vars.PathParamNames(n.Str("url")) {
		out = append(out, doc.New(key, name, "value", vals[name]))
	}
	return out
}
