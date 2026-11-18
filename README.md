# Zeno

## Ideia
Cliente de API desktop (Electron) com tela única: lateral com coleções, request no meio, resposta à direita. Sem abas. Dados em arquivos YAML legíveis, e importa direto do Insomnia.

## Problema
O Insomnia 12 passou a abrir abas e não tem opção pra desligar. Alternativas como o Yaak não agradaram. Preciso de algo simples que leia minhas coleções do Insomnia sem conversão manual.

## Status
em-andamento

## Notas

### Rodar
```bash
npm install
npm run dev        # desenvolvimento (com --noSandbox)
npm test           # vitest
npm run dist       # gera .deb e AppImage em dist/
```

### Onde ficam os dados
`~/.local/share/zeno/` (ou `$ZENO_DATA_DIR`). Fora deste repo de propósito: os ambientes importados do Insomnia têm senhas e tokens em texto puro.

```
<workspace>/workspace.yaml
<workspace>/_env/<ambiente>.yaml        # base (parentId: null) e sub-ambientes
<workspace>/<pasta>/folder.yaml         # headers, auth e variáveis herdadas
<workspace>/<pasta>/<request>.yaml
.responses/<requestId>.json             # últimas 20 respostas
state.json                              # workspace/request/ambiente ativos
```
Dá pra editar os YAML com o app aberto: ele recarrega sozinho.

### O que já faz
- HTTP: métodos, params, headers, body (JSON, XML, texto, form, multipart com arquivo), redirect, timeout, cancelar, TLS inválido opcional por workspace.
- Auth: basic, bearer, API key (header/query), herdar da pasta.
- Variáveis `{{ nome }}` e `{{ _.nome }}`, com herança base → sub-ambiente → pastas.
- Tags do Insomnia: `{% response %}` (body com JSONPath/caminho XML, header, url; gatilhos never/no-history/when-expired/always), `{% uuid %}`, `{% now %}`.
- Import do Insomnia: lê `~/.config/Insomnia` (NeDB) ou export JSON v4, com prévia e lista de avisos.
- Variáveis como badges (na URL, na barra do request e na lateral): clique pra ver, editar, criar ou remover, escolhendo onde salvar (ambiente ativo, Base ou pasta).
- Visual com a paleta TOTVS (marca.totvs.com): Azul Escuro `#002233`, Azul `#00DBFF`, Roxo `#A44DFF` e terciárias nos métodos e status.
- Árvore com ícones de pasta, busca, arrastar pra reordenar ou mover, renomear, duplicar e excluir.
- Atalhos: Ctrl+Enter enviar, Ctrl+N novo request, Ctrl+K buscar, Ctrl+E ambiente.

### Ainda não faz
GraphQL (importado como texto), gRPC, WebSocket, scripts pre/pós-request, OAuth2, cookies, export v5 (YAML) do Insomnia, tag `{% faker %}`.

### Verificação manual
`ZENO_DATA_DIR=/tmp/x ZENO_SCREENSHOT=/tmp/x.png npx electron . --no-sandbox` abre, tira print da janela e fecha. `ZENO_SCRIPT` roda JS na página antes do print.
`ZENO_REAL=1 npx vitest run test/real-import.test.ts` importa o Insomnia real pra uma pasta temporária e confere as contagens.
