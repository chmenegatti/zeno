// Ponte com a interface: o React chama window.zeno.<canal>(...args) e o adaptador (src/renderer/src/bridge.ts)
// manda tudo pra App.Call(canal, args JSON). Mesmos canais do preload do Electron.

package main

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"

	"github.com/wailsapp/wails/v2/pkg/runtime"
)

type App struct {
	ctx   context.Context
	store *Store
}

func NewApp() *App {
	return &App{store: NewStore(defaultDataDir())}
}

func (a *App) startup(ctx context.Context) {
	a.ctx = ctx
	a.store.Load()
}

// roteiro de verificação (ZENO_SCRIPT), como no Electron: roda o JS e sai quando terminar
func (a *App) domReady(ctx context.Context) {
	if s := os.Getenv("ZENO_SCRIPT"); s != "" {
		runtime.WindowExecJS(ctx, "console.log=(...m)=>window.go.main.App.Call('benchLog',[JSON.stringify(m.join(' '))]);Promise.resolve("+s+").catch(e=>console.log('ERRO '+e+' '+(e&&e.stack))).finally(()=>window.go.main.App.Call('windowAction',['\"quit\"']))")
	}
}

func arg[T any](args []string, i int) (T, error) {
	var v T
	if i >= len(args) {
		return v, nil
	}
	err := json.Unmarshal([]byte(args[i]), &v)
	return v, err
}

// não disponível no protótipo: a interface mostra o erro e segue
var notInPrototype = fmt.Errorf("não disponível no protótipo Go")

func (a *App) Call(channel string, args []string) (any, error) {
	switch channel {
	case "load":
		return Doc{"workspaces": a.store.List(), "state": a.store.GetState(), "dataDir": a.store.Dir}, nil
	case "setState":
		if len(args) > 0 {
			return nil, a.store.SetState(json.RawMessage(args[0]))
		}
		return nil, nil
	case "saveRequest":
		req, err := arg[Doc](args, 0)
		if err != nil {
			return nil, err
		}
		return nil, a.store.SaveRequest(req)
	case "send":
		wsID, _ := arg[string](args, 0)
		req, err := arg[Doc](args, 1)
		if err != nil {
			return nil, err
		}
		envID, _ := arg[string](args, 2)
		var ws Doc
		for _, w := range a.store.List() {
			if str(w, "id") == wsID {
				ws = w
			}
		}
		if ws == nil {
			return nil, fmt.Errorf("workspace não encontrado")
		}
		_, anc := FindNode(ws, str(req, "id"))
		p := prepare(ws, req, anc, envID)
		rec := send(str(req, "id"), p)
		history := a.store.AddResponse(rec)
		resp := any(rec)
		if len(history) > 0 {
			resp = history[0]
		}
		warnings := []string{}
		for _, t := range p.Unsupported {
			warnings = append(warnings, "tag não suportada no protótipo: "+t)
		}
		missing := p.Missing
		if missing == nil {
			missing = []string{}
		}
		return Doc{"response": resp, "history": history, "missing": missing, "warnings": warnings}, nil
	case "cancel":
		id, _ := arg[string](args, 0)
		cancelSend(id)
		return nil, nil
	case "responses":
		id, _ := arg[string](args, 0)
		return a.store.GetResponses(id), nil
	case "clearResponses":
		id, _ := arg[string](args, 0)
		return nil, os.RemoveAll(a.store.responsesFile(id))
	case "copyText":
		t, _ := arg[string](args, 0)
		return nil, runtime.ClipboardSetText(a.ctx, t)
	case "windowAction":
		act, _ := arg[string](args, 0)
		switch act {
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
	case "openDataDir":
		runtime.BrowserOpenURL(a.ctx, "file://"+filepath.ToSlash(a.store.Dir))
		return nil, nil
	case "benchLog":
		m, _ := arg[string](args, 0)
		fmt.Println("[renderer]", m)
		return nil, nil
	// o resto responde vazio pra interface abrir sem erro
	case "codeTargets", "pluginsList", "pluginsReload", "cookiesList":
		return []any{}, nil
	case "insomniaHotkeys":
		return nil, nil
	case "vaultStatus":
		return Doc{"available": false, "backend": "protótipo Go", "weak": true, "hasKey": false}, nil
	case "githubStatus":
		return Doc{"account": nil, "deviceAvailable": false}, nil
	case "tagPreview":
		return Doc{"error": "tags {% %} não estão no protótipo Go"}, nil
	}
	return nil, notInPrototype
}
