// Cofre no app: segredos conhecidos, proteger workspace e abrir segredos só pro envio
// (port de knownSecrets/protectWorkspace do index.ts e de open/collectSecrets/redactTimeline do engine.ts).

package main

import (
	"regexp"

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

// abre os segredos de ambientes, pastas e request só pro envio; devolve as cópias abertas e os valores
func (a *App) openForSend(ws, req *doc.Doc, anc []*doc.Doc) (*doc.Doc, *doc.Doc, []*doc.Doc, map[string]bool, error) {
	secrets := map[string]bool{}
	envs, err := a.vault.DecryptDeep(ws.Get("environments"), nil)
	if err != nil {
		return nil, nil, nil, nil, err
	}
	vault.CollectSecrets(ws.Get("environments"), envs, secrets)
	openWS := doc.New("id", ws.Get("id"), "settings", ws.Get("settings"), "environments", envs, "children", ws.Get("children"))
	r, err := a.vault.DecryptDeep(req, nil)
	if err != nil {
		return nil, nil, nil, nil, err
	}
	vault.CollectSecrets(req, r, secrets)
	openAnc := make([]*doc.Doc, len(anc))
	for i, f := range anc {
		o, err := a.vault.DecryptDeep(f, nil)
		if err != nil {
			return nil, nil, nil, nil, err
		}
		vault.CollectSecrets(f, o, secrets)
		openAnc[i] = o.(*doc.Doc)
	}
	return openWS, r.(*doc.Doc), openAnc, secrets, nil
}
