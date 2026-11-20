package httpc

import (
	"context"
	"io"
	"net"
	"testing"

	"github.com/chmenegatti/zeno/wails/internal/vars"
)

// destino que fala primeiro: o que chega junto com o 200 do CONNECT é do túnel (não erro)
func TestTunelComDadosJunto(t *testing.T) {
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer ln.Close()
	go func() {
		c, err := ln.Accept()
		if err != nil {
			return
		}
		buf := make([]byte, 512)
		_, _ = c.Read(buf)
		_, _ = c.Write([]byte("HTTP/1.1 200 OK\r\n\r\nOLA"))
	}()
	d, err := ProxyDialer(vars.Prepared{Net: vars.Net{ProxyMode: "custom", ProxyURL: "http://" + ln.Addr().String()}}, false)
	if err != nil {
		t.Fatal(err)
	}
	c, err := d(context.Background(), "destino.test:80")
	if err != nil {
		t.Fatal(err)
	}
	defer c.Close()
	b := make([]byte, 3)
	if _, err := io.ReadFull(c, b); err != nil || string(b) != "OLA" {
		t.Fatalf("%q %v", b, err)
	}
}
