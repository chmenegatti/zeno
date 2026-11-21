package main

// Devolve memória ao sistema depois de picos (resposta de 50 MB, importação grande). Com o app parado o
// GC do Go não roda de novo e o heap do pico ficava preso no processo.

import (
	"os"
	"runtime"
	"runtime/debug"
	"sync"
	"time"
)

const trimAbove = 64 << 20 // heap acima disso depois de uma chamada: libera em seguida

type memTrim struct {
	mu    sync.Mutex
	timer *time.Timer
}

// after: chamado ao fim de cada Call; agenda a liberação (uma só, 1 s depois da última chamada grande)
func (m *memTrim) after() {
	if !trimEnabled() {
		return
	}
	var s runtime.MemStats
	runtime.ReadMemStats(&s)
	if s.HeapAlloc < trimAbove {
		return
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.timer != nil {
		m.timer.Stop()
	}
	m.timer = time.AfterFunc(time.Second, debug.FreeOSMemory)
}

// trimEnabled: ZENO_NO_TRIM=1 desliga a liberação (comparar com GOMEMLIMIT/GOGC, #159)
func trimEnabled() bool { return os.Getenv("ZENO_NO_TRIM") == "" }
