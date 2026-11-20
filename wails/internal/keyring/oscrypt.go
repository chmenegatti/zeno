// Package keyring: protege a chave mestra do cofre com o chaveiro do sistema, no mesmo formato do
// safeStorage do Electron (OSCrypt do Chromium), pra que a chave criada por um app abra no outro.
//
// Linux: "v11" = AES-128-CBC com chave PBKDF2-SHA1(senha do chaveiro, "saltysalt", 1 iteração),
// IV de 16 espaços; a senha fica no Secret Service (gnome-keyring) com o esquema
// chrome_libsecret_os_crypt_password_v2 e application=<nome do app>. "v10" = mesma coisa com a senha
// fixa "peanuts" (chaveiro indisponível: o Electron chama de basic_text e não protege de verdade).
package keyring

import (
	"bytes"
	"crypto/aes"
	"crypto/cipher"
	"crypto/sha1"
	"errors"
	"fmt"

	"golang.org/x/crypto/pbkdf2"
)

// Protector: quem protege a chave mestra (mesma interface do KeyProtector do Electron)
type Protector interface {
	Available() (ok bool, backend string, weak bool)
	Protect(text string) ([]byte, error)
	Unprotect(data []byte) (string, error)
}

var iv = bytes.Repeat([]byte{' '}, 16)

func deriveKey(password string) []byte { return deriveKeyIter(password, 1) }

// macOS usa 1003 iterações no OSCrypt; Linux, 1
func deriveKeyIter(password string, iter int) []byte {
	return pbkdf2.Key([]byte(password), []byte("saltysalt"), iter, 16, sha1.New)
}

// Encrypt: prefixo + AES-128-CBC/PKCS7
func Encrypt(prefix, password string, plain []byte) []byte {
	return encryptKey(prefix, deriveKey(password), plain)
}

func encryptKey(prefix string, key, plain []byte) []byte {
	block, _ := aes.NewCipher(key)
	pad := aes.BlockSize - len(plain)%aes.BlockSize
	buf := append(append([]byte{}, plain...), bytes.Repeat([]byte{byte(pad)}, pad)...)
	out := make([]byte, len(buf))
	cipher.NewCBCEncrypter(block, iv).CryptBlocks(out, buf)
	return append([]byte(prefix), out...)
}

// Decrypt: o contrário de Encrypt; erro se a senha não bate (padding inválido)
func Decrypt(password string, data []byte) ([]byte, error) {
	return decryptKey(deriveKey(password), data)
}

func decryptKey(key, data []byte) ([]byte, error) {
	if len(data) < 3+aes.BlockSize || (len(data)-3)%aes.BlockSize != 0 {
		return nil, errors.New("dado cifrado com tamanho inválido")
	}
	block, _ := aes.NewCipher(key)
	out := make([]byte, len(data)-3)
	cipher.NewCBCDecrypter(block, iv).CryptBlocks(out, data[3:])
	pad := int(out[len(out)-1])
	if pad == 0 || pad > aes.BlockSize || !bytes.Equal(out[len(out)-pad:], bytes.Repeat([]byte{byte(pad)}, pad)) {
		return nil, errors.New("senha do chaveiro não abre este dado")
	}
	return out[:len(out)-pad], nil
}

// Prefix: versão do dado ("v10", "v11")
func Prefix(data []byte) string {
	if len(data) < 3 {
		return ""
	}
	return string(data[:3])
}

// errUnsupported: formato de outro sistema/backend
func errUnsupported(p string) error {
	return fmt.Errorf("chave do cofre num formato que esta versão ainda não lê (%q)", p)
}

// None: sem chaveiro (cofre indisponível). ZENO_NO_KEYRING=1 no app usa isto: testes que não podem
// tocar no chaveiro de quem roda
type none struct{}

func (none) Available() (bool, string, bool) { return false, "nenhum", true }
func (none) Protect(string) ([]byte, error)  { return nil, errors.New("sem chaveiro (ZENO_NO_KEYRING)") }
func (none) Unprotect([]byte) (string, error) {
	return "", errors.New("sem chaveiro (ZENO_NO_KEYRING)")
}

func None() Protector { return none{} }
