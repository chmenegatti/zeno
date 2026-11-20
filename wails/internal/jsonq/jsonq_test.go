package jsonq

import (
	"testing"

	"github.com/chmenegatti/zeno/wails/internal/doc"
)

func TestQuery(t *testing.T) {
	v, _ := doc.FromJSON([]byte(`{"a":{"b":[10,{"c":"x"}]},"it's":1,"lista":[{"id":1},{"id":2}],"n":{"id":3}}`))
	cases := []struct {
		path string
		want string
	}{
		{"$.a.b[0]", "[10]"},
		{"$.a.b[-1].c", `["x"]`},
		{"$['it\\'s']", "[1]"},
		{"$.lista[*].id", "[1,2]"},
		{"$..id", "[1,2,3]"},
		{"a.b[1]", `[{"c":"x"}]`},
		{"$.nada", "[]"},
	}
	for _, c := range cases {
		got, _, err := Query(v, c.path)
		if err != nil {
			t.Fatal(c.path, err)
		}
		if b, _ := doc.Marshal(got); string(b) != c.want {
			t.Errorf("%s = %s, quer %s", c.path, b, c.want)
		}
	}
	if _, _, err := Query(v, "$.a[x"); err == nil {
		t.Error("caminho inválido deveria dar erro")
	}
}
