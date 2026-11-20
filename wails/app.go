// Ponte com a interface: o React chama window.zeno.<canal>(...args) e o adaptador
// (src/renderer/src/bridge.ts) manda tudo pra App.Call(canal, args JSON). Os canais são os mesmos
// do preload do Electron; cada um é registrado em handlers.go.

package main

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"time"

	"github.com/chmenegatti/zeno/wails/internal/cookies"
	"github.com/chmenegatti/zeno/wails/internal/doc"
	"github.com/chmenegatti/zeno/wails/internal/engine"
	"github.com/chmenegatti/zeno/wails/internal/grpcc"
	"github.com/chmenegatti/zeno/wails/internal/i18n"
	"github.com/chmenegatti/zeno/wails/internal/keyring"
	"github.com/chmenegatti/zeno/wails/internal/mock"
	"github.com/chmenegatti/zeno/wails/internal/oauth2"
	"github.com/chmenegatti/zeno/wails/internal/plugins"
	"github.com/chmenegatti/zeno/wails/internal/store"
	"github.com/chmenegatti/zeno/wails/internal/vault"
	"github.com/chmenegatti/zeno/wails/internal/watch"
	"github.com/chmenegatti/zeno/wails/internal/ws"
	"github.com/wailsapp/wails/v2/pkg/runtime"
)

// Args: argumentos do canal, um JSON por posição
type Args []string

// Get decodifica o argumento i (zero se não veio)
func Get[T any](a Args, i int) (T, error) {
	var v T
	if i >= len(a) || a[i] == "" {
		return v, nil
	}
	err := json.Unmarshal([]byte(a[i]), &v)
	return v, err
}

type handler func(a Args) (any, error)

type App struct {
	ctx      context.Context
	store    *store.Store
	cookies  *cookies.Cookies
	vault    *vault.Vault
	engine   *engine.Engine
	plugins  *plugins.Plugins
	mu       sync.RWMutex
	handlers map[string]handler
	watcher  *watch.Watcher
	prompts  prompts
	pending  pendingImport
	bodies   bodyCache
	trim     memTrim
	sockets  *ws.Manager
	mocks    *mock.Manager
	calls    *grpcc.Manager
}

func NewApp() *App {
	st := store.New(store.DefaultDataDir())
	// "zeno": mesmo item do chaveiro que o Electron usa (application=zeno)
	a := &App{store: st, cookies: cookies.New(st.Dir), vault: vault.New(st.Dir, systemKeyring()), handlers: map[string]handler{}}
	a.prompts = prompts{waiting: map[int]chan *promptAnswer{}, memory: map[string]string{}}
	// plugins em <dataDir>/plugins; desligados ficam em state.json
	a.plugins = plugins.New(filepath.Join(st.Dir, "plugins"), func(id string) bool {
		for _, x := range st.GetState().List("disabledPlugins") {
			if doc.AsStr(x) == id {
				return true
			}
		}
		return false
	})
	// idioma das mensagens geradas no Go: o mesmo da interface (padrão inglês); antes de carregar os
	// plugins, que traduzem mensagens na carga
	i18n.Set(st.GetState().Map("ui").Str("lang"))
	a.plugins.Load()
	// OAuth 2.0 (#9): login no navegador do sistema, aviso na interface enquanto espera
	oauth := &oauth2.Manager{Dir: st.Dir, Vault: a.vault, Interactive: true, Hooks: oauth2.Hooks{
		Open: func(u string) { runtime.BrowserOpenURL(a.ctx, u) },
		Wait: func(msg, u, code string) { a.Emit("oauth:wait", doc.New("message", msg, "url", u, "code", code)) },
		Done: func() { a.Emit("oauth:done") },
	}}
	a.engine = &engine.Engine{OAuth: oauth, Store: st, Cookies: a.cookies, Vault: a.vault, Plugins: a.plugins, Hooks: engine.Hooks{Emit: a.Emit, Ask: a.askPrompt}}
	a.sockets = &ws.Manager{Emit: func(e ws.Event) { a.Emit("ws:event", e) }}
	a.mocks = &mock.Manager{Workspace: st.WorkspaceSnapshot, OnHit: func(h mock.Hit) { a.Emit("mock:hit", h) }}
	a.calls = &grpcc.Manager{Emit: func(e grpcc.Event) { a.Emit("grpc:event", e) }}
	a.register()
	return a
}

func (a *App) handle(channel string, h handler) {
	a.handlers[channel] = h
}

func (a *App) startup(ctx context.Context) {
	a.ctx = ctx
	a.store.Load()
	// arquivo mudou fora do app (editor, git pull…): recarrega e avisa a interface
	w, err := watch.New(append([]string{a.store.Dir}, a.store.LinkedDirs()...), watch.Options{
		LastWrite: a.store.LastWrite,
		OnChange:  func() { a.Emit("store:changed", a.store.Load()) },
	})
	if err != nil {
		fmt.Fprintln(os.Stderr, "watcher:", err)
		return
	}
	a.watcher = w
}

func (a *App) shutdown(context.Context) {
	a.store.Flush()
	a.sockets.CloseAll()
	a.mocks.StopAll()
	a.calls.CancelAll()
	if a.watcher != nil {
		_ = a.watcher.Close()
	}
}

// Emit manda um evento pra interface (store:changed, response:added, run:step, prompt:ask)
func (a *App) Emit(name string, data ...any) {
	if a.ctx != nil {
		for i := range data {
			data[i] = a.bodies.offload(data[i])
		}
		runtime.EventsEmit(a.ctx, name, data...)
	}
}

// roteiro de verificação (ZENO_SCRIPT), como no Electron: roda o JS e sai quando terminar
func (a *App) domReady(ctx context.Context) {
	if s := os.Getenv("ZENO_SCRIPT"); s != "" {
		runtime.WindowExecJS(ctx, "console.log=(...m)=>window.go.main.App.Call('benchLog',[JSON.stringify(m.join(' '))]);"+
			"Promise.resolve("+s+").catch(e=>console.log('ERRO '+e+' '+(e&&e.stack))).finally(()=>window.go.main.App.Call('windowAction',['\"quit\"']))")
	}
}

// ErrNotPorted: canal que ainda não existe na versão Go (a interface mostra o erro e segue). Tipo próprio
// pra traduzir na hora de mostrar e continuar valendo com errors.Is.
var ErrNotPorted error = notPorted{}

type notPorted struct{}

func (notPorted) Error() string { return i18n.T("ainda não disponível na versão Go") }

// Call é o único método exposto ao JavaScript
func (a *App) Call(channel string, args []string) (any, error) {
	h, ok := a.handlers[channel]
	if !ok {
		return nil, fmt.Errorf("%s: %w", channel, ErrNotPorted)
	}
	t0 := time.Now()
	res, err := h(Args(args))
	if os.Getenv("ZENO_TRACE") != "" {
		defer func() { fmt.Fprintf(os.Stderr, "TRACE %s %v\n", channel, time.Since(t0)) }()
	}
	defer a.trim.after()
	return a.bodies.offload(res), err
}

// systemKeyring: o chaveiro do sistema; ZENO_NO_KEYRING=1 desliga (teste ponta a ponta)
func systemKeyring() keyring.Protector {
	if os.Getenv("ZENO_NO_KEYRING") != "" {
		return keyring.None()
	}
	return keyring.System("zeno")
}
