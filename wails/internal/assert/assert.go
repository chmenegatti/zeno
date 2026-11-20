// Package assert: asserções sem código (status, header, JSONPath, body e tempo), port de
// src/shared/assert.ts. Viram testes na mesma aba dos scripts.
package assert

import (
	"regexp"
	"strconv"
	"strings"

	"github.com/chmenegatti/zeno/wails/internal/doc"
	"github.com/chmenegatti/zeno/wails/internal/jsonq"
)

// Test: resultado (ScriptTest do Electron)
type Test struct {
	Name  string `json:"name"`
	OK    bool   `json:"ok"`
	Error string `json:"error,omitempty"`
	Where string `json:"where"`
}

var opLabel = map[string]string{"eq": "=", "neq": "≠", "contains": "contém", "notContains": "não contém", "lt": "<", "gt": ">", "exists": "existe", "notExists": "não existe", "matches": "casa regex"}
var sourceLabel = map[string]string{"status": "status", "header": "header", "json": "JSON", "body": "body", "time": "tempo (ms)"}

func noValue(op string) bool { return op == "exists" || op == "notExists" }

// Name: "status = 200", "header content-type contém json", "$.id existe"…
func Name(source, path, op, value string) string {
	what := sourceLabel[source]
	if source == "header" || source == "json" {
		p := path
		if p == "" {
			p = "?"
		}
		if source == "header" {
			what = "header " + p
		} else {
			what = p
		}
	}
	if noValue(op) {
		return what + " " + opLabel[op]
	}
	return strings.TrimSpace(what + " " + opLabel[op] + " " + value)
}

func text(v any, found bool) string {
	if !found {
		return ""
	}
	return jsonq.Text(v)
}

func num(v any) float64 {
	switch x := v.(type) {
	case int64:
		return float64(x)
	case float64:
		return x
	case int:
		return float64(x)
	}
	f, err := strconv.ParseFloat(strings.TrimSpace(doc.AsStr(v)), 64)
	if err != nil {
		return nan()
	}
	return f
}

func nan() float64 { var z float64; return z / z }

func equal(actual any, expected string) bool {
	if text(actual, true) == expected {
		return true
	}
	switch actual.(type) {
	case int64, float64, int, bool, nil:
		return doc.AsStr(actual) == strings.TrimSpace(expected) || (actual == nil && strings.TrimSpace(expected) == "null")
	}
	// valor esperado escrito como JSON ("abc", {"a":1}) compara pelo conteúdo
	exp, err := doc.FromJSON([]byte(expected))
	if err != nil {
		return false
	}
	a, _ := doc.Marshal(actual)
	b, _ := doc.Marshal(exp)
	return string(a) == string(b)
}

func contains(actual any, expected string) bool {
	if l, ok := actual.([]any); ok {
		for _, x := range l {
			if equal(x, expected) {
				return true
			}
		}
		return false
	}
	return strings.Contains(text(actual, true), expected)
}

func clip(s string) string {
	r := []rune(s)
	if len(r) > 200 {
		return string(r[:200]) + "…"
	}
	return s
}

// Evaluate avalia as asserções ativas contra a resposta; resolve troca {{ variáveis }} no valor esperado
func Evaluate(assertions []any, res *doc.Doc, resolve func(string) string) []Test {
	if resolve == nil {
		resolve = func(s string) string { return s }
	}
	out := []Test{}
	var parsed any
	var parseErr error
	parsedDone := false
	jsonDoc := func() (any, error) {
		if !parsedDone {
			parsedDone = true
			body := ""
			if res.Str("bodyEncoding") == "utf8" {
				body = res.Str("body")
			}
			parsed, parseErr = doc.FromJSON([]byte(body))
			if parseErr != nil {
				parseErr = errText("resposta não é JSON")
			}
		}
		return parsed, parseErr
	}
	for _, x := range assertions {
		a, _ := x.(*doc.Doc)
		if a == nil || a.Get("enabled") == false {
			continue
		}
		source, path, op := a.Str("source"), a.Str("path"), a.Str("op")
		expected := resolve(a.Str("value"))
		name := Name(source, path, op, expected)
		var actual any
		found := true
		var err error
		switch source {
		case "status":
			actual = res.Get("status")
		case "time":
			actual = res.Map("timing").Get("totalMs")
		case "body":
			actual = ""
			if res.Str("bodyEncoding") == "utf8" {
				actual = res.Str("body")
			}
		case "header":
			key := strings.ToLower(strings.TrimSpace(path))
			var hs []string
			for _, h := range res.List("headers") {
				if p, ok := h.([]any); ok && len(p) == 2 && strings.ToLower(doc.AsStr(p[0])) == key {
					hs = append(hs, doc.AsStr(p[1]))
				}
			}
			found = len(hs) > 0
			actual = strings.Join(hs, ", ")
		case "json":
			var d any
			if d, err = jsonDoc(); err == nil {
				p := path
				if p == "" {
					p = "$"
				}
				var vals []any
				var many bool
				if vals, many, err = jsonq.Query(d, p); err == nil {
					found = len(vals) > 0
					if many {
						actual = vals
					} else if found {
						actual = vals[0]
					}
				}
			}
		}
		if err != nil {
			out = append(out, Test{Name: name, OK: false, Where: "asserção", Error: err.Error()})
			continue
		}
		var ok bool
		switch op {
		case "exists":
			ok = found
		case "notExists":
			ok = !found
		case "eq":
			ok = found && equal(actual, expected)
		case "neq":
			ok = !found || !equal(actual, expected)
		case "contains":
			ok = found && contains(actual, expected)
		case "notContains":
			ok = !found || !contains(actual, expected)
		case "lt":
			ok = found && num(actual) < num(expected)
		case "gt":
			ok = found && num(actual) > num(expected)
		case "matches":
			re, rerr := regexp.Compile(expected)
			if rerr != nil {
				out = append(out, Test{Name: name, OK: false, Where: "asserção", Error: "regex inválida: " + rerr.Error()})
				continue
			}
			ok = found && re.MatchString(text(actual, true))
		}
		t := Test{Name: name, OK: ok, Where: "asserção"}
		if !ok {
			if found {
				t.Error = "valor: " + clip(text(actual, true))
			} else {
				t.Error = "não encontrado"
			}
		}
		out = append(out, t)
	}
	return out
}

type errText string

func (e errText) Error() string { return string(e) }
