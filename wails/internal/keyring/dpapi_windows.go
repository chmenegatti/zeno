//go:build windows

package keyring

// Windows: DPAPI (CryptProtectData), a mesma proteção que o safeStorage do Electron usa por baixo. A
// chave mestra do cofre só abre com o mesmo usuário do Windows. Nunca houve versão Electron pra Windows,
// então o formato é só nosso: prefixo "dp1" + o blob do DPAPI.

import (
	"bytes"
	"errors"
	"unsafe"

	"golang.org/x/sys/windows"
)

var dpapiPrefix = []byte("dp1")

// entropia fixa do app: outro programa do mesmo usuário precisa conhecê-la pra abrir o blob
var dpapiEntropy = []byte("zeno-vault-v1")

type dpapi struct{}

func blob(b []byte) *windows.DataBlob {
	if len(b) == 0 {
		return &windows.DataBlob{}
	}
	return &windows.DataBlob{Size: uint32(len(b)), Data: &b[0]}
}

func takeBlob(out *windows.DataBlob) []byte {
	defer windows.LocalFree(windows.Handle(unsafe.Pointer(out.Data)))
	return append([]byte{}, unsafe.Slice(out.Data, out.Size)...)
}

func (dpapi) Available() (bool, string, bool) { return true, "dpapi", false }

func (dpapi) Protect(text string) ([]byte, error) {
	var out windows.DataBlob
	name, _ := windows.UTF16PtrFromString("Zeno")
	if err := windows.CryptProtectData(blob([]byte(text)), name, blob(dpapiEntropy), 0, nil, windows.CRYPTPROTECT_UI_FORBIDDEN, &out); err != nil {
		return nil, err
	}
	return append(append([]byte{}, dpapiPrefix...), takeBlob(&out)...), nil
}

func (dpapi) Unprotect(data []byte) (string, error) {
	if !bytes.HasPrefix(data, dpapiPrefix) {
		return "", errors.New("chave do cofre num formato desconhecido neste sistema")
	}
	var out windows.DataBlob
	if err := windows.CryptUnprotectData(blob(data[len(dpapiPrefix):]), nil, blob(dpapiEntropy), 0, nil, windows.CRYPTPROTECT_UI_FORBIDDEN, &out); err != nil {
		return "", err
	}
	return string(takeBlob(&out)), nil
}

// System: DPAPI do usuário atual
func System(string) Protector { return dpapi{} }
