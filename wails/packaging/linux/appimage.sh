#!/bin/sh
# Monta o AppImage da versão Go: appimage.sh <binário> <versão> <saída.AppImage>
# Usa o GTK 3 e o WebKitGTK 4.1 do sistema (levar o WebKit junto deixaria o pacote enorme e preso a uma
# versão); no Fedora: sudo dnf install webkit2gtk4.1. Precisa do appimagetool no PATH (APPIMAGETOOL troca).
set -eu
bin=$1; version=$2; out=$3
here=$(cd "$(dirname "$0")" && pwd)
icons=$here/../../../build/icons
dir=$(mktemp -d)
trap 'rm -rf "$dir"' EXIT
app=$dir/Zeno.AppDir

install -Dm755 "$bin" "$app/usr/bin/zeno"
sed 's|^Exec=.*|Exec=zeno %U|' "$here/zeno.desktop" > "$app/zeno.desktop"
cp "$icons/256x256.png" "$app/zeno.png"
ln -s zeno.png "$app/.DirIcon"
for s in 16 24 32 48 64 128 256 512; do
  install -Dm644 "$icons/${s}x${s}.png" "$app/usr/share/icons/hicolor/${s}x${s}/apps/zeno.png"
done
cat > "$app/AppRun" <<'RUN'
#!/bin/sh
here=$(dirname "$(readlink -f "$0")")
if ! ldconfig -p 2>/dev/null | grep -q libwebkit2gtk-4.1.so.0; then
  echo "Zeno precisa do WebKitGTK 4.1 do sistema:" >&2
  echo "  Debian/Ubuntu: sudo apt install libwebkit2gtk-4.1-0" >&2
  echo "  Fedora:        sudo dnf install webkit2gtk4.1" >&2
  echo "  Arch:          sudo pacman -S webkit2gtk-4.1" >&2
fi
exec "$here/usr/bin/zeno" "$@"
RUN
chmod 755 "$app/AppRun"
ARCH=${ARCH:-x86_64} VERSION=$version "${APPIMAGETOOL:-appimagetool}" --no-appstream "$app" "$out" >/dev/null
echo "$out"
