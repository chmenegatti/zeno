package assert

import (
	"reflect"
	"strings"
	"testing"

	"github.com/chmenegatti/zeno/wails/internal/doc"
)

func a(source, op, value, path string) *doc.Doc {
	d := doc.New("enabled", true, "source", source)
	if path != "" {
		d.Set("path", path)
	}
	d.Set("op", op)
	if value != "" {
		d.Set("value", value)
	}
	return d
}

// mesmos casos de test/runner.test.ts ("cada operador")
func TestCadaOperador(t *testing.T) {
	res := doc.New("status", int64(201), "headers", []any{[]any{"Content-Type", "application/json; charset=utf-8"}},
		"body", `{"user":{"id":7,"tags":["a","b"]},"n":null}`, "bodyEncoding", "utf8", "timing", doc.New("headersMs", int64(1), "totalMs", int64(120)))
	off := a("status", "eq", "999", "")
	off.Set("enabled", false)
	r := Evaluate([]any{
		a("status", "eq", "201", ""),
		a("status", "lt", "300", ""),
		a("header", "contains", "json", "content-type"),
		a("header", "notExists", "", "x-nada"),
		a("json", "eq", "7", "$.user.id"),
		a("json", "eq", `["a","b"]`, "$.user.tags"),
		a("json", "contains", "b", "$.user.tags"),
		a("json", "eq", "null", "$.n"),
		a("json", "exists", "", "$.user"),
		a("body", "matches", `"id":\d+`, ""),
		a("time", "lt", "{{ limite }}", ""),
		a("status", "eq", "200", ""),
		a("json", "exists", "", "$.user.email"),
		off,
	}, res, func(s string) string { return strings.ReplaceAll(s, "{{ limite }}", "500") })
	var oks []bool
	for _, x := range r {
		oks = append(oks, x.OK)
	}
	if !reflect.DeepEqual(oks, []bool{true, true, true, true, true, true, true, true, true, true, true, false, false}) {
		t.Fatalf("oks: %v", oks)
	}
	if r[11].Name != "status = 200" || r[11].Error != "valor: 201" {
		t.Errorf("r11: %+v", r[11])
	}
	if r[12].Name != "$.user.email existe" || r[12].Error != "não encontrado" {
		t.Errorf("r12: %+v", r[12])
	}
	if r[10].Name != "tempo (ms) < 500" {
		t.Errorf("nome com variável resolvida: %q", r[10].Name)
	}
}

func TestJSONInvalidoViraFalha(t *testing.T) {
	for _, body := range []string{"<html>", `{"a":1} lixo`} {
		r := Evaluate([]any{a("json", "exists", "", "$.a")}, doc.New("body", body, "bodyEncoding", "utf8"), nil)
		if len(r) != 1 || r[0].OK || r[0].Error != "resposta não é JSON" {
			t.Errorf("%q: %+v", body, r)
		}
	}
}

// resposta recém-enviada guarda headers como [][2]string
func TestHeaderDoEnvio(t *testing.T) {
	res := doc.New("status", int64(200), "headers", [][2]string{{"Content-Type", "text/plain"}, {"X-Req", "/echo"}}, "body", "", "bodyEncoding", "utf8")
	r := Evaluate([]any{
		doc.New("enabled", true, "source", "header", "op", "contains", "value", "text/plain", "path", "content-type"),
		doc.New("enabled", true, "source", "header", "op", "eq", "value", "/echo", "path", "x-req"),
	}, res, func(s string) string { return s })
	for _, x := range r {
		if !x.OK {
			t.Errorf("%+v", x)
		}
	}
}
