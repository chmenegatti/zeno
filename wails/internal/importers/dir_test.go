package importers

import (
	"path/filepath"
	"runtime"
	"testing"
)

// snap e Flatpak trocam HOME/XDG_CONFIG_HOME pela pasta do pacote; o Insomnia fica na home real
func TestDirPacotes(t *testing.T) {
	if runtime.GOOS != "linux" {
		t.Skip("caminhos do Linux")
	}
	t.Setenv("HOME", "/home/ana")
	t.Setenv("XDG_CONFIG_HOME", "/home/ana/.cfg")
	t.Setenv("SNAP", "")
	t.Setenv("SNAP_REAL_HOME", "")
	t.Setenv("FLATPAK_ID", "")
	if got := Dir(); got != filepath.FromSlash("/home/ana/.cfg/Insomnia") {
		t.Errorf("XDG_CONFIG_HOME: %s", got)
	}
	t.Setenv("HOME", "/home/ana/snap/zeno-rest/3")
	t.Setenv("XDG_CONFIG_HOME", "/home/ana/snap/zeno-rest/3/.config")
	t.Setenv("SNAP", "/snap/zeno-rest/3")
	t.Setenv("SNAP_REAL_HOME", "/home/ana")
	if got := Dir(); got != "/home/ana/.config/Insomnia" {
		t.Errorf("snap: %s", got)
	}
	t.Setenv("SNAP", "")
	t.Setenv("SNAP_REAL_HOME", "")
	t.Setenv("HOME", "/home/ana")
	t.Setenv("XDG_CONFIG_HOME", "/home/ana/.var/app/com.cesarmenegatti.Zeno/config")
	t.Setenv("FLATPAK_ID", "com.cesarmenegatti.Zeno")
	if got := Dir(); got != "/home/ana/.config/Insomnia" {
		t.Errorf("flatpak: %s", got)
	}
}
