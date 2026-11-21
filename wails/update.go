package main

// Aviso de versão nova (#176): consulta a última release no GitHub e compara com a versão em uso. Uma
// requisição anônima, nada enviado além dela; sem rede ou sem cota da API, fica quieto.
//
//	ZENO_NO_UPDATE_CHECK=1  desliga (empacotadores)
//	ZENO_UPDATE_URL=…       outra URL no formato da API de releases (teste ponta a ponta)

import (
	"context"
	"encoding/json"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"
)

const latestReleaseURL = "https://api.github.com/repos/chmenegatti/zeno/releases/latest"

type updateInfo struct {
	Version string `json:"version"`
	URL     string `json:"url"`
	// como foi instalado, quando dá pra saber: flatpak, appimage, scoop; vazio = baixar da página
	Install string `json:"install,omitempty"`
}

// checkUpdate devolve a versão nova ou nil (em dia, desligado, sem rede)
func checkUpdate(ctx context.Context, current string) *updateInfo {
	if os.Getenv("ZENO_NO_UPDATE_CHECK") != "" {
		return nil
	}
	url := os.Getenv("ZENO_UPDATE_URL")
	if url == "" {
		url = latestReleaseURL
	}
	if ctx == nil {
		ctx = context.Background()
	}
	ctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil
	}
	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("User-Agent", "Zeno")
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		return nil
	}
	var rel struct {
		Tag        string `json:"tag_name"`
		URL        string `json:"html_url"`
		Draft      bool   `json:"draft"`
		Prerelease bool   `json:"prerelease"`
	}
	if json.NewDecoder(res.Body).Decode(&rel) != nil || rel.Draft || rel.Prerelease {
		return nil
	}
	if !newerVersion(rel.Tag, current) {
		return nil
	}
	return &updateInfo{Version: strings.TrimPrefix(rel.Tag, "v"), URL: rel.URL, Install: installKind()}
}

// newerVersion: a > b em semver simples (vX.Y.Z; sufixo -rc etc. conta como anterior à versão sem ele)
func newerVersion(a, b string) bool {
	pa, sa, okA := parseVersion(a)
	pb, sb, okB := parseVersion(b)
	if !okA || !okB {
		return false
	}
	for i := range pa {
		if pa[i] != pb[i] {
			return pa[i] > pb[i]
		}
	}
	return sa == "" && sb != ""
}

func parseVersion(v string) ([3]int, string, bool) {
	var out [3]int
	v = strings.TrimPrefix(strings.TrimSpace(v), "v")
	v, suffix, _ := strings.Cut(v, "-")
	parts := strings.Split(v, ".")
	if len(parts) != 3 {
		return out, "", false
	}
	for i, p := range parts {
		n, err := strconv.Atoi(p)
		if err != nil || n < 0 {
			return out, "", false
		}
		out[i] = n
	}
	return out, suffix, true
}

// installKind: pacotes que se atualizam pelo próprio gerenciador
func installKind() string {
	switch {
	case os.Getenv("FLATPAK_ID") != "":
		return "flatpak"
	case os.Getenv("APPIMAGE") != "":
		return "appimage"
	}
	if exe, err := os.Executable(); err == nil && strings.Contains(strings.ToLower(exe), `\scoop\apps\`) {
		return "scoop"
	}
	return ""
}
