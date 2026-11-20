package importers

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/chmenegatti/zeno/wails/internal/doc"
	"github.com/chmenegatti/zeno/wails/internal/store"
)

func src(name, url string) Source {
	b, _ := os.ReadFile(filepath.Join("testdata", name))
	return Source{Name: name, Text: string(b), URL: url}
}

// compara com testdata/golden/<nome>.json (saída dos importadores do Electron até a 0.7; referência fixa)
func golden(t *testing.T, name string, r Result, err error) {
	t.Helper()
	want, _ := os.ReadFile(filepath.Join("testdata", "golden", name+".json"))
	var got []byte
	if err != nil {
		got, _ = doc.MarshalIndent(doc.New("error", err.Error()))
	} else {
		got, _ = doc.MarshalIndent(r.Doc())
	}
	got = append(got, '\n')
	// ZENO_UPDATE_GOLDEN=1: regrava (depois de revisar o diff no git)
	if os.Getenv("ZENO_UPDATE_GOLDEN") != "" {
		_ = os.WriteFile(filepath.Join("testdata", "golden", name+".json"), got, 0o644)
		return
	}
	if string(got) != string(want) {
		os.WriteFile(filepath.Join(t.TempDir(), name+".json"), got, 0o644)
		t.Errorf("%s diferente do Electron\n--- Go\n%s\n--- Electron\n%s", name, got, want)
	}
}

func TestIgualAoElectron(t *testing.T) {
	cases := map[string][]Source{
		"openapi":             {src("loja-openapi.yaml", "")},
		"swagger":             {src("loja-swagger.json", "")},
		"postman":             {src("loja.postman_collection.json", ""), src("producao.postman_environment.json", "")},
		"postman-env-sozinho": {src("producao.postman_environment.json", "")},
		"insomnia-v5":         {src("loja.insomnia-v5.yaml", "")},
		"relativo":            {{Name: "r", Text: "openapi: 3.0.0\ninfo: { title: R }\nservers: [{ url: /api/v3 }]\npaths: {}", URL: "https://x.test/docs/openapi.yaml"}},
		"desconhecido":        {{Name: "x.json", Text: `{"a":1}`}},
		"v4":                  {{Name: "v4.json", Text: `{"_type":"export","__export_format":4,"resources":[{"_id":"wrk_a","_type":"workspace","name":"A"},{"_id":"req_a","_type":"request","parentId":"wrk_a","name":"R","method":"post","url":"http://x","body":{"mimeType":"multipart/form-data","params":[{"name":"f","type":"file","fileName":"/tmp/a"},{"name":"n","value":"v","disabled":true}]},"authentication":{"type":"apikey","key":"k","value":"v","addTo":"cookie"},"settingSendCookies":false}]}`}},
	}
	for name, srcs := range cases {
		t.Run(name, func(t *testing.T) {
			r, err := ParseSources(srcs, nil)
			golden(t, name, r, err)
		})
	}
}

func TestNedbIgualAoElectron(t *testing.T) {
	docs, err := ReadNedbDir(filepath.Join("testdata", "nedb"))
	if err != nil {
		t.Fatal(err)
	}
	golden(t, "nedb", Convert(docs, false), nil)
	golden(t, "nedb-tls", Convert(docs, true), nil)
}

func TestYAMLInvalido(t *testing.T) {
	// a mensagem da biblioteca YAML é outra; o começo é o mesmo do Electron
	_, err := ParseSources([]Source{{Name: "x.yaml", Text: "a: ["}}, nil)
	if err == nil || !strings.HasPrefix(err.Error(), "x.yaml: não é JSON nem YAML válido (") {
		t.Errorf("%v", err)
	}
}

func TestImportadorDePlugin(t *testing.T) {
	ext := []Extra{{Name: "CSV", Detect: func(s string) bool { return strings.HasPrefix(s, "nome,") }, Convert: func(string) (any, error) {
		return doc.FromJSON([]byte(`{"_type":"export","__export_format":4,"resources":[{"_id":"wrk_csv","_type":"workspace","name":"CSV"},{"_id":"r1","_type":"request","parentId":"wrk_csv","name":"Listar","method":"GET","url":"http://a"}]}`))
	}}}
	r, err := ParseSources([]Source{{Name: "a.csv", Text: "nome,metodo,url\n"}}, ext)
	if err != nil || r.Workspaces[0].Str("name") != "CSV" || len(r.Workspaces[0].List("children")) != 1 {
		t.Errorf("%v %v", r, err)
	}
}

// import grava e recarrega igual (round-trip no store), como no test/import-sources.test.ts
func TestIdaEVoltaNoStore(t *testing.T) {
	r, err := ParseSources([]Source{src("loja-openapi.yaml", ""), src("loja-swagger.json", ""), src("loja.postman_collection.json", ""), src("loja.insomnia-v5.yaml", "")}, nil)
	if err != nil || len(r.Workspaces) != 4 {
		t.Fatal(len(r.Workspaces), err)
	}
	st := store.New(t.TempDir())
	for _, w := range r.Workspaces {
		if err := st.WriteWorkspace(w); err != nil {
			t.Fatal(err)
		}
	}
	loaded := st.Load()
	for _, w := range r.Workspaces {
		var back *doc.Doc
		for _, l := range loaded {
			if l.Str("id") == w.Str("id") {
				back = l.Clone()
			}
		}
		back.Del("location")
		a, _ := doc.Marshal(w)
		b, _ := doc.Marshal(back)
		if string(a) != string(b) {
			t.Errorf("%s mudou ao gravar e reler\n%s\n%s", w.Str("name"), a, b)
		}
	}
}

// tags do Zeno não geram aviso; as outras dizem qual (mesmo texto do Electron)
func TestUnknownTags(t *testing.T) {
	if got := unknownTags([]string{"https://x/{% uuid 'v4' %}/{% response 'body', 'req_1', '', 'never' %}", "{% timestamp 'unix' %}"}); len(got) != 0 {
		t.Errorf("conhecidas: %v", got)
	}
	// {% %} vazio não derruba a importação
	if got := unknownTags([]string{"https://x/{% %}"}); len(got) != 1 {
		t.Errorf("vazia: %v", got)
	}
	got := unknownTags([]string{"https://x/{% minha_tag 'a' %}/{% outra %}", "{% minha_tag 'b' %}"})
	if strings.Join(got, ", ") != "{% minha_tag %}, {% outra %}" {
		t.Errorf("desconhecidas: %v", got)
	}
}

func TestInsomniaWebSocket(t *testing.T) {
	r, err := ParseSources([]Source{{Name: "v4.json", Text: `{"_type":"export","__export_format":4,"resources":[{"_id":"wrk_a","_type":"workspace","name":"A"},{"_id":"ws-req_1","_type":"websocket_request","parentId":"wrk_a","name":"Eco","url":"wss://eco.test/ws","headers":[{"name":"X","value":"1"}],"authentication":{"type":"bearer","token":"t"}}]}`}}, nil)
	if err != nil || len(r.Workspaces) != 1 {
		t.Fatal(err)
	}
	req, _ := doc.Find(r.Workspaces[0], "ws-req_1")
	if req == nil || req.Str("url") != "wss://eco.test/ws" || req.Map("auth").Str("token") != "t" || len(req.List("headers")) != 1 {
		t.Fatalf("%v", req)
	}
}

func TestInsomniaGrpc(t *testing.T) {
	r, err := ParseSources([]Source{{Name: "v4.json", Text: `{"_type":"export","__export_format":4,"resources":[{"_id":"wrk_a","_type":"workspace","name":"A"},{"_id":"greq_1","_type":"grpc_request","parentId":"wrk_a","name":"Produto","url":"localhost:50051","protoMethodName":"/loja.Loja/ObterProduto","body":{"text":"{\"id\":\"1\"}"},"metadata":[{"name":"x-t","value":"1"}],"protoFileId":"pf_1"}]}`}}, nil)
	if err != nil || len(r.Workspaces) != 1 {
		t.Fatal(err)
	}
	req, _ := doc.Find(r.Workspaces[0], "greq_1")
	if req == nil || req.Str("url") != "grpc://localhost:50051" || req.Map("grpc").Str("service") != "loja.Loja" || req.Map("grpc").Str("method") != "ObterProduto" ||
		req.Map("body").Str("text") != `{"id":"1"}` || len(req.List("headers")) != 1 || len(r.Warnings) != 1 {
		t.Fatalf("%v %v", req, r.Warnings)
	}
}
