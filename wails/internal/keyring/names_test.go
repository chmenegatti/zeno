package keyring

import "testing"

// mesmo item que o Electron (productName "Zeno") criaria no Keychain: "Zeno Safe Storage", conta "Zeno"
func TestMacKeychainName(t *testing.T) {
	for in, want := range map[string]string{"zeno": "Zeno", "Zeno": "Zeno", "zeno-teste-cofre": "Zeno-teste-cofre", "": ""} {
		if got := MacKeychainName(in); got != want {
			t.Errorf("%q: %q, want %q", in, got, want)
		}
	}
}
