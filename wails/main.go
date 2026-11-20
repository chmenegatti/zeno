// Zeno em Go + Wails (protótipo): mesma interface React, backend em Go, janela no WebKitGTK do sistema.
//
//	cd wails && make run      (compila a interface com electron-vite e roda)

package main

import (
	"embed"
	"log"

	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
)

//go:embed all:frontend/dist
var assets embed.FS

func main() {
	app := NewApp()
	err := wails.Run(&options.App{
		Title:            "Zeno",
		Width:            1400,
		Height:           843,
		AssetServer:      &assetserver.Options{Assets: assets},
		BackgroundColour: &options.RGBA{R: 11, G: 13, B: 18, A: 255},
		OnStartup:        app.startup,
		OnDomReady:       app.domReady,
		Bind:             []any{app},
	})
	if err != nil {
		log.Fatal(err)
	}
}
