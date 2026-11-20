package store

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/chmenegatti/zeno/wails/internal/doc"
)

// copia testdata/electron (pasta escrita pelo Store do Electron, ver testdata/gen.ts) pra um temporário
func electronDir(t *testing.T) string {
	t.Helper()
	dst := t.TempDir()
	if err := copyDir("testdata/electron", dst); err != nil {
		t.Fatal(err)
	}
	return dst
}

func files(t *testing.T, dir string) map[string]string {
	t.Helper()
	out := map[string]string{}
	_ = filepath.WalkDir(dir, func(p string, d os.DirEntry, err error) error {
		if err == nil && !d.IsDir() {
			b, _ := os.ReadFile(p)
			rel, _ := filepath.Rel(dir, p)
			out[rel] = string(b)
		}
		return nil
	})
	return out
}

func noLocation(wss []*Doc) []any {
	out := []any{}
	for _, w := range wss {
		c := w.Clone()
		c.Del("location")
		out = append(out, c)
	}
	return out
}

// a árvore que o Go monta é a mesma que o Electron entrega pra interface (mesmos campos, mesma ordem)
func TestLoadIgualAoElectron(t *testing.T) {
	s := New(electronDir(t))
	got, _ := doc.Marshal(noLocation(s.Load()))
	want, _ := os.ReadFile("testdata/electron-load.json")
	if string(got) != string(want) {
		t.Errorf("load diferente\n--- Go\n%s\n--- Electron\n%s", got, want)
	}
}

// salvar sem mudar nada não muda nenhum byte
func TestSalvarSemMudarNadaNaoMexeNosArquivos(t *testing.T) {
	dir := electronDir(t)
	before := files(t, dir)
	s := New(dir)
	for _, ws := range s.Load() {
		if err := s.SaveWorkspace(ws); err != nil {
			t.Fatal(err)
		}
		for _, e := range ws.List("environments") {
			if _, err := s.SaveEnvironment(ws.Str("id"), e.(*Doc)); err != nil {
				t.Fatal(err)
			}
		}
		var nodes []*Doc
		doc.Walk(ws.List("children"), func(n *Doc) { nodes = append(nodes, n.Clone()) })
		for _, n := range nodes {
			var err error
			if n.Str("kind") == "folder" {
				_, err = s.SaveFolder(n)
			} else {
				err = s.SaveRequest(n)
			}
			if err != nil {
				t.Fatal(err)
			}
		}
	}
	after := files(t, dir)
	for f, b := range before {
		if after[f] != b {
			t.Errorf("%s mudou\n--- antes\n%s\n--- depois\n%s", f, b, after[f])
		}
	}
	if len(after) != len(before) {
		t.Errorf("arquivos: %d antes, %d depois", len(before), len(after))
	}
}

func TestCriaRenomeiaMoveDuplicaApaga(t *testing.T) {
	s := New(t.TempDir())
	wss, err := s.CreateWorkspace("Meu WS")
	if err != nil {
		t.Fatal(err)
	}
	ws := wss[0].Str("id")
	_, fid, _ := s.CreateFolder(ws, "Pasta A", 1)
	wss, rid, _ := s.CreateRequest(ws, "Req", 2)
	req, _ := doc.Find(wss[0], rid)
	req = req.Clone()
	req.Set("name", "Req Renomeado")
	req.Set("url", "http://x")
	if err := s.SaveRequest(req); err != nil {
		t.Fatal(err)
	}
	if filepath.Base(s.PathOf(rid)) != "req-renomeado.yaml" {
		t.Errorf("arquivo: %s", s.PathOf(rid))
	}
	if _, err := s.MoveNode(rid, fid, 1); err != nil {
		t.Fatal(err)
	}
	if filepath.Dir(s.PathOf(rid)) != s.PathOf(fid) {
		t.Errorf("não moveu: %s", s.PathOf(rid))
	}
	wss, did, err := s.Duplicate(rid)
	if err != nil {
		t.Fatal(err)
	}
	cp, _ := doc.Find(wss[0], did)
	if cp.Str("url") != "http://x" || cp.Str("name") != "Req Renomeado (cópia)" || did == rid {
		t.Errorf("cópia: %v", cp)
	}
	if _, err := s.MoveNode(fid, fid, 0); err == nil {
		t.Error("pasta dentro dela mesma deveria falhar")
	}
	wss, _ = s.DeleteNode(fid)
	if len(wss[0].List("children")) != 0 {
		t.Errorf("sobrou: %v", wss[0].List("children"))
	}
}

func TestNomeRepetidoGanhaSufixo(t *testing.T) {
	s := New(t.TempDir())
	wss, _ := s.CreateWorkspace("W")
	ws := wss[0].Str("id")
	s.CreateRequest(ws, "Igual", 1)
	s.CreateRequest(ws, "Igual", 2)
	s.CreateRequest(ws, "Folder", 3) // nome reservado
	ents, _ := os.ReadDir(s.PathOf(ws))
	var names []string
	for _, e := range ents {
		if strings.HasSuffix(e.Name(), ".yaml") {
			names = append(names, e.Name())
		}
	}
	want := "folder-1.yaml igual-2.yaml igual.yaml workspace.yaml" // como o Electron: reservado ganha -1
	if strings.Join(names, " ") != want {
		t.Errorf("arquivos: %v", names)
	}
}

func TestRenomearPastaReindexaFilhos(t *testing.T) {
	s := New(t.TempDir())
	wss, _ := s.CreateWorkspace("W")
	ws := wss[0].Str("id")
	wss, fid, _ := s.CreateFolder(ws, "Antiga", 1)
	_, rid, _ := s.CreateRequest(fid, "R", 1)
	f, _ := doc.Find(s.List()[0], fid)
	f = f.Clone()
	f.Set("name", "Nova")
	if _, err := s.SaveFolder(f); err != nil {
		t.Fatal(err)
	}
	if !strings.HasSuffix(s.PathOf(rid), filepath.Join("nova", "r.yaml")) {
		t.Errorf("filho: %s", s.PathOf(rid))
	}
}

func TestAmbientes(t *testing.T) {
	s := New(t.TempDir())
	wss, _ := s.CreateWorkspace("W")
	ws := wss[0]
	base := ws.List("environments")[0].(*Doc)
	env := doc.New("id", "env_novo", "name", "Produção", "parentId", base.Get("id"), "data", doc.New("z", int64(1), "a", "2"), "sortKey", int64(1))
	wss, err := s.SaveEnvironment(ws.Str("id"), env)
	if err != nil {
		t.Fatal(err)
	}
	b, _ := os.ReadFile(filepath.Join(ws.Map("location").Str("dir"), "_env", "producao.yaml"))
	// ordem das variáveis mantida
	if !strings.Contains(string(b), "data:\n  z: 1\n  a: \"2\"\n") {
		t.Errorf("yaml:\n%s", b)
	}
	wss, _ = s.DeleteEnvironment("env_novo")
	if n := len(wss[0].List("environments")); n != 1 {
		t.Errorf("ambientes: %d", n)
	}
}

func TestWorkspaceForaDaPastaDeDados(t *testing.T) {
	dir := t.TempDir()
	s := New(dir)
	wss, _ := s.CreateWorkspace("API")
	id := wss[0].Str("id")
	s.CreateRequest(id, "Listar", 1)
	repo := t.TempDir()
	_ = os.WriteFile(filepath.Join(repo, "README.md"), []byte("projeto"), 0o644)
	wss, err := s.MoveWorkspace(id, repo)
	if err != nil {
		t.Fatal(err)
	}
	loc := wss[0].Map("location")
	if loc.Str("dir") != filepath.Join(repo, "api") || loc.Get("linked") != true {
		t.Errorf("location: %v", loc)
	}
	if exists(filepath.Join(dir, "api")) || !exists(filepath.Join(repo, "api", "listar.yaml")) {
		t.Error("não moveu os arquivos")
	}
	gi, _ := os.ReadFile(filepath.Join(repo, "api", ".gitignore"))
	if !strings.Contains(string(gi), ".vault/") {
		t.Errorf(".gitignore: %s", gi)
	}
	again := New(dir).Load()
	if len(again) != 1 || again[0].Str("id") != id {
		t.Errorf("reabrir: %v", again)
	}
	if _, err := s.MoveWorkspace(id, filepath.Join(dir, "sub")); err == nil || !strings.Contains(err.Error(), "fora da pasta de dados") {
		t.Errorf("deveria recusar: %v", err)
	}
}

func TestVincularNaoApagaArquivos(t *testing.T) {
	other := New(t.TempDir())
	wss, _ := other.CreateWorkspace("Compartilhado")
	wsPath := wss[0].Map("location").Str("dir")
	s := New(t.TempDir())
	_, id, err := s.LinkWorkspace(wsPath)
	if err != nil || id != wss[0].Str("id") {
		t.Fatal(id, err)
	}
	if _, _, err := s.LinkWorkspace(wsPath); err == nil || !strings.Contains(err.Error(), "já está aberto") {
		t.Errorf("deveria recusar: %v", err)
	}
	s.CreateRequest(id, "Novo", 1)
	if !exists(filepath.Join(wsPath, "novo.yaml")) {
		t.Error("request não foi pra pasta vinculada")
	}
	left, _ := s.DeleteWorkspace(id)
	if len(left) != 0 || !exists(filepath.Join(wsPath, "workspace.yaml")) {
		t.Error("remover vinculado não pode apagar arquivos")
	}
}

func TestGitignoreDaPastaDeDados(t *testing.T) {
	dir := t.TempDir()
	_ = os.WriteFile(filepath.Join(dir, ".gitignore"), []byte("node_modules/"), 0o644)
	New(dir)
	b, _ := os.ReadFile(filepath.Join(dir, ".gitignore"))
	if string(b) != "node_modules/\n.responses/\n.vault/\n.cookies/\n.github.json\nstate.json\nlinks.json\n" {
		t.Errorf(".gitignore:\n%s", b)
	}
}

func TestEstado(t *testing.T) {
	s := New(t.TempDir())
	if st := s.GetState(); st.Map("activeEnv") == nil {
		t.Error("activeEnv sempre presente")
	}
	if err := s.SetState([]byte(`{"activeEnv":{"w":"e"},"activeWorkspaceId":"w","pinned":["a&b"]}`)); err != nil {
		t.Fatal(err)
	}
	b, _ := os.ReadFile(filepath.Join(s.Dir, "state.json"))
	want := "{\n  \"activeEnv\": {\n    \"w\": \"e\"\n  },\n  \"activeWorkspaceId\": \"w\",\n  \"pinned\": [\n    \"a&b\"\n  ]\n}"
	if string(b) != want {
		t.Errorf("state.json:\n%s", b)
	}
}

func TestRespostas(t *testing.T) {
	s := New(t.TempDir())
	t.Cleanup(s.Flush)
	for i := 0; i < 25; i++ {
		s.AddResponse(doc.New("id", "res_"+string(rune('a'+i)), "requestId", "req_1", "body", "ok", "bodyEncoding", "utf8", "size", int64(2)))
	}
	h := s.GetResponses("req_1")
	if len(h) != 20 || h[0].(*Doc).Str("id") != "res_y" {
		t.Errorf("histórico: %d, primeiro %v", len(h), h[0])
	}
}

func TestBodyGrandeVaiPraArquivo(t *testing.T) {
	s := New(t.TempDir())
	t.Cleanup(s.Flush)
	big := strings.Repeat("x", LargeBody+10)
	rec := doc.New("id", "res_big", "requestId", "req_1", "body", big, "bodyEncoding", "utf8", "size", int64(len(big)))
	saved := s.AddResponse(rec)[0].(*Doc)
	if saved.Get("bodyFile") != true || len(saved.Str("body")) != previewChars {
		t.Fatalf("prévia: %d", len(saved.Str("body")))
	}
	s.Flush()
	if fi, _ := os.Stat(s.ResponsesFile("req_1")); fi.Size() > 400*1024 {
		t.Errorf("histórico grande demais: %d", fi.Size())
	}
	full, err := s.ResponseBody(saved)
	if err != nil || full != big {
		t.Fatal("body completo não voltou", err)
	}
	bodyFile := s.bodyPath("res_big")
	// saiu do histórico = arquivo apagado
	for i := 0; i < 20; i++ {
		s.AddResponse(doc.New("id", "res_"+string(rune('a'+i)), "requestId", "req_1", "body", "ok", "bodyEncoding", "utf8", "size", int64(2)))
	}
	if exists(bodyFile) {
		t.Error("body de resposta podada ficou no disco")
	}
	s.AddResponse(rec)
	if err := s.ClearResponses("req_1"); err != nil {
		t.Fatal(err)
	}
	if exists(bodyFile) || exists(s.ResponsesFile("req_1")) {
		t.Error("limpar deveria apagar histórico e bodies")
	}
	// acentos: conta bytes
	acc := strings.Repeat("ã", 3*1024*1024)
	if s.AddResponse(doc.New("id", "res_acc", "requestId", "req_2", "body", acc, "bodyEncoding", "utf8", "size", int64(len(acc))))[0].(*Doc).Get("bodyFile") != true {
		t.Error("6 MB em UTF-8 deveria ir pra arquivo")
	}
}

func TestSlugify(t *testing.T) {
	for in, want := range map[string]string{"Criar Produto": "criar-produto", "Ação/Teste!": "acao-teste", "": "sem-nome", "Pasta: com dois-pontos": "pasta-com-dois-pontos"} {
		if got := Slugify(in); got != want {
			t.Errorf("Slugify(%q) = %q, quer %q", in, got, want)
		}
	}
	if !sameSlug("igual-2", "Igual") || sameSlug("igual-x", "Igual") || !sameSlug("igual", "Igual") {
		t.Error("sameSlug")
	}
}

// gravação em segundo plano: o arquivo fica igual ao histórico e a releitura (sem cache) também
func TestRespostasGravadas(t *testing.T) {
	dir := t.TempDir()
	s := New(dir)
	for i := 0; i < 5; i++ {
		s.AddResponse(doc.New("id", "res_"+string(rune('a'+i)), "requestId", "req_1", "body", strings.Repeat("y", 100*1024), "bodyEncoding", "utf8", "size", int64(100*1024)))
	}
	s.Flush()
	other := New(dir)
	h := other.GetResponses("req_1")
	if len(h) != 5 || h[0].(*Doc).Str("id") != "res_e" {
		t.Fatalf("arquivo: %d", len(h))
	}
	if err := s.ClearResponses("req_1"); err != nil || len(s.GetResponses("req_1")) != 0 {
		t.Fatalf("limpar: %v", err)
	}
	if _, err := os.Stat(s.ResponsesFile("req_1")); !os.IsNotExist(err) {
		t.Error("arquivo ficou")
	}
}
