// gRPC (#5): descobrir serviços (reflection ou .proto), chamar e mandar mensagens. Os passos chegam
// na interface pelo evento grpc:event.

package main

import (
	"context"
	"crypto/tls"
	"errors"
	"net/url"
	"strings"
	"time"

	"github.com/chmenegatti/zeno/wails/internal/grpcc"
	"github.com/chmenegatti/zeno/wails/internal/httpc"
	"github.com/chmenegatti/zeno/wails/internal/i18n"
	"github.com/chmenegatti/zeno/wails/internal/vars"
	"google.golang.org/grpc"
	"google.golang.org/grpc/metadata"
)

// headers que o gRPC controla (não viram metadata)
var grpcReserved = map[string]bool{"content-type": true, "user-agent": true, "host": true, "te": true, "connection": true, "content-length": true}

func grpcMeta(p vars.Prepared) metadata.MD {
	md := metadata.MD{}
	for _, kv := range p.Headers {
		k := strings.ToLower(strings.TrimSpace(kv[0]))
		if k == "" || grpcReserved[k] || strings.HasPrefix(k, "grpc-") || (k == "cookie" && kv[1] == "") {
			continue
		}
		md.Append(k, kv[1])
	}
	return md
}

// grpcPrep: request pronto (variáveis, auth, metadata) e a conexão
func (a *App) grpcPrep(args Args) (*Doc, vars.Prepared, *grpc.ClientConn, metadata.MD, error) {
	wsID, _ := Get[string](args, 0)
	req, err := Get[*Doc](args, 1)
	if err != nil || req == nil {
		return nil, vars.Prepared{}, nil, nil, errNoWorkspace()
	}
	envID, _ := Get[string](args, 2)
	ws := a.store.Workspace(wsID)
	if ws == nil {
		return nil, vars.Prepared{}, nil, nil, errNoWorkspace()
	}
	p, err := a.engine.PrepareConn(ws, req, envID)
	if err != nil {
		return nil, p, nil, nil, err
	}
	if len(p.Missing) > 0 {
		return nil, p, nil, nil, errors.New(i18n.T("variáveis sem valor: %s", strings.Join(p.Missing, ", ")))
	}
	addr, secure, err := grpcc.ParseURL(p.URL)
	if err != nil {
		return nil, p, nil, nil, err
	}
	var tlsCfg *tls.Config
	if secure {
		c, err := httpc.TLSConfig(p, &url.URL{Scheme: "https", Host: addr})
		if err != nil {
			return nil, p, nil, nil, err
		}
		tlsCfg = c
	}
	dialer, err := httpc.ProxyDialer(p, secure)
	if err != nil {
		return nil, p, nil, nil, err
	}
	conn, err := grpcc.Dial(addr, tlsCfg, dialer)
	if err != nil {
		return nil, p, nil, nil, err
	}
	return req, p, conn, grpcMeta(p), nil
}

func (a *App) registerGrpc() {
	a.handle("grpcDescribe", func(args Args) (any, error) {
		req, _, conn, md, err := a.grpcPrep(args)
		if err != nil {
			return nil, err
		}
		defer conn.Close()
		ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
		defer cancel()
		return grpcc.Describe(ctx, grpcc.Source{Conn: conn, ProtoFile: req.Map("grpc").Str("protoFile"), MD: md})
	})
	// abre a chamada; sem client streaming manda o body como a mensagem
	a.handle("grpcStart", func(args Args) (any, error) {
		req, p, conn, md, err := a.grpcPrep(args)
		if err != nil {
			return nil, err
		}
		g := req.Map("grpc")
		ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
		defer cancel()
		m, err := grpcc.FindMethod(ctx, grpcc.Source{Conn: conn, ProtoFile: g.Str("protoFile"), MD: md}, g.Str("service"), g.Str("method"))
		if err != nil {
			conn.Close()
			return nil, err
		}
		first := p.Text
		return nil, a.calls.Start(req.Str("id"), conn, m, md, first, time.Duration(p.TimeoutMs)*time.Millisecond)
	})
	a.handle("grpcSend", func(args Args) (any, error) {
		wsID, _ := Get[string](args, 0)
		req, err := Get[*Doc](args, 1)
		if err != nil || req == nil {
			return nil, errNoWorkspace()
		}
		envID, _ := Get[string](args, 2)
		text, _ := Get[string](args, 3)
		ws := a.store.Workspace(wsID)
		if ws == nil {
			return nil, errNoWorkspace()
		}
		msg, err := a.engine.RenderText(ws, req, envID, text)
		if err != nil {
			return nil, err
		}
		return nil, a.calls.Send(req.Str("id"), msg)
	})
	a.handle("grpcCloseSend", func(args Args) (any, error) {
		id, _ := Get[string](args, 0)
		return nil, a.calls.CloseSend(id)
	})
	a.handle("grpcCancel", func(args Args) (any, error) {
		id, _ := Get[string](args, 0)
		a.calls.Cancel(id)
		return nil, nil
	})
	a.handle("grpcActive", func(args Args) (any, error) {
		id, _ := Get[string](args, 0)
		return a.calls.Active(id), nil
	})
}
