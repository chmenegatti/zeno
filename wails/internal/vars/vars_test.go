package vars

import (
	"reflect"
	"testing"
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
	r := &renderer{vars: Doc{"X-API-Key": "k1", "a": Doc{"b.c": 2, "list": []any{10, 20}}, "base": "http://h", "url": "{{ base }}/v1"}, missing: map[string]bool{}, unsupported: map[string]bool{}}
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
	ws := Doc{
		"settings": Doc{"insecureTLS": false, "timeoutMs": 5000},
		"environments": []any{
			Doc{"id": "base", "parentId": nil, "data": Doc{"host": "api.local", "tk": "base-token"}},
			Doc{"id": "dev", "parentId": "base", "data": Doc{"tk": "dev-token"}},
		},
	}
	folder := Doc{"kind": "folder", "headers": []any{Doc{"name": "X-Pasta", "value": "1", "enabled": true}}, "auth": Doc{"type": "bearer", "token": "{{ tk }}"}, "vars": Doc{}}
	req := Doc{
		"id": "r1", "method": "POST", "url": "{{ host }}/itens",
		"params":  []any{Doc{"name": "q", "value": "a b", "enabled": true}},
		"headers": []any{Doc{"name": "X-Req", "value": "2", "enabled": true}},
		"body":    Doc{"mime": "application/json", "text": `{"x":1}`},
		"auth":    Doc{"type": "inherit"},
	}
	p := Prepare(ws, req, []Doc{folder}, "dev")
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
