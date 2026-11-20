// Package runner: executor de coleção (port de src/main/runner.ts). Roda os requests de uma pasta (ou
// do workspace) em ordem, com iterações, atraso e linhas de dados (CSV/JSON). Variáveis gravadas por um
// request valem para os seguintes.
package runner

import (
	"encoding/json"
	"errors"
	"fmt"
	"math/big"
	"regexp"
	"sort"
	"strings"
	"sync/atomic"
	"time"

	"github.com/chmenegatti/zeno/wails/internal/doc"
	"github.com/chmenegatti/zeno/wails/internal/store"
)

type Doc = doc.Doc

// Options: RunOptions do Electron
type Options struct {
	WsID       string `json:"wsId"`
	FolderID   string `json:"folderId"`
	EnvID      string `json:"envId"`
	Iterations int    `json:"iterations"`
	DelayMs    int    `json:"delayMs"`
	// uma linha por iteração (CSV/JSON); vira variável
	Data []*Doc `json:"data"`
	// variáveis fixas (CLI --var); valem sobre ambiente e dados
	Vars *Doc `json:"vars"`
	// para no primeiro request com falha
	Bail bool `json:"bail"`
}

// Executor: o motor de envio (engine.Engine.ExecuteWith)
type Executor func(ws, req *Doc, envID string, extraVars *Doc) (*Doc, error)

// Handle: cancelar uma execução em andamento
type Handle struct {
	cancelled atomic.Bool
	done      chan struct{}
	once      atomicOnce
}

type atomicOnce struct{ v atomic.Bool }

func NewHandle() *Handle { return &Handle{done: make(chan struct{})} }

func (h *Handle) Cancel() {
	h.cancelled.Store(true)
	if h.once.v.CompareAndSwap(false, true) {
		close(h.done)
	}
}

func (h *Handle) Cancelled() bool { return h.cancelled.Load() }

// Item: request com o caminho de pastas
type Item struct {
	Req  *Doc
	Path string
}

// SortNodes: sortKey e depois nome (sortNodes de shared/tree.ts)
func SortNodes(nodes []any) []*Doc {
	out := []*Doc{}
	for _, n := range nodes {
		if d, ok := n.(*Doc); ok {
			out = append(out, d)
		}
	}
	sort.SliceStable(out, func(i, j int) bool {
		a, b := out[i].Num("sortKey", 0), out[j].Num("sortKey", 0)
		if a != b {
			return a < b
		}
		return store.LocaleCompare(out[i].Str("name"), out[j].Str("name")) < 0
	})
	return out
}

// Collect: requests em ordem de exibição, com o caminho de pastas
func Collect(nodes []any, trail []string) []Item {
	out := []Item{}
	for _, n := range SortNodes(nodes) {
		if n.Str("kind") == "request" {
			out = append(out, Item{Req: n, Path: strings.Join(trail, " / ")})
		} else {
			out = append(out, Collect(n.List("children"), append(append([]string{}, trail...), n.Str("name")))...)
		}
	}
	return out
}

func find(ws *Doc, id string) *Doc {
	n, _ := doc.Find(ws, id)
	return n
}

// Run executa a coleção; onStep recebe cada passo (índice e total)
func Run(exec Executor, st *store.Store, opts Options, onStep func(step *Doc, index, total int), h *Handle) (*Doc, error) {
	if h == nil {
		h = NewHandle()
	}
	ws0 := st.Workspace(opts.WsID)
	if ws0 == nil {
		return nil, errors.New("workspace não encontrado")
	}
	rootName := ws0.Str("name")
	nodes := ws0.List("children")
	if opts.FolderID != "" {
		f := find(ws0, opts.FolderID)
		if f == nil || f.Str("kind") != "folder" {
			return nil, errors.New("pasta não encontrada")
		}
		rootName = f.Str("name")
		nodes = f.List("children")
	}
	list := Collect(nodes, nil)
	iterations := opts.Iterations
	if len(opts.Data) > 0 && opts.Iterations <= 1 {
		iterations = len(opts.Data)
	}
	iterations = max(1, iterations)
	total := len(list) * iterations
	started := time.Now()
	steps := []any{}
	passed, failed := 0, 0
	wait := func(ms int) {
		select {
		case <-time.After(time.Duration(ms) * time.Millisecond):
		case <-h.done:
		}
	}

outer:
	for it := 0; it < iterations; it++ {
		var row *Doc
		if len(opts.Data) > 0 {
			row = opts.Data[it%len(opts.Data)]
		}
		extra := doc.New()
		for _, src := range []*Doc{row, opts.Vars} {
			if src != nil {
				for _, k := range src.Keys() {
					extra.Set(k, src.Get(k))
				}
			}
		}
		for _, item := range list {
			if h.Cancelled() {
				break outer
			}
			if len(steps) > 0 && opts.DelayMs > 0 {
				wait(opts.DelayMs)
			}
			if h.Cancelled() {
				break outer
			}
			// relê do disco a cada request: scripts anteriores podem ter gravado variáveis
			ws := st.Workspace(opts.WsID)
			if ws == nil {
				ws = ws0
			}
			req := item.Req
			if n := find(ws, req.Str("id")); n != nil && n.Str("kind") == "request" {
				req = n
			}
			step := doc.New("iteration", it+1, "requestId", req.Get("id"), "name", req.Str("name"), "path", item.Path)
			r, err := exec(ws, req, opts.EnvID, extra)
			if err != nil {
				step.Set("method", req.Get("method"))
				step.Set("url", req.Get("url"))
				step.Set("status", 0)
				step.Set("timeMs", 0)
				step.Set("tests", []any{})
				step.Set("error", err.Error())
			} else {
				res := r.Map("response")
				step.Set("method", res.Get("method"))
				step.Set("url", res.Get("url"))
				step.Set("status", res.Get("status"))
				step.Set("timeMs", res.Map("timing").Get("totalMs"))
				scr := r.Map("scripts")
				step.Set("tests", asDocs(scr.Get("tests")))
				if res.Get("error") != nil {
					step.Set("error", res.Get("error"))
				} else if scr != nil && len(scr.List("errors")) > 0 {
					msgs := []string{}
					for _, e := range scr.List("errors") {
						msgs = append(msgs, doc.AsStr(e))
					}
					step.Set("error", strings.Join(msgs, "; "))
				}
				if m := strs(r.Get("missing")); len(m) > 0 {
					step.Set("missing", m)
				}
				if w := strs(r.Get("warnings")); len(w) > 0 {
					step.Set("warnings", w)
				}
			}
			ok := StepOK(step)
			if ok {
				passed++
			} else {
				failed++
			}
			steps = append(steps, step)
			if onStep != nil {
				onStep(step, len(steps)-1, total)
			}
			if !ok && opts.Bail {
				break outer
			}
		}
	}
	rep := doc.New("name", rootName, "startedAt", started.UnixMilli(), "totalMs", time.Since(started).Milliseconds(),
		"steps", steps, "passed", passed, "failed", failed)
	if h.Cancelled() {
		rep.Set("cancelled", true)
	}
	return rep, nil
}

// strs: lista de textos do motor ([]string) ou lida de JSON ([]any)
func strs(v any) []any {
	switch x := v.(type) {
	case []string:
		out := make([]any, len(x))
		for i, s := range x {
			out[i] = s
		}
		return out
	case []any:
		return x
	}
	return nil
}

// asDocs: testes do motor (structs assert.Test ou Docs) como lista de Docs, no formato JSON da interface
func asDocs(v any) []any {
	if v == nil {
		return []any{}
	}
	b, err := json.Marshal(v)
	if err != nil {
		return []any{}
	}
	out, err := doc.FromJSON(b)
	if l, ok := out.([]any); err == nil && ok {
		return l
	}
	return []any{}
}

// StepOK: passou = enviado sem erro e todos os testes ok
func StepOK(s *Doc) bool {
	if e := s.Get("error"); e != nil && doc.AsStr(e) != "" {
		return false
	}
	for _, t := range s.List("tests") {
		if d, ok := t.(*Doc); !ok || d.Get("ok") != true {
			return false
		}
	}
	return true
}

var escRe = regexp.MustCompile(`[<>&"']`)

func esc(s string) string {
	return escRe.ReplaceAllStringFunc(s, func(c string) string {
		return map[string]string{"<": "&lt;", ">": "&gt;", "&": "&amp;", `"`: "&quot;", "'": "&apos;"}[c]
	})
}

func num(v any) float64 {
	switch x := v.(type) {
	case int:
		return float64(x)
	case int64:
		return float64(x)
	case float64:
		return x
	}
	return 0
}

// toFixed: Number.prototype.toFixed (arredonda o valor binário exato, metade pra cima)
func toFixed(x float64, digits int) string {
	neg := x < 0
	if neg {
		x = -x
	}
	exact := new(big.Float).SetPrec(2000).SetFloat64(x)
	scale := new(big.Float).SetPrec(2000).SetFloat64(1)
	for i := 0; i < digits; i++ {
		scale.Mul(scale, big.NewFloat(10))
	}
	exact.Mul(exact, scale)
	exact.Add(exact, big.NewFloat(0.5))
	n, _ := exact.Int(nil)
	s := n.String()
	for len(s) <= digits {
		s = "0" + s
	}
	out := s
	if digits > 0 {
		out = s[:len(s)-digits] + "." + s[len(s)-digits:]
	}
	if neg && strings.Trim(out, "0.") != "" {
		out = "-" + out
	}
	return out
}

// ToJUnit: um testsuite por iteração, um testcase por request (falha lista os testes que não passaram)
func ToJUnit(r *Doc) string {
	name := r.Str("name")
	var order []int
	byIt := map[int][]*Doc{}
	for _, x := range r.List("steps") {
		s := x.(*Doc)
		it := int(num(s.Get("iteration")))
		if _, ok := byIt[it]; !ok {
			order = append(order, it)
		}
		byIt[it] = append(byIt[it], s)
	}
	suites := []string{}
	for _, it := range order {
		steps := byIt[it]
		failures := 0
		var t float64
		cases := []string{}
		for _, s := range steps {
			if !StepOK(s) {
				failures++
			}
			ms := num(s.Get("timeMs"))
			t += ms
			parts := []string{}
			for _, p := range []string{name, s.Str("path")} {
				if p != "" {
					parts = append(parts, p)
				}
			}
			head := fmt.Sprintf(`    <testcase classname="%s" name="%s" time="%s"`, esc(strings.Join(parts, " / ")), esc(s.Str("name")), toFixed(ms/1000, 3))
			if StepOK(s) {
				cases = append(cases, head+"/>")
				continue
			}
			lines := []string{}
			if e := s.Get("error"); e != nil && doc.AsStr(e) != "" {
				lines = append(lines, doc.AsStr(e))
			}
			for _, x := range s.List("tests") {
				tt, _ := x.(*Doc)
				if tt == nil || tt.Get("ok") == true {
					continue
				}
				l := tt.Str("name")
				if e := tt.Str("error"); e != "" {
					l += ": " + e
				}
				lines = append(lines, l)
			}
			msg := "falhou"
			if len(lines) > 0 {
				msg = lines[0]
			}
			body := fmt.Sprintf("%s %s -> %s\n%s", doc.AsStr(s.Get("method")), doc.AsStr(s.Get("url")), doc.AsStr(s.Get("status")), strings.Join(lines, "\n"))
			cases = append(cases, fmt.Sprintf("%s>\n      <failure message=\"%s\">%s</failure>\n    </testcase>", head, esc(msg), esc(body)))
		}
		suffix := ""
		if len(byIt) > 1 {
			suffix = fmt.Sprintf(" #%d", it)
		}
		suites = append(suites, fmt.Sprintf("  <testsuite name=\"%s%s\" tests=\"%d\" failures=\"%d\" time=\"%s\">\n%s\n  </testsuite>",
			esc(name), suffix, len(steps), failures, toFixed(t/1000, 3), strings.Join(cases, "\n")))
	}
	return fmt.Sprintf("<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<testsuites name=\"%s\" tests=\"%d\" failures=\"%d\" time=\"%s\">\n%s\n</testsuites>\n",
		esc(name), len(r.List("steps")), int(num(r.Get("failed"))), toFixed(num(r.Get("totalMs"))/1000, 3), strings.Join(suites, "\n"))
}

var (
	jsonNameRe  = regexp.MustCompile(`(?i)\.json$`)
	jsonStartRe = regexp.MustCompile(`^[\[{]`)
)

// ParseData: linhas de dados: JSON (lista de objetos) ou CSV com cabeçalho
func ParseData(text, name string) ([]*Doc, error) {
	t := strings.TrimSpace(strings.TrimPrefix(text, "\ufeff"))
	if t == "" {
		return []*Doc{}, nil
	}
	if jsonNameRe.MatchString(name) || jsonStartRe.MatchString(t) {
		v, err := doc.FromJSON([]byte(t))
		if err != nil {
			var se *json.SyntaxError
			if errors.As(err, &se) {
				return nil, fmt.Errorf("JSON inválido: %s", se.Error())
			}
			return nil, err
		}
		list, ok := v.([]any)
		if !ok {
			list = []any{v}
		}
		out := []*Doc{}
		for _, x := range list {
			d, ok := x.(*Doc)
			if !ok || d == nil {
				return nil, errors.New("JSON de dados deve ser uma lista de objetos")
			}
			out = append(out, d)
		}
		return out, nil
	}
	rows := ParseCSV(t)
	head, rest := rows[0], rows[1:]
	out := []*Doc{}
	for _, r := range rest {
		empty := true
		for _, c := range r {
			if c != "" {
				empty = false
			}
		}
		if empty {
			continue
		}
		d := doc.New()
		for i, h := range head {
			v := ""
			if i < len(r) {
				v = r[i]
			}
			d.Set(strings.TrimSpace(h), v)
		}
		out = append(out, d)
	}
	return out, nil
}

// ParseCSV: RFC 4180 (aspas, aspas duplicadas, quebra de linha dentro de aspas); separador , ou ;
func ParseCSV(text string) [][]string {
	// primeira linha como text.split(/\r?\n/, 1)[0]
	first := text
	if i := strings.IndexByte(text, '\n'); i >= 0 {
		first = strings.TrimSuffix(text[:i], "\r")
	}
	sep := ','
	if strings.Count(first, ";") > strings.Count(first, ",") {
		sep = ';'
	}
	rows := [][]string{}
	row := []string{}
	var cell strings.Builder
	q := false
	rs := []rune(text)
	for i := 0; i < len(rs); i++ {
		c := rs[i]
		switch {
		case q:
			if c == '"' && i+1 < len(rs) && rs[i+1] == '"' {
				cell.WriteRune('"')
				i++
			} else if c == '"' {
				q = false
			} else {
				cell.WriteRune(c)
			}
		case c == '"':
			q = true
		case c == sep:
			row = append(row, cell.String())
			cell.Reset()
		case c == '\n' || c == '\r':
			if c == '\r' && i+1 < len(rs) && rs[i+1] == '\n' {
				i++
			}
			row = append(row, cell.String())
			rows = append(rows, row)
			row = []string{}
			cell.Reset()
		default:
			cell.WriteRune(c)
		}
	}
	row = append(row, cell.String())
	return append(rows, row)
}
