// Canais da interface. Cada fase da migração (#53) acrescenta os seus aqui; o que falta responde
// ErrNotPorted, ou um valor vazio quando a interface precisa dele pra abrir.

package main

import (
	"context"
	"encoding/base64"
	"errors"
	"fmt"
	"github.com/chmenegatti/zeno/wails/internal/engine"
	"github.com/chmenegatti/zeno/wails/internal/oauth2"
	"github.com/chmenegatti/zeno/wails/internal/vars"
	"os"
	"path/filepath"
	goruntime "runtime"
	"strings"
	"time"

	"github.com/chmenegatti/zeno/wails/internal/cookies"
	"github.com/chmenegatti/zeno/wails/internal/doc"
	"github.com/chmenegatti/zeno/wails/internal/filename"
	"github.com/chmenegatti/zeno/wails/internal/gitws"
	"github.com/chmenegatti/zeno/wails/internal/httpc"
	"github.com/chmenegatti/zeno/wails/internal/plugins"
	"github.com/chmenegatti/zeno/wails/internal/protect"
	"github.com/chmenegatti/zeno/wails/internal/store"
	"github.com/wailsapp/wails/v2/pkg/runtime"
)

type Doc = doc.Doc

var errNoWorkspace = errors.New("workspace não encontrado")

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
	// cópia com ids novos, na pasta de dados (sem histórico nem cookies)
	a.handle("duplicateWorkspace", func(args Args) (any, error) {
		id, _ := Get[string](args, 0)
		ws := st.Workspace(id)
		if ws == nil {
			return nil, errors.New("workspace não encontrado")
		}
		cp := store.CloneWorkspace(ws, ws.Str("name")+" (cópia)")
		if err := st.WriteWorkspace(cp); err != nil {
			return nil, err
		}
		return created(st.Load(), cp.Str("id"), nil)
	})
	a.handle("openWorkspaceDir", func(args Args) (any, error) {
		id, _ := Get[string](args, 0)
		ws := st.Workspace(id)
		if ws == nil || ws.Map("location").Str("dir") == "" {
			return nil, errors.New("workspace não encontrado")
		}
		runtime.BrowserOpenURL(a.ctx, "file://"+filepath.ToSlash(ws.Map("location").Str("dir")))
		return nil, nil
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

	// ---------- envio ----------
	a.handle("send", func(args Args) (any, error) {
		wsID, _ := Get[string](args, 0)
		req, err := Get[*Doc](args, 1)
		if err != nil {
			return nil, err
		}
		envID, _ := Get[string](args, 2)
		ws := st.Workspace(wsID)
		if ws == nil {
			return nil, errNoWorkspace
		}
		return a.engine.Execute(ws, req, envID, 0)
	})
	// request pronto pra "Gerar código" (o código sai no renderer, com o httpsnippet)
	a.handle("codeInput", func(args Args) (any, error) {
		wsID, _ := Get[string](args, 0)
		req, err := Get[*Doc](args, 1)
		if err != nil {
			return nil, err
		}
		envID, _ := Get[string](args, 2)
		resolveVars, _ := Get[bool](args, 3)
		ws := st.Workspace(wsID)
		if ws == nil {
			return nil, errors.New("workspace não encontrado")
		}
		if req == nil {
			return nil, errors.New("request não encontrado")
		}
		return a.engine.CodeInput(ws, req, envID, resolveVars)
	})
	// OAuth 2.0 (#9): status, obter/renovar agora, limpar e cancelar a espera do navegador
	oauthOf := func(args Args) (*vars.OAuth2, error) {
		wsID, _ := Get[string](args, 0)
		req, err := Get[*Doc](args, 1)
		if err != nil || req == nil {
			return nil, errors.New("request não encontrado")
		}
		envID, _ := Get[string](args, 2)
		ws := st.Workspace(wsID)
		if ws == nil {
			return nil, errNoWorkspace
		}
		return a.engine.OAuthPrepared(ws, req, envID)
	}
	tokenStatus := func(t *oauth2.Token) any {
		if t == nil || t.Access == "" {
			return nil
		}
		d := doc.New("type", t.Type, "hasRefresh", t.Refresh != "", "valid", t.Valid())
		if !t.Expiry.IsZero() {
			d.Set("expiresAt", t.Expiry.UnixMilli())
		}
		if t.Scope != "" {
			d.Set("scope", t.Scope)
		}
		return d
	}
	a.handle("oauthStatus", func(args Args) (any, error) {
		o, err := oauthOf(args)
		if err != nil {
			return nil, err
		}
		return tokenStatus(a.engine.OAuth.Status(engine.OAuthConfig(o))), nil
	})
	a.handle("oauthToken", func(args Args) (any, error) {
		o, err := oauthOf(args)
		if err != nil {
			return nil, err
		}
		t, err := a.engine.OAuth.Token(context.Background(), engine.OAuthConfig(o), true)
		if err != nil {
			return nil, err
		}
		return tokenStatus(t), nil
	})
	a.handle("oauthClear", func(args Args) (any, error) {
		o, err := oauthOf(args)
		if err != nil {
			return nil, err
		}
		a.engine.OAuth.Clear(o.Owner)
		return nil, nil
	})
	a.handle("oauthCancel", func(Args) (any, error) {
		a.engine.OAuth.Cancel()
		return nil, nil
	})
	a.handle("tagPreview", func(args Args) (any, error) {
		raw, _ := Get[string](args, 0)
		send, _ := Get[bool](args, 1)
		return a.engine.TagPreview(raw, send), nil
	})
	a.handle("promptReply", func(args Args) (any, error) {
		id, _ := Get[int](args, 0)
		ans, _ := Get[*promptAnswer](args, 1)
		a.promptReply(id, ans)
		return nil, nil
	})
	a.handle("promptForget", func(Args) (any, error) {
		a.prompts.mu.Lock()
		a.prompts.memory = map[string]string{}
		a.prompts.mu.Unlock()
		return nil, nil
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

	// ---------- cofre ----------
	a.handle("vaultStatus", func(Args) (any, error) { return a.vault.Status(), nil })
	a.handle("vaultEncrypt", func(args Args) (any, error) {
		plain, _ := Get[string](args, 0)
		return a.vault.Encrypt(plain)
	})
	a.handle("vaultReveal", func(args Args) (any, error) {
		tok, _ := Get[string](args, 0)
		return a.vault.Decrypt(tok)
	})
	a.handle("vaultScan", func(args Args) (any, error) {
		wsID, _ := Get[string](args, 0)
		ws := st.Workspace(wsID)
		if ws == nil {
			return doc.New("plain", []string{}, "warnings", []string{}), nil
		}
		r := protect.Scan(ws, a.knownSecrets())
		labels := make([]string, len(r.Spots))
		for i, s := range r.Spots {
			labels[i] = s.Label
		}
		return doc.New("plain", labels, "warnings", r.Warnings), nil
	})
	a.handle("vaultProtect", func(args Args) (any, error) {
		wsID, _ := Get[string](args, 0)
		n, err := a.protectWorkspace(wsID, nil)
		if err != nil {
			return nil, err
		}
		return doc.New("count", n, "workspaces", st.Load()), nil
	})

	// ---------- git do workspace ----------
	wsDir := func(args Args) (string, error) {
		id, _ := Get[string](args, 0)
		ws := st.Workspace(id)
		if ws == nil || ws.Map("location").Str("dir") == "" {
			return "", errNoWorkspace
		}
		return ws.Map("location").Str("dir"), nil
	}
	a.handle("gitStatus", func(args Args) (any, error) {
		dir, err := wsDir(args)
		if err != nil {
			return nil, err
		}
		return gitws.GetStatus(dir)
	})
	a.handle("gitDiff", func(args Args) (any, error) {
		dir, err := wsDir(args)
		if err != nil {
			return nil, err
		}
		file, _ := Get[string](args, 1)
		return gitws.Diff(dir, file)
	})
	// roda a operação e devolve o status novo; mudanças nos arquivos chegam pelo watcher
	gitOp := func(name string, op func(dir string, args Args) error) {
		a.handle(name, func(args Args) (any, error) {
			dir, err := wsDir(args)
			if err != nil {
				return nil, err
			}
			if err := op(dir, args); err != nil {
				return nil, err
			}
			return gitws.GetStatus(dir)
		})
	}
	gitOp("gitCommit", func(dir string, args Args) error {
		msg, _ := Get[string](args, 1)
		return gitws.Commit(dir, msg)
	})
	gitOp("gitPull", func(dir string, _ Args) error { return gitws.Pull(dir) })
	gitOp("gitPush", func(dir string, _ Args) error { return gitws.Push(dir) })
	gitOp("gitSwitch", func(dir string, args Args) error {
		branch, _ := Get[string](args, 1)
		create, _ := Get[bool](args, 2)
		return gitws.SwitchBranch(dir, branch, create)
	})
	gitOp("gitAbort", func(dir string, _ Args) error { return gitws.AbortRebase(dir) })
	gitOp("gitInit", func(dir string, _ Args) error { return gitws.Init(dir) })

	// ---------- importação ----------
	a.handle("importPreview", func(args Args) (any, error) {
		var src any = "file"
		if len(args) > 0 {
			v, err := doc.FromJSON([]byte(args[0]))
			if err != nil {
				return nil, err
			}
			src = v
		}
		return a.importPreview(src)
	})
	a.handle("importRun", func(args Args) (any, error) {
		ids, _ := Get[[]string](args, 0)
		protect, _ := Get[bool](args, 1)
		return a.importRun(ids, protect)
	})

	// ---------- plugins ----------
	a.handle("pluginsList", func(Args) (any, error) { return a.plugins.List(), nil })
	a.handle("pluginsReload", func(Args) (any, error) { return a.plugins.Load(), nil })
	a.handle("pluginsSetEnabled", func(args Args) (any, error) {
		id, _ := Get[string](args, 0)
		on, _ := Get[bool](args, 1)
		state := st.GetState()
		off := []any{}
		for _, x := range state.List("disabledPlugins") {
			if doc.AsStr(x) != id {
				off = append(off, x)
			}
		}
		if !on {
			off = append(off, id)
		}
		if len(off) > 0 {
			state.Set("disabledPlugins", off)
		} else {
			state.Del("disabledPlugins")
		}
		raw, _ := doc.Marshal(state)
		if err := st.SetState(raw); err != nil {
			return nil, err
		}
		return a.plugins.List(), nil
	})
	a.handle("pluginsOpenDir", func(Args) (any, error) {
		dir := filepath.Join(st.Dir, "plugins")
		if err := os.MkdirAll(dir, 0o755); err != nil {
			return nil, err
		}
		runtime.BrowserOpenURL(a.ctx, "file://"+filepath.ToSlash(dir))
		return dir, nil
	})
	// ação de plugin no menu do request: recebe o request já com variáveis resolvidas
	a.handle("pluginAction", func(args Args) (any, error) {
		id, _ := Get[string](args, 0)
		index, _ := Get[int](args, 1)
		wsID, _ := Get[string](args, 2)
		reqID, _ := Get[string](args, 3)
		envID, _ := Get[string](args, 4)
		ws := st.Workspace(wsID)
		if ws == nil {
			return nil, errNoWorkspace
		}
		p, name, err := a.engine.PrepareOpen(ws, reqID, envID, nil)
		if err != nil {
			return nil, err
		}
		hr := plugins.HookRequest{Method: p.Method, URL: p.URL, Headers: p.Headers}
		if p.BodyKind == "text" {
			t := p.Text
			hr.Body = &t
		}
		msgs, clip, err := a.plugins.RunAction(id, index, plugins.ActionRequest{Name: name, HookRequest: hr})
		if err != nil {
			return nil, err
		}
		if clip != nil {
			_ = runtime.ClipboardSetText(a.ctx, *clip)
		}
		return msgs, nil
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

	a.registerGitHub()
	a.registerRunner()

}

// workspace vinculado ou movido: o watcher passa a vigiar a pasta nova
func (a *App) watchLinks() {
	if a.watcher != nil {
		a.watcher.Add(a.store.LinkedDirs()...)
	}
}
