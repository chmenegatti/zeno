package store

import (
	"sort"
	"strings"

	"github.com/chmenegatti/zeno/wails/internal/doc"
)

// CloneWorkspace: cópia com ids novos em todos os níveis (workspace, pastas, requests, ambientes); as
// referências aos ids antigos dentro dos textos (ex.: {% response 'body', 'req_…' %}) passam a apontar
// pra cópia. Sem local (vai pra pasta de dados). Igual ao cloneWorkspace do shared/tree.ts.
func CloneWorkspace(ws *Doc, name string) *Doc {
	ids := map[string]string{ws.Str("id"): NewID("wrk")}
	for _, e := range ws.List("environments") {
		if d, ok := e.(*Doc); ok {
			ids[d.Str("id")] = NewID("env")
		}
	}
	var collect func([]any)
	collect = func(nodes []any) {
		for _, n := range nodes {
			d, ok := n.(*Doc)
			if !ok {
				continue
			}
			if d.Str("kind") == "request" {
				ids[d.Str("id")] = NewID("req")
			} else {
				ids[d.Str("id")] = NewID("fld")
				collect(d.List("children"))
			}
		}
	}
	collect(ws.List("children"))
	// ids mais longos primeiro: um id nunca é trocado dentro de outro
	old := make([]string, 0, len(ids))
	for k := range ids {
		if k != "" {
			old = append(old, k)
		}
	}
	sort.Slice(old, func(i, j int) bool { return len(old[i]) > len(old[j]) })
	swap := func(s string) string {
		if n, ok := ids[s]; ok {
			return n
		}
		for _, o := range old {
			if strings.Contains(s, o) {
				s = strings.ReplaceAll(s, o, ids[o])
			}
		}
		return s
	}
	var walk func(any) any
	walk = func(v any) any {
		switch x := v.(type) {
		case string:
			return swap(x)
		case []any:
			out := make([]any, len(x))
			for i, e := range x {
				out[i] = walk(e)
			}
			return out
		case *Doc:
			out := doc.New()
			for _, k := range x.Keys() {
				if k == "location" && x == ws {
					continue
				}
				out.Set(k, walk(x.Get(k)))
			}
			return out
		}
		return v
	}
	out := walk(ws).(*Doc)
	out.Set("name", name)
	return out
}
