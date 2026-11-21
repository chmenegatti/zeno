package main

import (
	"bufio"
	"bytes"
	"os"
	"path/filepath"
	"strconv"
	"strings"
)

// processTree: pid e todos os descendentes (o WebKit pode passar por bwrap/xdg-dbus-proxy), lidos de /proc
func processTree(root int) []procMem {
	children := map[int][]int{}
	dirs, _ := filepath.Glob("/proc/[0-9]*")
	for _, d := range dirs {
		pid, err := strconv.Atoi(filepath.Base(d))
		if err != nil {
			continue
		}
		if ppid := statPPID(d); ppid > 0 {
			children[ppid] = append(children[ppid], pid)
		}
	}
	var out []procMem
	queue := []int{root}
	for len(queue) > 0 {
		pid := queue[0]
		queue = queue[1:]
		if p, ok := readProcMem(pid); ok {
			out = append(out, p)
		}
		queue = append(queue, children[pid]...)
	}
	return out
}

// statPPID: 4º campo de /proc/<pid>/stat; o nome (2º) vem entre parênteses e pode ter espaço
func statPPID(dir string) int {
	b, err := os.ReadFile(dir + "/stat")
	if err != nil {
		return 0
	}
	i := bytes.LastIndexByte(b, ')')
	if i < 0 {
		return 0
	}
	f := strings.Fields(string(b[i+1:]))
	if len(f) < 2 {
		return 0
	}
	n, _ := strconv.Atoi(f[1])
	return n
}

func readProcMem(pid int) (procMem, bool) {
	dir := "/proc/" + strconv.Itoa(pid)
	comm, err := os.ReadFile(dir + "/comm")
	if err != nil {
		return procMem{}, false
	}
	p := procMem{PID: pid, Name: strings.TrimSpace(string(comm))}
	// smaps_rollup (kernel 4.14+) tem Rss e Pss; status (VmRSS) fica de reserva
	if f, err := os.Open(dir + "/smaps_rollup"); err == nil {
		p.RSS, p.PSS = kbFields(f, "Rss:", "Pss:")
		f.Close()
	}
	if p.RSS == 0 {
		if f, err := os.Open(dir + "/status"); err == nil {
			p.RSS, _ = kbFields(f, "VmRSS:", "")
			f.Close()
		}
	}
	return p, true
}

// kbFields lê duas linhas "Nome:   123 kB" e devolve em bytes
func kbFields(f *os.File, a, b string) (va, vb uint64) {
	sc := bufio.NewScanner(f)
	for sc.Scan() {
		line := sc.Text()
		for _, k := range []struct {
			name string
			dst  *uint64
		}{{a, &va}, {b, &vb}} {
			if k.name != "" && strings.HasPrefix(line, k.name) {
				if f := strings.Fields(line[len(k.name):]); len(f) > 0 {
					n, _ := strconv.ParseUint(f[0], 10, 64)
					*k.dst = n << 10
				}
			}
		}
	}
	return
}
