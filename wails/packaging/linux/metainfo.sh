#!/bin/sh
# Metainfo AppStream do .deb/.rpm (nome, ícone, descrição e capturas nas lojas: App Center, GNOME Software,
# Discover), a partir do arquivo do Flatpak: muda só o .desktop, que aqui é zeno.desktop. Uso: metainfo.sh > arquivo
set -eu
here=$(cd "$(dirname "$0")" && pwd)
sed 's|<launchable type="desktop-id">com.cesarmenegatti.Zeno.desktop</launchable>|<launchable type="desktop-id">zeno.desktop</launchable>|' \
  "$here/../../../packaging/flatpak/com.cesarmenegatti.Zeno.metainfo.xml"
