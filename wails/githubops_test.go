package main

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/chmenegatti/zeno/wails/internal/store"
)

// status de envio sobrevive a sair (apaga .github.json) e entrar de novo na mesma conta
func TestGhSyncedSobreviveAoSair(t *testing.T) {
	dir := t.TempDir()
	a := &App{store: &store.Store{Dir: dir}}
	ws := filepath.Join(dir, "loja")
	os.MkdirAll(ws, 0o755)
	os.WriteFile(filepath.Join(ws, "workspace.yaml"), []byte("id: wrk_a\nname: A\n"), 0o644)
	os.WriteFile(a.ghFile(), []byte(`{"login":"ana","repo":"zeno-collections","token":"x"}`), 0o600)
	a.ghMarkSynced(map[string]string{"wrk_a": ws}, "abc")
	os.Remove(a.ghFile())
	s := a.ghSyncedRead()["ana"]["wrk_a"]
	if s.Commit != "abc" || s.Repo != "zeno-collections" || s.Hash == "" || s.Hash != wsHash(ws) {
		t.Fatalf("%+v", s)
	}
	os.WriteFile(filepath.Join(ws, "workspace.yaml"), []byte("id: wrk_a\nname: B\n"), 0o644)
	if wsHash(ws) == s.Hash {
		t.Error("hash não mudou com o YAML")
	}
}
