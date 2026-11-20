// Package engine: envio completo (port da parte de envio de src/main/engine.ts): segredos do cofre abertos
// só pro envio, scripts pré e pós-request, tags {% %} com dependências, cookies, asserções e histórico.
// Plugins: tags, requestHooks e responseHooks.
package engine

import (
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/chmenegatti/zeno/wails/internal/assert"
	"github.com/chmenegatti/zeno/wails/internal/cookies"
	"github.com/chmenegatti/zeno/wails/internal/doc"
	"github.com/chmenegatti/zeno/wails/internal/httpc"
	"github.com/chmenegatti/zeno/wails/internal/plugins"
	"github.com/chmenegatti/zeno/wails/internal/protect"
	"github.com/chmenegatti/zeno/wails/internal/scripts"
	"github.com/chmenegatti/zeno/wails/internal/store"
	"github.com/chmenegatti/zeno/wails/internal/tags"
	"github.com/chmenegatti/zeno/wails/internal/vars"
	"github.com/chmenegatti/zeno/wails/internal/vault"
)

type Doc = doc.Doc

// Hooks: o que o motor pede pra interface
type Hooks struct {
	// Emit: evento pra interface (response:added)
	Emit func(name string, data ...any)
	// Ask: {% prompt %}; ok=false = cancelou
	Ask func(tags.Prompt) (string, bool)
}

// Engine: envio com o store, cookies e cofre do app
type Engine struct {
	Store   *store.Store
	Cookies *cookies.Cookies
	Vault   *vault.Vault
	Plugins *plugins.Plugins
	Hooks   Hooks
}

// tag de plugin pro resolvedor de tags (nil sem plugins)
func (e *Engine) pluginTag(varsDoc *Doc) func(string, []string) (string, bool, error) {
	if e.Plugins == nil {
		return nil
	}
	return func(name string, args []string) (string, bool, error) {
		if !e.Plugins.HasTag(name) {
			return "", false, nil
		}
		v, err := e.Plugins.RunTag(name, args, func(t string) string { return vars.Render(t, varsDoc) }, varsDoc)
		return v, true, err
	}
}

func (e *Engine) emit(name string, data ...any) {
	if e.Hooks.Emit != nil {
		e.Hooks.Emit(name, data...)
	}
}

func (e *Engine) ask(p tags.Prompt) (string, bool) {
	if e.Hooks.Ask == nil {
		return "", false
	}
	return e.Hooks.Ask(p)
}

// resultado como o SendResult do Electron (scripts = relatório de testes, quando há asserções)
func sendResult(rec *Doc, history []any, missing, warnings []string, report *Doc) *Doc {
	if missing == nil {
		missing = []string{}
	}
	// avisos sem repetição, na ordem
	seen := map[string]bool{}
	uniq := []string{}
	for _, w := range warnings {
		if !seen[w] {
			seen[w] = true
			uniq = append(uniq, w)
		}
	}
	out := doc.New("response", rec, "history", history, "missing", missing, "warnings", uniq)
	if report != nil {
		out.Set("scripts", report)
	}
	return out
}

// workspace que contém o request (ativo primeiro)
func (e *Engine) wsOfRequest(id string) *Doc {
	for _, w := range e.Store.List() {
		if n, _ := doc.Find(w, id); n != nil && n.Str("kind") == "request" {
			return w
		}
	}
	return nil
}

// Latest: última resposta do request com o body completo
func (e *Engine) Latest(id string) *Doc {
	h := e.Store.GetResponses(id)
	if len(h) == 0 {
		return nil
	}
	rec, _ := h[0].(*Doc)
	if rec == nil {
		return nil
	}
	if rec.Get("bodyFile") == true {
		if body, err := e.Store.ResponseBody(rec); err == nil {
			rec = rec.Clone()
			rec.Set("body", body)
			rec.Del("bodyFile")
		}
	}
	return rec
}

// Execute: envia o request (resolvendo tags e mandando as dependências de {% response %})
func (e *Engine) Execute(ws, req *Doc, envID string, depth int) (*Doc, error) {
	_, anc := doc.Find(ws, req.Str("id"))
	// segredos do cofre abertos só aqui, só pro envio
	openWS, openReq, openAnc, secrets, err := e.openForSend(ws, req, anc)
	if err != nil {
		return nil, err
	}

	// ---------- scripts: pastas de fora pra dentro, depois o request ----------
	rep := &scripts.Report{}
	pre, post := chain("pre", openAnc, openReq), chain("post", openAnc, openReq)
	var st *scripts.State
	var before scripts.State
	baseEnv, subEnv := envs(openWS, envID)
	if len(pre)+len(post) > 0 {
		base := baseEnv.Map("data").Clone()
		if base == nil {
			base = doc.New()
		}
		state := scripts.State{Base: base, Env: base, EnvIsBase: subEnv == nil, Vars: doc.New(), Request: scriptRequest(openReq)}
		if subEnv != nil {
			state.Env = subEnv.Map("data").Clone()
			if state.Env == nil {
				state.Env = doc.New()
			}
		}
		before = scripts.State{Base: state.Base.Clone(), Env: state.Env.Clone()}
		st = &state
	}
	if st != nil && len(pre) > 0 {
		next, failed := scripts.RunPhase("pre", pre, *st, rep, scripts.Timeout)
		st = &next
		// o que o script mudou vale pro envio
		openWS = withState(openWS, baseEnv, subEnv, st)
		openReq = applyRequest(openReq, st.Request)
		if st.Vars.Len() > 0 {
			openAnc = append(append([]*Doc{}, openAnc...), pseudoFolder("_script", st.Vars))
		}
		if failed {
			e.persistEnvChanges(ws, baseEnv, subEnv, before, *st)
			rec := doc.New("id", httpc.ResponseID(time.Now()), "requestId", req.Get("id"), "at", time.Now().UnixMilli(),
				"method", openReq.Get("method"), "url", openReq.Get("url"), "status", 0, "statusText", "", "headers", []any{},
				"body", "", "bodyEncoding", "utf8", "size", 0, "timing", doc.New("headersMs", 0, "totalMs", 0),
				"error", "Não enviado: o script "+rep.Errors[0])
			return sendResult(rec, e.Store.AddResponse(rec), nil, nil, reportDoc(rep)), nil
		}
	}

	p := vars.Prepare(openWS, openReq, openAnc, envID, nil)
	warnings := []string{}
	if len(p.Unsupported) > 0 {
		if depth > 3 {
			warnings = append(warnings, "cadeia de {% response %} longa demais (máx. 3)")
		} else {
			varsDoc := vars.BuildVars(openWS, envID, openAnc)
			// mesma pergunta (chave) só uma vez por envio
			asked := map[string]struct {
				v  string
				ok bool
			}{}
			ctx := &tags.Context{
				Latest:         e.Latest,
				ResolveRequest: e.resolveRef(ws),
				Render:         func(t string) string { return vars.Render(t, varsDoc) },
				Plugin:         e.pluginTag(varsDoc),
				Ask: func(pr tags.Prompt) (string, bool) {
					key := pr.Key
					if key == "" {
						key = pr.Title + "|" + pr.Label
					}
					if r, ok := asked[key]; ok {
						return r.v, r.ok
					}
					v, ok := e.ask(pr)
					asked[key] = struct {
						v  string
						ok bool
					}{v, ok}
					return v, ok
				},
				SendByID: func(id string) (*Doc, error) {
					dep := e.wsOfRequest(id)
					if dep == nil {
						return nil, fmt.Errorf("request %s não existe", id)
					}
					node, _ := doc.Find(dep, id)
					depEnv := envID
					if dep.Str("id") != ws.Str("id") {
						depEnv = e.Store.GetState().Map("activeEnv").Str(dep.Str("id"))
					}
					r, err := e.Execute(dep, node, depEnv, depth+1)
					if err != nil {
						return nil, err
					}
					e.emit("response:added", id, r.Get("history"))
					return e.Latest(id), nil
				},
			}
			values, errs, err := tags.Resolve(p.Unsupported, ctx)
			var pc *tags.ErrPromptCancelled
			if errors.As(err, &pc) {
				// dependência: a pergunta cancelada sobe e o envio principal também para
				if depth > 0 {
					return nil, err
				}
				// cancelou a pergunta: não envia nem grava no histórico
				rec := doc.New("id", httpc.ResponseID(time.Now()), "requestId", req.Get("id"), "at", time.Now().UnixMilli(),
					"method", req.Get("method"), "url", req.Get("url"), "status", 0, "statusText", "", "headers", []any{},
					"body", "", "bodyEncoding", "utf8", "size", 0, "timing", doc.New("headersMs", 0, "totalMs", 0), "error", err.Error())
				return sendResult(rec, e.Store.GetResponses(req.Str("id")), nil, nil, nil), nil
			}
			if err != nil {
				return nil, err
			}
			warnings = append(warnings, errs...)
			p = vars.Prepare(openWS, openReq, openAnc, envID, values)
		}
	}
	for _, t := range p.Unsupported {
		warnings = append(warnings, "tag não resolvida: "+t)
	}
	// requestHooks dos plugins: podem mudar método, URL, headers e body (texto) antes do envio
	if e.Plugins != nil {
		hr := plugins.HookRequest{Method: p.Method, URL: p.URL, Headers: p.Headers}
		if p.BodyKind == "text" {
			t := p.Text
			hr.Body = &t
		}
		h, ws := e.Plugins.BeforeSend(hr, vars.BuildVars(openWS, envID, openAnc))
		warnings = append(warnings, ws...)
		p.Method, p.URL, p.Headers = h.Method, h.URL, h.Headers
		if h.Body != nil && (p.BodyKind == "text" || (p.BodyKind == "none" && *h.Body != "")) {
			p.BodyKind, p.Text = "text", *h.Body
		}
	}
	// cookie jar do workspace, respeitando "mandar/guardar cookies" do request
	wsID := ws.Str("id")
	var hooks httpc.CookieHooks
	if req.Get("sendCookies") != false {
		hooks.Header = func(u string) string { return e.Cookies.Header(wsID, u) }
	}
	if req.Get("storeCookies") != false {
		hooks.Store = func(u string, set []string) { e.Cookies.Store(wsID, u, set) }
	}
	rec := httpc.Send(req.Str("id"), p, hooks)
	vault.RedactTimeline(rec, secrets)
	if e.Plugins != nil && rec.Str("error") == "" {
		body := ""
		if rec.Str("bodyEncoding") == "utf8" {
			body = rec.Str("body")
		}
		hs, _ := rec.Get("headers").([][2]string)
		st, _ := rec.Get("status").(int)
		warnings = append(warnings, e.Plugins.AfterResponse(plugins.HookResponse{Status: st, Headers: hs, Body: body})...)
	}

	if st != nil && len(post) > 0 && rec.Str("error") == "" {
		body := ""
		if rec.Str("bodyEncoding") == "utf8" {
			body = rec.Str("body")
		}
		cur := *st
		cur.Response = doc.New("code", rec.Get("status"), "status", rec.Get("statusText"), "headers", rec.Get("headers"), "body", body, "time", rec.Map("timing").Get("totalMs"))
		next, _ := scripts.RunPhase("post", post, cur, rep, scripts.Timeout)
		st = &next
	}

	// asserções: depois dos scripts, com as variáveis que eles deixaram (body completo, antes da prévia)
	var enabled []any
	for _, x := range req.List("assertions") {
		if d, _ := x.(*Doc); d != nil && d.Get("enabled") != false {
			enabled = append(enabled, d)
		}
	}
	if len(enabled) > 0 && rec.Str("error") == "" {
		wsA, ancA := openWS, openAnc
		if st != nil {
			wsA = withState(openWS, baseEnv, subEnv, st)
			if st.Vars.Len() > 0 {
				ancA = append(append([]*Doc{}, openAnc...), pseudoFolder("_script", st.Vars))
			}
		}
		varsDoc := vars.BuildVars(wsA, envID, ancA)
		for _, t := range assert.Evaluate(enabled, rec, func(s string) string { return vars.Render(s, varsDoc) }) {
			rep.Tests = append(rep.Tests, t)
		}
	}
	if st != nil {
		e.persistEnvChanges(ws, baseEnv, subEnv, before, *st)
	}
	var report *Doc
	if st != nil || len(enabled) > 0 {
		report = reportDoc(rep)
	}
	history := e.Store.AddResponse(rec)
	// o body vai uma vez só, no histórico: a interface só lê id e erro de "response"
	resp := rec
	if len(history) > 0 {
		if h, ok := history[0].(*Doc); ok && h.Str("id") == rec.Str("id") {
			resp = h.Clone()
			resp.Set("body", "")
		}
	}
	return sendResult(resp, history, p.Missing, warnings, report), nil
}

// ---------- prévia de tag ----------

// variáveis do workspace e ambiente ativos, com os segredos abertos (prévia)
func (e *Engine) previewVars() (*Doc, string, *Doc) {
	st := e.Store.GetState()
	ws := e.Store.Workspace(st.Str("activeWorkspaceId"))
	if ws == nil {
		if l := e.Store.List(); len(l) > 0 {
			ws = l[0]
		}
	}
	if ws == nil {
		return doc.New(), "", nil
	}
	envID := st.Map("activeEnv").Str(ws.Str("id"))
	envs, err := e.Vault.DecryptDeep(ws.Get("environments"), map[string]bool{})
	if err != nil {
		envs = ws.Get("environments")
	}
	return vars.BuildVars(doc.New("environments", envs), envID, nil), envID, ws
}

func (e *Engine) TagPreview(raw string, send bool) *Doc {
	name, args := tags.ParseArgs(raw)
	switch {
	case name == "uuid" || name == "now":
		v, _, _ := tags.Resolve([]string{raw}, &tags.Context{})
		return doc.New("value", v[raw])
	case tags.IsFn(name):
		vs, _, _ := e.previewVars()
		// prompt não pergunta aqui
		v, err := tags.EvalFn(name, args, &tags.Context{Render: func(t string) string { return vars.Render(t, vs) }})
		if err != nil {
			return doc.New("error", err.Error())
		}
		return doc.New("value", v)
	case name != "response":
		// tag de plugin: prévia com as variáveis do ambiente ativo
		if e.Plugins == nil || !e.Plugins.HasTag(name) {
			return doc.New("error", fmt.Sprintf("tag %q não suportada (nenhum plugin ativo tem)", name))
		}
		vs, _, _ := e.previewVars()
		v, err := e.Plugins.RunTag(name, args, func(t string) string { return vars.Render(t, vs) }, vs)
		if err != nil {
			return doc.New("error", err.Error())
		}
		return doc.New("value", v)
	}
	get := func(i int) string {
		if i < len(args) {
			return args[i]
		}
		return ""
	}
	field, ref, filter := get(0), get(1), get(2)
	if field == "" {
		field = "body"
	}
	// workspace ativo primeiro, como no envio
	activeID := e.Store.GetState().Str("activeWorkspaceId")
	var ws, node *Doc
	for _, pass := range []bool{true, false} {
		for _, w := range e.Store.List() {
			if (w.Str("id") == activeID) != pass || node != nil {
				continue
			}
			if n := tags.FindRequestRef(w.List("children"), ref); n != nil {
				ws, node = w, n
			}
		}
	}
	if node == nil {
		return doc.New("error", "request não encontrado")
	}
	res := e.Latest(node.Str("id"))
	if send {
		r, err := e.Execute(ws, node, e.Store.GetState().Map("activeEnv").Str(ws.Str("id")), 0)
		if err != nil {
			return doc.New("error", err.Error())
		}
		e.emit("response:added", node.Get("id"), r.Get("history"))
		res = e.Latest(node.Str("id"))
	}
	if res == nil {
		return doc.New("error", "ainda sem resposta: envie o request")
	}
	v, err := tags.Extract(res, field, filter)
	if err != nil {
		return doc.New("error", err.Error(), "at", res.Get("at"))
	}
	return doc.New("value", v, "at", res.Get("at"))
}

// abre os segredos de ambientes, pastas e request só pro envio; devolve as cópias abertas e os valores
func (e *Engine) openForSend(ws, req *doc.Doc, anc []*doc.Doc) (*doc.Doc, *doc.Doc, []*doc.Doc, map[string]bool, error) {
	secrets := map[string]bool{}
	envs, err := e.Vault.DecryptDeep(ws.Get("environments"), nil)
	if err != nil {
		return nil, nil, nil, nil, err
	}
	vault.CollectSecrets(ws.Get("environments"), envs, secrets)
	openWS := doc.New("id", ws.Get("id"), "settings", ws.Get("settings"), "environments", envs, "children", ws.Get("children"))
	r, err := e.Vault.DecryptDeep(req, nil)
	if err != nil {
		return nil, nil, nil, nil, err
	}
	vault.CollectSecrets(req, r, secrets)
	openAnc := make([]*doc.Doc, len(anc))
	for i, f := range anc {
		o, err := e.Vault.DecryptDeep(f, nil)
		if err != nil {
			return nil, nil, nil, nil, err
		}
		vault.CollectSecrets(f, o, secrets)
		openAnc[i] = o.(*doc.Doc)
	}
	return openWS, r.(*doc.Doc), openAnc, secrets, nil
}

// PrepareOpen: request pronto sem enviar (gerar código, ações de plugin): segredos abertos e tags
// resolvidas como o Insomnia faz ao gerar código ({% response %} usa a última resposta e nunca reenvia;
// prompt não pergunta). override = versão em edição na tela (ainda não salva).
func (e *Engine) PrepareOpen(ws *Doc, reqID, envID string, override *Doc) (vars.Prepared, string, error) {
	node, anc := doc.Find(ws, reqID)
	if node == nil || node.Str("kind") != "request" {
		return vars.Prepared{}, "", errors.New("request não encontrado")
	}
	req := node
	if override != nil {
		req = override
	}
	openWS, openReq, openAnc, _, err := e.openForSend(ws, req, anc)
	if err != nil {
		return vars.Prepared{}, "", err
	}
	p := vars.Prepare(openWS, openReq, openAnc, envID, nil)
	if len(p.Unsupported) > 0 {
		varsDoc := vars.BuildVars(openWS, envID, openAnc)
		values, _, err := tags.Resolve(p.Unsupported, &tags.Context{
			Latest:         e.Latest,
			NoSend:         true,
			ResolveRequest: e.resolveRef(ws),
			Render:         func(t string) string { return vars.Render(t, varsDoc) },
			Plugin:         e.pluginTag(varsDoc),
		})
		if err == nil {
			p = vars.Prepare(openWS, openReq, openAnc, envID, values)
		}
	}
	return p, node.Str("name"), nil
}

// id do request por id ou nome: primeiro no workspace, depois nos outros
func (e *Engine) resolveRef(ws *Doc) func(string) string {
	return func(ref string) string {
		if n := tags.FindRequestRef(ws.List("children"), ref); n != nil {
			return n.Str("id")
		}
		for _, w := range e.Store.List() {
			if n := tags.FindRequestRef(w.List("children"), ref); n != nil {
				return n.Str("id")
			}
		}
		return ""
	}
}

// ---------- scripts ----------

func chain(phase string, anc []*Doc, req *Doc) []scripts.Script {
	var out []scripts.Script
	for _, a := range anc {
		if c := a.Map("scripts").Str(phase); strings.TrimSpace(c) != "" {
			out = append(out, scripts.Script{Where: "pasta " + a.Str("name"), Code: c})
		}
	}
	if c := req.Map("scripts").Str(phase); strings.TrimSpace(c) != "" {
		out = append(out, scripts.Script{Where: req.Str("name"), Code: c})
	}
	return out
}

// ambiente Base e o sub-ambiente ativo (nil se nenhum)
func envs(ws *Doc, envID string) (base, sub *Doc) {
	for _, x := range ws.List("environments") {
		d, _ := x.(*Doc)
		if d == nil {
			continue
		}
		if d.Get("parentId") == nil && base == nil {
			base = d
		}
		if envID != "" && d.Str("id") == envID && d.Get("parentId") != nil {
			sub = d
		}
	}
	return base, sub
}

// request como os scripts veem (ScriptRequest)
func scriptRequest(req *Doc) *Doc {
	body := req.Map("body")
	b := doc.New("mime", body.Get("mime"))
	if body.Has("text") {
		b.Set("text", body.Get("text"))
	}
	headers, params := req.Get("headers"), req.Get("params")
	if headers == nil {
		headers = []any{}
	}
	if params == nil {
		params = []any{}
	}
	return doc.New("method", req.Get("method"), "url", req.Get("url"), "headers", cloneAny(headers), "params", cloneAny(params), "body", b)
}

func cloneAny(v any) any {
	d := doc.New("x", v).Clone()
	return d.Get("x")
}

// request depois do pré-script (multipart mantém os campos)
func applyRequest(req, sr *Doc) *Doc {
	r := req.Clone()
	r.Set("method", sr.Get("method"))
	r.Set("url", sr.Get("url"))
	r.Set("headers", sr.Get("headers"))
	r.Set("params", sr.Get("params"))
	if !req.Map("body").Has("fields") {
		b := req.Map("body").Clone()
		if b == nil {
			b = doc.New()
		}
		b.Set("mime", sr.Map("body").Get("mime"))
		if sr.Map("body").Has("text") {
			b.Set("text", sr.Map("body").Get("text"))
		}
		r.Set("body", b)
	}
	return r
}

// workspace com os ambientes como os scripts deixaram
func withState(ws, base, sub *Doc, st *scripts.State) *Doc {
	list := []any{}
	for _, x := range ws.List("environments") {
		d, _ := x.(*Doc)
		if d == nil {
			continue
		}
		switch {
		case base != nil && d.Str("id") == base.Str("id"):
			c := d.Clone()
			c.Set("data", st.Base)
			list = append(list, c)
		case sub != nil && d.Str("id") == sub.Str("id"):
			c := d.Clone()
			c.Set("data", st.Env)
			list = append(list, c)
		default:
			list = append(list, d)
		}
	}
	out := doc.New()
	for _, k := range ws.Keys() {
		out.Set(k, ws.Get(k))
	}
	out.Set("environments", list)
	return out
}

func pseudoFolder(id string, v *Doc) *Doc {
	return doc.New("kind", "folder", "id", id, "name", id, "sortKey", int64(0), "headers", []any{}, "auth", doc.New("type", "inherit"), "vars", v, "children", []any{})
}

func reportDoc(r *scripts.Report) *Doc {
	logs, tests, errs := r.Logs, r.Tests, r.Errors
	if logs == nil {
		logs = []string{}
	}
	if tests == nil {
		tests = []any{}
	}
	if errs == nil {
		errs = []string{}
	}
	return doc.New("logs", logs, "tests", tests, "errors", errs)
}

func same(a, b any) bool {
	x, _ := doc.Marshal(a)
	y, _ := doc.Marshal(b)
	return string(x) == string(y)
}

// grava nos YAML o que os scripts mudaram nos ambientes; valor que já era cifrado ou parece segredo
// volta cifrado pro cofre
func (e *Engine) persistEnvChanges(ws, base, sub *Doc, before, after scripts.State) {
	type target struct {
		id        string
		old, next *Doc
	}
	var targets []target
	if base != nil {
		targets = append(targets, target{base.Str("id"), before.Base, after.Base})
	}
	if !after.EnvIsBase && sub != nil {
		targets = append(targets, target{sub.Str("id"), before.Env, after.Env})
	}
	changed := false
	// relê do disco: num executor de coleção o ambiente pode ter mudado desde que o request começou
	cur := e.Store.Workspace(ws.Str("id"))
	if cur == nil {
		cur = ws
	}
	for _, t := range targets {
		var raw *Doc
		for _, x := range cur.List("environments") {
			if d, _ := x.(*Doc); d != nil && d.Str("id") == t.id {
				raw = d
			}
		}
		if raw == nil || same(t.old, t.next) {
			continue
		}
		data := raw.Map("data").Clone()
		if data == nil {
			data = doc.New()
		}
		for _, k := range t.old.Keys() {
			if !t.next.Has(k) {
				data.Del(k)
			}
		}
		for _, k := range t.next.Keys() {
			v := t.next.Get(k)
			if t.old.Has(k) && same(t.old.Get(k), v) {
				continue
			}
			if s, ok := v.(string); ok && s != "" && (vault.IsEncrypted(raw.Map("data").Get(k)) || protect.LooksSecret(k)) {
				if enc, err := e.Vault.Encrypt(s); err == nil {
					v = enc
				}
			}
			data.Set(k, v)
		}
		env := raw.Clone()
		env.Set("data", data)
		if _, err := e.Store.SaveEnvironment(ws.Str("id"), env); err == nil {
			changed = true
		}
	}
	if changed {
		e.emit("store:changed", e.Store.List())
	}
}

// CodeInput: request pronto pra "Gerar código" (o código sai no renderer). Com resolveVars, como
// PrepareOpen; sem, as {{ variáveis }} ficam como referência e só os segredos literais do request e
// das pastas são decifrados (pedido explícito do usuário).
func (e *Engine) CodeInput(ws, req *Doc, envID string, resolveVars bool) (*Doc, error) {
	if resolveVars {
		p, _, err := e.PrepareOpen(ws, req.Str("id"), envID, req)
		if err != nil {
			return nil, err
		}
		return p.Input(req.Str("id")), nil
	}
	r, err := e.Vault.DecryptDeep(req, nil)
	if err != nil {
		return nil, err
	}
	_, anc := doc.Find(ws, req.Str("id"))
	open := make([]*Doc, len(anc))
	for i, f := range anc {
		o, err := e.Vault.DecryptDeep(f, nil)
		if err != nil {
			return nil, err
		}
		d := o.(*Doc).Clone()
		d.Set("vars", doc.New())
		open[i] = d
	}
	bare := ws.Clone()
	bare.Set("environments", []any{})
	return vars.Prepare(bare, r.(*Doc), open, envID, nil).Input(req.Str("id")), nil
}
