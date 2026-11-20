#!/bin/sh
# Regenera as fontes declaradas do Flatpak a partir do código no checkout atual (rodar na tag do release):
#   go-modules.txt + go-sources.json  (módulos Go, de wails/go.mod)
#   node-sources.json                 (pacotes npm, de package-lock.json)
# Precisa de go e do flatpak-node-generator:
#   pip install --user "git+https://github.com/flatpak/flatpak-builder-tools.git#subdirectory=node"
set -eu
here=$(cd "$(dirname "$0")" && pwd)
root=$(cd "$here/../.." && pwd)
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

(cd "$root/wails" && go mod vendor -o "$tmp/vendor")
cp "$tmp/vendor/modules.txt" "$here/go-modules.txt"
(cd "$root/wails" && python3 "$here/go-sources.py" "$tmp/vendor/modules.txt") > "$here/go-sources.json"

flatpak-node-generator npm "$root/package-lock.json" -o "$here/node-sources.json"
echo "ok: go-sources.json ($(grep -c '"archive"' "$here/go-sources.json") módulos), node-sources.json"
