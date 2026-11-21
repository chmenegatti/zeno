package main

import (
	"os"
	"strings"
	"testing"
	"time"
)

func TestMemStatsInterval(t *testing.T) {
	for in, want := range map[string]time.Duration{"": 0, "0": 0, "1": 10 * time.Second, "2s": 2 * time.Second, "x": 10 * time.Second} {
		if got := memStatsInterval(in); got != want {
			t.Errorf("%q: %v, quer %v", in, got, want)
		}
	}
}

func TestReadMemSnapshot(t *testing.T) {
	m := readMemSnapshot()
	if m.HeapAlloc == 0 || m.Sys == 0 {
		t.Fatalf("runtime zerado: %+v", m)
	}
	if len(m.Procs) > 0 && (m.Procs[0].PID != os.Getpid() || m.Procs[0].RSS == 0 || m.TotalRSS < m.Procs[0].RSS) {
		t.Fatalf("processo do app: %+v", m.Procs)
	}
	if s := m.String(); !strings.HasPrefix(s, "MEM heapAlloc=") || !strings.Contains(s, "total rss=") {
		t.Fatal(s)
	}
}
