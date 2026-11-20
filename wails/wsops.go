// WebSocket (#6): conectar, mandar mensagem (com variáveis e tags resolvidas) e fechar. As mensagens
// chegam na interface pelo evento ws:event.

package main

import (
	"errors"
	"net/http"
	"net/url"
	"strings"

	"github.com/chmenegatti/zeno/wails/internal/httpc"
)

func (a *App) registerWS() {
	// wsId, request, envId
	reqOf := func(args Args) (*Doc, *Doc, string, error) {
		wsID, _ := Get[string](args, 0)
		req, err := Get[*Doc](args, 1)
		if err != nil || req == nil {
			return nil, nil, "", errors.New("request inválido")
		}
		envID, _ := Get[string](args, 2)
		ws := a.store.Workspace(wsID)
		if ws == nil {
			return nil, nil, "", errNoWorkspace
		}
		return ws, req, envID, nil
	}
	a.handle("wsConnect", func(args Args) (any, error) {
		ws, req, envID, err := reqOf(args)
		if err != nil {
			return nil, err
		}
		p, err := a.engine.PrepareConn(ws, req, envID)
		if err != nil {
			return nil, err
		}
		if len(p.Missing) > 0 {
			return nil, errors.New("variáveis sem valor: " + strings.Join(p.Missing, ", "))
		}
		u, err := url.Parse(p.URL)
		if err != nil || (u.Scheme != "ws" && u.Scheme != "wss") || u.Host == "" {
			return nil, errors.New("URL de WebSocket inválida (ws:// ou wss://): " + p.URL)
		}
		target := *u
		target.Scheme = "http" + strings.TrimPrefix(u.Scheme, "ws")
		client, err := httpc.NetClient(p, &target)
		if err != nil {
			return nil, err
		}
		h := http.Header{}
		for _, kv := range p.Headers {
			// Content-Type vem do tipo da mensagem (body), não do handshake
			if kv[0] == "" || strings.EqualFold(kv[0], "content-type") {
				continue
			}
			h.Add(kv[0], kv[1])
		}
		if h.Get("User-Agent") == "" {
			h.Set("User-Agent", "Zeno")
		}
		var store func([]string)
		if req.Get("storeCookies") != false {
			wsID := ws.Str("id")
			store = func(set []string) { a.cookies.Store(wsID, target.String(), set) }
		}
		return nil, a.sockets.Connect(req.Str("id"), u.String(), h, client, store)
	})
	a.handle("wsSend", func(args Args) (any, error) {
		ws, req, envID, err := reqOf(args)
		if err != nil {
			return nil, err
		}
		text, _ := Get[string](args, 3)
		msg, err := a.engine.RenderText(ws, req, envID, text)
		if err != nil {
			return nil, err
		}
		return nil, a.sockets.Send(req.Str("id"), msg)
	})
	a.handle("wsClose", func(args Args) (any, error) {
		id, _ := Get[string](args, 0)
		a.sockets.Close(id)
		return nil, nil
	})
	a.handle("wsIsOpen", func(args Args) (any, error) {
		id, _ := Get[string](args, 0)
		return a.sockets.Open(id), nil
	})
}
