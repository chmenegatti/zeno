// Package importers: Insomnia (NeDB, export JSON v4, export YAML v5), Postman (coleção v2.x e
// ambientes) e OpenAPI 3.x / Swagger 2.0 viram workspaces do Zeno. Port de src/main/import-*.ts; a
// saída é conferida contra a do Electron (testdata/golden, gerado por testdata/gen.ts), inclusive a
// ordem dos campos, que define o YAML gravado.
package importers

import (
	"crypto/sha1"
	"encoding/hex"
	"math"
	"strings"
	"unicode"

	"github.com/chmenegatti/zeno/wails/internal/doc"
	"golang.org/x/text/unicode/norm"
)

type Doc = doc.Doc

// Result: workspaces convertidos e avisos (ParseResult do Electron)
type Result struct {
	Workspaces []*Doc
	Warnings   []string
}

// JSON como o Electron devolve ({ workspaces, warnings })
func (r Result) Doc() *Doc {
	ws := make([]any, len(r.Workspaces))
	for i, w := range r.Workspaces {
		ws[i] = w
	}
	warnings := r.Warnings
	if warnings == nil {
		warnings = []string{}
	}
	return doc.New("workspaces", ws, "warnings", warnings)
}

// StableID: id estável (reimportar o mesmo spec substitui o workspace em vez de duplicar)
func StableID(prefix string, parts ...string) string {
	s := sha1.Sum([]byte(strings.Join(parts, "\x00")))
	return prefix + "_" + hex.EncodeToString(s[:])[:24]
}

// ---------- semântica de JavaScript nos dados lidos ----------

func obj(v any) *Doc {
	d, _ := v.(*Doc)
	return d
}

func arr(v any) []any {
	a, _ := v.([]any)
	return a
}

// get encadeado: get(x, "a", "b") = x?.a?.b
func get(v any, keys ...string) any {
	cur := v
	for _, k := range keys {
		d := obj(cur)
		if d == nil {
			return nil
		}
		cur = d.Get(k)
	}
	return cur
}

// truthy: valor "verdadeiro" do JavaScript
func truthy(v any) bool {
	switch x := v.(type) {
	case nil:
		return false
	case bool:
		return x
	case string:
		return x != ""
	case int64:
		return x != 0
	case float64:
		return x != 0 && !math.IsNaN(x)
	}
	return true
}

// coalesce: a ?? b
func coalesce(vs ...any) any {
	for _, v := range vs {
		if v != nil {
			return v
		}
	}
	return nil
}

// or: a || b
func or(vs ...any) any {
	for _, v := range vs {
		if truthy(v) {
			return v
		}
	}
	if len(vs) == 0 {
		return nil
	}
	return vs[len(vs)-1]
}

// str: null/undefined → "", objeto → JSON, resto → String(v)
func str(v any) string {
	switch v.(type) {
	case nil:
		return ""
	case *Doc, []any:
		b, _ := doc.Marshal(v)
		return string(b)
	}
	return doc.AsStr(v)
}

// isString: typeof v === 'string'
func isString(v any) bool { _, ok := v.(string); return ok }

// num: typeof v === 'number' ? v : def
func isNum(v any) bool {
	switch v.(type) {
	case int64, float64, int:
		return true
	}
	return false
}

// localeCompare aproximado (sem acento e sem caixa primeiro), como em store
func localeCompare(a, b string) int {
	fold := func(s string) string {
		t := norm.NFD.String(strings.ToLower(s))
		return strings.Map(func(r rune) rune {
			if unicode.Is(unicode.Mn, r) {
				return -1
			}
			return r
		}, t)
	}
	if fa, fb := fold(a), fold(b); fa != fb {
		return strings.Compare(fa, fb)
	}
	return strings.Compare(a, b)
}

// sortNodes: sortKey e depois nome, estável
func sortNodes(nodes []any) []any {
	out := append([]any{}, nodes...)
	for i := 1; i < len(out); i++ {
		for j := i; j > 0; j-- {
			a, b := obj(out[j-1]), obj(out[j])
			ka, kb := a.Num("sortKey", 0), b.Num("sortKey", 0)
			if ka > kb || (ka == kb && localeCompare(a.Str("name"), b.Str("name")) > 0) {
				out[j-1], out[j] = out[j], out[j-1]
			} else {
				break
			}
		}
	}
	return out
}

// set só se o valor não é "undefined" (nil vira ausente; use setNull pra null explícito)
func setDef(d *Doc, k string, v any) {
	if v != nil {
		d.Set(k, v)
	}
}

// avisos sem repetição, na ordem
type warner struct {
	list []string
	seen map[string]bool
	uniq bool
}

func (w *warner) warn(m string) {
	if w.uniq {
		if w.seen == nil {
			w.seen = map[string]bool{}
		}
		if w.seen[m] {
			return
		}
		w.seen[m] = true
	}
	w.list = append(w.list, m)
}
