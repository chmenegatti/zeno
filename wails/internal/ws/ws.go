// Package ws: conexões WebSocket dos requests ws:// e wss:// (#6). Uma conexão por request; cada
// mensagem (enviada ou recebida), abertura e fechamento sai como Event pro renderer.
package ws

import (
	"context"
	"encoding/base64"
	"errors"
	"net/http"
	"sync"
	"time"

	"github.com/coder/websocket"
)

// Event: o que aconteceu na conexão. Kind: open, in, out, close, error
type Event struct {
	ReqID  string      `json:"reqId"`
	Kind   string      `json:"kind"`
	Data   string      `json:"data,omitempty"`
	Binary bool        `json:"binary,omitempty"`
	At     int64       `json:"at"`
	Code   int         `json:"code,omitempty"`
	Reason string      `json:"reason,omitempty"`
	Status int         `json:"status,omitempty"`
	Header [][2]string `json:"headers,omitempty"`
}

type conn struct {
	c      *websocket.Conn
	cancel context.CancelFunc
}

// Manager guarda as conexões abertas
type Manager struct {
	Emit  func(Event)
	mu    sync.Mutex
	conns map[string]*conn
}

func (m *Manager) emit(e Event) {
	e.At = time.Now().UnixMilli()
	if m.Emit != nil {
		m.Emit(e)
	}
}

// Open: conexão aberta pro request?
func (m *Manager) Open(reqID string) bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.conns[reqID] != nil
}

// Connect abre (fechando a anterior do mesmo request) e lê as mensagens em segundo plano.
// setCookies (opcional) recebe os Set-Cookie do handshake
func (m *Manager) Connect(reqID, url string, header http.Header, client *http.Client, setCookies func([]string)) error {
	m.Close(reqID)
	dctx, dcancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer dcancel()
	c, res, err := websocket.Dial(dctx, url, &websocket.DialOptions{HTTPClient: client, HTTPHeader: header})
	if err != nil {
		if res != nil {
			return errors.New(err.Error() + " (HTTP " + res.Status + ")")
		}
		return err
	}
	if res != nil && setCookies != nil {
		if set := res.Header.Values("Set-Cookie"); len(set) > 0 {
			setCookies(set)
		}
	}
	c.SetReadLimit(16 << 20)
	ctx, cancel := context.WithCancel(context.Background())
	me := &conn{c: c, cancel: cancel}
	m.mu.Lock()
	if m.conns == nil {
		m.conns = map[string]*conn{}
	}
	m.conns[reqID] = me
	m.mu.Unlock()
	open := Event{ReqID: reqID, Kind: "open"}
	if res != nil {
		open.Status = res.StatusCode
		for k, vs := range res.Header {
			for _, v := range vs {
				open.Header = append(open.Header, [2]string{k, v})
			}
		}
	}
	m.emit(open)
	go func() {
		defer func() {
			m.mu.Lock()
			if m.conns[reqID] == me {
				delete(m.conns, reqID)
			}
			m.mu.Unlock()
			cancel()
		}()
		for {
			typ, data, err := c.Read(ctx)
			if err != nil {
				e := Event{ReqID: reqID, Kind: "close"}
				if st := websocket.CloseStatus(err); st != -1 {
					e.Code = int(st)
					var ce websocket.CloseError
					if errors.As(err, &ce) {
						e.Reason = ce.Reason
					}
				} else if ctx.Err() == nil {
					e.Reason = err.Error()
				}
				m.emit(e)
				return
			}
			if typ == websocket.MessageBinary {
				m.emit(Event{ReqID: reqID, Kind: "in", Data: base64.StdEncoding.EncodeToString(data), Binary: true})
			} else {
				m.emit(Event{ReqID: reqID, Kind: "in", Data: string(data)})
			}
		}
	}()
	return nil
}

// Send manda uma mensagem de texto
func (m *Manager) Send(reqID, text string) error {
	m.mu.Lock()
	cn := m.conns[reqID]
	m.mu.Unlock()
	if cn == nil {
		return errors.New("WebSocket não está conectado")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	if err := cn.c.Write(ctx, websocket.MessageText, []byte(text)); err != nil {
		return err
	}
	m.emit(Event{ReqID: reqID, Kind: "out", Data: text})
	return nil
}

// Close fecha normalmente (o fim chega como Event close pela leitura)
func (m *Manager) Close(reqID string) {
	m.mu.Lock()
	cn := m.conns[reqID]
	delete(m.conns, reqID)
	m.mu.Unlock()
	if cn == nil {
		return
	}
	go func() {
		_ = cn.c.Close(websocket.StatusNormalClosure, "")
		cn.cancel()
	}()
}

// CloseAll: ao sair do app
func (m *Manager) CloseAll() {
	m.mu.Lock()
	ids := make([]string, 0, len(m.conns))
	for id := range m.conns {
		ids = append(ids, id)
	}
	m.mu.Unlock()
	for _, id := range ids {
		m.Close(id)
	}
}
