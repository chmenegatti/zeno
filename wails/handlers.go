// Canais da interface. Cada fase da migração (#53) acrescenta os seus aqui; o que falta responde
// ErrNotPorted, ou um valor vazio quando a interface precisa dele pra abrir.

package main

import (
	"errors"
	"fmt"
	"path/filepath"
	"time"

	"github.com/chmenegatti/zeno/wails/internal/doc"
	"github.com/chmenegatti/zeno/wails/internal/httpc"
	"github.com/chmenegatti/zeno/wails/internal/vars"
	"github.com/wailsapp/wails/v2/pkg/runtime"
)

type Doc = doc.Doc

// {workspaces, id} como o Created do Electron
func created(wss []*Doc, id string, err error) (any, error) {
	if err != nil {
		return nil, err
	}
	return doc.New("workspaces", wss, "id", id), nil
}

func list(wss []*Doc, err error) (any, error) {
	if err != nil {
		return nil, err
	}
	return wss, nil
}

func nowKey() float64 { return float64(time.Now().UnixMilli()) }

func (a *App) pickDir(title string) (string, error) {
	return runtime.OpenDirectoryDialog(a.ctx, runtime.OpenDialogOptions{Title: title, CanCreateDirectories: true})
}

func (a *App) register() {
	st := a.store

	a.handle("load", func(Args) (any, error) {
		return doc.New("workspaces", st.List(), "state", st.GetState(), "dataDir", st.Dir), nil
	})
	a.handle("setState", func(args Args) (any, error) {
		if len(args) == 0 {
			return nil, nil
		}
		return nil, st.SetState([]byte(args[0]))
	})

	// ---------- workspaces ----------
	a.handle("createWorkspace", func(args Args) (any, error) {
		name, _ := Get[string](args, 0)
		return list(st.CreateWorkspace(name))
	})
	a.handle("saveWorkspace", func(args Args) (any, error) {
		d, err := Get[*Doc](args, 0)
		if err != nil {
			return nil, err
		}
		return nil, st.SaveWorkspace(d)
	})
	a.handle("deleteWorkspace", func(args Args) (any, error) {
		id, _ := Get[string](args, 0)
		return list(st.DeleteWorkspace(id))
	})
	a.handle("linkWorkspace", func(Args) (any, error) {
		dir, err := a.pickDir("Pasta do workspace (com workspace.yaml)")
		if err != nil || dir == "" {
			return nil, err
		}
		wss, id, err := st.LinkWorkspace(dir)
		a.watchLinks()
		return created(wss, id, err)
	})
	a.handle("moveWorkspace", func(args Args) (any, error) {
		id, _ := Get[string](args, 0)
		dir, err := a.pickDir("Mover workspace para… (ex.: uma pasta dentro do repositório do projeto)")
		if err != nil || dir == "" {
			return nil, err
		}
		wss, err := st.MoveWorkspace(id, dir)
		a.watchLinks()
		return list(wss, err)
	})

	// ---------- pastas e requests ----------
	a.handle("createRequest", func(args Args) (any, error) {
		parent, _ := Get[string](args, 0)
		name, _ := Get[string](args, 1)
		return created(st.CreateRequest(parent, name, nowKey()))
	})
	a.handle("createFolder", func(args Args) (any, error) {
		parent, _ := Get[string](args, 0)
		name, _ := Get[string](args, 1)
		return created(st.CreateFolder(parent, name, nowKey()))
	})
	a.handle("saveRequest", func(args Args) (any, error) {
		req, err := Get[*Doc](args, 0)
		if err != nil {
			return nil, err
		}
		return nil, st.SaveRequest(req)
	})
	a.handle("saveFolder", func(args Args) (any, error) {
		d, err := Get[*Doc](args, 0)
		if err != nil {
			return nil, err
		}
		return list(st.SaveFolder(d))
	})
	a.handle("deleteNode", func(args Args) (any, error) {
		id, _ := Get[string](args, 0)
		return list(st.DeleteNode(id))
	})
	a.handle("moveNode", func(args Args) (any, error) {
		id, _ := Get[string](args, 0)
		parent, _ := Get[string](args, 1)
		key, _ := Get[float64](args, 2)
		return list(st.MoveNode(id, parent, key))
	})
	a.handle("duplicate", func(args Args) (any, error) {
		id, _ := Get[string](args, 0)
		return created(st.Duplicate(id))
	})

	// ---------- ambientes ----------
	a.handle("saveEnvironment", func(args Args) (any, error) {
		wsID, _ := Get[string](args, 0)
		env, err := Get[*Doc](args, 1)
		if err != nil {
			return nil, err
		}
		return list(st.SaveEnvironment(wsID, env))
	})
	a.handle("deleteEnvironment", func(args Args) (any, error) {
		id, _ := Get[string](args, 0)
		return list(st.DeleteEnvironment(id))
	})

	// ---------- envio (protótipo; completo na fase 2, #60) ----------
	a.handle("send", func(args Args) (any, error) {
		wsID, _ := Get[string](args, 0)
		req, err := Get[*Doc](args, 1)
		if err != nil {
			return nil, err
		}
		envID, _ := Get[string](args, 2)
		ws := st.Workspace(wsID)
		if ws == nil {
			return nil, errors.New("workspace não encontrado")
		}
		_, anc := doc.Find(ws, req.Str("id"))
		p := vars.Prepare(ws, req, anc, envID)
		rec := httpc.Send(req.Str("id"), p)
		history := st.AddResponse(rec)
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
		return doc.New("response", resp, "history", history, "missing", missing, "warnings", warnings), nil
	})
	a.handle("cancel", func(args Args) (any, error) {
		id, _ := Get[string](args, 0)
		httpc.Cancel(id)
		return nil, nil
	})
	a.handle("responses", func(args Args) (any, error) {
		id, _ := Get[string](args, 0)
		return st.GetResponses(id), nil
	})
	a.handle("responseBody", func(args Args) (any, error) {
		reqID, _ := Get[string](args, 0)
		resID, _ := Get[string](args, 1)
		rec, err := st.FindResponse(reqID, resID)
		if err != nil {
			return nil, err
		}
		return st.ResponseBody(rec)
	})
	a.handle("clearResponses", func(args Args) (any, error) {
		id, _ := Get[string](args, 0)
		return nil, st.ClearResponses(id)
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
		runtime.BrowserOpenURL(a.ctx, "file://"+filepath.ToSlash(st.Dir))
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
	a.handle("vaultStatus", empty(doc.New("available", false, "backend", "versão Go (fase 2)", "weak", true, "hasKey", false)))
	a.handle("githubStatus", empty(doc.New("account", nil, "deviceAvailable", false)))
	a.handle("tagPreview", empty(doc.New("error", "tags {% %} ainda não disponíveis na versão Go")))
}

// workspace vinculado ou movido: o watcher passa a vigiar a pasta nova
func (a *App) watchLinks() {
	if a.watcher != nil {
		a.watcher.Add(a.store.LinkedDirs()...)
	}
}
