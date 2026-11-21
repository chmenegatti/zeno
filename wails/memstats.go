package main

// Medição de memória (#159). O RSS do binário Go não é o retrato todo: no Linux a renderização do
// WebKitGTK roda em processos filhos (WebKitWebProcess, WebKitNetworkProcess). memSnapshot junta as
// estatísticas do runtime Go com a memória de cada processo da árvore do app.
//
//	ZENO_MEMSTATS=1      grava um resumo no stderr a cada 10 s (ou ZENO_MEMSTATS=2s, 1m…)
//	window.zeno.memStats()  o mesmo resumo como objeto (roteiros de benchmark)

import (
	"fmt"
	"io"
	"os"
	"runtime"
	"runtime/debug"
	"strings"
	"time"
)

type procMem struct {
	PID  int    `json:"pid"`
	Name string `json:"name"`
	RSS  uint64 `json:"rss"` // bytes
	PSS  uint64 `json:"pss"` // bytes; 0 quando o sistema não informa
}

type memSnapshot struct {
	HeapAlloc    uint64    `json:"heapAlloc"`
	HeapInuse    uint64    `json:"heapInuse"`
	HeapIdle     uint64    `json:"heapIdle"`
	HeapReleased uint64    `json:"heapReleased"`
	Sys          uint64    `json:"sys"`
	NumGC        uint32    `json:"numGC"`
	MemLimit     int64     `json:"memLimit"` // debug.SetMemoryLimit / GOMEMLIMIT; math.MaxInt64 = sem limite
	Trim         bool      `json:"trim"`
	Procs        []procMem `json:"procs"` // o app primeiro, depois os filhos
	TotalRSS     uint64    `json:"totalRss"`
	TotalPSS     uint64    `json:"totalPss"`
}

func readMemSnapshot() memSnapshot {
	var s runtime.MemStats
	runtime.ReadMemStats(&s)
	m := memSnapshot{
		HeapAlloc: s.HeapAlloc, HeapInuse: s.HeapInuse, HeapIdle: s.HeapIdle,
		HeapReleased: s.HeapReleased, Sys: s.Sys, NumGC: s.NumGC,
		MemLimit: debug.SetMemoryLimit(-1), Trim: trimEnabled(),
		Procs: processTree(os.Getpid()),
	}
	for _, p := range m.Procs {
		m.TotalRSS += p.RSS
		m.TotalPSS += p.PSS
	}
	return m
}

func mib(b uint64) string { return fmt.Sprintf("%.1f", float64(b)/(1<<20)) }

// String: uma linha, MiB
func (m memSnapshot) String() string {
	var b strings.Builder
	fmt.Fprintf(&b, "MEM heapAlloc=%s heapInuse=%s heapIdle=%s heapReleased=%s sys=%s gc=%d",
		mib(m.HeapAlloc), mib(m.HeapInuse), mib(m.HeapIdle), mib(m.HeapReleased), mib(m.Sys), m.NumGC)
	for _, p := range m.Procs {
		fmt.Fprintf(&b, " | %s[%d] rss=%s pss=%s", p.Name, p.PID, mib(p.RSS), mib(p.PSS))
	}
	fmt.Fprintf(&b, " | total rss=%s pss=%s", mib(m.TotalRSS), mib(m.TotalPSS))
	return b.String()
}

// memStatsInterval: ZENO_MEMSTATS=1 → 10 s; aceita duração do Go (2s, 1m); vazio/0 → desligado
func memStatsInterval(v string) time.Duration {
	switch v {
	case "", "0", "false":
		return 0
	case "1", "true":
		return 10 * time.Second
	}
	if d, err := time.ParseDuration(v); err == nil && d > 0 {
		return d
	}
	return 10 * time.Second
}

// logMemStats grava o resumo em w a cada intervalo até stop fechar
func logMemStats(w io.Writer, every time.Duration, stop <-chan struct{}) {
	t := time.NewTicker(every)
	defer t.Stop()
	for {
		fmt.Fprintln(w, readMemSnapshot())
		select {
		case <-stop:
			return
		case <-t.C:
		}
	}
}
