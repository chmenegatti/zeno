// Zeno em Go + Wails: mesma interface React, backend em Go, janela no navegador do sistema
// (WebKitGTK no Linux, WebView2 no Windows, WKWebView no macOS). Migração: #53.
//
//	cd wails && make run      (compila a interface com electron-vite e roda)

package main

import (
	"embed"
	"log"

	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
	"github.com/wailsapp/wails/v2/pkg/options/linux"
)

//go:embed all:frontend/dist
var assets embed.FS

// ícone da janela (barra no X11; no GNOME/Wayland vale o do .desktop), copiado de build/icons pelo Makefile
//
//go:embed frontend/icon.png
var icon []byte

func main() {
	app := NewApp()
	err := wails.Run(&options.App{
		// mesmas medidas e cor de fundo da janela do Electron
		Title:            "Zeno",
		Width:            1400,
		Height:           880,
		MinWidth:         900,
		MinHeight:        560,
		AssetServer:      &assetserver.Options{Assets: assets},
		BackgroundColour: &options.RGBA{R: 0x00, G: 0x12, B: 0x1c, A: 255},
		Linux:            &linux.Options{Icon: icon, ProgramName: "zeno", WindowIsTranslucent: false},
		OnStartup:        app.startup,
		OnDomReady:       app.domReady,
		OnShutdown:       app.shutdown,
		Bind:             []any{app},
	})
	if err != nil {
		log.Fatal(err)
	}
}
