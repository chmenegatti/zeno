// Package store: os mesmos arquivos do Zeno em Electron (src/main/store.ts), lidos e gravados em Go.
//
//	<dataDir>/<workspace>/workspace.yaml
//	<dataDir>/<workspace>/_env/<ambiente>.yaml
//	<dataDir>/<workspace>/<pasta>/folder.yaml
//	<dataDir>/<workspace>/<pasta>/<request>.yaml
//	<dataDir>/.responses/<requestId>.json   (histórico de respostas)
//	<dataDir>/state.json                     (estado da interface)
//	<dataDir>/links.json                     (workspaces fora da pasta de dados, ex.: num repositório)
//
// O YAML sai no mesmo formato do Electron (doc.EncodeYAML): a mesma pasta abre nos dois, e quem versiona
// em git não vê diferença à toa.
package store

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"slices"
	"strconv"
	"strings"
	"sync"
	"time"
	"unicode"

	"github.com/chmenegatti/zeno/wails/internal/doc"
	"golang.org/x/text/unicode/norm"
)

type Doc = doc.Doc

const (
	wsFile     = "workspace.yaml"
	folderFile = "folder.yaml"
	envDir     = "_env"
)

type indexEntry struct {
	kind, path, wsID string
}

// Store: pasta de dados aberta. Seguro pra uso concorrente.
type Store struct {
	Dir string
	// última escrita própria (pro watcher ignorar)
	lastWrite  time.Time
	mu         sync.Mutex
	index      map[string]indexEntry
	workspaces []*Doc
	links      []string
	resp       respCache
}

// DefaultDataDir: ZENO_DATA_DIR, ou $XDG_DATA_HOME/zeno, ou ~/.local/share/zeno (mesmo do Electron)
func DefaultDataDir() string {
	if d := os.Getenv("ZENO_DATA_DIR"); d != "" {
		return d
	}
	base := os.Getenv("XDG_DATA_HOME")
	if base == "" {
		h, _ := os.UserHomeDir()
		base = filepath.Join(h, ".local", "share")
	}
	return filepath.Join(base, "zeno")
}

// New abre (e cria) a pasta de dados
func New(dir string) *Store {
	_ = os.MkdirAll(dir, 0o755)
	// respostas, cookies e estado nunca vão pro git, mesmo com a pasta de dados dentro de um repositório
	WriteGitignore(dir)
	s := &Store{Dir: dir, index: map[string]indexEntry{}}
	if b, err := os.ReadFile(s.linksFile()); err == nil {
		var l []any
		if json.Unmarshal(b, &l) == nil {
			for _, x := range l {
				if p, ok := x.(string); ok {
					s.links = append(s.links, p)
				}
			}
		}
	}
	return s
}

// LastWrite: quando o próprio app escreveu pela última vez
func (s *Store) LastWrite() time.Time {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.lastWrite
}

func (s *Store) linksFile() string { return filepath.Join(s.Dir, "links.json") }

func (s *Store) saveLinks() error {
	b, _ := json.MarshalIndent(s.links, "", "  ")
	if len(s.links) == 0 {
		b = []byte("[]")
	}
	return os.WriteFile(s.linksFile(), b, 0o644)
}

// LinkedDirs: pastas dos workspaces vinculados (pro watcher)
func (s *Store) LinkedDirs() []string {
	s.mu.Lock()
	defer s.mu.Unlock()
	return append([]string(nil), s.links...)
}

// NewID: id no formato do Electron (prefixo_32hex)
func NewID(prefix string) string {
	b := make([]byte, 16)
	_, _ = rand.Read(b)
	return prefix + "_" + hex.EncodeToString(b)
}

var nonSlug = regexp.MustCompile(`[^a-z0-9]+`)

// Slugify: nome de arquivo a partir do nome (igual ao slugify do Electron)
func Slugify(name string) string {
	t := norm.NFD.String(name)
	t = strings.Map(func(r rune) rune {
		if unicode.Is(unicode.Mn, r) {
			return -1
		}
		return r
	}, t)
	t = strings.Trim(nonSlug.ReplaceAllString(strings.ToLower(t), "-"), "-")
	if len(t) > 60 {
		t = t[:60]
	}
	if t == "" {
		return "sem-nome"
	}
	return t
}

// arquivo `foo` ou `foo-3` corresponde ao nome `Foo`?
func sameSlug(base, name string) bool {
	slug := Slugify(name)
	if base == slug || !strings.HasPrefix(base, slug+"-") {
		return base == slug
	}
	_, err := strconv.Atoi(base[len(slug)+1:])
	return err == nil
}

// ---------- leitura ----------

func readYaml(file string) *Doc {
	raw, err := os.ReadFile(file)
	if err != nil {
		return nil
	}
	v, err := doc.ParseYAML(raw)
	if err != nil {
		return nil
	}
	d, _ := v.(*Doc)
	return d
}

// Load relê tudo do disco (pasta de dados + vinculados)
func (s *Store) Load() []*Doc {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.load()
}

func (s *Store) load() []*Doc {
	s.index = map[string]indexEntry{}
	out := []*Doc{}
	type wsDir struct {
		dir    string
		linked bool
	}
	dirs := []wsDir{}
	ents, _ := os.ReadDir(s.Dir)
	for _, e := range ents {
		if e.IsDir() && !strings.HasPrefix(e.Name(), ".") {
			dirs = append(dirs, wsDir{filepath.Join(s.Dir, e.Name()), false})
		}
	}
	for _, l := range s.links {
		dirs = append(dirs, wsDir{l, true})
	}
	for _, wd := range dirs {
		raw := readYaml(filepath.Join(wd.dir, wsFile))
		if raw == nil {
			continue
		}
		id := raw.Str("id")
		if id == "" {
			id = NewID("wrk")
		}
		// mesmo workspace em dois lugares: vale o primeiro
		if _, dup := s.index[id]; dup {
			continue
		}
		name := raw.Str("name")
		if name == "" {
			name = filepath.Base(wd.dir)
		}
		set := raw.Map("settings")
		ws := doc.New("id", id, "name", name)
		if d := raw.Str("description"); d != "" {
			ws.Set("description", d)
		}
		ws.Set("settings", normSettings(set))
		ws.Set("location", doc.New("dir", wd.dir, "linked", wd.linked))
		s.index[id] = indexEntry{"workspace", wd.dir, id}
		ws.Set("environments", doc.Docs(s.loadEnvs(wd.dir, id)))
		ws.Set("children", doc.Docs(s.loadDir(wd.dir, id)))
		out = append(out, ws)
	}
	slices.SortStableFunc(out, func(a, b *Doc) int { return localeCompare(a.Str("name"), b.Str("name")) })
	s.workspaces = out
	return out
}

func (s *Store) loadEnvs(wsDir, wsID string) []*Doc {
	dir := filepath.Join(wsDir, envDir)
	ents, err := os.ReadDir(dir)
	if err != nil {
		return []*Doc{}
	}
	envs := []*Doc{}
	for _, e := range ents {
		if !strings.HasSuffix(e.Name(), ".yaml") {
			continue
		}
		file := filepath.Join(dir, e.Name())
		raw := readYaml(file)
		if raw == nil {
			continue
		}
		env := normEnv(raw, strings.TrimSuffix(e.Name(), ".yaml"))
		s.index[env.Str("id")] = indexEntry{"env", file, wsID}
		envs = append(envs, env)
	}
	doc.Sort(envs)
	return envs
}

func (s *Store) loadDir(dir, wsID string) []*Doc {
	nodes := []*Doc{}
	ents, _ := os.ReadDir(dir)
	for _, e := range ents {
		p := filepath.Join(dir, e.Name())
		if e.IsDir() {
			if e.Name() == envDir || strings.HasPrefix(e.Name(), ".") {
				continue
			}
			f := normFolder(readYaml(filepath.Join(p, folderFile)), e.Name())
			s.index[f.Str("id")] = indexEntry{"folder", p, wsID}
			f.Set("children", doc.Docs(s.loadDir(p, wsID)))
			nodes = append(nodes, f)
		} else if strings.HasSuffix(e.Name(), ".yaml") && e.Name() != folderFile && e.Name() != wsFile {
			raw := readYaml(p)
			if raw == nil {
				continue
			}
			r := normRequest(raw, strings.TrimSuffix(e.Name(), ".yaml"))
			s.index[r.Str("id")] = indexEntry{"request", p, wsID}
			nodes = append(nodes, r)
		}
	}
	doc.Sort(nodes)
	return nodes
}

// List: workspaces carregados
func (s *Store) List() []*Doc {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.workspaces
}

// Workspace pela id
func (s *Store) Workspace(id string) *Doc {
	for _, w := range s.List() {
		if w.Str("id") == id {
			return w
		}
	}
	return nil
}

// WorkspaceSnapshot: cópia do workspace feita sob o lock, pra ler fora da goroutine da interface
// (mock server) sem disputar com gravações
func (s *Store) WorkspaceSnapshot(id string) *Doc {
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, w := range s.workspaces {
		if w.Str("id") == id {
			return w.Clone()
		}
	}
	return nil
}

// PathOf: arquivo ou pasta de um nó
func (s *Store) PathOf(id string) string {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.index[id].path
}

// ---------- escrita ----------

func (s *Store) write(file string, d *Doc) error {
	s.lastWrite = time.Now()
	if err := os.MkdirAll(filepath.Dir(file), 0o755); err != nil {
		return err
	}
	return os.WriteFile(file, doc.EncodeYAML(d), 0o644)
}

func (s *Store) touch() { s.lastWrite = time.Now() }

func exists(p string) bool {
	_, err := os.Stat(p)
	return err == nil
}

// caminho livre dentro de dir: slug, slug-2, slug-3...
func uniquePath(dir, name, ext string) string {
	slug := Slugify(name)
	bad := map[string]bool{envDir: true, "folder": true, "workspace": true}
	for i := 1; ; i++ {
		base := slug
		if i > 1 || bad[slug] {
			base = slug + "-" + strconv.Itoa(i)
		}
		p := filepath.Join(dir, base+ext)
		if !exists(p) {
			return p
		}
	}
}

func (s *Store) dirOfParent(parentID string) (string, error) {
	e, ok := s.index[parentID]
	if !ok || (e.kind != "workspace" && e.kind != "folder") {
		return "", fmt.Errorf("pai inválido: %s", parentID)
	}
	return e.path, nil
}

func (s *Store) wsOf(id string) (*Doc, error) {
	e, ok := s.index[id]
	if ok {
		for _, w := range s.workspaces {
			if w.Str("id") == e.wsID {
				return w, nil
			}
		}
	}
	return nil, fmt.Errorf("workspace não encontrado para %s", id)
}

// ---------- workspaces ----------

// CreateWorkspace cria pasta, workspace.yaml e o ambiente Base
func (s *Store) CreateWorkspace(name string) ([]*Doc, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	dir := uniquePath(s.Dir, name, "")
	ws := doc.New("id", NewID("wrk"), "name", name, "settings", doc.New("insecureTLS", false, "timeoutMs", int64(30000)))
	if err := s.write(filepath.Join(dir, wsFile), ws); err != nil {
		return nil, err
	}
	base := doc.New("id", NewID("env"), "name", "Base", "parentId", nil, "data", doc.New(), "sortKey", int64(0))
	if err := s.write(filepath.Join(dir, envDir, "base.yaml"), base); err != nil {
		return nil, err
	}
	return s.load(), nil
}

// SaveWorkspace grava nome, descrição e configurações
func (s *Store) SaveWorkspace(d *Doc) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	e, ok := s.index[d.Str("id")]
	if !ok {
		return errors.New("workspace não encontrado")
	}
	out := stripEmpty(doc.New("id", d.Get("id"), "name", d.Get("name"), "description", or(d, "description"), "settings", d.Get("settings")))
	if err := s.write(filepath.Join(e.path, wsFile), out); err != nil {
		return err
	}
	for _, w := range s.workspaces {
		if w.Str("id") == d.Str("id") {
			w.Set("name", d.Get("name"))
			if d.Str("description") != "" {
				w.Set("description", d.Get("description"))
			} else {
				w.Del("description")
			}
			w.Set("settings", d.Get("settings"))
		}
	}
	return nil
}

// DeleteWorkspace apaga os arquivos; workspace vinculado só sai da lista (os arquivos são do repositório do usuário)
func (s *Store) DeleteWorkspace(id string) ([]*Doc, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if e, ok := s.index[id]; ok && e.kind == "workspace" {
		if i := slices.Index(s.links, e.path); i >= 0 {
			s.links = slices.Delete(s.links, i, i+1)
			if err := s.saveLinks(); err != nil {
				return nil, err
			}
		} else {
			s.touch()
			if err := os.RemoveAll(e.path); err != nil {
				return nil, err
			}
		}
	}
	return s.load(), nil
}

// LinkWorkspace passa a abrir um workspace que já existe numa pasta (ex.: clonada de um repositório)
func (s *Store) LinkWorkspace(dir string) ([]*Doc, string, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	abs, _ := filepath.Abs(dir)
	raw := readYaml(filepath.Join(abs, wsFile))
	if raw == nil || raw.Str("id") == "" {
		return nil, "", fmt.Errorf("não há %s em %s", wsFile, abs)
	}
	if open, ok := s.index[raw.Str("id")]; ok {
		return nil, "", fmt.Errorf("esse workspace já está aberto (%s)", open.path)
	}
	s.links = append(s.links, abs)
	if err := s.saveLinks(); err != nil {
		return nil, "", err
	}
	return s.load(), raw.Str("id"), nil
}

// MoveWorkspace leva o workspace pra outra pasta (ex.: dentro do repositório do projeto).
// Pasta vazia ou inexistente: usa ela. Com outros arquivos: cria uma subpasta com o nome do workspace.
func (s *Store) MoveWorkspace(id, target string) ([]*Doc, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	e, ok := s.index[id]
	var ws *Doc
	for _, w := range s.workspaces {
		if w.Str("id") == id {
			ws = w
		}
	}
	if !ok || e.kind != "workspace" || ws == nil {
		return nil, errors.New("workspace não encontrado")
	}
	dest, _ := filepath.Abs(target)
	data, _ := filepath.Abs(s.Dir)
	inside := func(a, b string) bool { return a == b || strings.HasPrefix(a, b+string(filepath.Separator)) }
	if inside(dest, data) {
		return nil, errors.New("escolha uma pasta fora da pasta de dados do Zeno")
	}
	if inside(dest, e.path) {
		return nil, errors.New("escolha uma pasta fora do workspace")
	}
	if exists(filepath.Join(dest, wsFile)) {
		return nil, errors.New("já existe um workspace nessa pasta")
	}
	if ents, err := os.ReadDir(dest); err == nil && len(ents) > 0 {
		dest = uniquePath(dest, ws.Str("name"), "")
	}
	s.touch()
	if err := os.MkdirAll(dest, 0o755); err != nil {
		return nil, err
	}
	if err := copyDir(e.path, dest); err != nil {
		return nil, err
	}
	WriteGitignore(dest)
	if err := os.RemoveAll(e.path); err != nil {
		return nil, err
	}
	s.links = append(slices.DeleteFunc(s.links, func(l string) bool { return l == e.path }), dest)
	if err := s.saveLinks(); err != nil {
		return nil, err
	}
	return s.load(), nil
}

func copyDir(src, dst string) error {
	return filepath.WalkDir(src, func(p string, d os.DirEntry, err error) error {
		if err != nil {
			return err
		}
		rel, _ := filepath.Rel(src, p)
		to := filepath.Join(dst, rel)
		if d.IsDir() {
			return os.MkdirAll(to, 0o755)
		}
		b, err := os.ReadFile(p)
		if err != nil {
			return err
		}
		info, _ := d.Info()
		return os.WriteFile(to, b, info.Mode().Perm())
	})
}

// WriteWorkspace grava um workspace inteiro (import). Substitui o existente com a mesma id, no mesmo lugar.
func (s *Store) WriteWorkspace(ws *Doc) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	var dir string
	if e, ok := s.index[ws.Str("id")]; ok && e.kind == "workspace" {
		s.touch()
		if err := os.RemoveAll(e.path); err != nil {
			return err
		}
		dir = e.path
	} else {
		dir = uniquePath(s.Dir, ws.Str("name"), "")
	}
	if err := s.write(filepath.Join(dir, wsFile), stripEmpty(doc.New("id", ws.Get("id"), "name", ws.Get("name"), "description", or(ws, "description"), "settings", ws.Get("settings")))); err != nil {
		return err
	}
	for _, e := range ws.List("environments") {
		env, _ := e.(*Doc)
		if env == nil {
			continue
		}
		if err := s.write(uniquePath(filepath.Join(dir, envDir), env.Str("name"), ".yaml"), stripEmpty(env)); err != nil {
			return err
		}
	}
	return s.writeNodes(dir, ws.List("children"))
}

func (s *Store) writeNodes(dir string, nodes []any) error {
	for _, n := range nodes {
		d, _ := n.(*Doc)
		if d == nil {
			continue
		}
		if d.Str("kind") == "folder" {
			fdir := uniquePath(dir, d.Str("name"), "")
			if err := s.write(filepath.Join(fdir, folderFile), folderToYaml(d)); err != nil {
				return err
			}
			if err := s.writeNodes(fdir, d.List("children")); err != nil {
				return err
			}
		} else if err := s.write(uniquePath(dir, d.Str("name"), ".yaml"), requestToYaml(d)); err != nil {
			return err
		}
	}
	return nil
}

// ---------- pastas e requests ----------

// CreateRequest cria request vazio no pai (workspace ou pasta)
func (s *Store) CreateRequest(parentID, name string, sortKey float64) ([]*Doc, string, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	dir, err := s.dirOfParent(parentID)
	if err != nil {
		return nil, "", err
	}
	req := normRequest(doc.New("name", name, "sortKey", sortKey), name)
	if err := s.write(uniquePath(dir, name, ".yaml"), requestToYaml(req)); err != nil {
		return nil, "", err
	}
	return s.load(), req.Str("id"), nil
}

// CreateFolder cria pasta no pai (workspace ou pasta)
func (s *Store) CreateFolder(parentID, name string, sortKey float64) ([]*Doc, string, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	dir, err := s.dirOfParent(parentID)
	if err != nil {
		return nil, "", err
	}
	f := normFolder(doc.New("name", name, "sortKey", sortKey), name)
	if err := s.write(filepath.Join(uniquePath(dir, name, ""), folderFile), folderToYaml(f)); err != nil {
		return nil, "", err
	}
	return s.load(), f.Str("id"), nil
}

// SaveRequest grava o request; se o nome mudou, renomeia o arquivo
func (s *Store) SaveRequest(req *Doc) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	id := req.Str("id")
	e, ok := s.index[id]
	if !ok || e.kind != "request" {
		return errors.New("request não encontrado")
	}
	file := e.path
	if !sameSlug(strings.TrimSuffix(filepath.Base(file), ".yaml"), req.Str("name")) {
		next := uniquePath(filepath.Dir(file), req.Str("name"), ".yaml")
		s.touch()
		if err := os.Rename(file, next); err != nil {
			return err
		}
		file = next
		e.path = next
		s.index[id] = e
	}
	if err := s.write(file, requestToYaml(req)); err != nil {
		return err
	}
	// a árvore em memória fica igual ao disco
	if ws, err := s.wsOf(id); err == nil {
		n := normRequest(req, req.Str("name"))
		replace(ws.List("children"), n)
	}
	return nil
}

// SaveFolder grava a pasta; se o nome mudou, renomeia o diretório
func (s *Store) SaveFolder(d *Doc) ([]*Doc, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	e, ok := s.index[d.Str("id")]
	if !ok || e.kind != "folder" {
		return nil, errors.New("pasta não encontrada")
	}
	if !sameSlug(filepath.Base(e.path), d.Str("name")) {
		next := uniquePath(filepath.Dir(e.path), d.Str("name"), "")
		s.touch()
		if err := os.Rename(e.path, next); err != nil {
			return nil, err
		}
		// filhos mudaram de caminho: reindexa
		if err := s.write(filepath.Join(next, folderFile), folderToYaml(d)); err != nil {
			return nil, err
		}
		return s.load(), nil
	}
	if err := s.write(filepath.Join(e.path, folderFile), folderToYaml(d)); err != nil {
		return nil, err
	}
	if ws, err := s.wsOf(d.Str("id")); err == nil {
		if n, _ := doc.Find(ws, d.Str("id")); n != nil {
			f := normFolder(d, d.Str("name"))
			f.Set("children", n.Get("children"))
			replace(ws.List("children"), f)
		}
	}
	return s.workspaces, nil
}

func replace(children []any, node *Doc) bool {
	for i, c := range children {
		d, _ := c.(*Doc)
		if d == nil {
			continue
		}
		if d.Str("id") == node.Str("id") {
			children[i] = node
			return true
		}
		if d.Str("kind") == "folder" && replace(d.List("children"), node) {
			return true
		}
	}
	return false
}

// DeleteNode apaga request ou pasta (com tudo dentro)
func (s *Store) DeleteNode(id string) ([]*Doc, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if e, ok := s.index[id]; ok && (e.kind == "request" || e.kind == "folder") {
		s.touch()
		if err := os.RemoveAll(e.path); err != nil {
			return nil, err
		}
	}
	return s.load(), nil
}

// MoveNode leva o nó pra outro pai (workspace ou pasta) e ajusta o sortKey
func (s *Store) MoveNode(id, newParentID string, sortKey float64) ([]*Doc, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	e, ok := s.index[id]
	if !ok || (e.kind != "request" && e.kind != "folder") {
		return nil, errors.New("nó inválido")
	}
	target, err := s.dirOfParent(newParentID)
	if err != nil {
		return nil, err
	}
	sep := string(filepath.Separator)
	if e.kind == "folder" && strings.HasPrefix(target+sep, e.path+sep) {
		return nil, errors.New("não dá pra mover pasta pra dentro dela mesma")
	}
	ws, err := s.wsOf(id)
	if err != nil {
		return nil, err
	}
	node, _ := doc.Find(ws, id)
	if node == nil {
		return nil, errors.New("nó não encontrado")
	}
	dest := e.path
	ext := ""
	if e.kind == "request" {
		ext = ".yaml"
	}
	if filepath.Dir(e.path) != target {
		dest = uniquePath(target, node.Str("name"), ext)
		s.touch()
		if err := os.Rename(e.path, dest); err != nil {
			return nil, err
		}
	}
	node.Set("sortKey", num(sortKey))
	if e.kind == "request" {
		err = s.write(dest, requestToYaml(node))
	} else {
		err = s.write(filepath.Join(dest, folderFile), folderToYaml(node))
	}
	if err != nil {
		return nil, err
	}
	return s.load(), nil
}

// Duplicate copia request ou pasta (ids novas) logo abaixo do original
func (s *Store) Duplicate(id string) ([]*Doc, string, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	ws, err := s.wsOf(id)
	if err != nil {
		return nil, "", err
	}
	node, _ := doc.Find(ws, id)
	e := s.index[id]
	if node == nil {
		return nil, "", errors.New("nó não encontrado")
	}
	cp := node.Clone()
	var reid func(n *Doc)
	reid = func(n *Doc) {
		if n.Str("kind") == "folder" {
			n.Set("id", NewID("fld"))
			for _, c := range n.List("children") {
				if d, _ := c.(*Doc); d != nil {
					reid(d)
				}
			}
		} else {
			n.Set("id", NewID("req"))
		}
	}
	reid(cp)
	cp.Set("name", cp.Str("name")+" (cópia)")
	cp.Set("sortKey", num(node.Num("sortKey", 0)+0.5))
	if err := s.writeNodes(filepath.Dir(e.path), []any{cp}); err != nil {
		return nil, "", err
	}
	return s.load(), cp.Str("id"), nil
}

// ---------- ambientes ----------

// SaveEnvironment grava (ou cria, se a id é nova) um ambiente do workspace
func (s *Store) SaveEnvironment(wsID string, env *Doc) ([]*Doc, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	file := s.index[env.Str("id")].path
	if file == "" {
		e, ok := s.index[wsID]
		if !ok {
			return nil, errors.New("workspace não encontrado")
		}
		file = uniquePath(filepath.Join(e.path, envDir), env.Str("name"), ".yaml")
	}
	if err := s.write(file, stripEmpty(env)); err != nil {
		return nil, err
	}
	return s.load(), nil
}

// DeleteEnvironment apaga o arquivo do ambiente
func (s *Store) DeleteEnvironment(id string) ([]*Doc, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if e, ok := s.index[id]; ok && e.kind == "env" {
		s.touch()
		if err := os.Remove(e.path); err != nil && !os.IsNotExist(err) {
			return nil, err
		}
	}
	return s.load(), nil
}

// ---------- estado da interface ----------

// GetState: state.json (activeEnv sempre presente)
func (s *Store) GetState() *Doc {
	st := doc.New("activeEnv", doc.New())
	if b, err := os.ReadFile(filepath.Join(s.Dir, "state.json")); err == nil {
		if v, err := doc.FromJSON(b); err == nil {
			if d, ok := v.(*Doc); ok {
				if !d.Has("activeEnv") {
					st.Set("activeEnv", doc.New())
					for _, k := range d.Keys() {
						st.Set(k, d.Get(k))
					}
					return st
				}
				return d
			}
		}
	}
	return st
}

// SetState grava state.json como o Electron (JSON com 2 espaços)
func (s *Store) SetState(raw []byte) error {
	v, err := doc.FromJSON(raw)
	if err != nil {
		return err
	}
	b, err := doc.MarshalIndent(v)
	if err != nil {
		return err
	}
	return os.WriteFile(filepath.Join(s.Dir, "state.json"), b, 0o644)
}

// WriteGitignore: o que fica na máquina nunca vai pro git (só acrescenta o que falta)
func WriteGitignore(dir string) {
	file := filepath.Join(dir, ".gitignore")
	need := []string{".responses/", ".vault/", ".cookies/", ".github.json", "state.json", "links.json"}
	cur, err := os.ReadFile(file)
	if err != nil {
		_ = os.WriteFile(file, []byte("# gerado pelo Zeno: respostas, cookies, estado da interface e chave do cofre ficam só na máquina\n"+strings.Join(need, "\n")+"\n"), 0o644)
		return
	}
	have := map[string]bool{}
	for _, l := range regexp.MustCompile(`\r?\n`).Split(string(cur), -1) {
		have[strings.TrimSpace(l)] = true
	}
	var missing []string
	for _, n := range need {
		if !have[n] {
			missing = append(missing, n)
		}
	}
	if len(missing) > 0 {
		sep := ""
		if len(cur) > 0 && cur[len(cur)-1] != '\n' {
			sep = "\n"
		}
		_ = os.WriteFile(file, []byte(string(cur)+sep+strings.Join(missing, "\n")+"\n"), 0o644)
	}
}

// localeCompare aproximado: sem acento e sem caixa primeiro, como o Intl do JavaScript
func localeCompare(a, b string) int {
	ka, kb := foldKey(a), foldKey(b)
	if ka != kb {
		return strings.Compare(ka, kb)
	}
	return strings.Compare(a, b)
}

func foldKey(s string) string {
	t := norm.NFD.String(strings.ToLower(s))
	return strings.Map(func(r rune) rune {
		if unicode.Is(unicode.Mn, r) {
			return -1
		}
		return r
	}, t)
}

// LocaleCompare: ordem de nomes como o localeCompare do Electron
func LocaleCompare(a, b string) int { return localeCompare(a, b) }

// normSettings: settings do workspace com as chaves conhecidas, na ordem: insecureTLS, timeoutMs e, se
// houver, proxy {mode, url, noProxy}, caFile e clientCerts [{host, cert, key, pfx, passphrase}] (#18)
func normSettings(set *Doc) *Doc {
	out := doc.New("insecureTLS", set.Get("insecureTLS") == true, "timeoutMs", num(set.Num("timeoutMs", 30000)))
	if px := set.Map("proxy"); px != nil {
		mode := px.Str("mode")
		if mode != "system" && mode != "custom" {
			mode = "none"
		}
		p := doc.New("mode", mode)
		for _, k := range []string{"url", "noProxy"} {
			if v := px.Str(k); v != "" {
				p.Set(k, v)
			}
		}
		out.Set("proxy", p)
	}
	if ca := set.Str("caFile"); ca != "" {
		out.Set("caFile", ca)
	}
	var certs []any
	for _, x := range set.List("clientCerts") {
		d, ok := x.(*Doc)
		if !ok || d == nil {
			continue
		}
		c := doc.New("host", d.Str("host"))
		for _, k := range []string{"cert", "key", "pfx", "passphrase"} {
			if v := d.Str(k); v != "" {
				c.Set(k, v)
			}
		}
		certs = append(certs, c)
	}
	if len(certs) > 0 {
		out.Set("clientCerts", certs)
	}
	// mock server (#20): porta escolhida
	if m := set.Map("mock"); m != nil && m.Num("port", 0) > 0 {
		out.Set("mock", doc.New("port", num(m.Num("port", 0))))
	}
	return out
}
