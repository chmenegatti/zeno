package importers

// Detecta o formato de cada arquivo/URL e converte (port de src/main/import-sources.ts): Insomnia v4
// (JSON) e v5 (YAML), OpenAPI 3.x, Swagger 2.0 e Postman (coleção v2.x + arquivos de ambiente).

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"regexp"
	"strings"
	"time"

	"github.com/chmenegatti/zeno/wails/internal/doc"
	"github.com/chmenegatti/zeno/wails/internal/i18n"
)

// Source: arquivo ou URL
type Source struct {
	// Name: nome do arquivo ou URL, pra mensagens
	Name string
	Text string
	// URL de onde veio (resolve servers relativos do OpenAPI)
	URL string
}

// Extra: importador de plugin; reconhece o texto e devolve um export do Insomnia v4
type Extra struct {
	Name    string
	Detect  func(text string) bool
	Convert func(text string) (any, error)
}

func parse(src Source) (any, error) {
	t := strings.TrimSpace(strings.TrimPrefix(src.Text, "\ufeff"))
	if t == "" {
		return nil, errors.New(i18n.T("%s: arquivo vazio", src.Name))
	}
	if strings.HasPrefix(t, "{") || strings.HasPrefix(t, "[") {
		if v, err := doc.FromJSON([]byte(t)); err == nil {
			return v, nil
		}
		// talvez YAML com chaves
	}
	v, err := doc.ParseYAML([]byte(t))
	if err != nil {
		return nil, errors.New(i18n.T("%s: não é JSON nem YAML válido (%s)", src.Name, strings.Split(err.Error(), "\n")[0]))
	}
	return v, nil
}

var postmanV1 = regexp.MustCompile(`collection/v1`)

// ParseSources: converte os arquivos; ambientes do Postman viram sub-ambientes das coleções junto
func ParseSources(sources []Source, extra []Extra) (Result, error) {
	var order []string
	byID := map[string]*Doc{}
	var warnings []string
	add := func(r Result) {
		for _, w := range r.Workspaces {
			id := w.Str("id")
			if _, ok := byID[id]; !ok {
				order = append(order, id)
			}
			byID[id] = w
		}
		warnings = append(warnings, r.Warnings...)
	}
	var collections, envs []any
	for _, src := range sources {
		// plugins primeiro: formatos que o Zeno não conhece (inclusive não-JSON/YAML)
		var im *Extra
		for i := range extra {
			if extra[i].Detect(src.Text) {
				im = &extra[i]
				break
			}
		}
		if im != nil {
			out, err := im.Convert(src.Text)
			if err != nil {
				return Result{}, err
			}
			if !IsV4(out) {
				return Result{}, errors.New(i18n.T("%s: o importador %q não devolveu um export do Insomnia v4", src.Name, im.Name))
			}
			docs, _ := FromExportV4(out)
			add(Convert(docs, false))
			continue
		}
		raw, err := parse(src)
		if err != nil {
			return Result{}, err
		}
		switch {
		case IsV4(raw):
			docs, _ := FromExportV4(raw)
			add(Convert(docs, false))
		case IsV5(raw):
			spec := get(raw, "spec", "contents")
			specDoc := spec
			if s, ok := spec.(string); ok {
				if specDoc, err = parse(Source{Name: src.Name, Text: s}); err != nil {
					return Result{}, err
				}
			}
			if len(arr(get(raw, "collection"))) == 0 && IsOpenAPI(specDoc) {
				add(ConvertOpenAPI(specDoc, src.URL))
			} else {
				docs, _ := FromExportV5(raw)
				add(Convert(docs, false))
			}
		case IsOpenAPI(raw):
			add(ConvertOpenAPI(raw, src.URL))
		case IsPostmanCollection(raw):
			collections = append(collections, raw)
		case IsPostmanEnvironment(raw):
			envs = append(envs, raw)
		case truthy(get(raw, "info", "schema")) && postmanV1.MatchString(jsString(get(raw, "info", "schema"))):
			return Result{}, errors.New(i18n.T("%s: coleção Postman v1; exporte de novo como v2.1", src.Name))
		default:
			return Result{}, errors.New(i18n.T("%s: formato não reconhecido (esperado Insomnia, OpenAPI/Swagger ou Postman)", src.Name))
		}
	}
	for _, c := range collections {
		add(ConvertPostman(c, envs))
	}
	if len(envs) > 0 && len(collections) == 0 {
		return Result{}, errors.New(i18n.T("ambientes do Postman precisam ser escolhidos junto com a coleção"))
	}
	var list []*Doc
	for _, id := range order {
		list = append(list, byID[id])
	}
	sortWorkspaces(list)
	if len(list) == 0 {
		return Result{}, errors.New(i18n.T("nada para importar"))
	}
	return Result{Workspaces: list, Warnings: warnings}, nil
}

// FetchSource baixa um spec/coleção por URL (http/https)
func FetchSource(ctx context.Context, rawURL string) (Source, error) {
	u := strings.TrimSpace(rawURL)
	if !regexp.MustCompile(`(?i)^https?://`).MatchString(u) {
		return Source{}, errors.New(i18n.T("informe uma URL http(s)"))
	}
	ctx, cancel := context.WithTimeout(ctx, 20*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, "GET", u, nil)
	if err != nil {
		return Source{}, err
	}
	req.Header.Set("Accept", "application/json, application/yaml, text/yaml, */*")
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		return Source{}, fmt.Errorf("%s: %w", u, err)
	}
	defer res.Body.Close()
	if res.StatusCode < 200 || res.StatusCode > 299 {
		return Source{}, fmt.Errorf("%s: HTTP %d", u, res.StatusCode)
	}
	const max = 30 * 1024 * 1024
	b, err := io.ReadAll(io.LimitReader(res.Body, max+1))
	if err != nil {
		return Source{}, err
	}
	if len(b) > max {
		return Source{}, errors.New(i18n.T("%s: arquivo grande demais", u))
	}
	return Source{Name: u, Text: string(b), URL: res.Request.URL.String()}, nil
}
