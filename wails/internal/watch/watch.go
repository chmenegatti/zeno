// Package watch: avisa quando arquivos da pasta de dados (ou de workspaces vinculados) mudam fora do app,
// como o chokidar no Electron. Recursivo (o fsnotify não é), com debounce e janela pra ignorar as
// escritas do próprio app.
package watch

import (
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/fsnotify/fsnotify"
)

// Options do watcher
type Options struct {
	// Debounce: espera esse tempo sem eventos antes de avisar (Electron: 300 ms)
	Debounce time.Duration
	// Quiet: ignora eventos até esse tempo depois de uma escrita do próprio app (Electron: 1500 ms)
	Quiet time.Duration
	// LastWrite: quando o app escreveu pela última vez
	LastWrite func() time.Time
	// OnChange: chamado (fora do lock) quando algo mudou
	OnChange func()
}

// Watcher recursivo
type Watcher struct {
	opt   Options
	fs    *fsnotify.Watcher
	mu    sync.Mutex
	roots map[string]bool
	timer *time.Timer
	done  chan struct{}
}

// ignorado: qualquer parte começando com ponto (.responses, .vault, .git, .cookies…), state.json e links.json
func ignored(p string) bool {
	for _, part := range strings.Split(filepath.ToSlash(p), "/") {
		if strings.HasPrefix(part, ".") && part != "." && part != ".." {
			return true
		}
	}
	base := filepath.Base(p)
	return base == "state.json" || base == "links.json"
}

// New começa a vigiar as pastas
func New(roots []string, opt Options) (*Watcher, error) {
	if opt.Debounce == 0 {
		opt.Debounce = 300 * time.Millisecond
	}
	if opt.Quiet == 0 {
		opt.Quiet = 1500 * time.Millisecond
	}
	if opt.LastWrite == nil {
		opt.LastWrite = func() time.Time { return time.Time{} }
	}
	f, err := fsnotify.NewWatcher()
	if err != nil {
		return nil, err
	}
	w := &Watcher{opt: opt, fs: f, roots: map[string]bool{}, done: make(chan struct{})}
	w.Add(roots...)
	go w.loop()
	return w, nil
}

// Add passa a vigiar mais pastas (ex.: workspace vinculado agora)
func (w *Watcher) Add(roots ...string) {
	for _, r := range roots {
		w.mu.Lock()
		seen := w.roots[r]
		w.roots[r] = true
		w.mu.Unlock()
		if !seen {
			w.addTree(r, r)
		}
	}
}

func (w *Watcher) relIgnored(p string) bool {
	w.mu.Lock()
	defer w.mu.Unlock()
	for r := range w.roots {
		if rel, err := filepath.Rel(r, p); err == nil && !strings.HasPrefix(rel, "..") {
			return ignored(rel)
		}
	}
	return ignored(p)
}

func (w *Watcher) addTree(root, dir string) {
	_ = filepath.WalkDir(dir, func(p string, d os.DirEntry, err error) error {
		if err != nil || !d.IsDir() {
			return nil
		}
		if rel, _ := filepath.Rel(root, p); ignored(rel) {
			return filepath.SkipDir
		}
		_ = w.fs.Add(p)
		return nil
	})
}

func (w *Watcher) loop() {
	for {
		select {
		case <-w.done:
			return
		case ev, ok := <-w.fs.Events:
			if !ok {
				return
			}
			if w.relIgnored(ev.Name) {
				continue
			}
			// pasta nova: vigia ela também (fsnotify não é recursivo)
			if ev.Has(fsnotify.Create) {
				if fi, err := os.Stat(ev.Name); err == nil && fi.IsDir() {
					w.addTree(ev.Name, ev.Name)
				}
			}
			w.bump()
		case _, ok := <-w.fs.Errors:
			if !ok {
				return
			}
		}
	}
}

func (w *Watcher) quiet() bool {
	return time.Since(w.opt.LastWrite()) < w.opt.Quiet
}

func (w *Watcher) bump() {
	if w.quiet() {
		return
	}
	w.mu.Lock()
	defer w.mu.Unlock()
	if w.timer != nil {
		w.timer.Stop()
	}
	w.timer = time.AfterFunc(w.opt.Debounce, func() {
		if !w.quiet() {
			w.opt.OnChange()
		}
	})
}

// Close para de vigiar
func (w *Watcher) Close() error {
	close(w.done)
	w.mu.Lock()
	if w.timer != nil {
		w.timer.Stop()
	}
	w.mu.Unlock()
	return w.fs.Close()
}
