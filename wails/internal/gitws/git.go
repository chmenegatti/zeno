// Package gitws: git do workspace pela linha de comando (git do sistema), port de src/main/git.ts.
// Usa a configuração, as chaves SSH e os credential helpers que a pessoa já tem; toda operação fica
// restrita à pasta do workspace.
package gitws

import (
	"bytes"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"

	"github.com/chmenegatti/zeno/wails/internal/doc"
	"github.com/chmenegatti/zeno/wails/internal/i18n"
)

// File: arquivo mudado (GitFile)
type File struct {
	Path   string `json:"path"`
	Status string `json:"status"`
	Label  string `json:"label"`
}

// Status do workspace (GitStatus)
type Status struct {
	Repo      bool     `json:"repo"`
	Root      string   `json:"root,omitempty"`
	Branch    string   `json:"branch,omitempty"`
	Upstream  string   `json:"upstream,omitempty"`
	Ahead     int      `json:"ahead"`
	Behind    int      `json:"behind"`
	Branches  []string `json:"branches"`
	HasRemote bool     `json:"hasRemote"`
	Conflict  bool     `json:"conflict"`
	Files     []File   `json:"files"`
}

func env() []string {
	e := os.Environ()
	// sem prompt interativo: sem terminal, o git ficaria esperando senha pra sempre
	e = append(e, "GIT_TERMINAL_PROMPT=0", "LC_ALL=C")
	if os.Getenv("GIT_SSH_COMMAND") == "" {
		e = append(e, "GIT_SSH_COMMAND=ssh -o BatchMode=yes")
	}
	return e
}

var errPrefix = regexp.MustCompile(`^(fatal|error): `)

// Git roda o git na pasta; erro com a mensagem do git (sem "fatal: ")
func Git(cwd string, args ...string) (string, error) {
	cmd := exec.Command("git", args...)
	cmd.Dir = cwd
	cmd.Env = env()
	var out, errb bytes.Buffer
	cmd.Stdout, cmd.Stderr = &out, &errb
	if err := cmd.Run(); err != nil {
		msg := strings.TrimSpace(errb.String())
		if msg == "" {
			msg = strings.TrimSpace(out.String())
		}
		if msg == "" {
			msg = err.Error()
		}
		return "", errors.New(errPrefix.ReplaceAllString(msg, ""))
	}
	return out.String(), nil
}

func ok(s string, err error) (string, bool) { return s, err == nil }

// nome legível do arquivo: request, pasta ou ambiente
func labelOf(dir, rel string) string {
	b, err := os.ReadFile(filepath.Join(dir, rel))
	if err == nil {
		if v, err := doc.ParseYAML(b); err == nil {
			if d, _ := v.(*doc.Doc); d != nil {
				if name := d.Str("name"); name != "" {
					base := filepath.Base(rel)
					switch {
					case base == "workspace.yaml":
						return "workspace " + name
					case base == "folder.yaml":
						return "pasta " + name
					case strings.Split(filepath.ToSlash(rel), "/")[0] == "_env":
						return "ambiente " + name
					}
					return name
				}
			}
		}
	}
	return rel
}

func code(xy string) string {
	switch {
	case strings.Contains(xy, "U") || xy == "AA" || xy == "DD":
		return "U"
	case xy == "??" || strings.Contains(xy, "A"):
		return "A"
	case strings.Contains(xy, "D"):
		return "D"
	case strings.Contains(xy, "R"):
		return "R"
	}
	return "M"
}

var headRe = regexp.MustCompile(`^## (?:No commits yet on |Initial commit on )?(.+?)(?:\.\.\.(\S+))?(?: \[(.*)\])?$`)
var aheadRe, behindRe = regexp.MustCompile(`ahead (\d+)`), regexp.MustCompile(`behind (\d+)`)

// GetStatus: branch, remoto, à frente/atrás e arquivos mudados da pasta do workspace
func GetStatus(dir string) (Status, error) {
	empty := Status{Branches: []string{}, Files: []File{}}
	root, isRepo := ok(Git(dir, "rev-parse", "--show-toplevel"))
	root = strings.TrimSpace(root)
	if !isRepo || root == "" {
		return empty, nil
	}
	raw, err := Git(dir, "status", "--porcelain=v1", "-z", "-b", "-uall", "--", ".")
	if err != nil {
		return empty, err
	}
	parts := strings.Split(raw, "\x00")
	head := parts[0]
	parts = parts[1:]
	m := headRe.FindStringSubmatch(head)
	files := []File{}
	for i := 0; i < len(parts); i++ {
		rec := parts[i]
		if len(rec) < 4 {
			continue
		}
		xy, repoRel := rec[:2], rec[3:]
		if xy[0] == 'R' || xy[0] == 'C' {
			i++ // próximo registro é o nome antigo
		}
		rel := relTo(dir, filepath.Join(root, filepath.FromSlash(repoRel)), repoRel)
		files = append(files, File{Path: rel, Status: code(xy), Label: labelOf(dir, rel)})
	}
	sort.Slice(files, func(i, j int) bool { return files[i].Path < files[j].Path })
	branches := []string{}
	if out, isOK := ok(Git(dir, "for-each-ref", "--format=%(refname:short)", "refs/heads")); isOK {
		for _, b := range strings.Split(out, "\n") {
			if b != "" {
				branches = append(branches, b)
			}
		}
	}
	remotes, _ := ok(Git(dir, "remote"))
	inRebase := func(p string) bool {
		r, isOK := ok(Git(dir, "rev-parse", "--git-path", p))
		if !isOK {
			return false
		}
		r = strings.TrimSpace(r)
		if !filepath.IsAbs(r) {
			r = filepath.Join(dir, r)
		}
		_, err := os.Stat(r)
		return err == nil
	}
	st := Status{Repo: true, Root: root, Branches: branches, HasRemote: strings.TrimSpace(remotes) != "", Conflict: inRebase("rebase-merge") || inRebase("rebase-apply"), Files: files}
	if m != nil {
		if !strings.HasPrefix(m[1], "HEAD") {
			st.Branch = m[1]
		}
		st.Upstream = m[2]
		if a := aheadRe.FindStringSubmatch(m[3]); a != nil {
			st.Ahead, _ = strconv.Atoi(a[1])
		}
		if b := behindRe.FindStringSubmatch(m[3]); b != nil {
			st.Behind, _ = strconv.Atoi(b[1])
		}
	}
	return st, nil
}

// Diff de um arquivo contra o último commit (arquivo novo: tudo como adição)
func Diff(dir, rel string) (string, error) {
	_, tracked := ok(Git(dir, "ls-files", "--error-unmatch", "--", rel))
	_, hasHead := ok(Git(dir, "rev-parse", "--verify", "HEAD"))
	if tracked && hasHead {
		return Git(dir, "diff", "HEAD", "--", rel)
	}
	b, err := os.ReadFile(filepath.Join(dir, rel))
	if err != nil {
		return "", nil
	}
	lines := strings.Split(strings.TrimSuffix(string(b), "\n"), "\n")
	for i, l := range lines {
		lines[i] = "+" + l
	}
	return "+++ " + rel + "\n" + strings.Join(lines, "\n"), nil
}

// Commit: só o que está na pasta do workspace (o resto do repositório fica como está)
func Commit(dir, message string) error {
	if strings.TrimSpace(message) == "" {
		return errors.New(i18n.T("escreva a mensagem do commit"))
	}
	if _, err := Git(dir, "add", "-A", "--", "."); err != nil {
		return err
	}
	_, err := Git(dir, "commit", "-m", strings.TrimSpace(message), "--", ".")
	return err
}

// Pull com rebase (sem commit de merge); --autostash leva junto o que ainda não foi commitado
func Pull(dir string) error {
	_, err := Git(dir, "pull", "--rebase", "--autostash")
	return err
}

// Push; sem upstream, cria no origin
func Push(dir string) error {
	if _, hasUp := ok(Git(dir, "rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}")); hasUp {
		_, err := Git(dir, "push")
		return err
	}
	_, err := Git(dir, "push", "-u", "origin", "HEAD")
	return err
}

// SwitchBranch troca (ou cria) o branch
func SwitchBranch(dir, branch string, create bool) error {
	name := strings.TrimSpace(branch)
	if name == "" {
		return errors.New(i18n.T("informe o nome do branch"))
	}
	var err error
	if create {
		_, err = Git(dir, "switch", "-c", name)
	} else {
		_, err = Git(dir, "switch", name)
	}
	return err
}

// AbortRebase desiste do rebase em conflito
func AbortRebase(dir string) error {
	_, err := Git(dir, "rebase", "--abort")
	return err
}

// Init cria o repositório
func Init(dir string) error {
	_, err := Git(dir, "init")
	return err
}

// relTo: caminho de file relativo à pasta do workspace. A pasta pode ser um link (compara pelo
// caminho real) ou, no Windows, estar noutro volume que o git devolve (Rel falha): aí usa o caminho
// relativo à raiz do repositório, que o git aceita igual em diff/commit.
func relTo(dir, file, repoRel string) string {
	rel, err := filepath.Rel(dir, file)
	if err != nil || strings.HasPrefix(rel, "..") {
		// compara pelos caminhos reais dos dois lados (link; no Windows também nome curto RUNNER~1 x longo)
		if rd, e := filepath.EvalSymlinks(dir); e == nil {
			if r, e := filepath.Rel(rd, realPath(file)); e == nil && !strings.HasPrefix(r, "..") {
				return filepath.ToSlash(r)
			}
		}
		if err != nil {
			return repoRel
		}
	}
	return filepath.ToSlash(rel)
}

// realPath: caminho real de um arquivo que pode não existir mais (apagado no status do git): resolve a
// pasta mais próxima que existe e junta o resto
func realPath(p string) string {
	if r, err := filepath.EvalSymlinks(p); err == nil {
		return r
	}
	parent := filepath.Dir(p)
	if parent == p {
		return p
	}
	return filepath.Join(realPath(parent), filepath.Base(p))
}
