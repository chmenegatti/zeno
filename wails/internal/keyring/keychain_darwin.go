//go:build darwin && cgo

package keyring

// macOS: senha aleatória no Keychain ("<app> Safe Storage", conta <app>) criada pelo próprio app — a
// lista de acesso do item fica com o app, como no Chromium/Electron — e a chave mestra cifrada no
// formato OSCrypt do Mac: "v10" + AES-128-CBC com PBKDF2-SHA1(senha, "saltysalt", 1003 iterações).

/*
#cgo CFLAGS: -Wno-deprecated-declarations
#cgo LDFLAGS: -framework CoreFoundation -framework Security
#include <stdlib.h>
#include <Security/Security.h>
*/
import "C"

import (
	"crypto/rand"
	"encoding/base64"
	"errors"
	"fmt"
	"sync"
	"unsafe"
)

const macIterations = 1003

type keychain struct {
	service, account string
	mu               sync.Mutex
}

func (k *keychain) find() (string, bool, error) {
	svc, acc := C.CString(k.service), C.CString(k.account)
	defer C.free(unsafe.Pointer(svc))
	defer C.free(unsafe.Pointer(acc))
	var n C.UInt32
	var data unsafe.Pointer
	st := C.SecKeychainFindGenericPassword(0, C.UInt32(len(k.service)), svc, C.UInt32(len(k.account)), acc, &n, &data, nil)
	if st == C.errSecItemNotFound {
		return "", false, nil
	}
	if st != C.errSecSuccess {
		return "", false, fmt.Errorf("Keychain: erro %d ao ler a senha do cofre", int(st))
	}
	defer C.SecKeychainItemFreeContent(nil, data)
	return C.GoStringN((*C.char)(data), C.int(n)), true, nil
}

func (k *keychain) add(pw string) error {
	svc, acc, p := C.CString(k.service), C.CString(k.account), C.CString(pw)
	defer C.free(unsafe.Pointer(svc))
	defer C.free(unsafe.Pointer(acc))
	defer C.free(unsafe.Pointer(p))
	st := C.SecKeychainAddGenericPassword(0, C.UInt32(len(k.service)), svc, C.UInt32(len(k.account)), acc, C.UInt32(len(pw)), unsafe.Pointer(p), nil)
	if st != C.errSecSuccess {
		return fmt.Errorf("Keychain: erro %d ao guardar a senha do cofre", int(st))
	}
	return nil
}

// password: a do Keychain; cria se create e ainda não existe
func (k *keychain) password(create bool) (string, error) {
	k.mu.Lock()
	defer k.mu.Unlock()
	pw, ok, err := k.find()
	if err != nil || ok {
		return pw, err
	}
	if !create {
		return "", errors.New("a senha do cofre não está no Keychain deste Mac")
	}
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	pw = base64.StdEncoding.EncodeToString(b)
	return pw, k.add(pw)
}

func (k *keychain) Available() (bool, string, bool) { return true, "keychain", false }

func (k *keychain) Protect(text string) ([]byte, error) {
	pw, err := k.password(true)
	if err != nil {
		return nil, err
	}
	return encryptKey("v10", deriveKeyIter(pw, macIterations), []byte(text)), nil
}

func (k *keychain) Unprotect(data []byte) (string, error) {
	if p := Prefix(data); p != "v10" {
		return "", errUnsupported(p)
	}
	pw, err := k.password(false)
	if err != nil {
		return "", err
	}
	out, err := decryptKey(deriveKeyIter(pw, macIterations), data)
	return string(out), err
}

// System: Keychain do usuário, item "<app> Safe Storage"
func System(app string) Protector {
	return &keychain{service: app + " Safe Storage", account: app}
}
