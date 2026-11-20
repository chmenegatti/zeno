package github

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"reflect"
	"sort"
	"strings"
	"sync"
	"testing"
	"time"
)

// GitHub de mentira: um repositório, commits como mapas caminho → conteúdo (como test/github.test.ts)
type fakeGitHub struct {
	mu      sync.Mutex
	repo    bool
	trees   map[string]map[string]string
	commits map[string]string // commit → tree
	blobs   map[string]string
	head    string
	n       int
}

func (g *fakeGitHub) id(p string) string { g.n++; return fmt.Sprint(p, g.n) }

func (g *fakeGitHub) files() map[string]string {
	if g.head == "" {
		return map[string]string{}
	}
	return g.trees[g.commits[g.head]]
}

func keys(m map[string]string) []string {
	out := []string{}
	for k := range m {
		out = append(out, k)
	}
	sort.Strings(out)
	return out
}

func newFake(t *testing.T) *fakeGitHub {
	g := &fakeGitHub{trees: map[string]map[string]string{}, commits: map[string]string{}, blobs: map[string]string{}}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		g.mu.Lock()
		defer g.mu.Unlock()
		reply := func(status int, body any) {
			w.WriteHeader(status)
			_ = json.NewEncoder(w).Encode(body)
		}
		var body map[string]any
		_ = json.NewDecoder(r.Body).Decode(&body)
		p, m := r.URL.Path, r.Method
		if r.Header.Get("Authorization") != "Bearer tk" {
			reply(401, map[string]any{"message": "Bad credentials"})
			return
		}
		switch {
		case p == "/user":
			reply(200, map[string]any{"login": "ana", "name": "Ana", "avatar_url": "x"})
			return
		case p == "/repos/ana/zeno-collections" && m == "GET":
			if g.repo {
				reply(200, map[string]any{"default_branch": "main"})
			} else {
				reply(404, map[string]any{"message": "Not Found"})
			}
			return
		case p == "/user/repos":
			if body["name"] != "zeno-collections" || body["private"] != true {
				t.Errorf("criação do repo: %v", body)
			}
			g.repo = true
			reply(201, map[string]any{"default_branch": "main"})
			return
		}
		gp := strings.TrimPrefix(p, "/repos/ana/zeno-collections/git")
		switch {
		case gp == "/ref/heads/main":
			if g.head == "" {
				reply(404, map[string]any{})
			} else {
				reply(200, map[string]any{"object": map[string]any{"sha": g.head}})
			}
		case strings.HasPrefix(gp, "/trees/") && m == "GET":
			tr := g.trees[g.commits[gp[7:]]]
			items := []map[string]any{}
			for _, path := range keys(tr) {
				b := g.id("b")
				g.blobs[b] = tr[path]
				items = append(items, map[string]any{"path": path, "type": "blob", "sha": b})
			}
			reply(200, map[string]any{"tree": items})
		case strings.HasPrefix(gp, "/commits/") && m == "GET":
			reply(200, map[string]any{"tree": map[string]any{"sha": g.commits[gp[9:]]}})
		case gp == "/trees":
			tr := map[string]string{}
			if base, ok := body["base_tree"].(string); ok {
				for k, v := range g.trees[base] {
					tr[k] = v
				}
			}
			for _, e := range body["tree"].([]any) {
				e := e.(map[string]any)
				if sha, has := e["sha"]; has && sha == nil {
					delete(tr, e["path"].(string))
				} else {
					tr[e["path"].(string)] = e["content"].(string)
				}
			}
			// mesma árvore = mesmo sha (como no git)
			for s, v := range g.trees {
				if reflect.DeepEqual(v, tr) {
					reply(201, map[string]any{"sha": s})
					return
				}
			}
			s := g.id("t")
			g.trees[s] = tr
			reply(201, map[string]any{"sha": s})
		case gp == "/commits":
			s := g.id("c")
			g.commits[s] = body["tree"].(string)
			reply(201, map[string]any{"sha": s, "html_url": "https://github.com/ana/zeno-collections/commit/" + s})
		case gp == "/refs/heads/main" || gp == "/refs":
			g.head = body["sha"].(string)
			reply(200, map[string]any{})
		case strings.HasPrefix(gp, "/blobs/"):
			// como a API: base64 quebrado em linhas
			enc := base64.StdEncoding.EncodeToString([]byte(g.blobs[gp[7:]]))
			if len(enc) > 8 {
				enc = enc[:8] + "\n" + enc[8:]
			}
			reply(200, map[string]any{"content": enc})
		default:
			reply(500, map[string]any{"message": "rota não simulada: " + m + " " + p})
		}
	}))
	t.Cleanup(srv.Close)
	old := APIBase
	APIBase = srv.URL
	t.Cleanup(func() { APIBase = old })
	return g
}

func write(t *testing.T, p, s string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(p, []byte(s), 0o644); err != nil {
		t.Fatal(err)
	}
}

func read(t *testing.T, p string) string {
	t.Helper()
	b, err := os.ReadFile(p)
	if err != nil {
		t.Fatal(err)
	}
	return string(b)
}

func eq(t *testing.T, got, want any) {
	t.Helper()
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("\n got: %#v\nwant: %#v", got, want)
	}
}

func TestPushListPull(t *testing.T) {
	g := newFake(t)
	sync := &Sync{API: NewAPI("tk"), Owner: "ana", Repo: "zeno-collections"}
	local := filepath.Join(t.TempDir(), "loja")
	write(t, filepath.Join(local, "workspace.yaml"), "id: wrk_loja\nname: Loja\n")
	write(t, filepath.Join(local, "api", "listar.yaml"), "id: req_1\nname: Listar\n")
	write(t, filepath.Join(local, "api", "criar.yaml"), "id: req_2\nname: Criar\n")
	write(t, filepath.Join(local, "secrets.json"), `{"senha":"nao sobe"}`)
	write(t, filepath.Join(local, "README.md"), "notas locais")
	write(t, filepath.Join(local, ".git", "config"), "nao vai")

	files, err := WorkspaceFiles(local)
	if err != nil {
		t.Fatal(err)
	}
	var rels []string
	for _, f := range files {
		rels = append(rels, f.Rel)
	}
	eq(t, rels, []string{"api/criar.yaml", "api/listar.yaml", "workspace.yaml"})

	ws := []LocalWorkspace{{Dir: "loja", Name: "Loja", LocalDir: local}}
	push := func(msg string) *PushResult {
		t.Helper()
		r, err := sync.Push(ws, msg)
		if err != nil {
			t.Fatal(err)
		}
		return r
	}
	r1 := push("Zeno: Loja")
	if r1 == nil || r1.Files != 3 || !strings.HasPrefix(r1.URL, "https://github.com/ana/") {
		t.Fatalf("push: %+v", r1)
	}
	eq(t, keys(g.files()), []string{"loja/api/criar.yaml", "loja/api/listar.yaml", "loja/workspace.yaml"})
	list, err := sync.List()
	if err != nil {
		t.Fatal(err)
	}
	eq(t, list, []RemoteWorkspace{{Dir: "loja", ID: "wrk_loja", Name: "Loja", Files: 3}})

	// sem mudança: nada de commit novo
	if r := push("de novo"); r != nil {
		t.Fatalf("commit vazio: %+v", r)
	}

	// request apagado no app some do repo
	os.Remove(filepath.Join(local, "api", "criar.yaml"))
	write(t, filepath.Join(local, "api", "listar.yaml"), "id: req_1\nname: Listar todos\n")
	push("Zeno: Loja")
	eq(t, keys(g.files()), []string{"loja/api/listar.yaml", "loja/workspace.yaml"})

	// arquivo que o Zeno não gerencia no repo (.gitignore, imagem) não é apagado no envio
	g.files()["loja/.gitignore"] = "*.log"
	g.files()["loja/docs/diagrama.png"] = "png"
	write(t, filepath.Join(local, "api", "novo.yaml"), "id: req_3\nname: Novo\n")
	push("Zeno: Loja")
	eq(t, keys(g.files()), []string{"loja/.gitignore", "loja/api/listar.yaml", "loja/api/novo.yaml", "loja/docs/diagrama.png", "loja/workspace.yaml"})
	os.Remove(filepath.Join(local, "api", "novo.yaml"))
	push("Zeno: Loja")

	// baixar em outra máquina
	other := filepath.Join(t.TempDir(), "loja")
	n, err := sync.Pull("loja", other)
	if err != nil || n != 2 {
		t.Fatalf("pull: %d %v", n, err)
	}
	if !strings.Contains(read(t, filepath.Join(other, "api", "listar.yaml")), "Listar todos") {
		t.Fatal("conteúdo baixado")
	}
	// arquivos locais que não são do Zeno ficam intactos ao atualizar; YAML que sumiu do repo sai
	write(t, filepath.Join(other, "notas.md"), "minhas notas")
	write(t, filepath.Join(other, "api", "velho.yaml"), "id: req_9\n")
	if _, err := sync.Pull("loja", other); err != nil {
		t.Fatal(err)
	}
	eq(t, read(t, filepath.Join(other, "notas.md")), "minhas notas")
	if _, err := os.Stat(filepath.Join(other, ".gitignore")); err == nil {
		t.Fatal(".gitignore não devia baixar")
	}
	if _, err := os.Stat(filepath.Join(other, "api", "velho.yaml")); err == nil {
		t.Fatal("YAML local fora do repo devia sair")
	}
	if _, err := sync.Pull("nao-existe", other); err == nil || !strings.Contains(err.Error(), "não está no repositório") {
		t.Fatalf("pull inexistente: %v", err)
	}
}

func TestInvalidToken(t *testing.T) {
	newFake(t)
	_, err := NewAPI("errado").User()
	if err == nil || !strings.Contains(err.Error(), "token do GitHub inválido") {
		t.Fatalf("erro: %v", err)
	}
}

func TestDevicePoll(t *testing.T) {
	answers := []string{`{"error":"authorization_pending"}`, `{"error":"slow_down"}`, `{"access_token":"tk-device"}`}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var b map[string]string
		_ = json.NewDecoder(r.Body).Decode(&b)
		if r.URL.Path != "/login/oauth/access_token" || b["device_code"] != "dc" || b["client_id"] != "cid" {
			t.Errorf("pedido: %s %v", r.URL.Path, b)
		}
		w.Write([]byte(answers[0]))
		answers = answers[1:]
	}))
	defer srv.Close()
	old := LoginBase
	LoginBase = srv.URL
	defer func() { LoginBase = old }()
	var waits []time.Duration
	tk, err := DevicePoll(nil, "cid", "dc", 5, 900, func(d time.Duration) { waits = append(waits, d) })
	if err != nil || tk != "tk-device" {
		t.Fatalf("%q %v", tk, err)
	}
	eq(t, waits, []time.Duration{5 * time.Second, 5 * time.Second, 10 * time.Second})
}

func TestDeviceError(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte(`{"error":"access_denied"}`))
	}))
	defer srv.Close()
	old := LoginBase
	LoginBase = srv.URL
	defer func() { LoginBase = old }()
	_, err := DevicePoll(nil, "cid", "dc", 5, 900, func(time.Duration) {})
	if err == nil || err.Error() != "GitHub: access_denied" {
		t.Fatalf("%v", err)
	}
}

func TestIsManaged(t *testing.T) {
	for p, want := range map[string]bool{"a.yaml": true, "x/b.YML": true, ".gitignore": false, "x/.hidden/a.yaml": false, "README.md": false} {
		if IsManaged(p) != want {
			t.Errorf("%s: %v", p, !want)
		}
	}
}
