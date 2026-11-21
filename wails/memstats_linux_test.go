package main

import (
	"os"
	"os/exec"
	"testing"
	"time"
)

// filho e neto entram na árvore (o WebKit pode vir via bwrap)
func TestProcessTreeChildren(t *testing.T) {
	cmd := exec.Command("sh", "-c", "sleep 5 & wait")
	if err := cmd.Start(); err != nil {
		t.Skip(err)
	}
	defer cmd.Process.Kill()
	var names []string
	for i := 0; i < 100; i++ {
		names = names[:0]
		for _, p := range processTree(os.Getpid()) {
			names = append(names, p.Name)
		}
		if len(names) > 0 && names[len(names)-1] == "sleep" {
			return
		}
		time.Sleep(20 * time.Millisecond)
	}
	t.Fatalf("neto não apareceu: %v", names)
}
