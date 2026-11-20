// Package github: salvar coleções no GitHub (port de src/main/github.ts). Login (sessão do GitHub
// CLI, token colado ou device flow) e sincronização dos workspaces com um repositório privado pela
// API, sem precisar de git instalado. Um commit por envio; cada workspace vira uma pasta na raiz do
// repositório (o nome da pasta local).
package github

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"time"

	"github.com/chmenegatti/zeno/wails/internal/store"
)

const DefaultRepo = "zeno-collections"

// endereços trocáveis nos testes
var (
	APIBase   = "https://api.github.com"
	LoginBase = "https://github.com"
)

// Account: conta conectada (o que a interface vê)
type Account struct {
	Login  string `json:"login"`
	Name   string `json:"name,omitempty"`
	Avatar string `json:"avatar,omitempty"`
	// repositório privado onde os workspaces ficam
	Repo string `json:"repo"`
	Via  string `json:"via"` // gh | token | device
}

// RemoteWorkspace: workspace no repositório
type RemoteWorkspace struct {
	Dir   string `json:"dir"`
	ID    string `json:"id,omitempty"`
	Name  string `json:"name"`
	Files int    `json:"files"`
}

// API: chamadas à API do GitHub com o token; erro com a mensagem da API
type API struct {
	Token  string
	Client *http.Client
}

func NewAPI(token string) *API { return &API{Token: token, Client: http.DefaultClient} }

// Req: out recebe o JSON da resposta; com ok404, 404 e 409 (repositório vazio) devolvem found=false
func (a *API) Req(method, url string, body, out any, ok404 bool) (found bool, err error) {
	full := url
	if !strings.HasPrefix(url, "http") {
		full = APIBase + url
	}
	var rd io.Reader
	if body != nil {
		b, err := json.Marshal(body)
		if err != nil {
			return false, err
		}
		rd = bytes.NewReader(b)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, method, full, rd)
	if err != nil {
		return false, err
	}
	req.Header.Set("Authorization", "Bearer "+a.Token)
	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("X-GitHub-Api-Version", "2022-11-28")
	req.Header.Set("User-Agent", "Zeno")
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	c := a.Client
	if c == nil {
		c = http.DefaultClient
	}
	res, err := c.Do(req)
	if err != nil {
		return false, err
	}
	defer res.Body.Close()
	raw, err := io.ReadAll(res.Body)
	if err != nil {
		return false, err
	}
	if ok404 && (res.StatusCode == 404 || res.StatusCode == 409) {
		return false, nil
	}
	if res.StatusCode < 200 || res.StatusCode > 299 {
		msg := fmt.Sprint(res.StatusCode)
		var e struct {
			Message string `json:"message"`
		}
		if json.Unmarshal(raw, &e) == nil {
			msg = fmt.Sprintf("%d: %s", res.StatusCode, e.Message)
		}
		if res.StatusCode == 401 {
			return false, errors.New("token do GitHub inválido ou expirado: entre de novo")
		}
		return false, fmt.Errorf("GitHub %s %s: %s", method, strings.Replace(url, APIBase, "", 1), msg)
	}
	if res.StatusCode != 204 && out != nil && len(raw) > 0 {
		if err := json.Unmarshal(raw, out); err != nil {
			return false, err
		}
	}
	return true, nil
}

type User struct {
	Login     string `json:"login"`
	Name      string `json:"name"`
	AvatarURL string `json:"avatar_url"`
}

func (a *API) User() (*User, error) {
	var u User
	if _, err := a.Req("GET", "/user", nil, &u, false); err != nil {
		return nil, err
	}
	return &u, nil
}

// IsManaged: arquivo que o Zeno gerencia: só YAML (workspace, pastas, requests, ambientes) fora de
// pastas/arquivos ocultos; o resto da pasta não é dele
func IsManaged(rel string) bool {
	if !yamlRe.MatchString(rel) {
		return false
	}
	for _, p := range strings.Split(rel, "/") {
		if strings.HasPrefix(p, ".") {
			return false
		}
	}
	return true
}

var yamlRe = regexp.MustCompile(`(?i)\.ya?ml$`)

type File struct {
	Rel  string
	Text string
}

// WorkspaceFiles: arquivos de um workspace (caminhos relativos com /, só os YAML do Zeno; sem .git,
// README, package.json…)
func WorkspaceFiles(dir string) ([]File, error) {
	var out []File
	err := filepath.WalkDir(dir, func(p string, e fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if p == dir {
			return nil
		}
		if strings.HasPrefix(e.Name(), ".") {
			if e.IsDir() {
				return filepath.SkipDir
			}
			return nil
		}
		if e.IsDir() || !e.Type().IsRegular() && e.Type()&fs.ModeSymlink == 0 || !yamlRe.MatchString(e.Name()) {
			return nil
		}
		b, err := os.ReadFile(p)
		if err != nil {
			return err
		}
		rel, err := filepath.Rel(dir, p)
		if err != nil {
			return err
		}
		out = append(out, File{Rel: filepath.ToSlash(rel), Text: string(b)})
		return nil
	})
	sort.Slice(out, func(i, j int) bool { return store.LocaleCompare(out[i].Rel, out[j].Rel) < 0 })
	return out, err
}

type treeItem struct {
	Path string `json:"path"`
	Type string `json:"type"`
	Sha  string `json:"sha"`
}

// Sync: workspaces ↔ repositório owner/repo
type Sync struct {
	API   *API
	Owner string
	Repo  string
}

func (s *Sync) path(p string) string { return "/repos/" + s.Owner + "/" + s.Repo + p }

// EnsureRepo cria o repositório privado se não existir; devolve o branch padrão
func (s *Sync) EnsureRepo() (string, error) {
	var r struct {
		DefaultBranch string `json:"default_branch"`
	}
	found, err := s.API.Req("GET", s.path(""), nil, &r, true)
	if err != nil {
		return "", err
	}
	if found {
		return r.DefaultBranch, nil
	}
	if _, err := s.API.Req("POST", "/user/repos", map[string]any{
		"name": s.Repo, "private": true, "auto_init": true, "description": "Coleções do Zeno (cliente de API)",
	}, &r, false); err != nil {
		return "", err
	}
	if r.DefaultBranch == "" {
		return "main", nil
	}
	return r.DefaultBranch, nil
}

type head struct {
	commit string
	tree   []treeItem
}

func (s *Sync) head(branch string) (*head, error) {
	var ref struct {
		Object struct {
			Sha string `json:"sha"`
		} `json:"object"`
	}
	found, err := s.API.Req("GET", s.path("/git/ref/heads/"+branch), nil, &ref, true)
	if err != nil || !found {
		return nil, err
	}
	var t struct {
		Tree []treeItem `json:"tree"`
	}
	if _, err := s.API.Req("GET", s.path("/git/trees/"+ref.Object.Sha+"?recursive=1"), nil, &t, false); err != nil {
		return nil, err
	}
	return &head{commit: ref.Object.Sha, tree: t.Tree}, nil
}

func (s *Sync) blob(sha string) ([]byte, error) {
	var b struct {
		Content string `json:"content"`
	}
	if _, err := s.API.Req("GET", s.path("/git/blobs/"+sha), nil, &b, false); err != nil {
		return nil, err
	}
	// a API quebra o base64 em linhas
	return base64.StdEncoding.DecodeString(strings.NewReplacer("\n", "", "\r", "").Replace(b.Content))
}

var (
	wsYamlRe = regexp.MustCompile(`^[^/]+/workspace\.yaml$`)
	idRe     = regexp.MustCompile(`(?m)^id:\s*(\S+)`)
	nameRe   = regexp.MustCompile(`(?m)^name:\s*(.+)$`)
	quotesRe = regexp.MustCompile(`^["']|["']$`)
)

// List: workspaces no repositório (pastas da raiz com workspace.yaml)
func (s *Sync) List() ([]RemoteWorkspace, error) {
	branch, err := s.EnsureRepo()
	if err != nil {
		return nil, err
	}
	h, err := s.head(branch)
	if err != nil || h == nil {
		return []RemoteWorkspace{}, err
	}
	out := []RemoteWorkspace{}
	for _, d := range h.tree {
		if d.Type != "blob" || !wsYamlRe.MatchString(d.Path) {
			continue
		}
		dir := strings.SplitN(d.Path, "/", 2)[0]
		b, err := s.blob(d.Sha)
		if err != nil {
			return nil, err
		}
		text := string(b)
		w := RemoteWorkspace{Dir: dir, Name: dir}
		if m := idRe.FindStringSubmatch(text); m != nil {
			w.ID = m[1]
		}
		if m := nameRe.FindStringSubmatch(text); m != nil {
			w.Name = m[1]
		}
		w.Name = quotesRe.ReplaceAllString(w.Name, "")
		for _, t := range h.tree {
			if t.Type == "blob" && strings.HasPrefix(t.Path, dir+"/") {
				w.Files++
			}
		}
		out = append(out, w)
	}
	sort.SliceStable(out, func(i, j int) bool { return store.LocaleCompare(out[i].Name, out[j].Name) < 0 })
	return out, nil
}

// LocalWorkspace: pasta local → pasta no repositório
type LocalWorkspace struct {
	Dir      string
	Name     string
	LocalDir string
}

type PushResult struct {
	Commit string `json:"commit"`
	Files  int    `json:"files"`
	URL    string `json:"url"`
}

// Push envia os workspaces num commit só; apaga do repo o YAML que sumiu localmente. nil = nada mudou
func (s *Sync) Push(workspaces []LocalWorkspace, message string) (*PushResult, error) {
	branch, err := s.EnsureRepo()
	if err != nil {
		return nil, err
	}
	h, err := s.head(branch)
	if err != nil {
		return nil, err
	}
	entries := []map[string]any{}
	files := 0
	for _, w := range workspaces {
		local, err := WorkspaceFiles(w.LocalDir)
		if err != nil {
			return nil, err
		}
		files += len(local)
		keep := map[string]bool{}
		for _, f := range local {
			p := w.Dir + "/" + f.Rel
			keep[p] = true
			entries = append(entries, map[string]any{"path": p, "mode": "100644", "type": "blob", "content": f.Text})
		}
		// arquivos que só existem no repo saem (request apagado ou renomeado no app); só YAML do
		// Zeno: .gitignore, imagens e afins no repo ficam como estão
		if h != nil {
			for _, t := range h.tree {
				if t.Type == "blob" && strings.HasPrefix(t.Path, w.Dir+"/") && IsManaged(t.Path[len(w.Dir)+1:]) && !keep[t.Path] {
					entries = append(entries, map[string]any{"path": t.Path, "mode": "100644", "type": "blob", "sha": nil})
				}
			}
		}
	}
	treeReq := map[string]any{"tree": entries}
	base := ""
	if h != nil {
		var c struct {
			Tree struct {
				Sha string `json:"sha"`
			} `json:"tree"`
		}
		if _, err := s.API.Req("GET", s.path("/git/commits/"+h.commit), nil, &c, false); err != nil {
			return nil, err
		}
		base = c.Tree.Sha
		treeReq["base_tree"] = base
	}
	var tree struct {
		Sha string `json:"sha"`
	}
	if _, err := s.API.Req("POST", s.path("/git/trees"), treeReq, &tree, false); err != nil {
		return nil, err
	}
	// nada mudou: não cria commit vazio
	if base != "" && tree.Sha == base {
		return nil, nil
	}
	parents := []string{}
	if h != nil {
		parents = append(parents, h.commit)
	}
	var commit struct {
		Sha     string `json:"sha"`
		HTMLURL string `json:"html_url"`
	}
	if _, err := s.API.Req("POST", s.path("/git/commits"), map[string]any{"message": message, "tree": tree.Sha, "parents": parents}, &commit, false); err != nil {
		return nil, err
	}
	if h != nil {
		_, err = s.API.Req("PATCH", s.path("/git/refs/heads/"+branch), map[string]any{"sha": commit.Sha}, nil, false)
	} else {
		_, err = s.API.Req("POST", s.path("/git/refs"), map[string]any{"ref": "refs/heads/" + branch, "sha": commit.Sha}, nil, false)
	}
	if err != nil {
		return nil, err
	}
	return &PushResult{Commit: commit.Sha, Files: files, URL: commit.HTMLURL}, nil
}

// Pull baixa um workspace do repo pra pasta target (substitui os YAML dele; o resto fica)
func (s *Sync) Pull(dir, target string) (int, error) {
	branch, err := s.EnsureRepo()
	if err != nil {
		return 0, err
	}
	h, err := s.head(branch)
	if err != nil {
		return 0, err
	}
	var blobs []treeItem
	if h != nil {
		for _, t := range h.tree {
			if t.Type == "blob" && strings.HasPrefix(t.Path, dir+"/") && IsManaged(t.Path[len(dir)+1:]) {
				blobs = append(blobs, t)
			}
		}
	}
	if len(blobs) == 0 {
		return 0, fmt.Errorf("%q não está no repositório", dir)
	}
	type file struct {
		rel  string
		data []byte
	}
	var files []file
outer:
	for _, b := range blobs {
		rel := b.Path[len(dir)+1:]
		for _, p := range strings.Split(rel, "/") {
			if p == ".." || strings.HasPrefix(p, ".") {
				continue outer
			}
		}
		data, err := s.blob(b.Sha)
		if err != nil {
			return 0, err
		}
		files = append(files, file{rel, data})
	}
	// só troca depois de baixar tudo: falha no meio não deixa o workspace pela metade
	if _, err := os.Stat(target); err == nil {
		old, err := WorkspaceFiles(target)
		if err != nil {
			return 0, err
		}
		for _, f := range old {
			if err := os.Remove(filepath.Join(target, filepath.FromSlash(f.Rel))); err != nil {
				return 0, err
			}
		}
	}
	root := filepath.Clean(target) + string(filepath.Separator)
	for _, f := range files {
		p := filepath.Join(target, filepath.FromSlash(f.rel))
		if !strings.HasPrefix(p, root) {
			continue
		}
		if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
			return 0, err
		}
		if err := os.WriteFile(p, f.data, 0o644); err != nil {
			return 0, err
		}
	}
	return len(files), nil
}

// GhCliToken: token da sessão do GitHub CLI (gh auth token), se houver
func GhCliToken() string {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	out, err := exec.CommandContext(ctx, "gh", "auth", "token").Output()
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(out))
}

// ---------- device flow (OAuth App do Zeno; ZENO_GITHUB_CLIENT_ID troca por outro) ----------

// ZenoClientID: Client ID do OAuth App "zeno" (público: o device flow não usa segredo)
const ZenoClientID = "Ov23liQibBJHrwEBxzCU"

func DeviceClientID() string {
	if id := os.Getenv("ZENO_GITHUB_CLIENT_ID"); id != "" {
		return id
	}
	return ZenoClientID
}

type DeviceCode struct {
	DeviceCode      string `json:"device_code"`
	UserCode        string `json:"user_code"`
	VerificationURI string `json:"verification_uri"`
	Interval        int    `json:"interval"`
	ExpiresIn       int    `json:"expires_in"`
}

func postJSON(c *http.Client, url string, body any, out any) (int, error) {
	b, _ := json.Marshal(body)
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, "POST", url, bytes.NewReader(b))
	if err != nil {
		return 0, err
	}
	req.Header.Set("Accept", "application/json")
	req.Header.Set("Content-Type", "application/json")
	if c == nil {
		c = http.DefaultClient
	}
	res, err := c.Do(req)
	if err != nil {
		return 0, err
	}
	defer res.Body.Close()
	if res.StatusCode >= 200 && res.StatusCode < 300 {
		err = json.NewDecoder(res.Body).Decode(out)
	}
	return res.StatusCode, err
}

func DeviceStart(c *http.Client, clientID string) (*DeviceCode, error) {
	var d DeviceCode
	status, err := postJSON(c, LoginBase+"/login/device/code", map[string]string{"client_id": clientID, "scope": "repo"}, &d)
	if err == nil && (status < 200 || status > 299) {
		err = fmt.Errorf("GitHub device flow: %d", status)
	}
	if err != nil {
		return nil, err
	}
	return &d, nil
}

// DevicePoll espera o usuário autorizar no navegador; devolve o token
func DevicePoll(c *http.Client, clientID, deviceCode string, interval, expiresIn int, sleep func(time.Duration)) (string, error) {
	if sleep == nil {
		sleep = time.Sleep
	}
	until := time.Now().Add(time.Duration(expiresIn) * time.Second)
	wait := max(5, interval)
	for time.Now().Before(until) {
		sleep(time.Duration(wait) * time.Second)
		var j struct {
			AccessToken string `json:"access_token"`
			Error       string `json:"error"`
		}
		if _, err := postJSON(c, LoginBase+"/login/oauth/access_token", map[string]string{
			"client_id": clientID, "device_code": deviceCode, "grant_type": "urn:ietf:params:oauth:grant-type:device_code",
		}, &j); err != nil {
			return "", err
		}
		switch {
		case j.AccessToken != "":
			return j.AccessToken, nil
		case j.Error == "slow_down":
			wait += 5
		case j.Error != "" && j.Error != "authorization_pending":
			return "", fmt.Errorf("GitHub: %s", j.Error)
		}
	}
	return "", errors.New("o código expirou: comece de novo")
}
