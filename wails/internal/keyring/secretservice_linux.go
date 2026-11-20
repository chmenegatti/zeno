package keyring

import (
	"crypto/rand"
	"encoding/base64"
	"errors"
	"fmt"
	"time"

	"github.com/chmenegatti/zeno/wails/internal/i18n"
	"github.com/godbus/dbus/v5"
)

const (
	ssDest   = "org.freedesktop.secrets"
	ssPath   = "/org/freedesktop/secrets"
	ssSchema = "chrome_libsecret_os_crypt_password_v2"
)

type secret struct {
	Session     dbus.ObjectPath
	Parameters  []byte
	Value       []byte
	ContentType string
}

// SecretService: senha do app no gnome-keyring (ou outro Secret Service), como o Chromium guarda
type SecretService struct {
	// App: atributo "application" do item (o Electron usa o nome do app: "zeno")
	App string
}

func (s SecretService) attrs() map[string]string {
	return map[string]string{"xdg:schema": ssSchema, "application": s.App}
}

func (s SecretService) open() (*dbus.Conn, dbus.ObjectPath, error) {
	conn, err := dbus.SessionBus()
	if err != nil {
		return nil, "", err
	}
	var out dbus.Variant
	var session dbus.ObjectPath
	if err := conn.Object(ssDest, ssPath).Call("org.freedesktop.Secret.Service.OpenSession", 0, "plain", dbus.MakeVariant("")).Store(&out, &session); err != nil {
		return nil, "", err
	}
	return conn, session, nil
}

// destrava itens (pode pedir a senha do chaveiro na tela)
func unlock(conn *dbus.Conn, paths []dbus.ObjectPath) error {
	var unlocked []dbus.ObjectPath
	var prompt dbus.ObjectPath
	if err := conn.Object(ssDest, ssPath).Call("org.freedesktop.Secret.Service.Unlock", 0, paths).Store(&unlocked, &prompt); err != nil {
		return err
	}
	if prompt == "/" {
		return nil
	}
	ch := make(chan *dbus.Signal, 1)
	conn.Signal(ch)
	defer conn.RemoveSignal(ch)
	_ = conn.AddMatchSignal(dbus.WithMatchObjectPath(prompt), dbus.WithMatchInterface("org.freedesktop.Secret.Prompt"))
	if err := conn.Object(ssDest, prompt).Call("org.freedesktop.Secret.Prompt.Prompt", 0, "").Err; err != nil {
		return err
	}
	select {
	case sig := <-ch:
		if len(sig.Body) > 0 {
			if dismissed, _ := sig.Body[0].(bool); dismissed {
				return errors.New(i18n.T("desbloqueio do chaveiro cancelado"))
			}
		}
		return nil
	case <-time.After(2 * time.Minute):
		return errors.New(i18n.T("chaveiro não foi desbloqueado"))
	}
}

// password: senha guardada; create=true cria uma nova se não existir (como o Chromium)
func (s SecretService) password(create bool) (string, error) {
	conn, session, err := s.open()
	if err != nil {
		return "", err
	}
	svc := conn.Object(ssDest, ssPath)
	var unlocked, locked []dbus.ObjectPath
	if err := svc.Call("org.freedesktop.Secret.Service.SearchItems", 0, s.attrs()).Store(&unlocked, &locked); err != nil {
		return "", err
	}
	if len(unlocked) == 0 && len(locked) > 0 {
		if err := unlock(conn, locked); err != nil {
			return "", err
		}
		unlocked = locked
	}
	if len(unlocked) > 0 {
		var sec secret
		if err := conn.Object(ssDest, unlocked[0]).Call("org.freedesktop.Secret.Item.GetSecret", 0, session).Store(&sec); err != nil {
			return "", err
		}
		return string(sec.Value), nil
	}
	if !create {
		return "", errors.New(i18n.T("senha do zeno não está no chaveiro"))
	}
	b := make([]byte, 16)
	_, _ = rand.Read(b)
	pw := base64.StdEncoding.EncodeToString(b)
	props := map[string]dbus.Variant{
		"org.freedesktop.Secret.Item.Label":      dbus.MakeVariant(s.App + " Safe Storage"),
		"org.freedesktop.Secret.Item.Attributes": dbus.MakeVariant(s.attrs()),
	}
	coll := conn.Object(ssDest, "/org/freedesktop/secrets/aliases/default")
	var item, prompt dbus.ObjectPath
	if err := coll.Call("org.freedesktop.Secret.Collection.CreateItem", 0, props, secret{Session: session, Value: []byte(pw), ContentType: "text/plain"}, true).Store(&item, &prompt); err != nil {
		return "", fmt.Errorf(i18n.T("não deu pra guardar a senha no chaveiro: %w"), err)
	}
	if prompt != "/" {
		return "", errors.New(i18n.T("chaveiro bloqueado: desbloqueie e tente de novo"))
	}
	return pw, nil
}

// Available: Secret Service no ar (o Electron chama de gnome_libsecret)
func (s SecretService) Available() (bool, string, bool) {
	conn, _, err := s.open()
	if err != nil || conn == nil {
		return false, "basic_text", true
	}
	return true, "gnome_libsecret", false
}

// Protect cifra no formato v11
func (s SecretService) Protect(text string) ([]byte, error) {
	pw, err := s.password(true)
	if err != nil {
		return nil, err
	}
	return Encrypt("v11", pw, []byte(text)), nil
}

// Unprotect abre v11 (senha do chaveiro) ou v10 (senha fixa do basic_text)
func (s SecretService) Unprotect(data []byte) (string, error) {
	switch Prefix(data) {
	case "v11":
		pw, err := s.password(false)
		if err != nil {
			return "", err
		}
		b, err := Decrypt(pw, data)
		return string(b), err
	case "v10":
		b, err := Decrypt("peanuts", data)
		return string(b), err
	}
	return "", errUnsupported(Prefix(data))
}

// System: o chaveiro deste sistema pro app
func System(app string) Protector { return SecretService{App: app} }
