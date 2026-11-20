// Package engine: envio completo (port da parte de envio de src/main/engine.ts): segredos do cofre abertos
// só pro envio, tags {% %} com dependências, cookies, asserções e histórico. Scripts e plugins entram
// no #67 e no #68.
package engine

import (
	"errors"
	"fmt"
	"time"

	"github.com/chmenegatti/zeno/wails/internal/assert"
	"github.com/chmenegatti/zeno/wails/internal/cookies"
	"github.com/chmenegatti/zeno/wails/internal/doc"
	"github.com/chmenegatti/zeno/wails/internal/httpc"
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
	Hooks   Hooks
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

	// asserções (com o body completo, antes de virar prévia no histórico)
	var report *Doc
	var enabled []any
	for _, x := range req.List("assertions") {
		if d, _ := x.(*Doc); d != nil && d.Get("enabled") != false {
			enabled = append(enabled, d)
		}
	}
	if len(enabled) > 0 {
		tests := []assert.Test{}
		if rec.Str("error") == "" {
			varsDoc := vars.BuildVars(openWS, envID, openAnc)
			tests = assert.Evaluate(enabled, rec, func(s string) string { return vars.Render(s, varsDoc) })
		}
		report = doc.New("logs", []string{}, "tests", tests, "errors", []string{})
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
		return doc.New("error", fmt.Sprintf("tag %q não suportada (nenhum plugin ativo tem)", name))
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
