package store

import (
	"errors"
	"os"
	"path/filepath"
	"regexp"
	"sync"

	"github.com/chmenegatti/zeno/wails/internal/doc"
	"github.com/chmenegatti/zeno/wails/internal/i18n"
)

const (
	maxResponses = 20
	// LargeBody: acima disso o body vai pra um arquivo próprio e o histórico guarda só a prévia
	LargeBody    = 5 * 1024 * 1024
	previewChars = 256 * 1024
)

var unsafeName = regexp.MustCompile(`[^\w-]`)

// ResponsesFile: histórico de um request
func (s *Store) ResponsesFile(reqID string) string {
	return filepath.Join(s.Dir, ".responses", unsafeName.ReplaceAllString(reqID, "_")+".json")
}

func (s *Store) bodyPath(resID string) string {
	return filepath.Join(s.Dir, ".responses", "bodies", unsafeName.ReplaceAllString(resID, "_"))
}

// Histórico em memória e gravação em segundo plano. Reler e regravar o .json do request a cada envio
// custava dezenas de ms com bodies de MBs (até 20 no histórico). A lista mais nova de cada request fica
// em memória (limite respCacheMax pelo tamanho dos bodies, os menos usados saem) e o arquivo é gravado
// por um único gravador, na ordem; Flush espera terminar (fechar o app, CLI, testes).
const respCacheMax = 64 << 20

type respEntry struct {
	list []any
	size int
	used int64
}

type respCache struct {
	mu      sync.Mutex
	entries map[string]*respEntry
	size    int
	tick    int64
	pending map[string][]any
	running bool
	wg      sync.WaitGroup
}

func listSize(l []any) int {
	n := 0
	for _, r := range l {
		if d, _ := r.(*Doc); d != nil {
			n += len(d.Str("body")) + 512
		}
	}
	return n
}

// remember: c.mu travado
func (c *respCache) remember(reqID string, l []any) {
	if c.entries == nil {
		c.entries = map[string]*respEntry{}
	}
	if old, ok := c.entries[reqID]; ok {
		c.size -= old.size
		delete(c.entries, reqID)
	}
	size := listSize(l)
	if size > respCacheMax {
		return
	}
	c.tick++
	c.entries[reqID] = &respEntry{list: l, size: size, used: c.tick}
	c.size += size
	for c.size > respCacheMax {
		var oldest string
		var at int64 = -1
		for k, e := range c.entries {
			if at < 0 || e.used < at {
				oldest, at = k, e.used
			}
		}
		c.size -= c.entries[oldest].size
		delete(c.entries, oldest)
	}
}

func (c *respCache) forget(reqID string) {
	if e, ok := c.entries[reqID]; ok {
		c.size -= e.size
		delete(c.entries, reqID)
	}
	delete(c.pending, reqID)
}

// GetResponses: histórico do request, mais nova primeiro (a lista é só pra leitura)
func (s *Store) GetResponses(reqID string) []any {
	c := &s.resp
	c.mu.Lock()
	if l, ok := c.pending[reqID]; ok {
		c.mu.Unlock()
		return append([]any{}, l...)
	}
	if e, ok := c.entries[reqID]; ok {
		c.tick++
		e.used = c.tick
		c.mu.Unlock()
		return append([]any{}, e.list...)
	}
	c.mu.Unlock()
	b, err := os.ReadFile(s.ResponsesFile(reqID))
	if err != nil {
		return []any{}
	}
	v, err := doc.FromJSON(b)
	l, ok := v.([]any)
	if !ok || err != nil {
		return []any{}
	}
	c.mu.Lock()
	if _, busy := c.pending[reqID]; !busy {
		c.remember(reqID, l)
	}
	c.mu.Unlock()
	return append([]any{}, l...)
}

// queueWrite: grava o histórico em segundo plano (vale a lista mais nova de cada request)
func (s *Store) queueWrite(reqID string, l []any) {
	c := &s.resp
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.pending == nil {
		c.pending = map[string][]any{}
	}
	c.pending[reqID] = l
	c.remember(reqID, l)
	if !c.running {
		c.running = true
		c.wg.Add(1)
		go s.writeLoop()
	}
}

func (s *Store) writeLoop() {
	c := &s.resp
	defer c.wg.Done()
	for {
		c.mu.Lock()
		var reqID string
		var l []any
		for k, v := range c.pending {
			reqID, l = k, v
			break
		}
		if l == nil {
			c.running = false
			c.mu.Unlock()
			return
		}
		c.mu.Unlock()
		file := s.ResponsesFile(reqID)
		_ = os.MkdirAll(filepath.Dir(file), 0o755)
		b, _ := doc.Marshal(l)
		_ = os.WriteFile(file, b, 0o644)
		c.mu.Lock()
		// só sai da fila se ninguém pôs uma lista mais nova enquanto gravava
		if cur, ok := c.pending[reqID]; ok && len(cur) > 0 && len(l) > 0 && cur[0] == l[0] && len(cur) == len(l) {
			delete(c.pending, reqID)
		}
		c.mu.Unlock()
	}
}

// Flush espera as gravações de histórico pendentes
func (s *Store) Flush() {
	s.resp.wg.Wait()
}

// AddResponse põe no topo do histórico (máximo 20). Body grande vai pra .responses/bodies/<id> e o
// histórico guarda a prévia; o que sai do histórico leva o arquivo junto.
func (s *Store) AddResponse(rec *Doc) []any {
	body := rec.Str("body")
	if rec.Num("size", 0) > LargeBody || len(body) > LargeBody {
		bp := s.bodyPath(rec.Str("id"))
		_ = os.MkdirAll(filepath.Dir(bp), 0o755)
		_ = os.WriteFile(bp, []byte(body), 0o644)
		short := rec.Clone()
		if rec.Str("bodyEncoding") == "utf8" {
			short.Set("body", preview(body))
		} else {
			short.Set("body", "")
		}
		short.Set("bodyFile", true)
		rec = short
	}
	all := append([]any{rec}, s.GetResponses(rec.Str("requestId"))...)
	list := all
	if len(all) > maxResponses {
		list = all[:maxResponses]
		for _, old := range all[maxResponses:] {
			if d, _ := old.(*Doc); d != nil && d.Get("bodyFile") == true {
				_ = os.Remove(s.bodyPath(d.Str("id")))
			}
		}
	}
	s.queueWrite(rec.Str("requestId"), list)
	return append([]any{}, list...)
}

// os primeiros 256 Ki caracteres (UTF-16, como body.slice no JavaScript)
func preview(s string) string {
	n := 0
	for i, r := range s {
		if n >= previewChars {
			return s[:i]
		}
		if r > 0xFFFF {
			n += 2
		} else {
			n++
		}
	}
	return s
}

// ResponseBody: body completo (lê do arquivo quando foi guardado à parte)
func (s *Store) ResponseBody(rec *Doc) (string, error) {
	if rec.Get("bodyFile") != true {
		return rec.Str("body"), nil
	}
	b, err := os.ReadFile(s.bodyPath(rec.Str("id")))
	if err != nil {
		return "", errors.New(i18n.T("o body completo desta resposta não está mais no disco"))
	}
	return string(b), nil
}

// FindResponse acha uma resposta no histórico do request
func (s *Store) FindResponse(reqID, resID string) (*Doc, error) {
	for _, r := range s.GetResponses(reqID) {
		if d, _ := r.(*Doc); d != nil && d.Str("id") == resID {
			return d, nil
		}
	}
	return nil, errors.New(i18n.T("resposta não está mais no histórico"))
}

// ClearResponses apaga o histórico do request e os bodies guardados à parte
func (s *Store) ClearResponses(reqID string) error {
	s.Flush()
	list := s.GetResponses(reqID)
	s.resp.mu.Lock()
	s.resp.forget(reqID)
	s.resp.mu.Unlock()
	for _, r := range list {
		if d, _ := r.(*Doc); d != nil && d.Get("bodyFile") == true {
			_ = os.Remove(s.bodyPath(d.Str("id")))
		}
	}
	if err := os.Remove(s.ResponsesFile(reqID)); err != nil && !os.IsNotExist(err) {
		return err
	}
	return nil
}
