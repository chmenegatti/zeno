package exporters

import (
	"archive/zip"
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"

	"github.com/chmenegatti/zeno/wails/internal/doc"
	"github.com/chmenegatti/zeno/wails/internal/importers"
)

// workspace de exemplo com o que os dois formatos sabem guardar
func sample() *Doc {
	ws, err := doc.FromJSON([]byte(`{
  "id": "wrk_loja", "name": "Loja", "description": "API da loja",
  "settings": {"insecureTLS": false, "timeoutMs": 30000},
  "environments": [
    {"id": "env_base", "name": "Base", "parentId": null, "data": {"base": "https://loja.test", "user": "ana"}, "sortKey": 0},
    {"id": "env_prod", "name": "Produção", "parentId": "env_base", "data": {"base": "https://loja.com"}, "sortKey": 1}
  ],
  "children": [
    {"kind": "folder", "id": "fld_api", "name": "API", "sortKey": 0, "headers": [], "auth": {"type": "bearer", "token": "{{ token }}"}, "vars": {"v": "1"},
     "scripts": {"pre": "console.log(1)"},
     "children": [
       {"kind": "request", "id": "req_listar", "name": "Listar", "method": "GET", "url": "{{ base }}/itens",
        "params": [{"name": "q", "value": "{{ user }}", "enabled": true}, {"name": "off", "value": "1", "enabled": false}],
        "headers": [{"name": "X-A", "value": "a", "enabled": true}], "body": {"mime": null}, "auth": {"type": "inherit"}, "sortKey": 0},
       {"kind": "request", "id": "req_criar", "name": "Criar", "method": "POST", "url": "{{ base }}/itens",
        "params": [], "headers": [], "body": {"mime": "application/json", "text": "{\"nome\": \"{{ user }}\"}"},
        "auth": {"type": "basic", "username": "ana", "password": "s3"}, "sortKey": 1}
     ]},
    {"kind": "request", "id": "req_gql", "name": "GraphQL", "method": "POST", "url": "{{ base }}/graphql", "params": [], "headers": [],
     "body": {"mime": "application/graphql", "text": "{\n  \"query\": \"query P { a }\",\n  \"variables\": {\n    \"id\": \"1\"\n  }\n}"},
     "auth": {"type": "oauth2", "grantType": "client_credentials", "tokenUrl": "https://auth.test/token", "clientId": "c", "clientSecret": "s", "scope": "ler"}, "sortKey": 1},
    {"kind": "request", "id": "req_form", "name": "Form", "method": "POST", "url": "{{ base }}/up", "params": [], "headers": [],
     "body": {"mime": "multipart/form-data", "fields": [{"name": "n", "value": "v", "enabled": true}, {"name": "arq", "value": "", "enabled": true, "file": "/tmp/a.png"}]},
     "auth": {"type": "apikey", "key": "k", "value": "K1", "addTo": "query"}, "sortKey": 2}
  ]
}`))
	if err != nil {
		panic(err)
	}
	return ws.(*Doc)
}

func norm(t *testing.T, v any) any {
	t.Helper()
	b, err := doc.Marshal(v)
	if err != nil {
		t.Fatal(err)
	}
	var out any
	if err := json.Unmarshal(b, &out); err != nil {
		t.Fatal(err)
	}
	return out
}

// tira ids (o Postman não guarda) e campos que um formato não tem
func strip(v any, keys ...string) any {
	switch t := v.(type) {
	case map[string]any:
		for _, k := range keys {
			delete(t, k)
		}
		for _, x := range t {
			strip(x, keys...)
		}
	case []any:
		for _, x := range t {
			strip(x, keys...)
		}
	}
	return v
}

func reimport(t *testing.T, name string, files map[string][]byte) importers.Result {
	t.Helper()
	var srcs []importers.Source
	for n, b := range files {
		srcs = append(srcs, importers.Source{Name: n, Text: string(b)})
	}
	r, err := importers.ParseSources(srcs, nil)
	if err != nil || len(r.Workspaces) != 1 {
		t.Fatalf("%s: reimportar: %v %d", name, err, len(r.Workspaces))
	}
	return r
}

func TestInsomniaIdaEVolta(t *testing.T) {
	ws := sample()
	r, err := Insomnia([]*Doc{ws})
	if err != nil || r.Name != "Loja.insomnia.json" {
		t.Fatal(err, r.Name)
	}
	back := reimport(t, "insomnia", map[string][]byte{r.Name: r.Data}).Workspaces[0]
	for _, k := range []string{"children", "environments"} {
		got, want := norm(t, back.Get(k)), norm(t, ws.Get(k))
		if !reflect.DeepEqual(got, want) {
			g, _ := json.MarshalIndent(got, "", " ")
			w, _ := json.MarshalIndent(want, "", " ")
			t.Errorf("%s diferente\n--- volta\n%s\n--- original\n%s", k, g, w)
		}
	}
	if back.Str("id") != "wrk_loja" || back.Str("description") != "API da loja" {
		t.Errorf("workspace %v", back)
	}
}

func TestPostmanIdaEVolta(t *testing.T) {
	ws := sample()
	r, err := Postman([]*Doc{ws})
	if err != nil || r.Name != "Loja.postman.zip" {
		t.Fatal(err, r.Name)
	}
	zr, err := zip.NewReader(bytes.NewReader(r.Data), int64(len(r.Data)))
	if err != nil {
		t.Fatal(err)
	}
	files := map[string][]byte{}
	for _, f := range zr.File {
		rc, _ := f.Open()
		var b bytes.Buffer
		b.ReadFrom(rc)
		rc.Close()
		files[f.Name] = b.Bytes()
	}
	if len(files) != 2 || files["Loja.postman_collection.json"] == nil || files["Loja - Produção.postman_environment.json"] == nil {
		t.Fatalf("arquivos %v", len(files))
	}
	back := reimport(t, "postman", files).Workspaces[0]
	// o Postman reescreve {{ x }} como {{x}}: compara normalizando
	sp := func(v any) any {
		b, _ := json.Marshal(v)
		s := strings.NewReplacer("{{ ", "{{", " }}", "}}").Replace(string(b))
		var out any
		json.Unmarshal([]byte(s), &out)
		return out
	}
	got := strip(sp(norm(t, back.Get("children"))), "id")
	want := strip(sp(norm(t, ws.Get("children"))), "id")
	if !reflect.DeepEqual(got, want) {
		g, _ := json.MarshalIndent(got, "", " ")
		w, _ := json.MarshalIndent(want, "", " ")
		t.Errorf("children diferente\n--- volta\n%s\n--- original\n%s", g, w)
	}
	envs := norm(t, back.Get("environments")).([]any)
	if len(envs) != 2 || envs[1].(map[string]any)["name"] != "Produção" || envs[0].(map[string]any)["data"].(map[string]any)["user"] != "ana" {
		t.Errorf("ambientes %v", envs)
	}
	// sem sub-ambientes: só a coleção
	ws.Set("environments", ws.List("environments")[:1])
	r, _ = Postman([]*Doc{ws})
	if r.Name != "Loja.postman_collection.json" || !json.Valid(r.Data) {
		t.Errorf("coleção sozinha: %s", r.Name)
	}
	if len(r.Warnings) == 0 {
		t.Error("scripts deveriam avisar")
	}
}

func TestZipEBlank(t *testing.T) {
	dir := t.TempDir()
	os.WriteFile(filepath.Join(dir, "workspace.yaml"), []byte("id: wrk_a\nname: A\n"), 0o644)
	os.MkdirAll(filepath.Join(dir, ".git"), 0o755)
	os.WriteFile(filepath.Join(dir, ".git", "config"), []byte("x"), 0o644)
	os.WriteFile(filepath.Join(dir, "README.md"), []byte("x"), 0o644)
	ws := doc.New("id", "wrk_a", "name", "A", "location", doc.New("dir", dir))
	r, err := Zip([]*Doc{ws})
	if err != nil {
		t.Fatal(err)
	}
	zr, _ := zip.NewReader(bytes.NewReader(r.Data), int64(len(r.Data)))
	if len(zr.File) != 1 || zr.File[0].Name != filepath.Base(dir)+"/workspace.yaml" {
		t.Errorf("zip %v", zr.File)
	}
	v, n := Blank(doc.New("a", "$zeno$v1$abc", "l", []any{doc.New("value", "$zeno$v1$x")}, "b", "claro"))
	if n != 2 || v.(*Doc).Str("a") != "" || v.(*Doc).Str("b") != "claro" {
		t.Errorf("blank %v %d", v, n)
	}
}
