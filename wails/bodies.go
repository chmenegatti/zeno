package main

// Bodies grandes fora da ponte Go↔JS. O Wails entrega resultados e eventos como texto JSON avaliado no
// JavaScript (~25 MB/s): um envio devolve o histórico com até 20 respostas, e cada JSON de alguns MB
// custava centenas de ms. Body acima de offloadMin vira "bodyUrl"; o servidor de assets entrega o texto
// em /zeno-body/<token> e a bridge.ts busca com fetch antes de passar o resultado pra interface.

import (
	"crypto/rand"
	"encoding/hex"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/chmenegatti/zeno/wails/internal/doc"
)

const (
	offloadMin = 64 * 1024
	offloadTTL = 2 * time.Minute
	bodyPrefix = "/zeno-body/"
)

type offloaded struct {
	body string
	at   time.Time
}

type bodyCache struct {
	mu sync.Mutex
	m  map[string]offloaded
}

func (c *bodyCache) put(body string) string {
	b := make([]byte, 12)
	_, _ = rand.Read(b)
	tok := hex.EncodeToString(b)
	now := time.Now()
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.m == nil {
		c.m = map[string]offloaded{}
	}
	// a interface busca logo; o que ficou pra trás (janela fechando, erro) some sozinho
	for k, v := range c.m {
		if now.Sub(v.at) > offloadTTL {
			delete(c.m, k)
		}
	}
	c.m[tok] = offloaded{body, now}
	return tok
}

// take entrega uma vez só
func (c *bodyCache) take(tok string) (string, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	v, ok := c.m[tok]
	if ok {
		delete(c.m, tok)
	}
	return v.body, ok
}

// offload troca bodies grandes de registros de resposta por bodyUrl (cópias: o store não muda)
func (c *bodyCache) offload(v any) any {
	switch x := v.(type) {
	case *Doc:
		if x == nil {
			return x
		}
		if body, ok := x.Get("body").(string); ok && len(body) >= offloadMin && x.Has("requestId") && x.Has("bodyEncoding") {
			out := doc.New()
			for _, k := range x.Keys() {
				out.Set(k, x.Get(k))
			}
			out.Set("body", "")
			out.Set("bodyUrl", bodyPrefix+c.put(body))
			return out
		}
		var out *Doc
		for _, k := range x.Keys() {
			val := x.Get(k)
			nv := c.offload(val)
			if out == nil && !same(nv, val) {
				out = doc.New()
				for _, k2 := range x.Keys() {
					out.Set(k2, x.Get(k2))
				}
			}
			if out != nil {
				out.Set(k, nv)
			}
		}
		if out != nil {
			return out
		}
		return x
	case []any:
		var out []any
		for i, val := range x {
			nv := c.offload(val)
			if out == nil && !same(nv, val) {
				out = append([]any{}, x...)
			}
			if out != nil {
				out[i] = nv
			}
		}
		if out != nil {
			return out
		}
		return x
	}
	return v
}

// same: offload devolve o mesmo ponteiro/fatia quando nada mudou
func same(a, b any) bool {
	switch x := a.(type) {
	case *Doc:
		y, ok := b.(*Doc)
		return ok && x == y
	case []any:
		y, ok := b.([]any)
		return ok && len(x) == len(y) && (len(x) == 0 || &x[0] == &y[0])
	}
	return true
}

// ServeHTTP: GET /zeno-body/<token> (servidor de assets do Wails, mesma origem da interface)
func (c *bodyCache) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet || !strings.HasPrefix(r.URL.Path, bodyPrefix) {
		http.NotFound(w, r)
		return
	}
	body, ok := c.take(strings.TrimPrefix(r.URL.Path, bodyPrefix))
	if !ok {
		http.NotFound(w, r)
		return
	}
	w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	_, _ = w.Write([]byte(body))
}
