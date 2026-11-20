package gitws

import (
	"os"
	"os/exec"
	"path/filepath"
	"slices"
	"strings"
	"testing"

	"github.com/chmenegatti/zeno/wails/internal/doc"
	"github.com/chmenegatti/zeno/wails/internal/store"
)

func sh(t *testing.T, cwd string, args ...string) {
	t.Helper()
	cmd := exec.Command("git", args...)
	cmd.Dir = cwd
	if out, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("git %v: %s", args, out)
	}
}

func setupEnv(t *testing.T) {
	for k, v := range map[string]string{"GIT_AUTHOR_NAME": "Teste", "GIT_AUTHOR_EMAIL": "t@t", "GIT_COMMITTER_NAME": "Teste", "GIT_COMMITTER_EMAIL": "t@t", "GIT_CONFIG_GLOBAL": "/dev/null"} {
		t.Setenv(k, v)
	}
}

func cloneOf(t *testing.T, remote string) string {
	clone := filepath.Join(t.TempDir(), "repo")
	sh(t, filepath.Dir(clone), "-c", "advice.detachedHead=false", "clone", "-q", remote, clone)
	return clone
}

func editURL(t *testing.T, s *store.Store, name, url string) {
	ws := s.Load()[0]
	for _, n := range ws.List("children") {
		if d := n.(*doc.Doc); d.Str("name") == name {
			c := d.Clone()
			c.Set("url", url)
			if err := s.SaveRequest(c); err != nil {
				t.Fatal(err)
			}
		}
	}
}

// mesmos casos de test/git.test.ts
func TestDoisColegasSemConflito(t *testing.T) {
	setupEnv(t)
	remote := t.TempDir()
	sh(t, remote, "init", "-q", "--bare", "-b", "main")

	// Ana cria o workspace dentro do repo e publica
	anaClone := cloneOf(t, remote)
	ana := store.New(t.TempDir())
	wss, _ := ana.CreateWorkspace("API")
	id := wss[0].Str("id")
	ana.CreateRequest(id, "Listar", 1)
	ana.CreateRequest(id, "Criar", 2)
	if _, err := ana.MoveWorkspace(id, filepath.Join(anaClone, "api")); err != nil {
		t.Fatal(err)
	}
	anaDir := ana.Load()[0].Map("location").Str("dir")
	st, _ := GetStatus(anaDir)
	var labels []string
	for _, f := range st.Files {
		labels = append(labels, f.Label)
	}
	for _, want := range []string{"Listar", "Criar", "workspace API", "ambiente Base"} {
		if !slices.Contains(labels, want) {
			t.Errorf("faltou %q em %v", want, labels)
		}
	}
	if err := Commit(anaDir, "feat: workspace da API"); err != nil {
		t.Fatal(err)
	}
	if err := Push(anaDir); err != nil {
		t.Fatal(err)
	}
	if st, _ = GetStatus(anaDir); len(st.Files) != 0 || st.Upstream != "origin/main" {
		t.Errorf("depois do push: %+v", st)
	}

	// Bruno clona e abre o mesmo workspace
	brunoDir := filepath.Join(cloneOf(t, remote), "api")
	bruno := store.New(t.TempDir())
	if _, got, err := bruno.LinkWorkspace(brunoDir); err != nil || got != id {
		t.Fatal(got, err)
	}

	editURL(t, ana, "Listar", "https://api/itens")
	editURL(t, bruno, "Criar", "https://api/itens/novo")
	if d, _ := Diff(anaDir, "listar.yaml"); !strings.Contains(d, "+url: https://api/itens") {
		t.Errorf("diff: %s", d)
	}
	if err := Commit(anaDir, "feat: url de listar"); err != nil {
		t.Fatal(err)
	}
	if err := Commit(brunoDir, "feat: url de criar"); err != nil {
		t.Fatal(err)
	}
	if err := Push(anaDir); err != nil {
		t.Fatal(err)
	}
	if err := Push(brunoDir); err == nil {
		t.Error("push do Bruno deveria falhar (remoto andou)")
	}
	if err := Pull(brunoDir); err != nil {
		t.Fatal(err)
	}
	if err := Push(brunoDir); err != nil {
		t.Fatal(err)
	}
	if err := Pull(anaDir); err != nil {
		t.Fatal(err)
	}
	urls := func(s *store.Store) map[string]string {
		out := map[string]string{}
		for _, n := range s.Load()[0].List("children") {
			out[n.(*doc.Doc).Str("name")] = n.(*doc.Doc).Str("url")
		}
		return out
	}
	a, b := urls(ana), urls(bruno)
	if a["Listar"] != "https://api/itens" || a["Criar"] != "https://api/itens/novo" || b["Listar"] != a["Listar"] || b["Criar"] != a["Criar"] {
		t.Errorf("ana %v bruno %v", a, b)
	}
	if st, _ = GetStatus(anaDir); st.Conflict {
		t.Error("conflito")
	}
}

func TestForaDeRepoEBranches(t *testing.T) {
	setupEnv(t)
	dir := t.TempDir()
	if st, _ := GetStatus(dir); st.Repo {
		t.Fatal("não deveria ser repo")
	}
	if err := Init(dir); err != nil {
		t.Fatal(err)
	}
	_ = os.WriteFile(filepath.Join(dir, "a.yaml"), []byte("name: A\n"), 0o644)
	st, _ := GetStatus(dir)
	if len(st.Files) != 1 || st.Files[0] != (File{Path: "a.yaml", Status: "A", Label: "A"}) {
		t.Errorf("files: %+v", st.Files)
	}
	if d, _ := Diff(dir, "a.yaml"); !strings.Contains(d, "+name: A") {
		t.Errorf("diff: %s", d)
	}
	if err := Commit(dir, "primeiro"); err != nil {
		t.Fatal(err)
	}
	if err := SwitchBranch(dir, "release/1.2", true); err != nil {
		t.Fatal(err)
	}
	s2, _ := GetStatus(dir)
	if s2.Branch != "release/1.2" || !slices.Contains(s2.Branches, "release/1.2") || s2.HasRemote {
		t.Errorf("%+v", s2)
	}
}

func TestRelTo(t *testing.T) {
	dir := t.TempDir()
	link := filepath.Join(t.TempDir(), "link")
	if err := os.Symlink(dir, link); err != nil {
		t.Fatal(err)
	}
	cases := []struct{ dir, file, repoRel, want string }{
		{dir, filepath.Join(dir, "api", "a.yaml"), "ws/api/a.yaml", "api/a.yaml"},
		// pasta do workspace por link: compara pelo caminho real
		{link, filepath.Join(dir, "api", "a.yaml"), "ws/api/a.yaml", "api/a.yaml"},
		// Rel falha (no Windows: outro volume): não devolve vazio
		{"relativo", filepath.Join(dir, "a.yaml"), "ws/a.yaml", "ws/a.yaml"},
	}
	for _, c := range cases {
		if got := relTo(c.dir, c.file, c.repoRel); got != c.want {
			t.Errorf("relTo(%q, %q) = %q, want %q", c.dir, c.file, got, c.want)
		}
	}
}
