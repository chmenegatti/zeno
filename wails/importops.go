// Importação no app: prévia (Insomnia instalado, arquivos ou URL) e gravar os escolhidos.

package main

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"sync"

	"github.com/chmenegatti/zeno/wails/internal/doc"
	"github.com/chmenegatti/zeno/wails/internal/i18n"
	"github.com/chmenegatti/zeno/wails/internal/importers"
	"github.com/wailsapp/wails/v2/pkg/runtime"
)

type pendingImport struct {
	mu   sync.Mutex
	list []*Doc
}

// importadores dos plugins ativos
func (a *App) extraImporters() []importers.Extra {
	var out []importers.Extra
	for _, im := range a.plugins.Importers() {
		out = append(out, importers.Extra{Name: im.Name, Detect: im.Detect, Convert: im.Convert})
	}
	return out
}

func countTree(children []any) (folders, requests int) {
	doc.Walk(children, func(n *Doc) {
		if n.Str("kind") == "folder" {
			folders++
		} else {
			requests++
		}
	})
	return
}

// source: "insomnia", "file" ou { url }
func (a *App) importPreview(source any) (any, error) {
	var res importers.Result
	var label string
	var err error
	switch s := source.(type) {
	case string:
		switch s {
		case "insomnia":
			dir := importers.Dir()
			docs, err := importers.ReadNedbDir(dir)
			if err != nil {
				return nil, err
			}
			res, label = importers.Convert(docs, importers.SkipsTLS(dir)), dir
		case "file":
			files, err := runtime.OpenMultipleFilesDialog(a.ctx, runtime.OpenDialogOptions{
				Title: i18n.T("Importar (Insomnia, OpenAPI/Swagger, Postman)"),
				Filters: []runtime.FileFilter{
					{DisplayName: i18n.T("JSON ou YAML"), Pattern: "*.json;*.yaml;*.yml"},
					{DisplayName: i18n.T("Todos"), Pattern: "*"},
				},
			})
			if err != nil || len(files) == 0 {
				return nil, err
			}
			var srcs []importers.Source
			for _, f := range files {
				b, err := os.ReadFile(f)
				if err != nil {
					return nil, err
				}
				srcs = append(srcs, importers.Source{Name: filepath.Base(f), Text: string(b)})
			}
			if res, err = importers.ParseSources(srcs, a.extraImporters()); err != nil {
				return nil, err
			}
			label = strings.Join(files, ", ")
		default:
			return nil, errors.New(i18n.T("origem de importação desconhecida"))
		}
	case *Doc:
		u := s.Str("url")
		src, err := importers.FetchSource(context.Background(), u)
		if err != nil {
			return nil, err
		}
		if res, err = importers.ParseSources([]importers.Source{src}, a.extraImporters()); err != nil {
			return nil, err
		}
		label = u
	default:
		return nil, errors.New(i18n.T("origem de importação desconhecida"))
	}
	if err != nil {
		return nil, err
	}
	a.pending.mu.Lock()
	a.pending.list = res.Workspaces
	a.pending.mu.Unlock()
	existing := map[string]bool{}
	for _, w := range a.store.List() {
		existing[w.Str("id")] = true
	}
	list := []any{}
	for _, w := range res.Workspaces {
		f, r := countTree(w.List("children"))
		list = append(list, doc.New("id", w.Get("id"), "name", w.Get("name"), "folders", f, "requests", r,
			"environments", len(w.List("environments")), "exists", existing[w.Str("id")]))
	}
	warnings := res.Warnings
	if warnings == nil {
		warnings = []string{}
	}
	return doc.New("source", label, "workspaces", list, "warnings", warnings), nil
}

// grava os escolhidos; protect = cifrar os segredos em texto puro
func (a *App) importRun(ids []string, protect bool) (any, error) {
	a.pending.mu.Lock()
	list := a.pending.list
	a.pending.list = nil
	a.pending.mu.Unlock()
	for _, w := range list {
		if slices.Contains(ids, w.Str("id")) {
			if err := a.store.WriteWorkspace(w); err != nil {
				return nil, err
			}
		}
	}
	a.store.Load()
	if protect {
		// conhece todos os segredos antes de cifrar, pra pegar senha repetida entre workspaces
		known := a.knownSecrets()
		for _, id := range ids {
			if _, err := a.protectWorkspace(id, known); err != nil {
				return nil, err
			}
		}
	}
	return a.store.Load(), nil
}
