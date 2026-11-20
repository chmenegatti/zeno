// Package cli: `zeno run <workspace> [pasta] [opções]` (port de src/main/cli.ts). Roda a coleção e sai
// com código ≠ 0 se algo falhar. Usado pelo app (`zeno run …`) e pelo binário zeno-cli (sem WebKit, CI).
package cli

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"

	"github.com/chmenegatti/zeno/wails/internal/cookies"
	"github.com/chmenegatti/zeno/wails/internal/doc"
	"github.com/chmenegatti/zeno/wails/internal/engine"
	"github.com/chmenegatti/zeno/wails/internal/keyring"
	"github.com/chmenegatti/zeno/wails/internal/plugins"
	"github.com/chmenegatti/zeno/wails/internal/runner"
	"github.com/chmenegatti/zeno/wails/internal/store"
	"github.com/chmenegatti/zeno/wails/internal/vault"
)

type Doc = doc.Doc

const Usage = `uso: zeno run <workspace> [pasta] [opções]

  <workspace>          nome ou id do workspace, ou caminho de uma pasta com workspace.yaml (ex.: no repositório)
  [pasta]              nome, caminho ("Usuários/Admin") ou id; sem pasta roda o workspace inteiro

opções:
  -e, --env <nome>       sub-ambiente (nome ou id)
  -n, --iterations <n>   repetições (padrão 1; com --data, uma por linha)
  -d, --delay <ms>       espera entre requests
      --data <arquivo>   CSV (com cabeçalho) ou JSON (lista de objetos); cada linha vira variáveis
      --var <nome=valor> variável extra (pode repetir); vale sobre ambiente e dados
      --junit <arquivo>  grava relatório JUnit XML
      --bail             para no primeiro request que falhar
      --data-dir <dir>   pasta de dados do Zeno (padrão: a do app)
  -h, --help             esta ajuda

sai com 0 se tudo passou, 1 se algum request/teste falhou, 2 em erro de uso.`

// NoKeyring: sem chaveiro, valores cifrados não abrem (use --var)
type NoKeyring struct{}

func (NoKeyring) Available() (bool, string, bool)  { return false, "nenhum", true }
func (NoKeyring) Protect(string) ([]byte, error)   { return nil, errors.New("sem chaveiro") }
func (NoKeyring) Unprotect([]byte) (string, error) { return "", errors.New("sem chaveiro") }

type usageError struct{ msg string }

func (e usageError) Error() string { return e.msg }

func usagef(f string, a ...any) error { return usageError{fmt.Sprintf(f, a...)} }

type args struct {
	workspace, folder, env string
	iterations, delayMs    int
	data, junit, dataDir   string
	vars                   *Doc
	bail                   bool
}

var digits = regexp.MustCompile(`^\d+$`)

func parseArgs(argv []string) (*args, bool, error) {
	a := &args{iterations: 1, vars: doc.New()}
	var pos []string
	for i := 0; i < len(argv); i++ {
		arg := argv[i]
		flag, inline, hasInline := arg, "", false
		if strings.HasPrefix(arg, "--") && strings.Contains(arg, "=") {
			k := strings.Index(arg, "=")
			flag, inline, hasInline = arg[:k], arg[k+1:], true
		}
		val := func() (string, error) {
			if hasInline {
				return inline, nil
			}
			if i+1 >= len(argv) {
				return "", usagef("%s precisa de um valor", flag)
			}
			i++
			return argv[i], nil
		}
		num := func() (int, error) {
			v, err := val()
			if err != nil {
				return 0, err
			}
			if !digits.MatchString(v) {
				return 0, usagef("%s espera um número, veio %q", flag, v)
			}
			n, err := strconv.Atoi(v)
			if err != nil {
				return 0, usagef("%s espera um número, veio %q", flag, v)
			}
			return n, nil
		}
		var err error
		switch flag {
		case "-h", "--help":
			return nil, true, nil
		case "-e", "--env":
			a.env, err = val()
		case "-n", "--iterations":
			var n int
			n, err = num()
			a.iterations = max(1, n)
		case "-d", "--delay":
			a.delayMs, err = num()
		case "--data":
			a.data, err = val()
		case "--var":
			var v string
			if v, err = val(); err == nil {
				eq := strings.Index(v, "=")
				if eq <= 0 {
					return nil, false, usagef("--var espera nome=valor, veio %q", v)
				}
				a.vars.Set(v[:eq], v[eq+1:])
			}
		case "--junit":
			a.junit, err = val()
		case "--bail":
			a.bail = true
		case "--data-dir":
			a.dataDir, err = val()
		default:
			if strings.HasPrefix(arg, "-") && arg != "-" {
				return nil, false, usagef("opção desconhecida: %s", arg)
			}
			pos = append(pos, arg)
		}
		if err != nil {
			return nil, false, err
		}
	}
	if len(pos) == 0 {
		return nil, false, usagef("falta o workspace")
	}
	if len(pos) > 2 {
		return nil, false, usagef("argumentos demais: %s", strings.Join(pos[2:], " "))
	}
	a.workspace = pos[0]
	if len(pos) > 1 {
		a.folder = pos[1]
	}
	return a, false, nil
}

func norm(s string) string { return strings.ToLower(strings.TrimSpace(s)) }

func pickWorkspace(st *store.Store, key string) (*Doc, error) {
	list := st.List()
	for _, w := range list {
		if w.Str("id") == key {
			return w, nil
		}
	}
	for _, w := range list {
		if norm(w.Str("name")) == norm(key) {
			return w, nil
		}
	}
	names := []string{}
	for _, w := range list {
		names = append(names, "  "+w.Str("name"))
	}
	if len(names) > 0 {
		return nil, usagef("workspace %q não encontrado. Disponíveis:\n%s", key, strings.Join(names, "\n"))
	}
	return nil, usagef("workspace %q não encontrado", key)
}

func folders(nodes []any) []*Doc {
	out := []*Doc{}
	for _, n := range nodes {
		if d, ok := n.(*Doc); ok && d.Str("kind") == "folder" {
			out = append(out, d)
		}
	}
	return out
}

func pickFolder(ws *Doc, key string) (*Doc, error) {
	if n, _ := doc.Find(ws, key); n != nil && n.Str("kind") == "folder" {
		return n, nil
	}
	parts := []string{}
	for _, p := range strings.Split(key, "/") {
		if p = norm(p); p != "" {
			parts = append(parts, p)
		}
	}
	nodes := ws.List("children")
	var found *Doc
	for _, p := range parts {
		found = nil
		for _, f := range folders(nodes) {
			if norm(f.Str("name")) == p {
				found = f
				break
			}
		}
		if found == nil {
			break
		}
		nodes = found.List("children")
	}
	if found != nil && len(parts) > 0 {
		return found, nil
	}
	// nome solto em qualquer nível
	var matches []*Doc
	var walk func([]any)
	walk = func(ns []any) {
		for _, f := range folders(ns) {
			if norm(f.Str("name")) == norm(key) {
				matches = append(matches, f)
			}
			walk(f.List("children"))
		}
	}
	walk(ws.List("children"))
	if len(matches) == 1 {
		return matches[0], nil
	}
	if len(matches) > 1 {
		return nil, usagef("há %d pastas %q; use o caminho (ex.: \"Pai/%s\") ou o id", len(matches), key, key)
	}
	return nil, usagef("pasta %q não encontrada em %s", key, ws.Str("name"))
}

// Out: saída da CLI
type Out struct {
	Log, Err func(string)
}

// StdOut: stdout/stderr
func StdOut() Out {
	return Out{Log: func(s string) { fmt.Fprintln(os.Stdout, s) }, Err: func(s string) { fmt.Fprintln(os.Stderr, s) }}
}

// IsTTY: stdout é terminal (cores)
func IsTTY() bool {
	fi, err := os.Stdout.Stat()
	return err == nil && fi.Mode()&os.ModeCharDevice != 0
}

// Run executa a CLI e devolve o código de saída
func Run(argv []string, protector keyring.Protector, out Out, tty bool) (code int) {
	on := tty && os.Getenv("NO_COLOR") == ""
	c := func(code int, s string) string {
		if !on {
			return s
		}
		return fmt.Sprintf("\x1b[%dm%s\x1b[0m", code, s)
	}
	if len(argv) == 0 || argv[0] == "-h" || argv[0] == "--help" || argv[0] == "help" {
		out.Log(Usage)
		if len(argv) == 0 {
			return 2
		}
		return 0
	}
	if argv[0] != "run" {
		out.Err(fmt.Sprintf("comando desconhecido: %s\n\n%s", argv[0], Usage))
		return 2
	}
	tmp := ""
	defer func() {
		if tmp != "" {
			os.RemoveAll(tmp)
		}
	}()
	fail := func(err error) int {
		var ue usageError
		if errors.As(err, &ue) {
			out.Err(fmt.Sprintf("erro: %s\n\n%s", ue.msg, strings.SplitN(Usage, "\n", 2)[0]))
			return 2
		}
		out.Err("erro: " + err.Error())
		return 1
	}
	a, help, err := parseArgs(argv[1:])
	if err != nil {
		return fail(err)
	}
	if help {
		out.Log(Usage)
		return 0
	}
	dataDir := a.dataDir
	if dataDir == "" {
		dataDir = store.DefaultDataDir()
	}
	// caminho de pasta com workspace.yaml: roda direto dela, sem mexer na pasta de dados do app
	asDir, _ := filepath.Abs(a.workspace)
	_, statErr := os.Stat(filepath.Join(asDir, "workspace.yaml"))
	isDir := statErr == nil
	var st *store.Store
	var ws *Doc
	if isDir {
		if tmp, err = os.MkdirTemp("", "zeno-run-"); err != nil {
			return fail(err)
		}
		st = store.New(tmp)
		st.Load()
		_, id, err := st.LinkWorkspace(asDir)
		if err != nil {
			return fail(err)
		}
		ws = st.Workspace(id)
		if ws == nil {
			return fail(errors.New("workspace não encontrado em " + asDir))
		}
	} else {
		st = store.New(dataDir)
		st.Load()
		if ws, err = pickWorkspace(st, a.workspace); err != nil {
			return fail(err)
		}
	}
	folderID := ""
	if a.folder != "" {
		f, err := pickFolder(ws, a.folder)
		if err != nil {
			return fail(err)
		}
		folderID = f.Str("id")
	}
	envID := ""
	if a.env != "" {
		names := []string{}
		for _, x := range ws.List("environments") {
			e, _ := x.(*Doc)
			if e == nil || e.Get("parentId") == nil {
				continue
			}
			names = append(names, e.Str("name"))
			if e.Str("id") == a.env || norm(e.Str("name")) == norm(a.env) {
				envID = e.Str("id")
				break
			}
		}
		if envID == "" {
			if len(names) > 0 {
				return fail(usagef("ambiente %q não existe em %s (há: %s)", a.env, ws.Str("name"), strings.Join(names, ", ")))
			}
			return fail(usagef("ambiente %q não existe em %s", a.env, ws.Str("name")))
		}
	}
	var data []*Doc
	if a.data != "" {
		b, err := os.ReadFile(a.data)
		if err != nil {
			return fail(err)
		}
		if data, err = runner.ParseData(string(b), a.data); err != nil {
			return fail(err)
		}
	}
	// variáveis gravadas por scripts valem só durante a execução: a CLI não altera os YAML
	eng := &engine.Engine{
		Store:       st,
		Vault:       vault.New(dataDir, protector),
		Cookies:     cookies.New(""),
		Plugins:     cliPlugins(dataDir),
		NoPersist:   true,
		SoftSecrets: true,
	}
	exec := func(ws, req *Doc, envID string, extra *Doc) (*Doc, error) {
		return eng.ExecuteWith(ws, req, envID, 0, extra)
	}
	report, err := runner.Run(exec, st, runner.Options{WsID: ws.Str("id"), FolderID: folderID, EnvID: envID, Iterations: a.iterations, DelayMs: a.delayMs, Data: data, Vars: a.vars, Bail: a.bail},
		func(s *Doc, _, total int) {
			ok := runner.StepOK(s)
			where := ""
			if p := s.Str("path"); p != "" {
				where = c(2, p+" / ")
			}
			it := ""
			iter := int(num(s.Get("iteration")))
			if total > 1 && iter > 1 {
				it = c(2, fmt.Sprintf(" #%d", iter))
			}
			status := c(31, "---")
			if st := int(num(s.Get("status"))); st != 0 {
				if st < 400 {
					status = c(32, strconv.Itoa(st))
				} else {
					status = c(31, strconv.Itoa(st))
				}
			}
			mark := c(32, "✓")
			if !ok {
				mark = c(31, "✗")
			}
			out.Log(fmt.Sprintf("%s %-6s %s%s%s  %s  %s", mark, doc.AsStr(s.Get("method")), where, s.Str("name"), it, status, c(2, doc.AsStr(s.Get("timeMs"))+" ms")))
			if e := s.Get("error"); e != nil && doc.AsStr(e) != "" {
				out.Log("    " + c(31, doc.AsStr(e)))
			}
			for _, w := range s.List("warnings") {
				out.Log("    " + c(33, doc.AsStr(w)))
			}
			if m := s.List("missing"); m != nil {
				names := []string{}
				for _, x := range m {
					names = append(names, doc.AsStr(x))
				}
				out.Log("    " + c(33, "variável sem valor: "+strings.Join(names, ", ")))
			}
			for _, x := range s.List("tests") {
				t, _ := x.(*Doc)
				if t == nil {
					continue
				}
				line := "    "
				if t.Get("ok") == true {
					line += c(32, "✓")
				} else {
					line += c(31, "✗")
				}
				line += " " + t.Str("name")
				if t.Get("ok") != true && t.Str("error") != "" {
					line += c(2, " — "+t.Str("error"))
				}
				out.Log(line)
			}
		}, nil)
	if err != nil {
		return fail(err)
	}
	steps := report.List("steps")
	tests, testsFailed := 0, 0
	for _, x := range steps {
		for _, t := range x.(*Doc).List("tests") {
			tests++
			if td, _ := t.(*Doc); td == nil || td.Get("ok") != true {
				testsFailed++
			}
		}
	}
	failed := int(num(report.Get("failed")))
	failTxt := "0 com falha"
	if failed > 0 {
		failTxt = c(31, fmt.Sprintf("%d com falha", failed))
	}
	out.Log(fmt.Sprintf("\n%s: %d request(s), %s, %s · %d teste(s), %d falharam · %s ms", report.Str("name"), len(steps),
		c(32, fmt.Sprintf("%d ok", int(num(report.Get("passed"))))), failTxt, tests, testsFailed, doc.AsStr(report.Get("totalMs"))))
	if a.junit != "" {
		if err := os.WriteFile(a.junit, []byte(runner.ToJUnit(report)), 0o644); err != nil {
			return fail(err)
		}
		out.Log("JUnit: " + a.junit)
	}
	if len(steps) == 0 {
		out.Err("nenhum request para rodar")
	}
	if failed > 0 || len(steps) == 0 {
		return 1
	}
	return 0
}

func num(v any) float64 {
	switch x := v.(type) {
	case int:
		return float64(x)
	case int64:
		return float64(x)
	case float64:
		return x
	}
	return 0
}

// plugins da pasta de dados (os desligados no app continuam desligados)
func cliPlugins(dir string) *plugins.Plugins {
	off := map[string]bool{}
	if b, err := os.ReadFile(filepath.Join(dir, "state.json")); err == nil {
		if v, err := doc.FromJSON(b); err == nil {
			if d, ok := v.(*Doc); ok {
				for _, x := range d.List("disabledPlugins") {
					off[doc.AsStr(x)] = true
				}
			}
		}
	}
	p := plugins.New(filepath.Join(dir, "plugins"), func(id string) bool { return off[id] })
	p.Load()
	return p
}
