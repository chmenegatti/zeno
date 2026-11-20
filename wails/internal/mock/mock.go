// Package mock: servidor local por workspace (#20) que responde cada rota (método + path do request,
// com {{ id }} e :id como parâmetro) com o exemplo salvo do request. As rotas são lidas do workspace a
// cada chamada: editar ou salvar exemplo vale na hora, sem reiniciar.
package mock

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"net/http"
	"regexp"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/chmenegatti/zeno/wails/internal/doc"
)

type Doc = doc.Doc

// DefaultPort: porta quando o workspace não escolheu outra
const DefaultPort = 4010

// Route: método + path (segmentos; "" = parâmetro) de um request com exemplo
type Route struct {
	Method  string
	Path    string
	Segs    []string
	ReqID   string
	ReqName string
	Example *Doc
}

var leadTpl = regexp.MustCompile(`^\s*(\{\{.*?\}\}|\{%.*?%\})`)
var paramSeg = regexp.MustCompile(`^(\{\{.*\}\}|\{%.*%\}|:\w+|\{\w+\})$`)

// PathOf: path do template da URL ({{ base_url }}/users/{{ id }} → /users/{{ id }}), sem query
func PathOf(raw string) string {
	u := strings.TrimSpace(raw)
	if m := leadTpl.FindString(u); m != "" {
		u = u[len(m):]
	} else if i := strings.Index(u, "://"); i >= 0 {
		u = u[i+3:]
		if j := strings.Index(u, "/"); j >= 0 {
			u = u[j:]
		} else {
			u = "/"
		}
	} else if !strings.HasPrefix(u, "/") {
		if j := strings.Index(u, "/"); j >= 0 {
			u = u[j:]
		} else {
			u = "/"
		}
	}
	if i := strings.IndexAny(u, "?#"); i >= 0 {
		u = u[:i]
	}
	if !strings.HasPrefix(u, "/") {
		u = "/" + u
	}
	return u
}

func segments(path string) []string {
	var out []string
	for _, s := range strings.Split(path, "/") {
		if s != "" {
			out = append(out, s)
		}
	}
	return out
}

// Example: o exemplo servido (o marcado como padrão, senão o primeiro)
func Example(req *Doc) *Doc {
	var first *Doc
	for _, x := range req.List("examples") {
		e, _ := x.(*Doc)
		if e == nil {
			continue
		}
		if e.Get("default") == true {
			return e
		}
		if first == nil {
			first = e
		}
	}
	return first
}

// Routes: rotas do workspace, na ordem da árvore
func Routes(ws *Doc) []Route {
	var out []Route
	doc.Walk(ws.List("children"), func(n *Doc) {
		if n.Str("kind") != "request" {
			return
		}
		ex := Example(n)
		if ex == nil {
			return
		}
		p := PathOf(n.Str("url"))
		segs := segments(p)
		for i, s := range segs {
			if paramSeg.MatchString(s) || strings.Contains(s, "{{") || strings.Contains(s, "{%") {
				segs[i] = ""
			}
		}
		out = append(out, Route{Method: strings.ToUpper(n.Str("method")), Path: p, Segs: segs, ReqID: n.Str("id"), ReqName: n.Str("name"), Example: ex})
	})
	return out
}

// Match: rota com mais segmentos fixos iguais ao path pedido (empate: a primeira da árvore)
func Match(routes []Route, method, path string) *Route {
	segs := segments(path)
	var best *Route
	bestScore := -1
	for i := range routes {
		r := &routes[i]
		if r.Method != method && !(method == "HEAD" && r.Method == "GET") {
			continue
		}
		if len(r.Segs) != len(segs) {
			continue
		}
		score := 0
		ok := true
		for j, s := range r.Segs {
			if s == "" {
				continue
			}
			if s != segs[j] {
				ok = false
				break
			}
			score++
		}
		if ok && score > bestScore {
			best, bestScore = r, score
		}
	}
	return best
}

// Hit: chamada recebida pelo mock (pra interface mostrar)
type Hit struct {
	WsID   string `json:"wsId"`
	Method string `json:"method"`
	Path   string `json:"path"`
	Status int    `json:"status"`
	ReqID  string `json:"reqId,omitempty"`
	At     int64  `json:"at"`
}

type server struct {
	srv  *http.Server
	port int
}

// Manager: um servidor por workspace
type Manager struct {
	// Workspace devolve o workspace atual (rotas sempre frescas)
	Workspace func(id string) *Doc
	OnHit     func(Hit)
	mu        sync.Mutex
	servers   map[string]*server
}

func (m *Manager) handler(wsID string) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		status := m.serve(wsID, w, r)
		if m.OnHit != nil {
			hit := Hit{WsID: wsID, Method: r.Method, Path: r.URL.RequestURI(), Status: status, At: time.Now().UnixMilli()}
			m.OnHit(hit)
		}
	})
}

func (m *Manager) serve(wsID string, w http.ResponseWriter, r *http.Request) int {
	h := w.Header()
	var ws *Doc
	if m.Workspace != nil {
		ws = m.Workspace(wsID)
	}
	if ws == nil {
		http.Error(w, "workspace não existe mais", http.StatusGone)
		return http.StatusGone
	}
	routes := Routes(ws)
	rt := Match(routes, r.Method, r.URL.Path)
	if rt == nil {
		// preflight do navegador: libera
		if r.Method == http.MethodOptions {
			h.Set("Access-Control-Allow-Origin", "*")
			h.Set("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS")
			h.Set("Access-Control-Allow-Headers", "*")
			w.WriteHeader(http.StatusNoContent)
			return http.StatusNoContent
		}
		list := make([]string, len(routes))
		for i, x := range routes {
			list[i] = x.Method + " " + x.Path
		}
		h.Set("Content-Type", "application/json; charset=utf-8")
		w.WriteHeader(http.StatusNotFound)
		_ = json.NewEncoder(w).Encode(map[string]any{"error": "sem exemplo para " + r.Method + " " + r.URL.Path, "routes": list})
		return http.StatusNotFound
	}
	ex := rt.Example
	if d := ex.Num("delayMs", 0); d > 0 {
		select {
		case <-time.After(time.Duration(d) * time.Millisecond):
		case <-r.Context().Done():
			return 499
		}
	}
	for _, x := range ex.List("headers") {
		kv, _ := x.(*Doc)
		if kv == nil || kv.Get("enabled") == false || kv.Str("name") == "" {
			continue
		}
		switch strings.ToLower(kv.Str("name")) {
		case "content-length", "transfer-encoding", "content-encoding", "connection":
			continue
		}
		h.Add(kv.Str("name"), kv.Str("value"))
	}
	body := []byte(ex.Str("body"))
	if ex.Str("bodyEncoding") == "base64" {
		if b, err := base64.StdEncoding.DecodeString(ex.Str("body")); err == nil {
			body = b
		}
	}
	if h.Get("Content-Type") == "" && json.Valid(body) && len(body) > 0 {
		h.Set("Content-Type", "application/json; charset=utf-8")
	}
	if h.Get("Access-Control-Allow-Origin") == "" {
		h.Set("Access-Control-Allow-Origin", "*")
	}
	h.Set("X-Zeno-Mock", rt.ReqName)
	status := int(ex.Num("status", 200))
	if status < 100 || status > 999 {
		status = 200
	}
	w.WriteHeader(status)
	if r.Method != http.MethodHead {
		_, _ = w.Write(body)
	}
	return status
}

// Start liga o mock do workspace em 127.0.0.1:port (religa se já estava em outra porta)
func (m *Manager) Start(wsID string, port int) (int, error) {
	if port <= 0 {
		port = DefaultPort
	}
	m.mu.Lock()
	if s := m.servers[wsID]; s != nil && s.port == port {
		m.mu.Unlock()
		return port, nil
	}
	m.mu.Unlock()
	m.Stop(wsID)
	ln, err := net.Listen("tcp", fmt.Sprintf("127.0.0.1:%d", port))
	if err != nil {
		if errors.Is(err, syscall.EADDRINUSE) {
			return 0, fmt.Errorf("porta %d em uso: escolha outra", port)
		}
		return 0, err
	}
	srv := &http.Server{Handler: m.handler(wsID), ReadHeaderTimeout: 10 * time.Second}
	m.mu.Lock()
	if m.servers == nil {
		m.servers = map[string]*server{}
	}
	m.servers[wsID] = &server{srv: srv, port: port}
	m.mu.Unlock()
	go func() { _ = srv.Serve(ln) }()
	return port, nil
}

// Stop desliga o mock do workspace
func (m *Manager) Stop(wsID string) {
	m.mu.Lock()
	s := m.servers[wsID]
	delete(m.servers, wsID)
	m.mu.Unlock()
	if s != nil {
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancel()
		_ = s.srv.Shutdown(ctx)
	}
}

// Port: porta do mock ligado (0 = desligado)
func (m *Manager) Port(wsID string) int {
	m.mu.Lock()
	defer m.mu.Unlock()
	if s := m.servers[wsID]; s != nil {
		return s.port
	}
	return 0
}

// StopAll: ao sair do app
func (m *Manager) StopAll() {
	m.mu.Lock()
	ids := make([]string, 0, len(m.servers))
	for id := range m.servers {
		ids = append(ids, id)
	}
	m.mu.Unlock()
	for _, id := range ids {
		m.Stop(id)
	}
}
