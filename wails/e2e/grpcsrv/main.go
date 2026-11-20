// Servidor gRPC do e2e (#5): o loja.proto do grpctest com server reflection em 127.0.0.1:4778.
package main

import (
	"fmt"
	"os"

	"github.com/chmenegatti/zeno/wails/internal/grpcc/grpctest"
)

func main() {
	if _, _, err := grpctest.Start("127.0.0.1:4778"); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	select {}
}
