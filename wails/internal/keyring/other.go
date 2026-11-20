//go:build !linux && !windows

package keyring

import "errors"

// macOS (Keychain) entra com a distribuição nesse sistema (#83)
type unsupported struct{}

func (unsupported) Available() (bool, string, bool) { return false, "indisponível", true }
func (unsupported) Protect(string) ([]byte, error) {
	return nil, errors.New("cofre ainda não disponível neste sistema na versão Go")
}
func (unsupported) Unprotect([]byte) (string, error) {
	return "", errors.New("cofre ainda não disponível neste sistema na versão Go")
}

// System: o chaveiro deste sistema pro app
func System(string) Protector { return unsupported{} }
