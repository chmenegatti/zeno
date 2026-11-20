package runner

import (
	"bytes"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"reflect"
	"strings"
	"testing"

	"github.com/chmenegatti/zeno/wails/internal/cookies"
	"github.com/chmenegatti/zeno/wails/internal/doc"
	"github.com/chmenegatti/zeno/wails/internal/engine"
	"github.com/chmenegatti/zeno/wails/internal/store"
	"github.com/chmenegatti/zeno/wails/internal/vault"
)

type fakeKey struct{}

func (fakeKey) Available() (bool, string, bool)  { return true, "test", false }
func (fakeKey) Protect(t string) ([]byte, error) { return []byte("P:" + t), nil }
func (fakeKey) Unprotect(b []byte) (string, error) {
	if !bytes.HasPrefix(b, []byte("P:")) {
		return "", errors.New("nope")
	}
	return string(b[2:]), nil
}

func server(t *testing.T) string {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		js := func(code int, body any) {
			w.Header().Set("content-type", "application/json")
			w.Header().Set("x-req", r.URL.RequestURI())
			w.WriteHeader(code)
			_ = json.NewEncoder(w).Encode(body)
		}
		switch r.URL.Path {
		case "/login":
			js(200, map[string]any{"token": "tk-123"})
		case "/me":
			if r.Header.Get("Authorization") == "Bearer tk-123" {
				js(200, map[string]any{"id": 7, "name": "Ana"})
			} else {
				js(401, map[string]any{"error": "sem token"})
			}
		case "/items":
			js(200, map[string]any{"items": []any{map[string]any{"id": 1, "tag": "a"}, map[string]any{"id": 2, "tag": "b"}}})
		case "/echo":
			js(200, map[string]any{"q": r.URL.Query().Get("q")})
		case "/text":
			w.Header().Set("content-type", "text/plain")
			w.Write([]byte("olá mundo"))
		default:
			js(404, map[string]any{"error": "nada"})
		}
	}))
	t.Cleanup(srv.Close)
	return srv.URL
}

func a(source, op, value, path string) any {
	d := doc.New("enabled", true, "source", source, "op", op)
	if value != "" {
		d.Set("value", value)
	}
	if path != "" {
		d.Set("path", path)
	}
	return d
}

type env struct {
	st       *store.Store
	eng      *engine.Engine
	wsID     string
	folderID string
}

func (e env) exec(ws, req *Doc, envID string, extra *Doc) (*Doc, error) {
	return e.eng.ExecuteWith(ws, req, envID, 0, extra)
}

// workspace "Loja" com pasta "API" e os requests dados (em ordem)
func setup(t *testing.T, base string, reqs []*Doc) env {
	dir := t.TempDir()
	st := store.New(dir)
	st.Load()
	list, err := st.CreateWorkspace("Loja")
	if err != nil {
		t.Fatal(err)
	}
	ws := list[0]
	for _, e := range ws.List("environments") {
		e := e.(*Doc)
		if e.Get("parentId") == nil {
			e = e.Clone()
			e.Set("data", doc.New("base_url", base))
			if _, err := st.SaveEnvironment(ws.Str("id"), e); err != nil {
				t.Fatal(err)
			}
		}
	}
	_, folderID, err := st.CreateFolder(ws.Str("id"), "API", 0)
	if err != nil {
		t.Fatal(err)
	}
	for i, r := range reqs {
		_, id, err := st.CreateRequest(folderID, r.Str("name"), float64(i))
		if err != nil {
			t.Fatal(err)
		}
		cur, _ := doc.Find(st.Workspace(ws.Str("id")), id)
		d := cur.Clone()
		for _, k := range r.Keys() {
			d.Set(k, r.Get(k))
		}
		d.Set("id", id)
		d.Set("sortKey", int64(i))
		if err := st.SaveRequest(d); err != nil {
			t.Fatal(err)
		}
	}
	eng := &engine.Engine{Store: st, Cookies: cookies.New(dir), Vault: vault.New(dir, fakeKey{})}
	return env{st: st, eng: eng, wsID: ws.Str("id"), folderID: folderID}
}

func req(kv ...any) *Doc { return doc.New(kv...) }

func eq(t *testing.T, got, want any) {
	t.Helper()
	if !reflect.DeepEqual(got, want) {
		gb, _ := json.Marshal(got)
		wb, _ := json.Marshal(want)
		t.Fatalf("\n got: %s\nwant: %s", gb, wb)
	}
}

func oks(s *Doc) []bool {
	out := []bool{}
	for _, x := range s.List("tests") {
		out = append(out, x.(*Doc).Get("ok") == true)
	}
	return out
}

func TestDados(t *testing.T) {
	eq(t, ParseCSV("a,b\n\"x, y\",\"com \"\"aspas\"\"\"\n"), [][]string{{"a", "b"}, {"x, y", `com "aspas"`}, {""}})
	rows, err := ParseData("nome;idade\r\nAna;30\r\nBia;\"4\n0\"\r\n", "")
	if err != nil {
		t.Fatal(err)
	}
	b, _ := json.Marshal(rows)
	eq(t, string(b), `[{"nome":"Ana","idade":"30"},{"nome":"Bia","idade":"4\n0"}]`)
	rows, _ = ParseData(`[{"q":1},{"q":2}]`, "d.json")
	b, _ = json.Marshal(rows)
	eq(t, string(b), `[{"q":1},{"q":2}]`)
	if _, err := ParseData("[1,2]", "d.json"); err == nil || !strings.Contains(err.Error(), "lista de objetos") {
		t.Fatalf("erro: %v", err)
	}
	rows, _ = ParseData("\ufeff  ", "")
	eq(t, len(rows), 0)
}

func TestColecao(t *testing.T) {
	base := server(t)
	reqs := []*Doc{
		req("name", "login", "method", "POST", "url", "{{ base_url }}/login", "scripts", doc.New("post", "zeno.environment.set('token', zeno.response.json().token)"), "assertions", []any{a("status", "eq", "200", ""), a("json", "exists", "", "$.token")}),
		req("name", "me", "url", "{{ base_url }}/me", "auth", doc.New("type", "bearer", "token", "{{ token }}"), "assertions", []any{a("status", "eq", "200", ""), a("json", "eq", "Ana", "$.name")}),
		req("name", "items", "url", "{{ base_url }}/items", "assertions", []any{a("json", "eq", "[1,2]", "$.items[*].id")}),
		req("name", "texto", "url", "{{ base_url }}/text", "assertions", []any{a("body", "contains", "mundo", ""), a("header", "contains", "text/plain", "Content-Type")}),
		req("name", "echo", "url", "{{ base_url }}/echo?q=oi", "assertions", []any{a("json", "eq", "oi", "$.q")}),
		req("name", "tempo", "url", "{{ base_url }}/items", "assertions", []any{a("time", "lt", "5000", "")}),
		req("name", "404", "url", "{{ base_url }}/nada", "assertions", []any{a("status", "eq", "200", "")}),
		req("name", "script", "url", "{{ base_url }}/items", "scripts", doc.New("post", "zeno.test('dois itens', () => zeno.expect(zeno.response.json().items).to.have.lengthOf(2))")),
		req("name", "sem testes", "url", "{{ base_url }}/items"),
		req("name", "header", "url", "{{ base_url }}/echo", "assertions", []any{a("header", "eq", "/echo", "x-req")}),
	}
	e := setup(t, base, reqs)
	seen := []string{}
	rep, err := Run(e.exec, e.st, Options{WsID: e.wsID, FolderID: e.folderID, Iterations: 1}, func(s *Doc, _, total int) {
		seen = append(seen, s.Str("name"))
		if total != 10 {
			t.Errorf("total %d", total)
		}
	}, nil)
	if err != nil {
		t.Fatal(err)
	}
	names := []string{}
	for _, r := range reqs {
		names = append(names, r.Str("name"))
	}
	eq(t, seen, names)
	type row struct {
		Name   string
		Status any
		Oks    []bool
	}
	got := []row{}
	for _, x := range rep.List("steps") {
		s := x.(*Doc)
		got = append(got, row{s.Str("name"), s.Get("status"), oks(s)})
	}
	eq(t, got, []row{
		{"login", 200, []bool{true, true}},
		{"me", 200, []bool{true, true}},
		{"items", 200, []bool{true}},
		{"texto", 200, []bool{true, true}},
		{"echo", 200, []bool{true}},
		{"tempo", 200, []bool{true}},
		{"404", 404, []bool{false}},
		{"script", 200, []bool{true}},
		{"sem testes", 200, []bool{}},
		{"header", 200, []bool{true}},
	})
	eq(t, []any{rep.Get("passed"), rep.Get("failed")}, []any{9, 1})
	// token gravado cifrado (nome parece segredo)
	for _, x := range e.st.Workspace(e.wsID).List("environments") {
		d := x.(*Doc)
		if d.Get("parentId") == nil {
			if !strings.HasPrefix(d.Map("data").Str("token"), "$zeno$") || d.Map("data").Str("base_url") != base {
				t.Errorf("ambiente: %v", d.Map("data"))
			}
		}
	}
	xml := ToJUnit(rep)
	for _, want := range []string{`<testsuites name="API" tests="10" failures="1"`, `<testcase classname="API" name="404"`, `<failure message="status = 200: valor: 404">`} {
		if !strings.Contains(xml, want) {
			t.Errorf("JUnit sem %s:\n%s", want, xml)
		}
	}
}

func TestIteracoesBailCancelar(t *testing.T) {
	base := server(t)
	e := setup(t, base, []*Doc{
		req("name", "echo", "url", "{{ base_url }}/echo?q={{ q }}", "assertions", []any{a("json", "eq", "{{ esperado }}", "$.q")}),
		req("name", "items", "url", "{{ base_url }}/items"),
	})
	data, _ := ParseData("q,esperado\nx,x\ny,z\n", "")
	r, err := Run(e.exec, e.st, Options{WsID: e.wsID, FolderID: e.folderID, Iterations: 1, DelayMs: 5, Data: data}, nil, nil)
	if err != nil {
		t.Fatal(err)
	}
	got := []string{}
	for _, x := range r.List("steps") {
		s := x.(*Doc)
		o := []string{}
		for _, b := range oks(s) {
			if b {
				o = append(o, "true")
			} else {
				o = append(o, "false")
			}
		}
		got = append(got, doc.AsStr(s.Get("iteration"))+":"+s.Str("name")+":"+strings.Join(o, ","))
	}
	eq(t, got, []string{"1:echo:true", "1:items:", "2:echo:false", "2:items:"})
	eq(t, r.List("steps")[2].(*Doc).List("tests")[0].(*Doc).Str("error"), "valor: y")

	bail, _ := Run(e.exec, e.st, Options{WsID: e.wsID, FolderID: e.folderID, Iterations: 3, Data: data, Bail: true}, nil, nil)
	eq(t, len(bail.List("steps")), 3)

	h := NewHandle()
	c, _ := Run(e.exec, e.st, Options{WsID: e.wsID, Iterations: 5, DelayMs: 60000}, func(*Doc, int, int) { h.Cancel() }, h)
	eq(t, []any{len(c.List("steps")), c.Get("cancelled")}, []any{1, true})

	// --var vale sobre a linha de dados
	v, _ := Run(e.exec, e.st, Options{WsID: e.wsID, FolderID: e.folderID, Iterations: 1, Data: data[:1], Vars: doc.New("esperado", "outro")}, nil, nil)
	eq(t, v.List("steps")[0].(*Doc).List("tests")[0].(*Doc).Str("error"), "valor: x")
}

func TestAvisosEVariaveisSemValor(t *testing.T) {
	e := setup(t, server(t), []*Doc{req("name", "x", "url", "{{ base_url }}/items?a={{ nada }}&b={% tag_inexistente %}")})
	r, err := Run(e.exec, e.st, Options{WsID: e.wsID, Iterations: 1}, nil, nil)
	if err != nil {
		t.Fatal(err)
	}
	s := r.List("steps")[0].(*Doc)
	b, _ := json.Marshal(s)
	if !strings.Contains(string(b), `"missing":["nada"]`) || !strings.Contains(string(b), `"warnings":["`) {
		t.Errorf("passo sem missing/warnings: %s", b)
	}
}

func TestOrdem(t *testing.T) {
	e := setup(t, "http://x", []*Doc{req("name", "b"), req("name", "a")})
	got := []string{}
	for _, it := range Collect(e.st.Workspace(e.wsID).List("children"), nil) {
		got = append(got, it.Path+":"+it.Req.Str("name"))
	}
	eq(t, got, []string{"API:b", "API:a"})
	if _, err := Run(e.exec, e.st, Options{WsID: "nada"}, nil, nil); err == nil {
		t.Error("workspace inexistente")
	}
	if _, err := Run(e.exec, e.st, Options{WsID: e.wsID, FolderID: "nada"}, nil, nil); err == nil || err.Error() != "pasta não encontrada" {
		t.Errorf("pasta: %v", err)
	}
}

// JUnit idêntico ao do Electron (testdata/junit.xml gerado por testdata/gen.ts)
func TestJUnitIgualElectron(t *testing.T) {
	in, err := os.ReadFile("testdata/report.json")
	if err != nil {
		t.Fatal(err)
	}
	want, err := os.ReadFile("testdata/junit.xml")
	if err != nil {
		t.Fatal(err)
	}
	r, err := doc.FromJSON(in)
	if err != nil {
		t.Fatal(err)
	}
	if got := ToJUnit(r.(*Doc)); got != string(want) {
		t.Fatalf("got:\n%s\nwant:\n%s", got, want)
	}
}

func TestToFixed(t *testing.T) {
	for x, want := range map[float64]string{0.0625: "0.063", 0.0005: "0.001", 1.0005: "1.000", 0: "0.000", 12.3456: "12.346", 0.1235: "0.123"} {
		if got := toFixed(x, 3); got != want {
			t.Errorf("toFixed(%v) = %s, want %s", x, got, want)
		}
	}
}
