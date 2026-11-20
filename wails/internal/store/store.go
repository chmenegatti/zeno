// Package store: mesmos arquivos YAML do Zeno em Electron (src/main/store.ts), lidos e gravados em Go.
// Os documentos andam como doc.Doc: o que a interface manda volta pro YAML sem perder campo.

package store

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"sync"
	"unicode"

	"github.com/chmenegatti/zeno/wails/internal/doc"
	"golang.org/x/text/unicode/norm"
	"gopkg.in/yaml.v3"
)

const (
	wsFile       = "workspace.yaml"
	folderFile   = "folder.yaml"
	envDir       = "_env"
	maxResponses = 20
	largeBody    = 5 * 1024 * 1024
	previewChars = 256 * 1024
)

type Doc = doc.Doc

type indexEntry struct {
	kind, path, wsID string
}

type Store struct {
	Dir        string
	mu         sync.Mutex
	index      map[string]indexEntry
	workspaces []Doc
}

// DefaultDataDir: ZENO_DATA_DIR ou ~/.local/share/zeno (mesmo do Electron)
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
	return &Store{Dir: dir, index: map[string]indexEntry{}}
}

// NewID: id no formato do Electron (prefixo_32hex)
func NewID(prefix string) string {
	b := make([]byte, 16)
	_, _ = rand.Read(b)
	return prefix + "_" + hex.EncodeToString(b)
}

func readYaml(file string) Doc {
	raw, err := os.ReadFile(file)
	if err != nil {
		return nil
	}
	var d Doc
	if yaml.Unmarshal(raw, &d) != nil {
		return nil
	}
	return d
}

func kvList(v any) []any {
	arr, _ := v.([]any)
	out := make([]any, 0, len(arr))
	for _, it := range arr {
		m, _ := it.(Doc)
		if m == nil {
			continue
		}
		out = append(out, Doc{"name": doc.Str(m, "name"), "value": doc.Str(m, "value"), "enabled": m["enabled"] != false})
	}
	return out
}

func authOf(v any) any {
	if m, ok := v.(Doc); ok {
		if _, has := m["type"]; has {
			return m
		}
	}
	return Doc{"type": "inherit"}
}

func normRequest(raw Doc, fallback string) Doc {
	r := Doc{}
	for k, v := range raw {
		r[k] = v
	}
	r["kind"] = "request"
	if doc.Str(raw, "id") == "" {
		r["id"] = NewID("req")
	}
	if doc.Str(raw, "name") == "" {
		r["name"] = fallback
	}
	m := strings.ToUpper(doc.Str(raw, "method"))
	if m == "" {
		m = "GET"
	}
	r["method"] = m
	r["url"] = doc.Str(raw, "url")
	r["params"] = kvList(raw["params"])
	r["headers"] = kvList(raw["headers"])
	if b, ok := raw["body"].(Doc); ok {
		body := Doc{"mime": b["mime"]}
		if t, ok := b["text"]; ok {
			body["text"] = t
		}
		if f, ok := b["fields"]; ok {
			body["fields"] = f
		}
		r["body"] = body
	} else {
		r["body"] = Doc{"mime": nil}
	}
	r["auth"] = authOf(raw["auth"])
	r["sortKey"] = doc.Num(raw, "sortKey", 0)
	return r
}

func normFolder(raw Doc, fallback string) Doc {
	f := Doc{}
	for k, v := range raw {
		f[k] = v
	}
	f["kind"] = "folder"
	if doc.Str(raw, "id") == "" {
		f["id"] = NewID("fld")
	}
	if doc.Str(raw, "name") == "" {
		f["name"] = fallback
	}
	f["sortKey"] = doc.Num(raw, "sortKey", 0)
	f["headers"] = kvList(raw["headers"])
	f["auth"] = authOf(raw["auth"])
	if _, ok := raw["vars"].(Doc); !ok {
		f["vars"] = Doc{}
	}
	f["children"] = []any{}
	return f
}

// Load lê todos os workspaces da pasta de dados (sem os vinculados, no protótipo)
func (s *Store) Load() []Doc {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.index = map[string]indexEntry{}
	out := []Doc{}
	ents, _ := os.ReadDir(s.Dir)
	for _, e := range ents {
		if !e.IsDir() || strings.HasPrefix(e.Name(), ".") {
			continue
		}
		dir := filepath.Join(s.Dir, e.Name())
		wd := readYaml(filepath.Join(dir, wsFile))
		if wd == nil {
			continue
		}
		id := doc.Str(wd, "id")
		if id == "" {
			id = NewID("wrk")
		}
		if _, dup := s.index[id]; dup {
			continue
		}
		name := doc.Str(wd, "name")
		if name == "" {
			name = e.Name()
		}
		settings, _ := wd["settings"].(Doc)
		if settings == nil {
			settings = Doc{}
		}
		ws := Doc{
			"id":          id,
			"name":        name,
			"description": wd["description"],
			"settings":    Doc{"insecureTLS": settings["insecureTLS"] == true, "timeoutMs": doc.Num(settings, "timeoutMs", 30000)},
			"location":    Doc{"dir": dir, "linked": false},
		}
		s.index[id] = indexEntry{"workspace", dir, id}
		ws["environments"] = doc.Docs(s.loadEnvs(dir, id))
		ws["children"] = doc.Docs(s.loadDir(dir, id))
		out = append(out, ws)
	}
	sort.SliceStable(out, func(i, j int) bool { return doc.Str(out[i], "name") < doc.Str(out[j], "name") })
	s.workspaces = out
	return out
}

func (s *Store) loadEnvs(wsDir, wsID string) []Doc {
	dir := filepath.Join(wsDir, envDir)
	ents, err := os.ReadDir(dir)
	if err != nil {
		return []Doc{}
	}
	envs := []Doc{}
	for _, e := range ents {
		if !strings.HasSuffix(e.Name(), ".yaml") {
			continue
		}
		file := filepath.Join(dir, e.Name())
		raw := readYaml(file)
		if raw == nil {
			continue
		}
		env := Doc{"id": doc.Str(raw, "id"), "name": doc.Str(raw, "name"), "parentId": raw["parentId"], "sortKey": doc.Num(raw, "sortKey", 0)}
		if env["id"] == "" {
			env["id"] = NewID("env")
		}
		if env["name"] == "" {
			env["name"] = strings.TrimSuffix(e.Name(), ".yaml")
		}
		if c := doc.Str(raw, "color"); c != "" {
			env["color"] = c
		}
		if d, ok := raw["data"].(Doc); ok {
			env["data"] = d
		} else {
			env["data"] = Doc{}
		}
		s.index[env["id"].(string)] = indexEntry{"env", file, wsID}
		envs = append(envs, env)
	}
	doc.Sort(envs)
	return envs
}

func (s *Store) loadDir(dir, wsID string) []Doc {
	nodes := []Doc{}
	ents, _ := os.ReadDir(dir)
	for _, e := range ents {
		p := filepath.Join(dir, e.Name())
		if e.IsDir() {
			if e.Name() == envDir || strings.HasPrefix(e.Name(), ".") {
				continue
			}
			raw := readYaml(filepath.Join(p, folderFile))
			if raw == nil {
				raw = Doc{}
			}
			f := normFolder(raw, e.Name())
			s.index[f["id"].(string)] = indexEntry{"folder", p, wsID}
			f["children"] = doc.Docs(s.loadDir(p, wsID))
			nodes = append(nodes, f)
		} else if strings.HasSuffix(e.Name(), ".yaml") && e.Name() != folderFile && e.Name() != wsFile {
			raw := readYaml(p)
			if raw == nil {
				continue
			}
			r := normRequest(raw, strings.TrimSuffix(e.Name(), ".yaml"))
			s.index[r["id"].(string)] = indexEntry{"request", p, wsID}
			nodes = append(nodes, r)
		}
	}
	doc.Sort(nodes)
	return nodes
}

func (s *Store) List() []Doc {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.workspaces
}

// ---------- escrita ----------

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

func stripEmpty(d Doc) Doc {
	out := Doc{}
	for k, v := range d {
		if v == nil || v == "" {
			continue
		}
		out[k] = v
	}
	return out
}

func writeYaml(file string, d Doc) error {
	_ = os.MkdirAll(filepath.Dir(file), 0o755)
	b, err := yaml.Marshal(d)
	if err != nil {
		return err
	}
	return os.WriteFile(file, b, 0o644)
}

// SaveRequest grava o request (renomeia o arquivo se o nome mudou)
func (s *Store) SaveRequest(req Doc) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	id := doc.Str(req, "id")
	e, ok := s.index[id]
	if !ok || e.kind != "request" {
		return errors.New("request não encontrado")
	}
	file := e.path
	if Slugify(strings.TrimSuffix(filepath.Base(file), ".yaml")) != Slugify(doc.Str(req, "name")) {
		next := filepath.Join(filepath.Dir(file), Slugify(doc.Str(req, "name"))+".yaml")
		for i := 2; ; i++ {
			if _, err := os.Stat(next); err != nil {
				break
			}
			next = filepath.Join(filepath.Dir(file), Slugify(doc.Str(req, "name"))+"-"+strconv.Itoa(i)+".yaml")
		}
		if err := os.Rename(file, next); err == nil {
			file = next
			e.path = next
			s.index[id] = e
		}
	}
	out := Doc{}
	for k, v := range req {
		if k != "kind" {
			out[k] = v
		}
	}
	if err := writeYaml(file, stripEmpty(out)); err != nil {
		return err
	}
	// mantém a árvore em memória igual ao disco
	for _, ws := range s.workspaces {
		doc.Replace(doc.List(ws, "children"), req)
	}
	return nil
}

// ---------- estado e respostas ----------

func (s *Store) GetState() Doc {
	st := Doc{"activeEnv": Doc{}}
	if b, err := os.ReadFile(filepath.Join(s.Dir, "state.json")); err == nil {
		_ = json.Unmarshal(b, &st)
	}
	return st
}

func (s *Store) SetState(st json.RawMessage) error {
	return os.WriteFile(filepath.Join(s.Dir, "state.json"), st, 0o644)
}

var unsafeName = regexp.MustCompile(`[^\w-]`)

// ResponsesFile: histórico de um request
func (s *Store) ResponsesFile(reqID string) string {
	return filepath.Join(s.Dir, ".responses", unsafeName.ReplaceAllString(reqID, "_")+".json")
}

func (s *Store) GetResponses(reqID string) []any {
	out := []any{}
	if b, err := os.ReadFile(s.ResponsesFile(reqID)); err == nil {
		_ = json.Unmarshal(b, &out)
	}
	return out
}

// AddResponse guarda no histórico (body grande vai pra arquivo à parte, com prévia)
func (s *Store) AddResponse(rec Doc) []any {
	if size, _ := rec["size"].(int); size > largeBody {
		bp := filepath.Join(s.Dir, ".responses", "bodies", unsafeName.ReplaceAllString(doc.Str(rec, "id"), "_"))
		_ = os.MkdirAll(filepath.Dir(bp), 0o755)
		body, _ := rec["body"].(string)
		_ = os.WriteFile(bp, []byte(body), 0o644)
		short := Doc{}
		for k, v := range rec {
			short[k] = v
		}
		if rec["bodyEncoding"] == "utf8" && len(body) > previewChars {
			short["body"] = body[:previewChars]
		} else if rec["bodyEncoding"] != "utf8" {
			short["body"] = ""
		}
		short["bodyFile"] = true
		rec = short
	}
	all := append([]any{rec}, s.GetResponses(doc.Str(rec, "requestId"))...)
	if len(all) > maxResponses {
		all = all[:maxResponses]
	}
	file := s.ResponsesFile(doc.Str(rec, "requestId"))
	_ = os.MkdirAll(filepath.Dir(file), 0o755)
	b, _ := json.Marshal(all)
	_ = os.WriteFile(file, b, 0o644)
	return all
}
