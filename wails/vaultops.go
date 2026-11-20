// Cofre no app: segredos conhecidos e proteger workspace
// (port de knownSecrets/protectWorkspace do index.ts).

package main

import (
	"regexp"

	"github.com/chmenegatti/zeno/wails/internal/doc"
	"github.com/chmenegatti/zeno/wails/internal/protect"
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
		return 0, errNoWorkspace()
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
