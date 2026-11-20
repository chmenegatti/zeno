package main

// Executor de coleção (canais run* do src/main/index.ts): progresso por run:step, uma execução por vez.

import (
	"errors"
	"os"
	"path/filepath"
	"sync"

	"github.com/chmenegatti/zeno/wails/internal/doc"
	"github.com/chmenegatti/zeno/wails/internal/runner"
	"github.com/chmenegatti/zeno/wails/internal/store"
	"github.com/wailsapp/wails/v2/pkg/runtime"
)

func (a *App) registerRunner() {
	st := a.store
	var mu sync.Mutex
	var running *runner.Handle
	exec := func(ws, req *Doc, envID string, extra *Doc) (*Doc, error) {
		return a.engine.ExecuteWith(ws, req, envID, 0, extra)
	}
	a.handle("runCollection", func(args Args) (any, error) {
		opts, err := Get[runner.Options](args, 0)
		if err != nil {
			return nil, err
		}
		mu.Lock()
		if running != nil {
			mu.Unlock()
			return nil, errors.New("já tem uma execução em andamento")
		}
		h := runner.NewHandle()
		running = h
		mu.Unlock()
		defer func() {
			mu.Lock()
			running = nil
			mu.Unlock()
		}()
		return runner.Run(exec, st, opts, func(step *Doc, index, total int) {
			id := step.Str("requestId")
			a.Emit("response:added", id, st.GetResponses(id))
			a.Emit("run:step", step, index, total)
		}, h)
	})
	a.handle("runCancel", func(Args) (any, error) {
		mu.Lock()
		if running != nil {
			running.Cancel()
		}
		mu.Unlock()
		return nil, nil
	})
	a.handle("runPickData", func(Args) (any, error) {
		file, err := runtime.OpenFileDialog(a.ctx, runtime.OpenDialogOptions{
			Title: "Dados para as iterações (CSV ou JSON)",
			Filters: []runtime.FileFilter{
				{DisplayName: "CSV ou JSON", Pattern: "*.csv;*.json"},
				{DisplayName: "Todos", Pattern: "*"},
			},
		})
		if err != nil || file == "" {
			return nil, err
		}
		b, err := os.ReadFile(file)
		if err != nil {
			return nil, err
		}
		rows, err := runner.ParseData(string(b), file)
		if err != nil {
			return nil, err
		}
		list := make([]any, len(rows))
		for i, r := range rows {
			list[i] = r
		}
		return doc.New("name", filepath.Base(file), "rows", list), nil
	})
	a.handle("runSaveJUnit", func(args Args) (any, error) {
		report, err := Get[*Doc](args, 0)
		if err != nil || report == nil {
			return nil, errors.New("relatório inválido")
		}
		name := store.Slugify(report.Str("name"))
		if name == "" {
			name = "zeno"
		}
		dest, err := runtime.SaveFileDialog(a.ctx, runtime.SaveDialogOptions{
			Title:           "Salvar relatório JUnit",
			DefaultFilename: name + "-junit.xml",
			Filters:         []runtime.FileFilter{{DisplayName: "XML", Pattern: "*.xml"}},
		})
		if err != nil || dest == "" {
			return nil, err
		}
		if err := os.WriteFile(dest, []byte(runner.ToJUnit(report)), 0o644); err != nil {
			return nil, err
		}
		return dest, nil
	})
}
