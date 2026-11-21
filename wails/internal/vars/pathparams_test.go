package vars

import (
	"reflect"
	"testing"

	"github.com/chmenegatti/zeno/wails/internal/doc"
)

// mesmos casos de test/pathparams.test.ts
func TestPathParamNames(t *testing.T) {
	cases := map[string][]string{
		"https://api.x.com:8443/users/:id/posts/{postId}?q=:nao#:nem": {"id", "postId"},
		"{{ base_url }}/users/:id":                                    {"id"},
		"localhost:3000/users/:userId":                                {"userId"},
		"/v{version}/items/:id/:id":                                   {"version", "id"},
		"{{ base }}/a/{{ id }}/b":                                     nil,
		"{{ base }}/{% uuid 'v4' %}/x":                                nil,
		"https://x.com/time/10:30/:1abc":                              nil,
		"":                                                            nil,
	}
	for in, want := range cases {
		if got := PathParamNames(in); !reflect.DeepEqual(got, want) {
			t.Errorf("%q: %v, quer %v", in, got, want)
		}
	}
}

func TestReplacePathParams(t *testing.T) {
	vals := map[string]string{"id": "42", "postId": "{{ post }}"}
	got := ReplacePathParams("{{ base }}/users/:id/posts/{postId}/c/:outro?x=:id", func(n string) (string, bool) { v, ok := vals[n]; return v, ok })
	if want := "{{ base }}/users/42/posts/{{ post }}/c/:outro?x=:id"; got != want {
		t.Errorf("%q, quer %q", got, want)
	}
}

// mesmo caso de "prepare com parâmetros de caminho" em test/pathparams.test.ts
func TestPreparePathParams(t *testing.T) {
	ws := doc.New("settings", doc.New(), "environments", []any{doc.New("id", "e", "name", "Base", "parentId", nil, "data", doc.New("base", "https://api.x", "uid", "7"))})
	req := doc.New("id", "r", "method", "GET", "url", "{{ base }}/users/:id/posts/{post}",
		"params", []any{doc.New("name", "q", "value", "1", "enabled", true)},
		"pathParams", []any{doc.New("name", "id", "value", "{{ uid }}")},
		"body", doc.New("mime", nil), "auth", doc.New("type", "none"))
	if p := Prepare(ws, req, nil, "", nil); p.URL != "https://api.x/users/7/posts/{post}?q=1" {
		t.Errorf("%q", p.URL)
	}
}
