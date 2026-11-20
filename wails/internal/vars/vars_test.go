package vars

import (
	"reflect"
	"testing"

	"github.com/chmenegatti/zeno/wails/internal/doc"
)

func TestPath(t *testing.T) {
	cases := map[string][]string{
		"nome":           {"nome"},
		"_.a.b":          {"a", "b"},
		"_['X-API-Key']": {"X-API-Key"},
		`_["X-API-Key"]`: {"X-API-Key"},
		"_.a['b.c']":     {"a", "b.c"},
		"a.list[1]":      {"a", "list", "1"},
		"_":              {"_"},
	}
	for in, want := range cases {
		if got := Path(in); !reflect.DeepEqual(got, want) {
			t.Errorf("Path(%q) = %v, quer %v", in, got, want)
		}
	}
}

func TestRender(t *testing.T) {
	r := &renderer{vars: doc.New("X-API-Key", "k1", "a", doc.New("b.c", int64(2), "list", []any{int64(10), int64(20)}), "base", "http://h", "url", "{{ base }}/v1"), missing: map[string]bool{}, unsupported: map[string]bool{}}
	cases := map[string]string{
		"{{ _['X-API-Key'] }}": "k1",
		"{{ _.a['b.c'] }}":     "2",
		"{{ a.list[1] }}":      "20",
		"{{ url }}/x":          "http://h/v1/x",
		"{{ falta }}":          "{{ falta }}",
		"sem variável":         "sem variável",
	}
	for in, want := range cases {
		if got := r.render(in, 0); got != want {
			t.Errorf("render(%q) = %q, quer %q", in, got, want)
		}
	}
	if !r.missing["falta"] {
		t.Error("falta deveria estar em missing")
	}
}

func TestPrepareHerdaAuthEHeaders(t *testing.T) {
	ws := doc.New(
		"settings", doc.New("insecureTLS", false, "timeoutMs", int64(5000)),
		"environments", []any{
			doc.New("id", "base", "parentId", nil, "data", doc.New("host", "api.local", "tk", "base-token")),
			doc.New("id", "dev", "parentId", "base", "data", doc.New("tk", "dev-token")),
		},
	)
	folder := doc.New("kind", "folder", "headers", []any{doc.New("name", "X-Pasta", "value", "1", "enabled", true)}, "auth", doc.New("type", "bearer", "token", "{{ tk }}"), "vars", doc.New())
	req := doc.New(
		"id", "r1", "method", "POST", "url", "{{ host }}/itens",
		"params", []any{doc.New("name", "q", "value", "a b", "enabled", true)},
		"headers", []any{doc.New("name", "X-Req", "value", "2", "enabled", true)},
		"body", doc.New("mime", "application/json", "text", `{"x":1}`),
		"auth", doc.New("type", "inherit"),
	)
	p := Prepare(ws, req, []*Doc{folder}, "dev")
	if p.URL != "http://api.local/itens?q=a+b" {
		t.Errorf("URL = %q", p.URL)
	}
	want := [][2]string{{"X-Pasta", "1"}, {"X-Req", "2"}, {"Authorization", "Bearer dev-token"}, {"Content-Type", "application/json"}}
	if !reflect.DeepEqual(p.Headers, want) {
		t.Errorf("Headers = %v", p.Headers)
	}
	if p.BodyKind != "text" || p.Text != `{"x":1}` || p.TimeoutMs != 5000 {
		t.Errorf("body/timeout: %+v", p)
	}
}
