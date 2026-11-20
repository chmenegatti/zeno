// Cofre no app: segredos conhecidos, proteger workspace e abrir segredos só pro envio
// (port de knownSecrets/protectWorkspace do index.ts e de open/collectSecrets/redactTimeline do engine.ts).

package main

import (
	"regexp"
	"sort"
	"strings"

	"github.com/chmenegatti/zeno/wails/internal/doc"
	"github.com/chmenegatti/zeno/wails/internal/protect"
	"github.com/chmenegatti/zeno/wails/internal/vault"
)

var secretRe = regexp.MustCompile(`\$zeno\$v1\$[0-9a-f]{8}\$[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+`)

// todos os segredos conhecidos: literais (pelas regras) + já cifrados (decifrados só aqui, em memória)
func (a *App) knownSecrets() []string {
	known := map[string]bool{}
	for _, ws := range a.store.List() {
		for _, v := range protect.LiteralSecrets(ws) {
			known[v] = true
		}
		raw, _ := doc.Marshal([]any{ws.Get("environments"), ws.Get("children")})
		for _, t := range secretRe.FindAllString(string(raw), -1) {
			if p, err := a.vault.Decrypt(t); err == nil {
				known[p] = true
			}
		}
	}
	out := make([]string, 0, len(known))
	for k := range known {
		out = append(out, k)
	}
	return out
}

// cifra no cofre todo segredo em texto puro do workspace; devolve quantos
func (a *App) protectWorkspace(wsID string, known []string) (int, error) {
	ws := a.store.Workspace(wsID)
	if ws == nil {
		return 0, errNoWorkspace
	}
	if known == nil {
		known = a.knownSecrets()
	}
	spots := protect.Scan(ws, known).Spots
	// uma cópia por objeto alterado; grava cada um uma vez só
	type copyOf struct {
		kind string
		obj  *doc.Doc
	}
	copies := map[string]*copyOf{}
	var order []string
	for _, s := range spots {
		c := copies[s.ID]
		if c == nil {
			src := protect.Target(ws, s)
			if src == nil {
				continue
			}
			c = &copyOf{s.Kind, src.Clone()}
			copies[s.ID] = c
			order = append(order, s.ID)
		}
		tok, err := a.vault.Encrypt(doc.AsStr(protect.GetAt(c.obj, s.Path)))
		if err != nil {
			return 0, err
		}
		protect.SetAt(c.obj, s.Path, tok)
	}
	for _, kind := range []string{"request", "folder", "env"} {
		for _, id := range order {
			c := copies[id]
			if c.kind != kind {
				continue
			}
			var err error
			switch kind {
			case "request":
				err = a.store.SaveRequest(c.obj)
			case "folder":
				c.obj.Del("children")
				_, err = a.store.SaveFolder(c.obj)
			case "env":
				_, err = a.store.SaveEnvironment(wsID, c.obj)
			}
			if err != nil {
				return 0, err
			}
		}
	}
	return len(spots), nil
}

// segredos abertos (valores) pra esconder na linha do tempo gravada
func collectSecrets(raw, open any, out map[string]bool) {
	if vault.IsEncrypted(raw) {
		if s, ok := open.(string); ok && len(s) >= 3 {
			out[s] = true
		}
		return
	}
	switch r := raw.(type) {
	case []any:
		if o, ok := open.([]any); ok {
			for i := range r {
				if i < len(o) {
					collectSecrets(r[i], o[i], out)
				}
			}
		}
	case *doc.Doc:
		if o, ok := open.(*doc.Doc); ok {
			for _, k := range r.Keys() {
				collectSecrets(r.Get(k), o.Get(k), out)
			}
		}
	}
}

// troca segredos do cofre por ••• no cabeçalho e no body enviados (o que vai pro histórico em disco)
func redactTimeline(rec *doc.Doc, secrets map[string]bool) {
	tl := rec.Map("timeline")
	if tl == nil || len(secrets) == 0 {
		return
	}
	list := make([]string, 0, len(secrets))
	for s := range secrets {
		list = append(list, s)
	}
	sort.Slice(list, func(i, j int) bool { return len(list[i]) > len(list[j]) })
	hide := func(t string) string {
		for _, s := range list {
			t = strings.ReplaceAll(t, s, "•••••• (cofre)")
		}
		return t
	}
	if tl.Has("requestBody") {
		tl.Set("requestBody", hide(tl.Str("requestBody")))
	}
	for _, h := range tl.List("hops") {
		if hd, ok := h.(*doc.Doc); ok && hd.Has("requestHead") {
			hd.Set("requestHead", hide(hd.Str("requestHead")))
		}
	}
}

// abre os segredos de ambientes, pastas e request só pro envio; devolve as cópias abertas e os valores
func (a *App) openForSend(ws, req *doc.Doc, anc []*doc.Doc) (*doc.Doc, *doc.Doc, []*doc.Doc, map[string]bool, error) {
	secrets := map[string]bool{}
	envs, err := a.vault.DecryptDeep(ws.Get("environments"), nil)
	if err != nil {
		return nil, nil, nil, nil, err
	}
	collectSecrets(ws.Get("environments"), envs, secrets)
	openWS := doc.New("id", ws.Get("id"), "settings", ws.Get("settings"), "environments", envs, "children", ws.Get("children"))
	r, err := a.vault.DecryptDeep(req, nil)
	if err != nil {
		return nil, nil, nil, nil, err
	}
	collectSecrets(req, r, secrets)
	openAnc := make([]*doc.Doc, len(anc))
	for i, f := range anc {
		o, err := a.vault.DecryptDeep(f, nil)
		if err != nil {
			return nil, nil, nil, nil, err
		}
		collectSecrets(f, o, secrets)
		openAnc[i] = o.(*doc.Doc)
	}
	return openWS, r.(*doc.Doc), openAnc, secrets, nil
}
