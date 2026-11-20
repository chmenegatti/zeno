package doc

import (
	"os"
	"path/filepath"
	"testing"
)

// testdata/in*.json e js*.yaml: gerados pela biblioteca `yaml` do Electron (testdata/gen.mjs)
func TestEncodeIgualAoElectron(t *testing.T) {
	ins, _ := filepath.Glob("testdata/in*.json")
	if len(ins) == 0 {
		t.Fatal("sem fixtures")
	}
	for _, in := range ins {
		raw, _ := os.ReadFile(in)
		v, err := FromJSON(raw)
		if err != nil {
			t.Fatal(err)
		}
		want, _ := os.ReadFile(filepath.Join("testdata", "js"+in[len("testdata/in"):len(in)-len(".json")]+".yaml"))
		if got := string(EncodeYAML(v)); got != string(want) {
			t.Errorf("%s:\n--- Go\n%s\n--- Electron\n%s", in, got, want)
		}
	}
}

// ler o YAML do Electron e gravar de novo dá o mesmo arquivo
func TestIdaEVolta(t *testing.T) {
	ys, _ := filepath.Glob("testdata/js*.yaml")
	for _, y := range ys {
		raw, _ := os.ReadFile(y)
		v, err := ParseYAML(raw)
		if err != nil {
			t.Fatal(err)
		}
		if got := string(EncodeYAML(v)); got != string(raw) {
			t.Errorf("%s:\n--- Go\n%s\n--- original\n%s", y, got, raw)
		}
	}
}

func TestFromJSONRecusaTextoDepois(t *testing.T) {
	for _, bad := range []string{`{"a":1} xyz`, `[1]]`, `1 2`, ``} {
		if _, err := FromJSON([]byte(bad)); err == nil {
			t.Errorf("%q deveria falhar", bad)
		}
	}
	if v, err := FromJSON([]byte(" {\"a\":1}\n ")); err != nil || v.(*Doc).Get("a") != int64(1) {
		t.Errorf("espaços em volta: %v %v", v, err)
	}
}

// "billion laughs": âncoras em cascata não explodem a memória
func TestAliasesLimitados(t *testing.T) {
	y := "a: &a [x, x, x, x, x, x, x, x, x, x]\nb: &b [*a, *a, *a, *a, *a, *a, *a, *a, *a, *a]\nc: &c [*b, *b, *b, *b, *b, *b, *b, *b, *b, *b]\nd: &d [*c, *c, *c, *c, *c, *c, *c, *c, *c, *c]\ne: [*d, *d, *d, *d, *d, *d, *d, *d, *d, *d]\n"
	if _, err := ParseYAML([]byte(y)); err == nil {
		t.Error("deveria recusar")
	}
	ok := "base: &b { a: 1 }\nx: *b\ny: *b\n"
	if v, err := ParseYAML([]byte(ok)); err != nil || v.(*Doc).Map("y").Get("a") != int64(1) {
		t.Errorf("alias normal: %v %v", v, err)
	}
}
