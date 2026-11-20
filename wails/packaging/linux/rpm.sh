#!/bin/sh
# Monta o .rpm da versão Go: rpm.sh <binário> <versão> <saída.rpm>. Precisa do rpmbuild
# (Fedora: rpm-build; Debian/Ubuntu: rpm).
set -eu
bin=$(readlink -f "$1"); version=$2; out=$3
here=$(cd "$(dirname "$0")" && pwd)
icons=$(cd "$here/../../../build/icons" && pwd)
top=$(mktemp -d)
trap 'rm -rf "$top"' EXIT
rpmbuild -bb --quiet \
  --define "_topdir $top" \
  --define "zeno_version $(echo "$version" | tr - '~')" \
  --define "zeno_bin $bin" \
  --define "zeno_pkg $here" \
  --define "zeno_icons $icons" \
  "$here/zeno.spec"
cp "$top"/RPMS/*/zeno-*.rpm "$out"
echo "$out"
