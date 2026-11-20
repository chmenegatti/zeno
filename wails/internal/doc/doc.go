// Package doc: documentos do Zeno (workspace, pasta, request, ambiente) como map[string]any.
// O que a interface manda volta pro YAML sem perder campo; estes helpers leem com segurança.
package doc

import (
	"encoding/json"
	"sort"
	"strings"
)

// Doc é um documento YAML/JSON genérico.
type Doc = map[string]any

// Str lê um campo como texto ("" se ausente).
func Str(d Doc, k string) string {
	v, ok := d[k]
	if !ok || v == nil {
		return ""
	}
	if s, ok := v.(string); ok {
		return s
	}
	b, _ := json.Marshal(v)
	return strings.Trim(string(b), `"`)
}

// Num lê um campo numérico (YAML dá int, JSON dá float64).
func Num(d Doc, k string, def float64) float64 {
	switch x := d[k].(type) {
	case int:
		return float64(x)
	case int64:
		return float64(x)
	case float64:
		return x
	}
	return def
}

// Map lê um campo objeto.
func Map(d Doc, k string) Doc {
	m, _ := d[k].(Doc)
	return m
}

// List lê um campo lista.
func List(d Doc, k string) []any {
	l, _ := d[k].([]any)
	return l
}

// Docs converte []Doc em []any (pra guardar dentro de outro Doc).
func Docs(ds []Doc) []any {
	out := make([]any, len(ds))
	for i, d := range ds {
		out[i] = d
	}
	return out
}

// Sort ordena por sortKey e depois por nome, como sortNodes do Electron.
func Sort(nodes []Doc) {
	sort.SliceStable(nodes, func(i, j int) bool {
		a, b := Num(nodes[i], "sortKey", 0), Num(nodes[j], "sortKey", 0)
		if a != b {
			return a < b
		}
		return Str(nodes[i], "name") < Str(nodes[j], "name")
	})
}

// Find acha um nó pela id na árvore de um workspace; devolve também as pastas acima dele.
func Find(ws Doc, id string) (Doc, []Doc) {
	var walk func(children []any, anc []Doc) (Doc, []Doc)
	walk = func(children []any, anc []Doc) (Doc, []Doc) {
		for _, c := range children {
			d, _ := c.(Doc)
			if d == nil {
				continue
			}
			if Str(d, "id") == id {
				return d, anc
			}
			if Str(d, "kind") == "folder" {
				if n, a := walk(List(d, "children"), append(append([]Doc{}, anc...), d)); n != nil {
					return n, a
				}
			}
		}
		return nil, nil
	}
	return walk(List(ws, "children"), nil)
}

// Replace troca um nó (mesma id) na árvore; true se achou.
func Replace(children []any, node Doc) bool {
	for i, c := range children {
		d, _ := c.(Doc)
		if d == nil {
			continue
		}
		if Str(d, "id") == Str(node, "id") {
			children[i] = node
			return true
		}
		if Str(d, "kind") == "folder" && Replace(List(d, "children"), node) {
			return true
		}
	}
	return false
}
