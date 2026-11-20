package main

import (
	goruntime "runtime"

	"github.com/wailsapp/wails/v2/pkg/menu"
)

// appMenu: no macOS, menu do aplicativo (Sobre, Ocultar, Sair com Cmd+Q) e Editar, sem o qual Cmd+C/V/X/A/Z
// não funcionam nos campos do WKWebView. Linux e Windows ficam sem menu, como no Electron.
func appMenu() *menu.Menu {
	if goruntime.GOOS != "darwin" {
		return nil
	}
	m := menu.NewMenu()
	m.Append(menu.AppMenu())
	m.Append(menu.EditMenu())
	return m
}
