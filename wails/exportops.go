// Exportar workspaces (#116): zip com os YAML do Zeno, export do Insomnia (v4) e do Postman (v2.1).

package main

import (
	"errors"
	"os"
	"slices"

	"github.com/chmenegatti/zeno/wails/internal/doc"
	"github.com/chmenegatti/zeno/wails/internal/exporters"
	"github.com/wailsapp/wails/v2/pkg/runtime"
)

// exportBuild: arquivo do formato pedido. Fora do Zeno os segredos do cofre não abrem: secrets=true
// leva os valores abertos; senão eles saem vazios (e a conta volta em blanked)
func (a *App) exportBuild(ids []string, format string, secrets bool) (exporters.Result, int, error) {
	var ws []*Doc
	for _, w := range a.store.List() {
		if slices.Contains(ids, w.Str("id")) {
			ws = append(ws, w)
		}
	}
	if len(ws) == 0 {
		return exporters.Result{}, 0, errors.New("nenhum workspace escolhido")
	}
	if format == "zeno" {
		r, err := exporters.Zip(ws)
		return r, 0, err
	}
	blanked := 0
	for i, w := range ws {
		var v any
		if secrets {
			o, err := a.vault.DecryptDeep(w, nil)
			if err != nil {
				return exporters.Result{}, 0, err
			}
			v = o
		} else {
			o, n := exporters.Blank(w)
			v, blanked = o, blanked+n
		}
		d, _ := v.(*Doc)
		if d == nil {
			return exporters.Result{}, 0, errors.New("workspace inválido")
		}
		ws[i] = d
	}
	switch format {
	case "insomnia":
		r, err := exporters.Insomnia(ws)
		return r, blanked, err
	case "postman":
		r, err := exporters.Postman(ws)
		return r, blanked, err
	}
	return exporters.Result{}, 0, errors.New("formato desconhecido: " + format)
}

func (a *App) registerExport() {
	args3 := func(args Args) ([]string, string, bool) {
		ids, _ := Get[[]string](args, 0)
		format, _ := Get[string](args, 1)
		secrets, _ := Get[bool](args, 2)
		return ids, format, secrets
	}
	// prévia: nome do arquivo, tamanho e avisos (o que não dá pra levar), sem gravar nada
	a.handle("exportPreview", func(args Args) (any, error) {
		r, blanked, err := a.exportBuild(args3(args))
		if err != nil {
			return nil, err
		}
		return doc.New("name", r.Name, "size", len(r.Data), "warnings", nonNil(r.Warnings), "blanked", blanked), nil
	})
	a.handle("exportSave", func(args Args) (any, error) {
		r, _, err := a.exportBuild(args3(args))
		if err != nil {
			return nil, err
		}
		dest, err := runtime.SaveFileDialog(a.ctx, runtime.SaveDialogOptions{
			Title:            "Exportar workspaces",
			DefaultDirectory: downloadsDir(),
			DefaultFilename:  r.Name,
		})
		if err != nil || dest == "" {
			return nil, err
		}
		return dest, os.WriteFile(dest, r.Data, 0o600)
	})
}

func nonNil(s []string) []string {
	if s == nil {
		return []string{}
	}
	return s
}
