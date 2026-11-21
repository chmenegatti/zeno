#!/bin/bash
# Teste ponta a ponta da versão Go (#86): sobe o servidor de teste, abre o app numa pasta de dados
# temporária e roda e2e.js pelos mesmos canais da interface. Precisa de tela (no CI: xvfb-run).
# Roda sem chaveiro (ZENO_NO_KEYRING): nunca toca no chaveiro de quem roda. Sai com erro se algum PASS virar FAIL. Uso: make e2e (depois de make build).
set -u -o pipefail
# commit do teste de git: identidade própria (o runner do CI não tem)
export GIT_AUTHOR_NAME=Zeno GIT_AUTHOR_EMAIL=e2e@zeno.local GIT_COMMITTER_NAME=Zeno GIT_COMMITTER_EMAIL=e2e@zeno.local
here=$(cd "$(dirname "$0")" && pwd)
data=$(mktemp -d)
node "$here/srv.mjs" >/dev/null 2>&1 &
srv=$!
# servidor gRPC de teste (#5)
(cd "$here/.." && go build -o "$data/grpcsrv" ./e2e/grpcsrv) || exit 1
"$data/grpcsrv" >/dev/null 2>&1 &
gsrv=$!
trap 'kill $srv $gsrv 2>/dev/null; rm -rf "$data"' EXIT
sleep 1
out=$(ZENO_UPDATE_URL=http://127.0.0.1:4777/gh/latest ZENO_NO_KEYRING=1 ZENO_DATA_DIR=$data ZENO_SCRIPT="$(cat "$here/e2e.js")" timeout 180 "$here/../build/zeno" 2>&1 | while IFS= read -r line; do
  case "$line" in
    # arquivos vivos: edita um YAML por fora (depois da janela em que o app ignora as próprias gravações)
    *EDITAR-AGORA*) sleep 2; echo "# editado por fora" >> "$(find "$data" -name workspace.yaml | head -1)" ;;
    *"[renderer]"*) echo "${line#*\[renderer\] }" ;;
  esac
done)
status=$?
echo "$out"
# o app tem que sair sozinho no fim do roteiro (timeout = travou)
[ "$status" -eq 0 ] || { echo "app saiu com $status"; exit 1; }
echo "$out" | grep -q "RESULTADO .* 0 falhas"
