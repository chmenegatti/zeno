//go:build darwin && cgo

package keyring

import (
	"os"
	"testing"
)

// mexe no Keychain de verdade: só no CI do macOS (ZENO_KEYCHAIN_TEST=1), com um item de teste
func TestKeychain(t *testing.T) {
	if os.Getenv("ZENO_KEYCHAIN_TEST") == "" {
		t.Skip("ZENO_KEYCHAIN_TEST=1 pra testar no Keychain")
	}
	p := System("zeno-teste-cofre")
	enc, err := p.Protect("chave-mestra-ç")
	if err != nil {
		t.Fatal(err)
	}
	got, err := System("zeno-teste-cofre").Unprotect(enc)
	if err != nil || got != "chave-mestra-ç" {
		t.Fatalf("Unprotect: %q %v", got, err)
	}
	if _, err := System("zeno-teste-outro").Unprotect(enc); err == nil {
		t.Error("outro item do Keychain não devia abrir")
	}
}
