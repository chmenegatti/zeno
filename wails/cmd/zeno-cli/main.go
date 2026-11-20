// zeno-cli: só a linha de comando (`zeno-cli run <workspace> [pasta] [opções]`), sem interface nem
// WebKit. Compila estático (CGO_ENABLED=0) pra rodar em CI; o mesmo comando existe no app (`zeno run`).
// Segredos do cofre abrem pelo chaveiro do sistema quando há um; sem chaveiro, passe com --var.
package main

import (
	"os"

	"github.com/chmenegatti/zeno/wails/internal/cli"
	"github.com/chmenegatti/zeno/wails/internal/i18n"
	"github.com/chmenegatti/zeno/wails/internal/keyring"
)

func main() {
	i18n.FromEnv()
	os.Exit(cli.Run(os.Args[1:], keyring.System("zeno"), cli.StdOut(), cli.IsTTY()))
}
