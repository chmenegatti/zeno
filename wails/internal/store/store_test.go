package store

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/chmenegatti/zeno/wails/internal/doc"
)

func write(t *testing.T, p, s string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(p, []byte(s), 0o644); err != nil {
		t.Fatal(err)
	}
}

// pasta no formato gravado pelo Zeno em Electron
func fixture(t *testing.T) string {
	dir := t.TempDir()
	write(t, filepath.Join(dir, "loja/workspace.yaml"), "id: wrk_loja\nname: Loja\nsettings: { insecureTLS: true, timeoutMs: 1000 }\n")
	write(t, filepath.Join(dir, "loja/_env/base.yaml"), "id: env_base\nname: Base\nparentId: null\ndata:\n  host: api.local\n")
	write(t, filepath.Join(dir, "loja/_env/dev.yaml"), "id: env_dev\nname: Dev\nparentId: env_base\ncolor: \"#0f0\"\ndata: {}\nsortKey: 1\n")
	write(t, filepath.Join(dir, "loja/produtos/folder.yaml"), "id: fld_prod\nname: Produtos\nsortKey: 1\n")
	write(t, filepath.Join(dir, "loja/produtos/listar.yaml"), "id: req_listar\nname: Listar produtos\nmethod: get\nurl: \"{{ host }}/p\"\nsortKey: 2\nassertions:\n  - { enabled: true, source: status, op: lt, value: \"300\" }\n")
	write(t, filepath.Join(dir, "loja/produtos/criar.yaml"), "id: req_criar\nname: Criar produto\nmethod: POST\nsortKey: 1\n")
	write(t, filepath.Join(dir, "loja/login.yaml"), "id: req_login\nname: Login\nsortKey: 0\n")
	write(t, filepath.Join(dir, ".responses/x.json"), "[]")
	return dir
}

func TestLoad(t *testing.T) {
	s := New(fixture(t))
	wss := s.Load()
	if len(wss) != 1 {
		t.Fatalf("workspaces = %d", len(wss))
	}
	ws := wss[0]
	if doc.Str(ws, "name") != "Loja" || doc.Map(ws, "settings")["insecureTLS"] != true {
		t.Errorf("workspace: %v", ws)
	}
	if n := len(doc.List(ws, "environments")); n != 2 {
		t.Errorf("ambientes = %d", n)
	}
	ch := doc.List(ws, "children")
	// ordem por sortKey: login (0), pasta (1)
	if doc.Str(ch[0].(Doc), "id") != "req_login" || doc.Str(ch[1].(Doc), "id") != "fld_prod" {
		t.Errorf("ordem: %v %v", ch[0], ch[1])
	}
	req, anc := doc.Find(ws, "req_listar")
	if req == nil || len(anc) != 1 || doc.Str(req, "method") != "GET" || doc.Str(req, "kind") != "request" {
		t.Errorf("listar: %v (pastas %d)", req, len(anc))
	}
	// campo que o Go não conhece continua no documento
	if req["assertions"] == nil {
		t.Error("assertions sumiu")
	}
}

func TestSaveRequestRenomeiaArquivo(t *testing.T) {
	dir := fixture(t)
	s := New(dir)
	s.Load()
	req, _ := doc.Find(s.List()[0], "req_criar")
	next := Doc{}
	for k, v := range req {
		next[k] = v
	}
	next["name"] = "Cadastrar produto"
	next["url"] = "{{ host }}/p"
	if err := s.SaveRequest(next); err != nil {
		t.Fatal(err)
	}
	b, err := os.ReadFile(filepath.Join(dir, "loja/produtos/cadastrar-produto.yaml"))
	if err != nil {
		t.Fatal("arquivo não foi renomeado:", err)
	}
	if strings.Contains(string(b), "kind:") || !strings.Contains(string(b), "url: '{{ host }}/p'") {
		t.Errorf("yaml gravado:\n%s", b)
	}
	if _, err := os.Stat(filepath.Join(dir, "loja/produtos/criar.yaml")); !os.IsNotExist(err) {
		t.Error("arquivo antigo ficou")
	}
}

func TestRespostas(t *testing.T) {
	s := New(t.TempDir())
	for i := 0; i < 25; i++ {
		s.AddResponse(Doc{"id": "res_" + string(rune('a'+i)), "requestId": "req_1", "body": "ok", "bodyEncoding": "utf8", "size": 2})
	}
	h := s.GetResponses("req_1")
	if len(h) != 20 || doc.Str(h[0].(Doc), "id") != "res_y" {
		t.Errorf("histórico: %d, primeiro %v", len(h), h[0])
	}
}

func TestSlugify(t *testing.T) {
	for in, want := range map[string]string{"Criar Produto": "criar-produto", "Ação/Teste!": "acao-teste", "": "sem-nome"} {
		if got := Slugify(in); got != want {
			t.Errorf("Slugify(%q) = %q, quer %q", in, got, want)
		}
	}
}
