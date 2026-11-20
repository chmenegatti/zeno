package vault

import (
	"bytes"
	"errors"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"

	"github.com/chmenegatti/zeno/wails/internal/doc"
	"github.com/chmenegatti/zeno/wails/internal/keyring"
)

// protector de teste (os mesmos do test/vault.test.ts)
type fake struct{ weak, off bool }

func (f fake) Available() (bool, string, bool) {
	if f.weak {
		return !f.off, "basic_text", true
	}
	return !f.off, "test", false
}
func (fake) Protect(t string) ([]byte, error) { return []byte("P:" + t), nil }
func (fake) Unprotect(b []byte) (string, error) {
	if !bytes.HasPrefix(b, []byte("P:")) {
		return "", errors.New("nope")
	}
	return string(b[2:]), nil
}

func TestCifraEDecifra(t *testing.T) {
	v := New(t.TempDir(), fake{})
	tok, err := v.Encrypt("s3nh@-forte")
	if err != nil || !IsEncrypted(tok) || strings.Contains(tok, "s3nh") {
		t.Fatal(tok, err)
	}
	if p, _ := v.Decrypt(tok); p != "s3nh@-forte" {
		t.Errorf("decifrado: %q", p)
	}
	if again, _ := v.Encrypt(tok); again != tok {
		t.Error("cifrar de novo deveria devolver igual")
	}
}

func TestChavePersisteEProtegida(t *testing.T) {
	dir := t.TempDir()
	tok, _ := New(dir, fake{}).Encrypt("abc")
	if p, _ := New(dir, fake{}).Decrypt(tok); p != "abc" {
		t.Errorf("outra instância: %q", p)
	}
	b, _ := os.ReadFile(filepath.Join(dir, ".vault", "key"))
	if !bytes.HasPrefix(b, []byte("P:")) {
		t.Error("chave em disco sem proteção")
	}
	if fi, _ := os.Stat(filepath.Join(dir, ".vault", "key")); fi.Mode().Perm() != 0o600 {
		t.Errorf("permissão: %v", fi.Mode().Perm())
	}
}

func TestOutraChaveEAdulteracao(t *testing.T) {
	tok, _ := New(t.TempDir(), fake{}).Encrypt("abc")
	other := New(t.TempDir(), fake{})
	_, _ = other.Encrypt("x")
	if _, err := other.Decrypt(tok); err == nil || !strings.Contains(err.Error(), "outra chave") {
		t.Errorf("outra chave: %v", err)
	}
	v := New(t.TempDir(), fake{})
	tok, _ = v.Encrypt("abc")
	bad := tok[:len(tok)-6] + "AAAA=="
	if strings.HasSuffix(tok, "AAAA==") {
		bad = tok[:len(tok)-6] + "BBBB=="
	}
	if _, err := v.Decrypt(bad); err == nil {
		t.Error("adulteração passou")
	}
}

func TestRecusaChaveiroFraco(t *testing.T) {
	if _, err := New(t.TempDir(), fake{weak: true}).Encrypt("x"); err == nil || !strings.Contains(err.Error(), "não protege") {
		t.Errorf("fraco: %v", err)
	}
	if _, err := New(t.TempDir(), fake{off: true}).Encrypt("x"); err == nil || !strings.Contains(err.Error(), "indisponível") {
		t.Errorf("sem chaveiro: %v", err)
	}
}

func TestDecryptDeep(t *testing.T) {
	v := New(t.TempDir(), fake{})
	tok, _ := v.Encrypt("t0k")
	in := doc.New("a", []any{tok, int64(1)}, "b", doc.New("c", tok))
	out, _ := v.DecryptDeep(in, nil)
	got, _ := doc.Marshal(out)
	if string(got) != `{"a":["t0k",1],"b":{"c":"t0k"}}` {
		t.Errorf("deep: %s", got)
	}
	// o original não muda
	if in.Map("b").Str("c") != tok {
		t.Error("alterou o original")
	}
	// segredo de outra máquina: fica cifrado e entra em locked
	alien, _ := New(t.TempDir(), fake{}).Encrypt("x")
	locked := map[string]bool{}
	out, err := v.DecryptDeep(doc.New("k", alien), locked)
	if err != nil || !locked[alien] || out.(*doc.Doc).Str("k") != alien {
		t.Errorf("locked: %v %v", locked, err)
	}
}

// formato do Electron: token gerado pelo Vault do Electron (chave conhecida, protector de teste) abre aqui
func TestTokenDoElectron(t *testing.T) {
	dir := t.TempDir()
	// chave de 32 bytes "0123456789abcdef0123456789abcdef" em base64, protegida com "P:"
	_ = os.MkdirAll(filepath.Join(dir, ".vault"), 0o700)
	_ = os.WriteFile(filepath.Join(dir, ".vault", "key"), []byte("P:MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY="), 0o600)
	v := New(dir, fake{})
	// gerado no Node: Vault(dir, fake).encrypt('olá, segredo')
	tok := os.Getenv("ZENO_ELECTRON_TOKEN")
	if tok == "" {
		tok = electronToken
	}
	if p, err := v.Decrypt(tok); err != nil || p != "olá, segredo" {
		t.Errorf("token do Electron: %q %v", p, err)
	}
	if st := v.Status(); st.Str("keyId") != KeyID([]byte("0123456789abcdef0123456789abcdef")) {
		t.Errorf("status: %v", st)
	}
}

// OSCrypt v11/v10 (safeStorage do Electron no Linux): dado gerado pelo Chromium com senha conhecida
func TestOSCrypt(t *testing.T) {
	data := keyring.Encrypt("v11", "senha-do-chaveiro", []byte("chave-em-base64=="))
	if keyring.Prefix(data) != "v11" || len(data) != 3+32 {
		t.Fatalf("formato: %q %d", data[:3], len(data))
	}
	if p, err := keyring.Decrypt("senha-do-chaveiro", data); err != nil || string(p) != "chave-em-base64==" {
		t.Errorf("ida e volta: %q %v", p, err)
	}
	if _, err := keyring.Decrypt("outra", data); err == nil {
		t.Error("senha errada deveria falhar")
	}
	if !reflect.DeepEqual(keyring.Encrypt("v10", "peanuts", []byte("x"))[:3], []byte("v10")) {
		t.Error("v10")
	}
}

// gerado pelo Vault do Electron (ver TestTokenDoElectron)
const electronToken = "$zeno$v1$3eb1bd43$AkTfC8OFIVTwo891$0jYOaYg+Z6YtGSC8IuJlFNd+jANE+KfDcUaCtEQ="
