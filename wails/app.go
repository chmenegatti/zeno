// Ponte com a interface: o React chama window.zeno.<canal>(...args) e o adaptador
// (src/renderer/src/bridge.ts) manda tudo pra App.Call(canal, args JSON). Os canais são os mesmos
// do preload do Electron; cada um é registrado em handlers.go.

package main

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"sync"

	"github.com/chmenegatti/zeno/wails/internal/store"
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
	mu       sync.RWMutex
	handlers map[string]handler
}

func NewApp() *App {
	a := &App{store: store.New(store.DefaultDataDir()), handlers: map[string]handler{}}
	a.register()
	return a
}

func (a *App) handle(channel string, h handler) {
	a.handlers[channel] = h
}

func (a *App) startup(ctx context.Context) {
	a.ctx = ctx
	a.store.Load()
}

// Emit manda um evento pra interface (store:changed, response:added, run:step, prompt:ask)
func (a *App) Emit(name string, data ...any) {
	if a.ctx != nil {
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

// ErrNotPorted: canal que ainda não existe na versão Go (a interface mostra o erro e segue)
var ErrNotPorted = fmt.Errorf("ainda não disponível na versão Go")

// Call é o único método exposto ao JavaScript
func (a *App) Call(channel string, args []string) (any, error) {
	h, ok := a.handlers[channel]
	if !ok {
		return nil, fmt.Errorf("%s: %w", channel, ErrNotPorted)
	}
	return h(Args(args))
}
