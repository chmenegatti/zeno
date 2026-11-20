//go:build !linux && !windows && !(darwin && cgo)

package keyring

import (
	"errors"

	"github.com/chmenegatti/zeno/wails/internal/i18n"
)

// sistemas sem chaveiro suportado (Linux: Secret Service; Windows: DPAPI; macOS: Keychain)
type unsupported struct{}

func (unsupported) Available() (bool, string, bool) { return false, i18n.T("indisponível"), true }
func (unsupported) Protect(string) ([]byte, error) {
	return nil, errors.New(i18n.T("cofre ainda não disponível neste sistema na versão Go"))
}
func (unsupported) Unprotect([]byte) (string, error) {
	return "", errors.New(i18n.T("cofre ainda não disponível neste sistema na versão Go"))
}

// System: o chaveiro deste sistema pro app
func System(string) Protector { return unsupported{} }
