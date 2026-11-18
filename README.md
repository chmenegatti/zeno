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

### Commits e releases
- Commits seguem [Conventional Commits](https://www.conventionalcommits.org/pt-br/): `feat:`, `fix:`, `perf:`, `security:` entram no changelog; `docs:`, `chore:`, `test:`, `ci:`, `refactor:` não.
- `npm run release` calcula a próxima versão pelos commits, atualiza `CHANGELOG.md` e `package.json`, faz o commit `chore(release): vX.Y.Z` e cria a tag. `npm run release:dry` mostra o que faria.
- `git push --follow-tags` envia a tag; o workflow `.github/workflows/release.yml` testa, gera `.deb` e AppImage e publica a release no GitHub com as notas do changelog.

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

### Cofre de segredos
- Valor marcado como secreto vai pro YAML como `$zeno$v1$<chave>$<iv>$<dados>` (AES-256-GCM). Dá pra subir no git.
- A chave mestra (aleatória, 256 bits) fica em `.vault/key`, cifrada pelo chaveiro do sistema (`safeStorage` do Electron: gnome-keyring/kwallet no Linux). Sem chaveiro de verdade (`basic_text`), o app recusa criar o cofre.
- Só o processo principal decifra, e só na hora de enviar ou quando você clica em "mostrar".
- Onde marcar: no popover da variável (caixa "secreta"), no cadeado dos campos de auth e em **Workspace → Cofre de segredos**, que acha e cifra de uma vez senhas, tokens, headers `Authorization` e valores repetidos de segredos.
- O import do Insomnia já cifra tudo isso (opção ligada por padrão).
- Outro computador sem a chave: o app avisa que o segredo foi cifrado com outra chave; redefina o valor.
- Senha escrita no meio de URL ou body não é cifrada automaticamente: aparece como aviso pra virar variável.

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
