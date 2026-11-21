package store

// Lixeira (#155): excluir pasta/request move os arquivos pra <pasta de dados>/.trash/<id>/ com um
// meta.json; desfazer devolve pro mesmo lugar (mesmos ids e ordem). Itens com mais de 30 dias somem.

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"time"

	"github.com/chmenegatti/zeno/wails/internal/doc"
	"github.com/chmenegatti/zeno/wails/internal/i18n"
)

const (
	trashDir    = ".trash"
	trashMeta   = "meta.json"
	TrashMaxAge = 30 * 24 * time.Hour
)

type trashInfo struct {
	ID        string `json:"id"`
	WsID      string `json:"wsId"`
	NodeID    string `json:"nodeId"`
	ParentID  string `json:"parentId"`
	Kind      string `json:"kind"`
	Name      string `json:"name"`
	Requests  int    `json:"requests"`
	File      string `json:"file"`
	DeletedAt int64  `json:"deletedAt"`
}

func (s *Store) trashRoot() string { return filepath.Join(s.Dir, trashDir) }

// moveAll: rename, ou copia e apaga quando a origem está em outro disco (workspace vinculado)
func moveAll(src, dst string) error {
	if err := os.MkdirAll(filepath.Dir(dst), 0o755); err != nil {
		return err
	}
	if err := os.Rename(src, dst); err == nil {
		return nil
	}
	err := filepath.Walk(src, func(p string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}
		rel, _ := filepath.Rel(src, p)
		to := filepath.Join(dst, rel)
		if info.IsDir() {
			return os.MkdirAll(to, 0o755)
		}
		in, err := os.Open(p)
		if err != nil {
			return err
		}
		defer in.Close()
		out, err := os.Create(to)
		if err != nil {
			return err
		}
		if _, err := io.Copy(out, in); err != nil {
			out.Close()
			return err
		}
		return out.Close()
	})
	if err != nil {
		return err
	}
	return os.RemoveAll(src)
}

// trashNode: move o nó pra lixeira (chamado com o lock)
func (s *Store) trashNode(id string) (string, error) {
	e, ok := s.index[id]
	if !ok || (e.kind != "request" && e.kind != "folder") {
		return "", nil
	}
	info := trashInfo{WsID: e.wsID, NodeID: id, ParentID: e.wsID, Kind: e.kind, File: filepath.Base(e.path), DeletedAt: time.Now().UnixMilli()}
	for _, w := range s.workspaces {
		if w.Str("id") != e.wsID {
			continue
		}
		node, anc := doc.Find(w, id)
		if node != nil {
			info.Name = node.Str("name")
			if node.Str("kind") == "request" {
				info.Requests = 1
			} else {
				doc.Walk(node.List("children"), func(n *Doc) {
					if n.Str("kind") == "request" {
						info.Requests++
					}
				})
			}
		}
		if len(anc) > 0 {
			info.ParentID = anc[len(anc)-1].Str("id")
		}
	}
	info.ID = fmt.Sprintf("%d-%s", info.DeletedAt, id)
	dir := filepath.Join(s.trashRoot(), info.ID)
	s.touch()
	if err := moveAll(e.path, filepath.Join(dir, info.File)); err != nil {
		return "", err
	}
	b, _ := json.MarshalIndent(info, "", "  ")
	if err := os.WriteFile(filepath.Join(dir, trashMeta), b, 0o644); err != nil {
		return "", err
	}
	writeGitignore(s.Dir, trashDir+"/")
	return info.ID, nil
}

func (s *Store) readTrash() []trashInfo {
	var out []trashInfo
	ents, _ := os.ReadDir(s.trashRoot())
	for _, e := range ents {
		b, err := os.ReadFile(filepath.Join(s.trashRoot(), e.Name(), trashMeta))
		if err != nil {
			continue
		}
		var t trashInfo
		if json.Unmarshal(b, &t) == nil && t.ID == e.Name() {
			out = append(out, t)
		}
	}
	slices.SortFunc(out, func(a, b trashInfo) int { return int(b.DeletedAt - a.DeletedAt) })
	return out
}

// Trash: itens da lixeira de um workspace (vazio = todos), mais recente primeiro
func (s *Store) Trash(wsID string) []*Doc {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := []*Doc{}
	for _, t := range s.readTrash() {
		if wsID == "" || t.WsID == wsID {
			out = append(out, doc.New("id", t.ID, "wsId", t.WsID, "nodeId", t.NodeID, "kind", t.Kind, "name", t.Name, "requests", int64(t.Requests), "deletedAt", t.DeletedAt))
		}
	}
	return out
}

// RestoreTrash devolve o item pro lugar de onde saiu (ou pra raiz do workspace, se a pasta não existe mais)
func (s *Store) RestoreTrash(id string) ([]*Doc, string, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if strings.ContainsAny(id, `/\`) || id == "" || id == "." || id == ".." {
		return nil, "", errors.New(i18n.T("item da lixeira inválido"))
	}
	dir := filepath.Join(s.trashRoot(), id)
	b, err := os.ReadFile(filepath.Join(dir, trashMeta))
	if err != nil {
		return nil, "", errors.New(i18n.T("item não está mais na lixeira"))
	}
	var t trashInfo
	if err := json.Unmarshal(b, &t); err != nil {
		return nil, "", err
	}
	if _, ok := s.index[t.WsID]; !ok {
		return nil, "", errors.New(i18n.T("o workspace desse item não existe mais"))
	}
	parent, err := s.dirOfParent(t.ParentID)
	if err != nil {
		parent, _ = s.dirOfParent(t.WsID)
	}
	file := filepath.Base(t.File)
	target := filepath.Join(parent, file)
	if exists(target) {
		ext := filepath.Ext(file)
		if t.Kind == "folder" {
			ext = ""
		}
		target = uniquePath(parent, strings.TrimSuffix(file, ext), ext)
	}
	s.touch()
	if err := moveAll(filepath.Join(dir, file), target); err != nil {
		return nil, "", err
	}
	_ = os.RemoveAll(dir)
	return s.load(), t.NodeID, nil
}

// EmptyTrash apaga de vez os itens de um workspace (vazio = todos)
func (s *Store) EmptyTrash(wsID string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, t := range s.readTrash() {
		if wsID == "" || t.WsID == wsID {
			if err := os.RemoveAll(filepath.Join(s.trashRoot(), t.ID)); err != nil {
				return err
			}
		}
	}
	return nil
}

// PurgeTrash apaga itens mais velhos que maxAge (na abertura do app)
func (s *Store) PurgeTrash(maxAge time.Duration) {
	s.mu.Lock()
	defer s.mu.Unlock()
	limit := time.Now().Add(-maxAge).UnixMilli()
	for _, t := range s.readTrash() {
		if t.DeletedAt < limit {
			_ = os.RemoveAll(filepath.Join(s.trashRoot(), t.ID))
		}
	}
}
