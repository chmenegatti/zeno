// Store: mesmos arquivos YAML do Zeno em Electron (src/main/store.ts), lidos e gravados em Go.
// Os documentos andam como map[string]any: o que a interface manda volta pro YAML sem perder campo.

package main

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

type Doc = map[string]any

type indexEntry struct {
	kind, path, wsID string
}

type Store struct {
	Dir        string
	mu         sync.Mutex
	index      map[string]indexEntry
	workspaces []Doc
}

func defaultDataDir() string {
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

func NewStore(dir string) *Store {
	_ = os.MkdirAll(dir, 0o755)
	return &Store{Dir: dir, index: map[string]indexEntry{}}
}

func newID(prefix string) string {
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

func str(d Doc, k string) string {
	if v, ok := d[k]; ok && v != nil {
		switch x := v.(type) {
		case string:
			return x
		default:
			b, _ := json.Marshal(x)
			return strings.Trim(string(b), `"`)
		}
	}
	return ""
}

func num(d Doc, k string, def float64) float64 {
	switch x := d[k].(type) {
	case int:
		return float64(x)
	case float64:
		return x
	}
	return def
}

func kvList(v any) []any {
	arr, _ := v.([]any)
	out := make([]any, 0, len(arr))
	for _, it := range arr {
		m, _ := it.(Doc)
		if m == nil {
			continue
		}
		out = append(out, Doc{"name": str(m, "name"), "value": str(m, "value"), "enabled": m["enabled"] != false})
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
	if str(raw, "id") == "" {
		r["id"] = newID("req")
	}
	if str(raw, "name") == "" {
		r["name"] = fallback
	}
	m := strings.ToUpper(str(raw, "method"))
	if m == "" {
		m = "GET"
	}
	r["method"] = m
	r["url"] = str(raw, "url")
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
	r["sortKey"] = num(raw, "sortKey", 0)
	return r
}

func normFolder(raw Doc, fallback string) Doc {
	f := Doc{}
	for k, v := range raw {
		f[k] = v
	}
	f["kind"] = "folder"
	if str(raw, "id") == "" {
		f["id"] = newID("fld")
	}
	if str(raw, "name") == "" {
		f["name"] = fallback
	}
	f["sortKey"] = num(raw, "sortKey", 0)
	f["headers"] = kvList(raw["headers"])
	f["auth"] = authOf(raw["auth"])
	if _, ok := raw["vars"].(Doc); !ok {
		f["vars"] = Doc{}
	}
	f["children"] = []any{}
	return f
}

func sortDocs(nodes []Doc) {
	sort.SliceStable(nodes, func(i, j int) bool {
		a, b := num(nodes[i], "sortKey", 0), num(nodes[j], "sortKey", 0)
		if a != b {
			return a < b
		}
		return str(nodes[i], "name") < str(nodes[j], "name")
	})
}

func toAny(ds []Doc) []any {
	out := make([]any, len(ds))
	for i, d := range ds {
		out[i] = d
	}
	return out
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
		doc := readYaml(filepath.Join(dir, wsFile))
		if doc == nil {
			continue
		}
		id := str(doc, "id")
		if id == "" {
			id = newID("wrk")
		}
		if _, dup := s.index[id]; dup {
			continue
		}
		name := str(doc, "name")
		if name == "" {
			name = e.Name()
		}
		settings, _ := doc["settings"].(Doc)
		if settings == nil {
			settings = Doc{}
		}
		ws := Doc{
			"id":          id,
			"name":        name,
			"description": doc["description"],
			"settings":    Doc{"insecureTLS": settings["insecureTLS"] == true, "timeoutMs": num(settings, "timeoutMs", 30000)},
			"location":    Doc{"dir": dir, "linked": false},
		}
		s.index[id] = indexEntry{"workspace", dir, id}
		ws["environments"] = toAny(s.loadEnvs(dir, id))
		ws["children"] = toAny(s.loadDir(dir, id))
		out = append(out, ws)
	}
	sort.SliceStable(out, func(i, j int) bool { return str(out[i], "name") < str(out[j], "name") })
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
		env := Doc{"id": str(raw, "id"), "name": str(raw, "name"), "parentId": raw["parentId"], "sortKey": num(raw, "sortKey", 0)}
		if env["id"] == "" {
			env["id"] = newID("env")
		}
		if env["name"] == "" {
			env["name"] = strings.TrimSuffix(e.Name(), ".yaml")
		}
		if c := str(raw, "color"); c != "" {
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
	sortDocs(envs)
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
			f["children"] = toAny(s.loadDir(p, wsID))
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
	sortDocs(nodes)
	return nodes
}

func (s *Store) List() []Doc {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.workspaces
}

// ---------- escrita ----------

var nonSlug = regexp.MustCompile(`[^a-z0-9]+`)

func slugify(name string) string {
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
	id := str(req, "id")
	e, ok := s.index[id]
	if !ok || e.kind != "request" {
		return errors.New("request não encontrado")
	}
	file := e.path
	if slugify(strings.TrimSuffix(filepath.Base(file), ".yaml")) != slugify(str(req, "name")) {
		next := filepath.Join(filepath.Dir(file), slugify(str(req, "name"))+".yaml")
		for i := 2; ; i++ {
			if _, err := os.Stat(next); err != nil {
				break
			}
			next = filepath.Join(filepath.Dir(file), slugify(str(req, "name"))+"-"+strconv.Itoa(i)+".yaml")
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
		replaceNode(ws["children"], req)
	}
	return nil
}

func replaceNode(children any, node Doc) bool {
	arr, _ := children.([]any)
	for i, c := range arr {
		d, _ := c.(Doc)
		if d == nil {
			continue
		}
		if str(d, "id") == str(node, "id") {
			arr[i] = node
			return true
		}
		if str(d, "kind") == "folder" && replaceNode(d["children"], node) {
			return true
		}
	}
	return false
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

func (s *Store) responsesFile(reqID string) string {
	return filepath.Join(s.Dir, ".responses", unsafeName.ReplaceAllString(reqID, "_")+".json")
}

func (s *Store) GetResponses(reqID string) []any {
	out := []any{}
	if b, err := os.ReadFile(s.responsesFile(reqID)); err == nil {
		_ = json.Unmarshal(b, &out)
	}
	return out
}

// AddResponse guarda no histórico (body grande vai pra arquivo à parte, com prévia)
func (s *Store) AddResponse(rec Doc) []any {
	if size, _ := rec["size"].(int); size > largeBody {
		bp := filepath.Join(s.Dir, ".responses", "bodies", unsafeName.ReplaceAllString(str(rec, "id"), "_"))
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
	all := append([]any{rec}, s.GetResponses(str(rec, "requestId"))...)
	if len(all) > maxResponses {
		all = all[:maxResponses]
	}
	file := s.responsesFile(str(rec, "requestId"))
	_ = os.MkdirAll(filepath.Dir(file), 0o755)
	b, _ := json.Marshal(all)
	_ = os.WriteFile(file, b, 0o644)
	return all
}

// FindNode devolve o nó e as pastas acima dele
func FindNode(ws Doc, id string) (Doc, []Doc) {
	var walk func(children any, anc []Doc) (Doc, []Doc)
	walk = func(children any, anc []Doc) (Doc, []Doc) {
		arr, _ := children.([]any)
		for _, c := range arr {
			d, _ := c.(Doc)
			if d == nil {
				continue
			}
			if str(d, "id") == id {
				return d, anc
			}
			if str(d, "kind") == "folder" {
				if n, a := walk(d["children"], append(append([]Doc{}, anc...), d)); n != nil {
					return n, a
				}
			}
		}
		return nil, nil
	}
	return walk(ws["children"], nil)
}
