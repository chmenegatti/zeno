#!/bin/sh
# Monta o .deb da versão Go: deb.sh <binário> <versão> <saída.deb>
# Mesmo pacote e caminhos do .deb do Electron (zeno, /opt/Zeno/zeno, /usr/bin/zeno pelo alternatives),
# pra instalar por cima e atualizar sem conflito. Precisa só do dpkg-deb.
set -eu
bin=$1; version=$2; out=$3
here=$(cd "$(dirname "$0")" && pwd)
icons=$here/../../../build/icons
arch=$(dpkg --print-architecture 2>/dev/null || echo amd64)
root=$(mktemp -d)
chmod 755 "$root"
trap 'rm -rf "$root"' EXIT

install -Dm755 "$bin" "$root/opt/Zeno/zeno"
install -Dm644 "$here/zeno.desktop" "$root/usr/share/applications/zeno.desktop"
for s in 16 24 32 48 64 128 256 512; do
  install -Dm644 "$icons/${s}x${s}.png" "$root/usr/share/icons/hicolor/${s}x${s}/apps/zeno.png"
done
install -d "$root/DEBIAN"
install -m755 "$here/postinst" "$here/postrm" "$root/DEBIAN/"
size=$(du -sk --exclude=DEBIAN "$root" | cut -f1)
cat > "$root/DEBIAN/control" <<CONTROL
Package: zeno
Version: $version
Architecture: $arch
Maintainer: Cesar Menegatti <zeno@localhost>
Installed-Size: $size
Depends: libgtk-3-0t64 | libgtk-3-0, libwebkit2gtk-4.1-0
Recommends: xdg-utils, gnome-keyring | kwalletmanager
Section: devel
Priority: optional
Homepage: https://github.com/chmenegatti/zeno
Description: Cliente de API desktop sem abas
 Cliente de API desktop: coleções em YAML, segredos criptografados e import do Insomnia.
CONTROL
dpkg-deb --root-owner-group --build -Zxz "$root" "$out" >/dev/null
echo "$out"
