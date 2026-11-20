// Package jsonq: JSONPath simples ($.a.b[0], ['chave'], [*], .*, ..nome), port de parsePath/queryJson
// de src/shared/assert.ts. Valores no formato de doc.FromJSON (*doc.Doc, []any…).
package jsonq

import (
	"fmt"
	"regexp"
	"strconv"
	"strings"

	"github.com/chmenegatti/zeno/wails/internal/doc"
)

type seg struct {
	kind string // key | idx | all | deep
	name string
	i    int
}

var (
	nameRe = regexp.MustCompile(`^[^.\[\]]+`)
	intRe  = regexp.MustCompile(`^-?\d+$`)
	qRe    = regexp.MustCompile(`^(['"]).*['"]$`)
)

func parse(path string) ([]seg, error) {
	p := strings.TrimPrefix(strings.TrimSpace(path), "$")
	bad := fmt.Errorf("JSONPath inválido: %s", path)
	var out []seg
	i := 0
	name := func() (string, error) {
		m := nameRe.FindString(p[i:])
		if m == "" {
			return "", bad
		}
		i += len(m)
		return m, nil
	}
	for i < len(p) {
		switch {
		case strings.HasPrefix(p[i:], ".."):
			i += 2
			n, err := name()
			if err != nil {
				return nil, err
			}
			out = append(out, seg{kind: "deep", name: n})
		case p[i] == '.':
			i++
			if i < len(p) && p[i] == '*' {
				i++
				out = append(out, seg{kind: "all"})
				continue
			}
			n, err := name()
			if err != nil {
				return nil, err
			}
			out = append(out, seg{kind: "key", name: n})
		case p[i] == '[':
			if i+1 < len(p) && (p[i+1] == '\'' || p[i+1] == '"') {
				q := p[i+1]
				j := i + 2
				var key strings.Builder
				for j < len(p) && p[j] != q {
					if p[j] == '\\' && j+1 < len(p) {
						j++
					}
					key.WriteByte(p[j])
					j++
				}
				if j+1 >= len(p) || p[j] != q || p[j+1] != ']' {
					return nil, bad
				}
				out = append(out, seg{kind: "key", name: key.String()})
				i = j + 2
				continue
			}
			end := strings.Index(p[i:], "]")
			if end < 0 {
				return nil, bad
			}
			inner := strings.TrimSpace(p[i+1 : i+end])
			i += end + 1
			switch {
			case inner == "*":
				out = append(out, seg{kind: "all"})
			case intRe.MatchString(inner):
				n, _ := strconv.Atoi(inner)
				out = append(out, seg{kind: "idx", i: n})
			case qRe.MatchString(inner):
				out = append(out, seg{kind: "key", name: inner[1 : len(inner)-1]})
			default:
				return nil, bad
			}
		default:
			n, err := name()
			if err != nil {
				return nil, err
			}
			out = append(out, seg{kind: "key", name: n})
		}
	}
	return out, nil
}

// Query: valores achados e se o caminho pode dar vários (* ou ..)
func Query(v any, path string) ([]any, bool, error) {
	segs, err := parse(path)
	if err != nil {
		return nil, false, err
	}
	cur := []any{v}
	var deep func(x any, key string, acc *[]any)
	deep = func(x any, key string, acc *[]any) {
		switch t := x.(type) {
		case []any:
			for _, e := range t {
				deep(e, key, acc)
			}
		case *doc.Doc:
			for _, k := range t.Keys() {
				if k == key {
					*acc = append(*acc, t.Get(k))
				}
				deep(t.Get(k), key, acc)
			}
		}
	}
	many := false
	for _, s := range segs {
		next := []any{}
		for _, x := range cur {
			switch s.kind {
			case "key":
				if d, ok := x.(*doc.Doc); ok && d.Has(s.name) {
					next = append(next, d.Get(s.name))
				}
			case "idx":
				if l, ok := x.([]any); ok {
					j := s.i
					if j < 0 {
						j += len(l)
					}
					if j >= 0 && j < len(l) {
						next = append(next, l[j])
					}
				}
			case "all":
				many = true
				switch t := x.(type) {
				case []any:
					next = append(next, t...)
				case *doc.Doc:
					for _, k := range t.Keys() {
						next = append(next, t.Get(k))
					}
				}
			case "deep":
				many = true
				deep(x, s.name, &next)
			}
		}
		cur = next
	}
	return cur, many, nil
}

// Text: valor como texto (string pura; o resto em JSON compacto)
func Text(v any) string {
	if s, ok := v.(string); ok {
		return s
	}
	b, _ := doc.Marshal(v)
	return string(b)
}
