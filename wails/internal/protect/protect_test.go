package protect

import (
	"fmt"
	"reflect"
	"strings"
	"testing"

	"github.com/chmenegatti/zeno/wails/internal/doc"
)

func kv(name, value string) *Doc { return doc.New("name", name, "value", value, "enabled", true) }

func req(id string, kvs ...any) *Doc {
	r := doc.New("kind", "request", "id", id, "name", map[string]string{"r1": "R1", "r2": "R2", "r3": "R3"}[id], "method", "GET", "url", "",
		"params", []any{}, "headers", []any{}, "body", doc.New("mime", nil), "sortKey", int64(0), "auth", doc.New("type", "none"))
	for i := 0; i+1 < len(kvs); i += 2 {
		r.Set(kvs[i].(string), kvs[i+1])
	}
	return r
}

// mesmos casos de test/vault.test.ts (scanSecrets)
func TestScan(t *testing.T) {
	ws := doc.New("id", "w", "environments", []any{
		doc.New("id", "b", "name", "Base", "parentId", nil, "data", doc.New("password", "pw-123456", "token", "{{ a }}", "host", "h", "api_key", "$zeno$v1$x", "creds", doc.New("secret", "nested-s3cret"))),
		doc.New("id", "d", "name", "Dev", "parentId", "b", "data", doc.New("p-poc", "pw-123456", "user", "admin")),
	}, "children", []any{
		req("r1", "auth", doc.New("type", "basic", "username", "u", "password", "p")),
		req("r2", "auth", doc.New("type", "bearer", "token", "{{ t }}"), "headers", []any{kv("Authorization", "Bearer abc"), kv("Accept", "x")}),
		req("r3", "url", "http://h/login?pw=pw-123456"),
	})
	r := Scan(ws, nil)
	var labels []string
	for _, s := range r.Spots {
		labels = append(labels, s.Label)
	}
	want := []string{"Base · password", "Base · creds.secret", "R1 · auth basic", "R2 · header Authorization", "Dev · p-poc (mesmo valor de um segredo)"}
	if !reflect.DeepEqual(labels, want) {
		t.Errorf("labels:\n%v\n%v", labels, want)
	}
	if !reflect.DeepEqual(r.Spots[3].Path, Path{"headers", 0, "value"}) {
		t.Errorf("path: %v", r.Spots[3].Path)
	}
	if !reflect.DeepEqual(r.Warnings, []string{"R3 · URL"}) {
		t.Errorf("warnings: %v", r.Warnings)
	}
	if got := LiteralSecrets(ws); !reflect.DeepEqual(got, []string{"pw-123456", "nested-s3cret", "p", "Bearer abc"}) {
		t.Errorf("literais: %v", got)
	}
}

func TestSetGetAt(t *testing.T) {
	o := doc.New("data", doc.New("a", doc.New("b", int64(1))), "headers", []any{doc.New("value", "x")})
	SetAt(o, Path{"headers", 0, "value"}, "y")
	if GetAt(o, Path{"headers", 0, "value"}) != "y" || GetAt(o, Path{"data", "a", "b"}) != int64(1) {
		t.Error("setAt/getAt")
	}
}

// OAuth 2.0 (#9): client secret e senha literais aparecem pra proteger; com variável não
func TestScanOAuth2(t *testing.T) {
	ws := doc.New("environments", []any{}, "children", []any{
		doc.New("kind", "request", "id", "req_o", "name", "O", "headers", []any{},
			"auth", doc.New("type", "oauth2", "grantType", "password", "clientSecret", "s3gr3do", "password", "{{ senha }}")),
	})
	res := Scan(ws, nil)
	var got []string
	for _, s := range res.Spots {
		parts := make([]string, len(s.Path))
		for i, x := range s.Path {
			parts[i] = fmt.Sprint(x)
		}
		got = append(got, strings.Join(parts, "."))
	}
	if strings.Join(got, ",") != "auth.clientSecret" {
		t.Errorf("spots: %v", got)
	}
}
