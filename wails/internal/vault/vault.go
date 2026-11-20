// Package vault: cofre de segredos (port de src/main/vault.ts).
//
// Chave mestra aleatória (AES-256-GCM) em <dataDir>/.vault/key, protegida pelo chaveiro do sistema
// (keyring.Protector). Valores cifrados ficam no YAML como $zeno$v1$<kid>$<iv>$<dados+tag>, o mesmo
// formato do Electron: o que um app cifra o outro abre.
package vault

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"

	"github.com/chmenegatti/zeno/wails/internal/doc"
	"github.com/chmenegatti/zeno/wails/internal/keyring"
)

// Prefix dos valores cifrados
const Prefix = "$zeno$v1$"

// IsEncrypted: valor cifrado pelo cofre
func IsEncrypted(v any) bool {
	s, ok := v.(string)
	return ok && strings.HasPrefix(s, Prefix)
}

// Error: erro de cofre (mensagem pra tela)
type Error struct{ msg string }

func (e *Error) Error() string { return e.msg }

func vErr(f string, a ...any) error { return &Error{fmt.Sprintf(f, a...)} }

// Vault aberto pra uma pasta de dados
type Vault struct {
	keyFile string
	prot    keyring.Protector
	mu      sync.Mutex
	key     []byte
}

// New: cofre da pasta de dados
func New(dataDir string, p keyring.Protector) *Vault {
	return &Vault{keyFile: filepath.Join(dataDir, ".vault", "key"), prot: p}
}

// KeyID: 8 primeiros hex do SHA-256 da chave
func KeyID(key []byte) string {
	s := sha256.Sum256(key)
	return hex.EncodeToString(s[:])[:8]
}

// Status como o VaultStatus do Electron
func (v *Vault) Status() *doc.Doc {
	ok, backend, weak := v.prot.Available()
	_, err := os.Stat(v.keyFile)
	st := doc.New("available", ok, "backend", backend, "weak", weak, "hasKey", err == nil)
	if err != nil || !ok {
		return st
	}
	key, kerr := v.loadKey()
	if kerr != nil {
		st.Set("error", kerr.Error())
	} else {
		st.Set("keyId", KeyID(key))
	}
	return st
}

func (v *Vault) loadKey() ([]byte, error) {
	v.mu.Lock()
	defer v.mu.Unlock()
	return v.loadKeyLocked()
}

func (v *Vault) loadKeyLocked() ([]byte, error) {
	if v.key != nil {
		return v.key, nil
	}
	data, err := os.ReadFile(v.keyFile)
	if err != nil {
		return nil, vErr("cofre ainda não tem chave")
	}
	plain, err := v.prot.Unprotect(data)
	if err != nil {
		return nil, vErr("não deu pra abrir a chave do cofre com o chaveiro deste computador")
	}
	key, err := base64.StdEncoding.DecodeString(plain)
	if err != nil || len(key) != 32 {
		return nil, vErr("chave do cofre corrompida")
	}
	v.key = key
	return key, nil
}

// cria a chave se não existir (tudo sob o lock: duas primeiras cifragens juntas não criam duas chaves)
func (v *Vault) ensureKey() ([]byte, error) {
	v.mu.Lock()
	defer v.mu.Unlock()
	if v.key != nil {
		return v.key, nil
	}
	if _, err := os.Stat(v.keyFile); err == nil {
		return v.loadKeyLocked()
	}
	ok, backend, weak := v.prot.Available()
	if !ok {
		return nil, vErr("chaveiro do sistema indisponível; não dá pra criar o cofre")
	}
	if weak {
		return nil, vErr("chaveiro %q não protege de verdade; instale/abra o gnome-keyring ou kwallet", backend)
	}
	key := make([]byte, 32)
	_, _ = rand.Read(key)
	data, err := v.prot.Protect(base64.StdEncoding.EncodeToString(key))
	if err != nil {
		return nil, err
	}
	if err := os.MkdirAll(filepath.Dir(v.keyFile), 0o700); err != nil {
		return nil, err
	}
	if err := os.WriteFile(v.keyFile, data, 0o600); err != nil {
		return nil, err
	}
	v.key = key
	return key, nil
}

// Encrypt cifra (valor já cifrado volta igual)
func (v *Vault) Encrypt(plain string) (string, error) {
	if IsEncrypted(plain) {
		return plain, nil
	}
	key, err := v.ensureKey()
	if err != nil {
		return "", err
	}
	block, _ := aes.NewCipher(key)
	gcm, _ := cipher.NewGCM(block)
	iv := make([]byte, 12)
	_, _ = rand.Read(iv)
	data := gcm.Seal(nil, iv, []byte(plain), nil) // texto cifrado + tag, como o Electron
	return Prefix + KeyID(key) + "$" + base64.StdEncoding.EncodeToString(iv) + "$" + base64.StdEncoding.EncodeToString(data), nil
}

// Decrypt abre um valor cifrado (texto puro volta igual)
func (v *Vault) Decrypt(token string) (string, error) {
	if !IsEncrypted(token) {
		return token, nil
	}
	parts := strings.Split(token[len(Prefix):], "$")
	if len(parts) != 3 {
		return "", vErr("segredo adulterado ou corrompido")
	}
	key, err := v.loadKey()
	if err != nil {
		return "", err
	}
	if KeyID(key) != parts[0] {
		return "", vErr("segredo cifrado com outra chave (%s); redefina o valor neste computador", parts[0])
	}
	iv, err1 := base64.StdEncoding.DecodeString(parts[1])
	data, err2 := base64.StdEncoding.DecodeString(parts[2])
	if err1 != nil || err2 != nil || len(iv) != 12 {
		return "", vErr("segredo adulterado ou corrompido")
	}
	block, _ := aes.NewCipher(key)
	gcm, _ := cipher.NewGCM(block)
	plain, err := gcm.Open(nil, iv, data, nil)
	if err != nil {
		return "", vErr("segredo adulterado ou corrompido")
	}
	return string(plain), nil
}

// DecryptDeep decifra todo valor cifrado dentro do valor (cópia). Os que não abrem ficam em locked
// (chave de outra máquina, chaveiro fechado) com o valor cifrado no lugar.
func (v *Vault) DecryptDeep(x any, locked map[string]bool) (any, error) {
	switch t := x.(type) {
	case string:
		if !IsEncrypted(t) {
			return t, nil
		}
		p, err := v.Decrypt(t)
		if err != nil {
			var ve *Error
			if locked != nil && errors.As(err, &ve) {
				locked[t] = true
				return t, nil
			}
			return nil, err
		}
		return p, nil
	case *doc.Doc:
		out := doc.New()
		for _, k := range t.Keys() {
			val, err := v.DecryptDeep(t.Get(k), locked)
			if err != nil {
				return nil, err
			}
			out.Set(k, val)
		}
		return out, nil
	case []any:
		out := make([]any, len(t))
		for i, e := range t {
			val, err := v.DecryptDeep(e, locked)
			if err != nil {
				return nil, err
			}
			out[i] = val
		}
		return out, nil
	}
	return x, nil
}
