// Envio: segredos, tags {% %} (com dependências), cookies e histórico. Port da parte de envio de
// src/main/engine.ts; scripts, asserções e plugins entram nas próximas issues (#65, #67, #68).

package main

import (
	"errors"
	"fmt"
	"sync"
	"time"

	"github.com/chmenegatti/zeno/wails/internal/doc"
	"github.com/chmenegatti/zeno/wails/internal/httpc"
	"github.com/chmenegatti/zeno/wails/internal/tags"
	"github.com/chmenegatti/zeno/wails/internal/vars"
	"github.com/chmenegatti/zeno/wails/internal/vault"
)

// resultado como o SendResult do Electron
func sendResult(rec *Doc, history []any, missing, warnings []string) *Doc {
	if missing == nil {
		missing = []string{}
	}
	if warnings == nil {
		warnings = []string{}
	}
	return doc.New("response", rec, "history", history, "missing", missing, "warnings", warnings)
}

// workspace que contém o request (ativo primeiro)
func (a *App) wsOfRequest(id string) *Doc {
	for _, w := range a.store.List() {
		if n, _ := doc.Find(w, id); n != nil && n.Str("kind") == "request" {
			return w
		}
	}
	return nil
}

// última resposta do request com o body completo
func (a *App) latest(id string) *Doc {
	h := a.store.GetResponses(id)
	if len(h) == 0 {
		return nil
	}
	rec, _ := h[0].(*Doc)
	if rec == nil {
		return nil
	}
	if rec.Get("bodyFile") == true {
		if body, err := a.store.ResponseBody(rec); err == nil {
			rec = rec.Clone()
			rec.Set("body", body)
			rec.Del("bodyFile")
		}
	}
	return rec
}

// execute: envia o request (resolvendo tags e mandando as dependências de {% response %})
func (a *App) execute(ws, req *Doc, envID string, depth int) (*Doc, error) {
	_, anc := doc.Find(ws, req.Str("id"))
	// segredos do cofre abertos só aqui, só pro envio
	openWS, openReq, openAnc, secrets, err := a.openForSend(ws, req, anc)
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
				Latest: a.latest,
				ResolveRequest: func(ref string) string {
					if n := tags.FindRequestRef(ws.List("children"), ref); n != nil {
						return n.Str("id")
					}
					for _, w := range a.store.List() {
						if n := tags.FindRequestRef(w.List("children"), ref); n != nil {
							return n.Str("id")
						}
					}
					return ""
				},
				Render: func(t string) string { return vars.Render(t, varsDoc) },
				Ask: func(pr tags.Prompt) (string, bool) {
					key := pr.Key
					if key == "" {
						key = pr.Title + "|" + pr.Label
					}
					if r, ok := asked[key]; ok {
						return r.v, r.ok
					}
					v, ok := a.askPrompt(pr)
					asked[key] = struct {
						v  string
						ok bool
					}{v, ok}
					return v, ok
				},
				SendByID: func(id string) (*Doc, error) {
					dep := a.wsOfRequest(id)
					if dep == nil {
						return nil, fmt.Errorf("request %s não existe", id)
					}
					node, _ := doc.Find(dep, id)
					depEnv := envID
					if dep.Str("id") != ws.Str("id") {
						depEnv = a.store.GetState().Map("activeEnv").Str(dep.Str("id"))
					}
					r, err := a.execute(dep, node, depEnv, depth+1)
					if err != nil {
						return nil, err
					}
					a.Emit("response:added", id, r.Get("history"))
					return a.latest(id), nil
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
				return sendResult(rec, a.store.GetResponses(req.Str("id")), nil, nil), nil
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
		hooks.Header = func(u string) string { return a.cookies.Header(wsID, u) }
	}
	if req.Get("storeCookies") != false {
		hooks.Store = func(u string, set []string) { a.cookies.Store(wsID, u, set) }
	}
	rec := httpc.Send(req.Str("id"), p, hooks)
	vault.RedactTimeline(rec, secrets)
	history := a.store.AddResponse(rec)
	// o body vai uma vez só, no histórico: a interface só lê id e erro de "response"
	resp := rec
	if len(history) > 0 {
		if h, ok := history[0].(*Doc); ok && h.Str("id") == rec.Str("id") {
			resp = h.Clone()
			resp.Set("body", "")
		}
	}
	return sendResult(resp, history, p.Missing, warnings), nil
}

// ---------- {% prompt %}: pergunta na janela ----------

type promptAnswer struct {
	Value    string `json:"value"`
	Remember bool   `json:"remember"`
}

type prompts struct {
	mu      sync.Mutex
	seq     int
	waiting map[int]chan *promptAnswer
	memory  map[string]string
}

// pergunta na janela; "lembrar" guarda o valor só enquanto o app estiver aberto
func (a *App) askPrompt(p tags.Prompt) (string, bool) {
	key := p.Key
	if key == "" {
		key = p.Title + "|" + p.Label
	}
	a.prompts.mu.Lock()
	if v, ok := a.prompts.memory[key]; ok {
		a.prompts.mu.Unlock()
		return v, true
	}
	if a.ctx == nil {
		a.prompts.mu.Unlock()
		return "", false
	}
	a.prompts.seq++
	id := a.prompts.seq
	ch := make(chan *promptAnswer, 1)
	a.prompts.waiting[id] = ch
	a.prompts.mu.Unlock()
	a.Emit("prompt:ask", id, p)
	ans := <-ch
	if ans == nil {
		return "", false
	}
	if ans.Remember {
		a.prompts.mu.Lock()
		a.prompts.memory[key] = ans.Value
		a.prompts.mu.Unlock()
	}
	return ans.Value, true
}

func (a *App) promptReply(id int, ans *promptAnswer) {
	a.prompts.mu.Lock()
	ch := a.prompts.waiting[id]
	delete(a.prompts.waiting, id)
	a.prompts.mu.Unlock()
	if ch != nil {
		ch <- ans
	}
}

// ---------- prévia de tag ----------

// variáveis do workspace e ambiente ativos, com os segredos abertos (prévia)
func (a *App) previewVars() (*Doc, string, *Doc) {
	st := a.store.GetState()
	ws := a.store.Workspace(st.Str("activeWorkspaceId"))
	if ws == nil {
		if l := a.store.List(); len(l) > 0 {
			ws = l[0]
		}
	}
	if ws == nil {
		return doc.New(), "", nil
	}
	envID := st.Map("activeEnv").Str(ws.Str("id"))
	envs, err := a.vault.DecryptDeep(ws.Get("environments"), map[string]bool{})
	if err != nil {
		envs = ws.Get("environments")
	}
	return vars.BuildVars(doc.New("environments", envs), envID, nil), envID, ws
}

func (a *App) tagPreview(raw string, send bool) *Doc {
	name, args := tags.ParseArgs(raw)
	switch {
	case name == "uuid" || name == "now":
		v, _, _ := tags.Resolve([]string{raw}, &tags.Context{})
		return doc.New("value", v[raw])
	case tags.IsFn(name):
		vs, _, _ := a.previewVars()
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
	activeID := a.store.GetState().Str("activeWorkspaceId")
	var ws, node *Doc
	for _, pass := range []bool{true, false} {
		for _, w := range a.store.List() {
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
	res := a.latest(node.Str("id"))
	if send {
		r, err := a.execute(ws, node, a.store.GetState().Map("activeEnv").Str(ws.Str("id")), 0)
		if err != nil {
			return doc.New("error", err.Error())
		}
		a.Emit("response:added", node.Get("id"), r.Get("history"))
		res = a.latest(node.Str("id"))
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
