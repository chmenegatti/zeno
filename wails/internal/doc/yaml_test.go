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
