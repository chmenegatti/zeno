// Zeno em Go + Wails: mesma interface React, backend em Go, janela no navegador do sistema
// (WebKitGTK no Linux, WebView2 no Windows, WKWebView no macOS). Migração: #53.
//
//	cd wails && make run      (compila a interface com electron-vite e roda)

package main

import (
	"embed"
	"log"
	"os"
	goruntime "runtime"
	"strings"

	"github.com/chmenegatti/zeno/wails/internal/cli"
	"github.com/chmenegatti/zeno/wails/internal/keyring"

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

// `zeno run …`: roda a coleção na linha de comando, sem abrir janela (primeiro argumento que não é opção)
func cliArgs() []string {
	for i, a := range os.Args[1:] {
		if !strings.HasPrefix(a, "-") {
			if a == "run" {
				return os.Args[1+i:]
			}
			return nil
		}
	}
	return nil
}

func main() {
	if args := cliArgs(); args != nil {
		os.Exit(cli.Run(args, keyring.System("zeno"), cli.StdOut(), cli.IsTTY()))
	}
	// o Wails monta o CSS da cor de fundo da janela com printf: em locale com vírgula decimal (pt_BR) o
	// "1.0" vira "1,0", o GTK rejeita (Theme parsing error) e a janela pisca branca antes da interface
	if goruntime.GOOS == "linux" {
		_ = os.Setenv("LC_NUMERIC", "C")
	}
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
		Menu:             appMenu(),
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
