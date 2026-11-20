// Canais da interface. Cada fase da migração (#53) acrescenta os seus aqui; o que falta responde
// ErrNotPorted, ou um valor vazio quando a interface precisa dele pra abrir.

package main

import (
	"encoding/base64"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	goruntime "runtime"
	"strings"
	"time"

	"github.com/chmenegatti/zeno/wails/internal/cookies"
	"github.com/chmenegatti/zeno/wails/internal/doc"
	"github.com/chmenegatti/zeno/wails/internal/filename"
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

// headers do histórico (JSON: [[nome, valor], …])
func pairs(l []any) [][2]string {
	out := make([][2]string, 0, len(l))
	for _, h := range l {
		if p, ok := h.([]any); ok && len(p) == 2 {
			out = append(out, [2]string{doc.AsStr(p[0]), doc.AsStr(p[1])})
		}
	}
	return out
}

// pasta de dados do Insomnia (mesma do Electron em cada sistema)
func insomniaDir() string {
	home, _ := os.UserHomeDir()
	switch goruntime.GOOS {
	case "darwin":
		return filepath.Join(home, "Library", "Application Support", "Insomnia")
	case "windows":
		if d := os.Getenv("APPDATA"); d != "" {
			return filepath.Join(d, "Insomnia")
		}
		return filepath.Join(home, "AppData", "Roaming", "Insomnia")
	}
	if d := os.Getenv("XDG_CONFIG_HOME"); d != "" {
		return filepath.Join(d, "Insomnia")
	}
	return filepath.Join(home, ".config", "Insomnia")
}

// pasta de downloads do usuário (XDG no Linux), ou a pasta pessoal
func downloadsDir() string {
	home, _ := os.UserHomeDir()
	if b, err := os.ReadFile(filepath.Join(home, ".config", "user-dirs.dirs")); err == nil {
		for _, l := range strings.Split(string(b), "\n") {
			if v, ok := strings.CutPrefix(strings.TrimSpace(l), "XDG_DOWNLOAD_DIR="); ok {
				d := strings.ReplaceAll(strings.Trim(v, `"`), "$HOME", home)
				if fi, err := os.Stat(d); err == nil && fi.IsDir() {
					return d
				}
			}
		}
	}
	if d := filepath.Join(home, "Downloads"); dirExists(d) {
		return d
	}
	return home
}

func dirExists(p string) bool {
	fi, err := os.Stat(p)
	return err == nil && fi.IsDir()
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
		// cookie jar do workspace, respeitando "mandar/guardar cookies" do request
		var hooks httpc.CookieHooks
		if req.Get("sendCookies") != false {
			hooks.Header = func(u string) string { return a.cookies.Header(wsID, u) }
		}
		if req.Get("storeCookies") != false {
			hooks.Store = func(u string, set []string) { a.cookies.Store(wsID, u, set) }
		}
		rec := httpc.Send(req.Str("id"), p, hooks)
		history := st.AddResponse(rec)
		// o body vai uma vez só, no histórico: a interface só lê id e erro de "response"
		// (JSON de 2,7 MB: 6,6 MB pela ponte com o body duplicado, 222 ms; metade sem ele)
		resp := rec
		if len(history) > 0 {
			if h, ok := history[0].(*Doc); ok && h.Str("id") == rec.Str("id") {
				resp = h.Clone()
				resp.Set("body", "")
			}
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
	// salva o body numa pasta escolhida; nome sugerido pelo Content-Disposition, URL ou tipo
	a.handle("saveResponse", func(args Args) (any, error) {
		reqID, _ := Get[string](args, 0)
		resID, _ := Get[string](args, 1)
		rec, err := st.FindResponse(reqID, resID)
		if err != nil {
			return nil, err
		}
		dest, err := runtime.SaveFileDialog(a.ctx, runtime.SaveDialogOptions{
			DefaultDirectory: downloadsDir(),
			DefaultFilename:  filename.Suggest(pairs(rec.List("headers")), rec.Str("url")),
		})
		if err != nil || dest == "" {
			return nil, err
		}
		body, err := st.ResponseBody(rec)
		if err != nil {
			return nil, err
		}
		data := []byte(body)
		if rec.Str("bodyEncoding") == "base64" {
			if data, err = base64.StdEncoding.DecodeString(body); err != nil {
				return nil, err
			}
		}
		return dest, os.WriteFile(dest, data, 0o644)
	})
	a.handle("clearResponses", func(args Args) (any, error) {
		id, _ := Get[string](args, 0)
		return nil, st.ClearResponses(id)
	})

	// ---------- cookies ----------
	a.handle("cookiesList", func(args Args) (any, error) {
		wsID, _ := Get[string](args, 0)
		return a.cookies.List(wsID), nil
	})
	a.handle("cookiesSave", func(args Args) (any, error) {
		wsID, _ := Get[string](args, 0)
		list, err := Get[[]cookies.Info](args, 1)
		if err != nil {
			return nil, err
		}
		return a.cookies.Replace(wsID, list), nil
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
		case "devtools":
			// o inspetor do WebKit só existe em build de desenvolvimento (wails dev)
		case "fullscreen":
			if runtime.WindowIsFullscreen(a.ctx) {
				runtime.WindowUnfullscreen(a.ctx)
			} else {
				runtime.WindowFullscreen(a.ctx)
			}
		}
		return nil, nil
	})
	a.handle("pickFile", func(Args) (any, error) {
		f, err := runtime.OpenFileDialog(a.ctx, runtime.OpenDialogOptions{})
		if err != nil || f == "" {
			return nil, err
		}
		return f, nil
	})
	// atalhos personalizados do Insomnia (NeDB: vale o último registro)
	a.handle("insomniaHotkeys", func(Args) (any, error) {
		b, err := os.ReadFile(filepath.Join(insomniaDir(), "insomnia.Settings.db"))
		if err != nil {
			return nil, nil
		}
		var reg any
		for _, line := range strings.Split(string(b), "\n") {
			if v, err := doc.FromJSON([]byte(line)); err == nil {
				if d, ok := v.(*Doc); ok && d.Has("hotKeyRegistry") {
					reg = d.Get("hotKeyRegistry")
				}
			}
		}
		return reg, nil
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
	for _, c := range []string{"codeTargets", "pluginsList", "pluginsReload"} {
		a.handle(c, empty([]any{}))
	}
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
