package store

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/chmenegatti/zeno/wails/internal/vars"
)

// valores locais (#153): ficam fora da pasta do workspace e entram no workspace carregado
func TestLocalVars(t *testing.T) {
	s := New(t.TempDir())
	list, err := s.CreateWorkspace("Loja")
	if err != nil {
		t.Fatal(err)
	}
	ws := list[0]
	base := ws.List("environments")[0].(*Doc)
	if _, err := s.SetLocalVar(ws.Str("id"), base.Str("id"), "porta", "local-123"); err != nil {
		t.Fatal(err)
	}
	got := s.Workspace(ws.Str("id"))
	if v := got.Map("localVars").Map(base.Str("id")).Get("porta"); v != "local-123" {
		t.Fatalf("localVars = %v", got.Get("localVars"))
	}
	if v := vars.BuildVars(got, "", nil).Get("porta"); v != "local-123" {
		t.Errorf("BuildVars porta = %v", v)
	}
	// nada dentro da pasta do workspace
	dir := got.Map("location").Str("dir")
	filepath.Walk(dir, func(p string, _ os.FileInfo, _ error) error {
		if b, _ := os.ReadFile(p); strings.Contains(string(b), "local-123") {
			t.Errorf("valor local em %s", p)
		}
		return nil
	})
	if b, _ := os.ReadFile(filepath.Join(s.Dir, ".gitignore")); !strings.Contains(string(b), localVarsFile) {
		t.Error(".gitignore sem local-vars.yaml")
	}
	// apagar o último valor limpa o workspace do arquivo
	if _, err := s.SetLocalVar(ws.Str("id"), base.Str("id"), "porta", nil); err != nil {
		t.Fatal(err)
	}
	if s.Workspace(ws.Str("id")).Has("localVars") {
		t.Error("localVars deveria sumir")
	}
	if all := readYaml(s.localVarsPath()); all == nil || all.Len() != 0 {
		t.Errorf("arquivo = %v", all)
	}
}
