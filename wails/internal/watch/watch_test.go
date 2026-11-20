package watch

import (
	"os"
	"path/filepath"
	"sync/atomic"
	"testing"
	"time"
)

func waitFor(t *testing.T, n *atomic.Int32, want int32) {
	t.Helper()
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		if n.Load() >= want {
			return
		}
		time.Sleep(20 * time.Millisecond)
	}
	t.Fatalf("esperava %d avisos, veio %d", want, n.Load())
}

func TestAvisaMudancaExternaComDebounce(t *testing.T) {
	dir := t.TempDir()
	_ = os.MkdirAll(filepath.Join(dir, "ws", "pasta"), 0o755)
	var n atomic.Int32
	w, err := New([]string{dir}, Options{Debounce: 80 * time.Millisecond, Quiet: 200 * time.Millisecond, OnChange: func() { n.Add(1) }})
	if err != nil {
		t.Fatal(err)
	}
	defer w.Close()
	// várias escritas seguidas: um aviso só
	for i := 0; i < 5; i++ {
		_ = os.WriteFile(filepath.Join(dir, "ws", "pasta", "r.yaml"), []byte("name: x"), 0o644)
	}
	waitFor(t, &n, 1)
	time.Sleep(200 * time.Millisecond)
	if n.Load() != 1 {
		t.Errorf("avisos: %d", n.Load())
	}
	// pasta criada depois também é vigiada
	_ = os.MkdirAll(filepath.Join(dir, "ws", "nova"), 0o755)
	time.Sleep(150 * time.Millisecond)
	_ = os.WriteFile(filepath.Join(dir, "ws", "nova", "x.yaml"), []byte("a: 1"), 0o644)
	waitFor(t, &n, 3)
}

func TestIgnoraArquivosDoAppEEscritaPropria(t *testing.T) {
	dir := t.TempDir()
	_ = os.MkdirAll(filepath.Join(dir, ".responses"), 0o755)
	var n atomic.Int32
	var last atomic.Int64
	w, err := New([]string{dir}, Options{Debounce: 50 * time.Millisecond, Quiet: 300 * time.Millisecond,
		LastWrite: func() time.Time { return time.UnixMilli(last.Load()) },
		OnChange:  func() { n.Add(1) }})
	if err != nil {
		t.Fatal(err)
	}
	defer w.Close()
	_ = os.WriteFile(filepath.Join(dir, ".responses", "r.json"), []byte("[]"), 0o644)
	_ = os.WriteFile(filepath.Join(dir, "state.json"), []byte("{}"), 0o644)
	_ = os.WriteFile(filepath.Join(dir, "links.json"), []byte("[]"), 0o644)
	// escrita do próprio app
	last.Store(time.Now().UnixMilli())
	_ = os.WriteFile(filepath.Join(dir, "a.yaml"), []byte("x: 1"), 0o644)
	time.Sleep(400 * time.Millisecond)
	if n.Load() != 0 {
		t.Errorf("não devia avisar: %d", n.Load())
	}
}

func TestVinculadoAdicionadoDepois(t *testing.T) {
	dir, linked := t.TempDir(), t.TempDir()
	var n atomic.Int32
	w, _ := New([]string{dir}, Options{Debounce: 50 * time.Millisecond, OnChange: func() { n.Add(1) }})
	defer w.Close()
	w.Add(linked)
	_ = os.WriteFile(filepath.Join(linked, "workspace.yaml"), []byte("id: w"), 0o644)
	waitFor(t, &n, 1)
}
