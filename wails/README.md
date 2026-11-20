# Zeno em Go + Wails

Migração do processo principal do Zeno de Electron para Go, mantendo a interface React (épico #53).
Enquanto a migração não termina, o Zeno oficial continua sendo o Electron da raiz do repositório.

## Como funciona

- A interface é a mesma de `src/renderer`. Fora do Electron, `src/renderer/src/bridge.ts` troca o
  `window.zeno` do preload por chamadas a `App.Call(canal, args)` e os eventos pelos do Wails.
- `handlers.go` registra os canais (os mesmos do preload). Canal ainda não portado responde
  "ainda não disponível na versão Go".
- Os dados são os mesmos arquivos do Electron (YAML, `state.json`, `.responses/`): a mesma pasta
  abre nos dois.

| Pacote | O que faz | Origem no Electron |
|---|---|---|
| `internal/doc` | documentos genéricos (map) e busca na árvore | `src/shared/tree.ts` |
| `internal/store` | leitura e gravação dos YAML, estado, histórico | `src/main/store.ts` |
| `internal/vars` | variáveis com herança, auth e headers herdados | `src/shared/template.ts`, `prepare.ts` |
| `internal/httpc` | envio HTTP com linha do tempo (`httptrace`) | `src/main/http.ts` |

## Rodar

Linux: `sudo apt install libgtk-3-dev libwebkit2gtk-4.1-dev`.

```bash
cd wails
make run      # compila a interface, o binário e abre
make test     # testes dos pacotes (sem GTK)
```

Use `ZENO_DATA_DIR=/tmp/zeno-go make run` pra não mexer nos seus dados.
