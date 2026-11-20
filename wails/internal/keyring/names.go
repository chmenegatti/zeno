package keyring

import "strings"

// MacKeychainName: nome do app no item do Keychain como o Electron usa no macOS: app.getName(), que é o
// productName do package.json ("Zeno"). No Linux o Electron grava application=<executável> ("zeno").
func MacKeychainName(app string) string {
	if app == "" {
		return app
	}
	return strings.ToUpper(app[:1]) + app[1:]
}
