package store

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/chmenegatti/zeno/wails/internal/doc"
)

// lixeira (#155): excluir move pra .trash, restaurar devolve com o mesmo id e lugar
func TestLixeira(t *testing.T) {
	s := New(t.TempDir())
	list, _ := s.CreateWorkspace("Loja")
	wsID := list[0].Str("id")
	_, fld, _ := s.CreateFolder(wsID, "Pedidos", 1)
	_, req, _ := s.CreateRequest(fld, "Listar", 1)
	_, req2, _ := s.CreateRequest(wsID, "Solto", 2)

	list, tid, err := s.DeleteNode(fld)
	if err != nil || tid == "" {
		t.Fatal(err, tid)
	}
	if n, _ := doc.Find(list[0], req); n != nil {
		t.Fatal("request da pasta ainda aparece")
	}
	items := s.Trash(wsID)
	if len(items) != 1 || items[0].Str("name") != "Pedidos" || items[0].Get("requests") != int64(1) {
		t.Fatalf("lixeira %v", items)
	}
	if b, _ := os.ReadFile(filepath.Join(s.Dir, ".gitignore")); !strings.Contains(string(b), ".trash/") {
		t.Error(".gitignore sem .trash/")
	}
	list, id, err := s.RestoreTrash(tid)
	if err != nil || id != fld {
		t.Fatal(err, id)
	}
	if n, anc := doc.Find(list[0], req); n == nil || len(anc) != 1 || anc[0].Str("id") != fld {
		t.Fatal("request não voltou pra pasta")
	}
	if len(s.Trash(wsID)) != 0 {
		t.Error("item deveria sair da lixeira")
	}

	// pasta de origem apagada: volta pra raiz; nome ocupado ganha sufixo
	_, t2, _ := s.DeleteNode(req)
	s.DeleteNode(fld)
	list, id, err = s.RestoreTrash(t2)
	if n, anc := doc.Find(list[0], id); err != nil || n == nil || len(anc) != 0 {
		t.Fatalf("restaurar sem a pasta: %v %v", err, anc)
	}
	_, t3, _ := s.DeleteNode(req2)
	s.CreateRequest(wsID, "Solto", 3)
	if list, _, err = s.RestoreTrash(t3); err != nil || len(list[0].List("children")) != 3 {
		t.Fatalf("nome ocupado: %v %d", err, len(list[0].List("children")))
	}

	// id inválido e limpeza por idade
	if _, _, err := s.RestoreTrash("../x"); err == nil {
		t.Error("id com barra deveria falhar")
	}
	s.PurgeTrash(time.Hour)
	if len(s.Trash("")) != 1 {
		t.Fatalf("purge cedo demais: %d", len(s.Trash("")))
	}
	s.PurgeTrash(0)
	if len(s.Trash("")) != 0 {
		t.Error("purge deveria apagar")
	}
	_, t4, _ := s.DeleteNode(id)
	if err := s.EmptyTrash(wsID); err != nil || len(s.Trash(wsID)) != 0 || t4 == "" {
		t.Error("esvaziar")
	}
}
