// Canais da interface. Cada fase da migração (#53) acrescenta os seus aqui; o que falta responde
// ErrNotPorted, ou um valor vazio quando a interface precisa dele pra abrir.

package main

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"

	"github.com/chmenegatti/zeno/wails/internal/doc"
	"github.com/chmenegatti/zeno/wails/internal/httpc"
	"github.com/chmenegatti/zeno/wails/internal/vars"
	"github.com/wailsapp/wails/v2/pkg/runtime"
)

type Doc = doc.Doc

func (a *App) register() {
	a.handle("load", func(Args) (any, error) {
		return Doc{"workspaces": a.store.List(), "state": a.store.GetState(), "dataDir": a.store.Dir}, nil
	})
	a.handle("setState", func(args Args) (any, error) {
		if len(args) == 0 {
			return nil, nil
		}
		return nil, a.store.SetState(json.RawMessage(args[0]))
	})
	a.handle("saveRequest", func(args Args) (any, error) {
		req, err := Get[Doc](args, 0)
		if err != nil {
			return nil, err
		}
		return nil, a.store.SaveRequest(req)
	})

	// ---------- envio (protótipo; completo na fase 2, #60) ----------
	a.handle("send", func(args Args) (any, error) {
		wsID, _ := Get[string](args, 0)
		req, err := Get[Doc](args, 1)
		if err != nil {
			return nil, err
		}
		envID, _ := Get[string](args, 2)
		var ws Doc
		for _, w := range a.store.List() {
			if doc.Str(w, "id") == wsID {
				ws = w
			}
		}
		if ws == nil {
			return nil, fmt.Errorf("workspace não encontrado")
		}
		_, anc := doc.Find(ws, doc.Str(req, "id"))
		p := vars.Prepare(ws, req, anc, envID)
		rec := httpc.Send(doc.Str(req, "id"), p)
		history := a.store.AddResponse(rec)
		var resp any = rec
		if len(history) > 0 {
			resp = history[0]
		}
		warnings := []string{}
		for _, t := range p.Unsupported {
			warnings = append(warnings, "tag ainda não disponível na versão Go: "+t)
		}
		missing := p.Missing
		if missing == nil {
			missing = []string{}
		}
		return Doc{"response": resp, "history": history, "missing": missing, "warnings": warnings}, nil
	})
	a.handle("cancel", func(args Args) (any, error) {
		id, _ := Get[string](args, 0)
		httpc.Cancel(id)
		return nil, nil
	})
	a.handle("responses", func(args Args) (any, error) {
		id, _ := Get[string](args, 0)
		return a.store.GetResponses(id), nil
	})
	a.handle("clearResponses", func(args Args) (any, error) {
		id, _ := Get[string](args, 0)
		return nil, os.RemoveAll(a.store.ResponsesFile(id))
	})

	// ---------- janela e sistema ----------
	a.handle("copyText", func(args Args) (any, error) {
		t, _ := Get[string](args, 0)
		return nil, runtime.ClipboardSetText(a.ctx, t)
	})
	a.handle("windowAction", func(args Args) (any, error) {
		switch act, _ := Get[string](args, 0); act {
		case "quit":
			runtime.Quit(a.ctx)
		case "fullscreen":
			if runtime.WindowIsFullscreen(a.ctx) {
				runtime.WindowUnfullscreen(a.ctx)
			} else {
				runtime.WindowFullscreen(a.ctx)
			}
		}
		return nil, nil
	})
	a.handle("openDataDir", func(Args) (any, error) {
		runtime.BrowserOpenURL(a.ctx, "file://"+filepath.ToSlash(a.store.Dir))
		return nil, nil
	})
	a.handle("benchLog", func(args Args) (any, error) {
		m, _ := Get[string](args, 0)
		fmt.Println("[renderer]", m)
		return nil, nil
	})

	// ---------- ainda não portados: valores vazios pra interface abrir ----------
	empty := func(v any) handler { return func(Args) (any, error) { return v, nil } }
	for _, c := range []string{"codeTargets", "pluginsList", "pluginsReload", "cookiesList"} {
		a.handle(c, empty([]any{}))
	}
	a.handle("insomniaHotkeys", empty(nil))
	a.handle("vaultStatus", empty(Doc{"available": false, "backend": "versão Go (fase 2)", "weak": true, "hasKey": false}))
	a.handle("githubStatus", empty(Doc{"account": nil, "deviceAvailable": false}))
	a.handle("tagPreview", empty(Doc{"error": "tags {% %} ainda não disponíveis na versão Go"}))
}
