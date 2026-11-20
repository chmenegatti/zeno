#!/bin/bash
# Teste ponta a ponta da versão Go (#86): sobe o servidor de teste, abre o app numa pasta de dados
# temporária e roda e2e.js pelos mesmos canais da interface. Precisa de tela (no CI: xvfb-run).
# Sai com erro se algum PASS virar FAIL. Uso: make e2e (depois de make build).
set -u
here=$(cd "$(dirname "$0")" && pwd)
data=$(mktemp -d)
node "$here/srv.mjs" >/dev/null 2>&1 &
srv=$!
trap 'kill $srv 2>/dev/null; rm -rf "$data"' EXIT
sleep 1
out=$(ZENO_DATA_DIR=$data ZENO_SCRIPT="$(cat "$here/e2e.js")" timeout 180 "$here/../build/zeno" 2>&1 | while IFS= read -r line; do
  case "$line" in
    # arquivos vivos: edita um YAML por fora (depois da janela em que o app ignora as próprias gravações)
    *EDITAR-AGORA*) sleep 2; echo "# editado por fora" >> "$(find "$data" -name workspace.yaml | head -1)" ;;
    *"[renderer]"*) echo "${line#*\[renderer\] }" ;;
  esac
done)
echo "$out"
echo "$out" | grep -q "RESULTADO .* 0 falhas"
