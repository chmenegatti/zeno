package main

// GitHub: salvar coleções num repositório privado (canais github* do src/main/index.ts). A conta fica
// em <dataDir>/.github.json, no mesmo formato do Electron, com o token cifrado no cofre.

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"regexp"
	"slices"
	"strings"
	"sync"
	"time"

	"github.com/chmenegatti/zeno/wails/internal/doc"
	"github.com/chmenegatti/zeno/wails/internal/github"
	"github.com/wailsapp/wails/v2/pkg/runtime"
)

type ghSaved struct {
	github.Account
	// token cifrado no cofre
	Token string `json:"token"`
	// último envio/download de cada workspace (#116): pra tela de workspaces dizer se mudou desde então
	Synced map[string]ghSynced `json:"synced,omitempty"`
}

type ghSynced struct {
	Repo   string `json:"repo"`
	At     int64  `json:"at"`
	Commit string `json:"commit,omitempty"`
	// hash dos YAML naquele momento
	Hash string `json:"hash"`
}

// wsHash: hash dos YAML do workspace (os mesmos que vão pro GitHub)
func wsHash(dir string) string {
	files, err := github.WorkspaceFiles(dir)
	if err != nil {
		return ""
	}
	h := sha256.New()
	for _, f := range files {
		h.Write([]byte(f.Rel + "\x00" + f.Text + "\x00"))
	}
	return hex.EncodeToString(h.Sum(nil))
}

// ghMarkSynced: guarda o estado dos workspaces (id → pasta) como iguais aos do repositório
func (a *App) ghMarkSynced(dirs map[string]string, commit string) {
	g := a.ghRead()
	if g == nil {
		return
	}
	if g.Synced == nil {
		g.Synced = map[string]ghSynced{}
	}
	now := time.Now().UnixMilli()
	for id, dir := range dirs {
		g.Synced[id] = ghSynced{Repo: g.Repo, At: now, Commit: commit, Hash: wsHash(dir)}
	}
	_ = a.ghWrite(g)
}

type deviceFlow struct {
	mu       sync.Mutex
	code     string
	interval int
	expires  int
}

var repoNameRe = regexp.MustCompile(`^[\w.-]{1,100}$`)

func (a *App) ghFile() string { return filepath.Join(a.store.Dir, ".github.json") }

func (a *App) ghRead() *ghSaved {
	b, err := os.ReadFile(a.ghFile())
	if err != nil {
		return nil
	}
	var g ghSaved
	if json.Unmarshal(b, &g) != nil || g.Login == "" {
		return nil
	}
	return &g
}

func (a *App) ghWrite(g *ghSaved) error {
	b, err := json.MarshalIndent(g, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(a.ghFile(), b, 0o600)
}

func ghPublic(g *ghSaved) any {
	if g == nil {
		return nil
	}
	return g.Account
}

func (a *App) ghSync() (*github.Sync, error) {
	g := a.ghRead()
	if g == nil {
		return nil, errors.New("entre no GitHub primeiro")
	}
	token, err := a.vault.Decrypt(g.Token)
	if err != nil {
		return nil, err
	}
	return &github.Sync{API: github.NewAPI(token), Owner: g.Login, Repo: g.Repo}, nil
}

// ghLogin valida o token (GET /user) e guarda cifrado
func (a *App) ghLogin(token, via string) (any, error) {
	u, err := github.NewAPI(token).User()
	if err != nil {
		return nil, err
	}
	if u.Login == "" {
		return nil, errors.New("não deu pra ler a conta com esse token")
	}
	enc, err := a.vault.Encrypt(token)
	if err != nil {
		return nil, err
	}
	repo := github.DefaultRepo
	var synced map[string]ghSynced
	if old := a.ghRead(); old != nil {
		if old.Repo != "" {
			repo = old.Repo
		}
		if old.Login == u.Login {
			synced = old.Synced
		}
	}
	g := &ghSaved{Account: github.Account{Login: u.Login, Name: u.Name, Avatar: u.AvatarURL, Repo: repo, Via: via}, Token: enc, Synced: synced}
	if err := a.ghWrite(g); err != nil {
		return nil, err
	}
	return g.Account, nil
}

func (a *App) registerGitHub() {
	st := a.store
	var dev deviceFlow
	a.handle("githubStatus", func(Args) (any, error) {
		return doc.New("account", ghPublic(a.ghRead()), "deviceAvailable", github.DeviceClientID() != ""), nil
	})
	a.handle("githubLoginGh", func(Args) (any, error) {
		t := github.GhCliToken()
		if t == "" {
			return nil, errors.New(`GitHub CLI sem sessão: rode "gh auth login" no terminal ou cole um token`)
		}
		return a.ghLogin(t, "gh")
	})
	a.handle("githubLoginToken", func(args Args) (any, error) {
		t, _ := Get[string](args, 0)
		return a.ghLogin(strings.TrimSpace(t), "token")
	})
	a.handle("githubDeviceStart", func(Args) (any, error) {
		id := github.DeviceClientID()
		if id == "" {
			return nil, errors.New("login pelo navegador precisa de um OAuth App (ZENO_GITHUB_CLIENT_ID)")
		}
		d, err := github.DeviceStart(nil, id)
		if err != nil {
			return nil, err
		}
		dev.mu.Lock()
		dev.code, dev.interval, dev.expires = d.DeviceCode, d.Interval, d.ExpiresIn
		dev.mu.Unlock()
		runtime.BrowserOpenURL(a.ctx, d.VerificationURI)
		return doc.New("userCode", d.UserCode, "url", d.VerificationURI), nil
	})
	a.handle("githubDevicePoll", func(Args) (any, error) {
		id := github.DeviceClientID()
		dev.mu.Lock()
		code, interval, expires := dev.code, dev.interval, dev.expires
		dev.mu.Unlock()
		if id == "" || code == "" {
			return nil, errors.New("comece o login de novo")
		}
		token, err := github.DevicePoll(nil, id, code, interval, expires, nil)
		if err != nil {
			return nil, err
		}
		dev.mu.Lock()
		if dev.code == code {
			dev.code = ""
		}
		dev.mu.Unlock()
		return a.ghLogin(token, "device")
	})
	a.handle("githubLogout", func(Args) (any, error) {
		if err := os.Remove(a.ghFile()); err != nil && !os.IsNotExist(err) {
			return nil, err
		}
		return nil, nil
	})
	a.handle("githubSetRepo", func(args Args) (any, error) {
		g := a.ghRead()
		if g == nil {
			return nil, errors.New("entre no GitHub primeiro")
		}
		repo, _ := Get[string](args, 0)
		name := strings.TrimSpace(repo)
		if !repoNameRe.MatchString(name) {
			return nil, errors.New("nome de repositório inválido")
		}
		g.Repo = name
		if err := a.ghWrite(g); err != nil {
			return nil, err
		}
		return g.Account, nil
	})
	a.handle("githubList", func(Args) (any, error) {
		s, err := a.ghSync()
		if err != nil {
			return nil, err
		}
		return s.List()
	})
	a.handle("githubPush", func(args Args) (any, error) {
		s, err := a.ghSync()
		if err != nil {
			return nil, err
		}
		ids, _ := Get[[]string](args, 0)
		var list []github.LocalWorkspace
		var names []string
		dirs := map[string]string{}
		for _, w := range st.List() {
			dir := w.Map("location").Str("dir")
			if dir == "" || !slices.Contains(ids, w.Str("id")) {
				continue
			}
			list = append(list, github.LocalWorkspace{Dir: filepath.Base(dir), Name: w.Str("name"), LocalDir: dir})
			names = append(names, w.Str("name"))
			dirs[w.Str("id")] = dir
		}
		if len(list) == 0 {
			return nil, errors.New("nenhum workspace escolhido")
		}
		// data como o toLocaleString('pt-BR') do Electron
		when := time.Now().Format("02/01/2006, 15:04:05")
		r, err := s.Push(list, "Zeno: "+strings.Join(names, ", ")+" ("+when+")")
		if err != nil {
			return nil, err
		}
		commit := ""
		if r != nil {
			commit = r.Commit
		}
		a.ghMarkSynced(dirs, commit)
		if r == nil {
			return nil, nil
		}
		return r, nil
	})
	// baixa um workspace: se já existe aqui (mesmo id), atualiza no lugar; senão cria na pasta de dados
	a.handle("githubPull", func(args Args) (any, error) {
		s, err := a.ghSync()
		if err != nil {
			return nil, err
		}
		dir, _ := Get[string](args, 0)
		remoteID, _ := Get[string](args, 1)
		// nome de pasta da raiz do repositório, nunca um caminho
		if dir == "" || dir == "." || dir == ".." || strings.ContainsAny(dir, `/\`) {
			return nil, errors.New("pasta inválida")
		}
		target := ""
		if remoteID != "" {
			if w := st.Workspace(remoteID); w != nil {
				target = w.Map("location").Str("dir")
			}
		}
		if target == "" {
			target = filepath.Join(st.Dir, dir)
			if _, err := os.Stat(target); err == nil {
				target = filepath.Join(st.Dir, dir+"-github")
			}
		}
		n, err := s.Pull(dir, target)
		if err != nil {
			return nil, err
		}
		workspaces := st.Load()
		for _, w := range st.List() {
			if w.Map("location").Str("dir") == target {
				a.ghMarkSynced(map[string]string{w.Str("id"): target}, "")
			}
		}
		a.Emit("store:changed", workspaces)
		return doc.New("files", n, "workspaces", workspaces), nil
	})
	// situação de cada workspace no GitHub: quando foi enviado/baixado e se mudou desde então
	a.handle("githubWsStatus", func(args Args) (any, error) {
		g := a.ghRead()
		out := doc.New()
		if g == nil {
			return out, nil
		}
		for _, w := range st.List() {
			sy, ok := g.Synced[w.Str("id")]
			if !ok || sy.Repo != g.Repo {
				continue
			}
			dir := w.Map("location").Str("dir")
			out.Set(w.Str("id"), doc.New("at", sy.At, "commit", sy.Commit, "changed", dir == "" || wsHash(dir) != sy.Hash))
		}
		return out, nil
	})
}
