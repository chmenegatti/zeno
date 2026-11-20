//go:build windows

package keyring

import "testing"

func TestDPAPI(t *testing.T) {
	p := System("zeno")
	if ok, backend, weak := p.Available(); !ok || backend != "dpapi" || weak {
		t.Fatalf("Available: %v %s %v", ok, backend, weak)
	}
	enc, err := p.Protect("chave-mestra-ç")
	if err != nil {
		t.Fatal(err)
	}
	got, err := p.Unprotect(enc)
	if err != nil || got != "chave-mestra-ç" {
		t.Fatalf("Unprotect: %q %v", got, err)
	}
	if _, err := p.Unprotect([]byte("v11lixo")); err == nil {
		t.Error("formato desconhecido devia falhar")
	}
}
