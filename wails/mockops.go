// Mock server (#20): exemplo a partir de uma resposta do histórico; ligar/desligar o servidor local
// do workspace e listar as rotas.

package main

import (
	"errors"
	"strings"

	"github.com/chmenegatti/zeno/wails/internal/doc"
	"github.com/chmenegatti/zeno/wails/internal/mock"
	"github.com/chmenegatti/zeno/wails/internal/store"
)

func (a *App) mockStatus(wsID string) (any, error) {
	ws := a.store.WorkspaceSnapshot(wsID)
	if ws == nil {
		return nil, errNoWorkspace
	}
	routes := []any{}
	for _, r := range mock.Routes(ws) {
		routes = append(routes, doc.New("method", r.Method, "path", r.Path, "reqId", r.ReqID, "reqName", r.ReqName, "status", r.Example.Get("status")))
	}
	port := ws.Map("settings").Map("mock").Num("port", mock.DefaultPort)
	return doc.New("running", a.mocks.Port(wsID) != 0, "port", a.mocks.Port(wsID), "configuredPort", port, "routes", routes), nil
}

func (a *App) registerMock() {
	a.handle("mockStatus", func(args Args) (any, error) {
		id, _ := Get[string](args, 0)
		return a.mockStatus(id)
	})
	a.handle("mockStart", func(args Args) (any, error) {
		id, _ := Get[string](args, 0)
		ws := a.store.Workspace(id)
		if ws == nil {
			return nil, errNoWorkspace
		}
		if _, err := a.mocks.Start(id, int(ws.Map("settings").Map("mock").Num("port", mock.DefaultPort))); err != nil {
			return nil, err
		}
		return a.mockStatus(id)
	})
	a.handle("mockStop", func(args Args) (any, error) {
		id, _ := Get[string](args, 0)
		a.mocks.Stop(id)
		return a.mockStatus(id)
	})
	// exemplo a partir de uma resposta do histórico (sem headers de transporte)
	a.handle("exampleFromResponse", func(args Args) (any, error) {
		reqID, _ := Get[string](args, 0)
		resID, _ := Get[string](args, 1)
		rec, err := a.store.FindResponse(reqID, resID)
		if err != nil {
			return nil, err
		}
		if rec.Str("error") != "" {
			return nil, errors.New("resposta com erro não vira exemplo")
		}
		body, err := a.store.ResponseBody(rec)
		if err != nil {
			return nil, err
		}
		headers := []any{}
		var pairs [][2]string
		switch hs := rec.Get("headers").(type) {
		case [][2]string:
			pairs = hs
		case []any:
			for _, x := range hs {
				if kv, ok := x.([]any); ok && len(kv) == 2 {
					pairs = append(pairs, [2]string{doc.AsStr(kv[0]), doc.AsStr(kv[1])})
				}
			}
		}
		for _, kv := range pairs {
			name := kv[0]
			switch strings.ToLower(name) {
			case "content-length", "transfer-encoding", "content-encoding", "connection", "date", "keep-alive", "set-cookie":
				continue
			}
			headers = append(headers, doc.New("name", name, "value", kv[1], "enabled", true))
		}
		ex := doc.New("id", store.NewID("ex"), "name", strings.TrimSpace(doc.AsStr(rec.Get("status"))+" "+rec.Str("statusText")), "status", rec.Get("status"), "headers", headers, "body", body)
		if rec.Str("bodyEncoding") == "base64" {
			ex.Set("bodyEncoding", "base64")
		}
		return ex, nil
	})
}
