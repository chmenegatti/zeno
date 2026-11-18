<div align="center">

<img src="docs/logo.png" width="112" alt="Logo do Zeno" />

# Zeno

**Cliente de API desktop focado: uma tela, sem abas, coleções em YAML e segredos criptografados.**

[![Release](https://img.shields.io/github/v/release/chmenegatti/zeno?color=00dbff&label=release)](https://github.com/chmenegatti/zeno/releases/latest)
[![CI](https://github.com/chmenegatti/zeno/actions/workflows/ci.yml/badge.svg)](https://github.com/chmenegatti/zeno/actions/workflows/ci.yml)
[![Licença MIT](https://img.shields.io/github/license/chmenegatti/zeno?color=a44dff)](LICENSE)
![Plataforma](https://img.shields.io/badge/plataforma-Linux-002233)
[![Contribuições bem-vindas](https://img.shields.io/badge/PRs-bem--vindos-00ffd4)](CONTRIBUTING.md)

[Instalação](#instalação) · [Recursos](#recursos) · [Primeiros passos](#primeiros-passos) · [Cofre de segredos](#cofre-de-segredos) · [Scripts](#scripts-e-testes) · [Git](#git-e-trabalho-em-equipe) · [Roadmap](#roadmap) · [Contribuir](CONTRIBUTING.md)

<img src="docs/screenshot.png" alt="Tela do Zeno: coleções à esquerda, request no meio e resposta à direita" width="100%" />

</div>

## Por que o Zeno?

Clientes de API populares foram ganhando abas, contas na nuvem e telas cada vez mais cheias. O Zeno vai no sentido oposto:

- **Uma tela só.** Lateral com as coleções, request no meio, resposta à direita. Clicar num request troca o conteúdo; nada se empilha.
- **Seus dados são arquivos.** Cada request é um arquivo YAML legível, numa pasta sua. Dá pra versionar no git, revisar em PR e editar no seu editor favorito.
- **Segredos não vazam.** Senhas e tokens ficam criptografados no próprio YAML, com a chave guardada no chaveiro do sistema.
- **Migração sem dor.** Importa as coleções do Insomnia direto da pasta dele, incluindo ambientes e encadeamento de tokens.
- **Local primeiro.** Sem conta, sem telemetria, sem sincronização obrigatória.

## Recursos

| | |
|---|---|
| **HTTP completo** | Todos os métodos, params, headers, body JSON/XML/texto/form/multipart com arquivo, redirects, timeout e cancelamento |
| **Autenticação** | Basic, Bearer, API key (header ou query) e herança da pasta |
| **Ambientes e variáveis** | `{{ var }}` e `{{ _.var }}` com herança Base → sub-ambiente → pasta, troca rápida com `Ctrl+E` |
| **Badges de variáveis** | Variáveis aparecem como badges na URL e na lateral; clique pra ver, editar, criar ou mover |
| **Scripts e testes** | JavaScript antes do envio e depois da resposta (por request ou pasta), com `zeno.test`/`zeno.expect`; scripts do Insomnia e do Postman rodam sem mudança |
| **Asserções e executor** | Checagens de status, header, JSONPath, body e tempo sem programar; rode uma pasta inteira com iterações, dados CSV/JSON e relatório JUnit, no app ou com `zeno run` no CI |
| **Encadeamento** | `{% response %}` usa o body, header ou URL de outro request, reenviando só quando o valor expira |
| **Cofre de segredos** | AES-256-GCM com a chave protegida pelo chaveiro do sistema (gnome-keyring, KWallet) |
| **cURL e código** | Cole um `curl` na URL e o request é montado; copie como cURL ou gere Go, JavaScript e Python |
| **Importação** | Insomnia (pasta, export v4 e v5), OpenAPI 3 e Swagger 2 (arquivo ou URL) e Postman v2.1 com ambientes, com prévia e lista do que não foi convertido |
| **Organização** | Pastas aninhadas, arrastar pra mover/reordenar, duplicar, renomear, busca com `Ctrl+K` |
| **Resposta** | JSON formatado com destaque de sintaxe, headers, tempos e histórico das últimas 20 respostas |
| **Git integrado** | Workspace dentro do repo do projeto, com status, diff por request, commit, pull, push e branches |
| **Arquivos vivos** | Editou o YAML por fora ou deu `pull`? O app recarrega na hora |

## Instalação

Baixe o pacote na [página de releases](https://github.com/chmenegatti/zeno/releases/latest).

**Debian/Ubuntu (.deb)**

```bash
sudo apt install ./zeno_*_amd64.deb
```

**Qualquer distribuição (AppImage)**

```bash
chmod +x Zeno-*.AppImage
./Zeno-*.AppImage
```

> Por enquanto há pacotes só para Linux x64. O código roda em macOS e Windows com `npm run dev`; ajuda para empacotar nessas plataformas é bem-vinda.

### A partir do código

Requer Node.js 22 ou mais novo.

```bash
git clone https://github.com/chmenegatti/zeno.git
cd zeno
npm install
npm run dev
```

## Primeiros passos

1. **Importe** (opcional): menu do workspace → *Importar…*. Lê o Insomnia instalado, arquivos (export do Insomnia, OpenAPI/Swagger, coleção e ambientes do Postman) ou a URL de um spec. Escolha os workspaces na prévia e deixe marcada a opção de criptografar senhas e tokens.

   Do OpenAPI sai uma pasta por tag, um request por operação, `{{ base_url }}` com o primeiro servidor, parâmetros de path como `{{ id }}` e body de exemplo montado do schema.
2. **Ou crie do zero**: *Novo workspace*, depois `Ctrl+N` para um request.
3. **Defina variáveis**: clique no ✎ ao lado do ambiente ou em ＋ na seção *Variáveis*. Use `{{ base_url }}/recurso` na URL.
4. **Envie** com `Ctrl+Enter`.

> Tem um `curl` pronto (da documentação ou do *Copy as cURL* do navegador)? Cole no campo de URL: método, headers, body, query, `-u` e Bearer viram campos do request.

### Atalhos

Mesmo padrão do Insomnia. Todos podem ser trocados em **⌨ Atalhos** (`Ctrl+Shift+/`): *trocar*, *+* (outra combinação) ou *padrão*. **Importar do Insomnia** traz os atalhos que você personalizou lá.

| Atalho | Ação |
|---|---|
| `Ctrl+=` / `Ctrl+-` / `Ctrl+0` | Zoom da janela (fica salvo) |
| `Ctrl+Shift+=` / `Ctrl+Shift+-` | Fonte dos editores |
| `Ctrl+\` | Mostrar/esconder a lateral |
| `Ctrl+P` | Paleta de comandos: busca difusa em requests de todos os workspaces e ações (trocar ambiente/workspace, importar, preferências…). `>` no começo = só comandos |
| `Ctrl+Shift+F` | Filtrar a lateral; com o foco num editor, formata o JSON (mantém `{{ }}` e `{% %}`) |
| `Ctrl+L` / `Ctrl+'` | Focar a URL / a resposta |
| `Ctrl+,` / `Ctrl+Shift+,` | Preferências (zoom, fontes) / configurações do workspace |
| `Ctrl+Shift+/` | Lista de atalhos |
| `Ctrl+Enter`, `Ctrl+R`, `F5` | Enviar request |
| `Ctrl+Shift+Enter` | Opções de envio: enviar depois de N segundos ou repetir a cada N segundos (também no ▾ ao lado do Enviar) |
| `Ctrl+K` | Cookies do workspace |
| `Ctrl+Shift+P` | Fixar/desafixar o request no topo da lateral |
| `Ctrl+N` / `Ctrl+Shift+N` | Novo request / nova pasta (na pasta atual) |
| `Ctrl+D` / `Ctrl+Shift+Backspace` | Duplicar / excluir o request |
| `Ctrl+Shift+L` / `Ctrl+Shift+H` / `Ctrl+Shift+G` | Método HTTP / histórico de respostas / gerar código |
| `Ctrl+E` / `Ctrl+Shift+E` | Editar ambientes / trocar ambiente |
| `Alt+Shift+U` | Badges de variável mostram o valor em vez do nome (secretos continuam mascarados) |
| `Ctrl+S` | Salvar agora (o salvamento já é automático) |
| `F11`, `Ctrl+Alt+I`, `Ctrl+Q` | Tela cheia, DevTools, sair |
| Duplo clique | Renomear item na lateral |
| Botão direito | Menu de contexto (novo, duplicar, copiar como cURL, gerar código, excluir) |

## Variáveis e ambientes

Cada workspace tem um ambiente **Base** e quantos sub-ambientes quiser (Desenvolvimento, Produção…). Pastas também podem ter variáveis. Na hora de enviar, vale a definição mais específica: **pasta > sub-ambiente ativo > Base**.

<img src="docs/variaveis.png" alt="Popover de edição de variável" width="640" />

Clique em qualquer badge para ver de onde vem o valor, mudar, mover para outro nível ou marcar como secreto. Badge laranja indica variável que não existe no ambiente ativo; clicar nela já cria.

As variáveis viram badge em todo lugar: URL, params, headers, auth, campos de formulário e também nos editores de body e de ambientes. Digitar `{{` abre a lista de variáveis do ambiente ativo, com valor (secretos mascarados) e origem; `Ctrl+Espaço` mostra variáveis e tags. `Alt+Shift+U` troca o nome pelo valor nos badges.

### Tags de template

| Tag | O que faz |
|---|---|
| `{% response 'body', 'req_id', '$.token', 'when-expired', 3600 %}` | Valor da resposta de outro request (JSONPath ou caminho XML). Gatilhos: `never`, `no-history`, `when-expired`, `always` |
| `{% response 'header', 'req_id', 'X-Session' %}` | Header da resposta de outro request |
| `{% response 'body', 'Auth / Login', '$.token' %}` | O request também pode ser indicado pelo nome ou pelo caminho `Pasta / Nome` |
| `{% uuid 'v4' %}` | UUID aleatório |
| `{% now %}` | Data e hora atual (ISO 8601) |
| `{% timestamp 'millis'\|'unix'\|'iso' %}` | Timestamp em milissegundos, segundos ou ISO |
| `{% faker 'randomEmail' %}` | Dado falso com os nomes do Insomnia/Postman: `randomFullName`, `randomEmail`, `randomPhoneNumber`, `randomCPF`, `randomUUID`, `randomInt`, `randomCity`… |
| `{% hash 'sha256', 'hex', '{{ senha }}' %}` | Hash md5/sha1/sha256/sha512 em hex ou base64 |
| `{% base64 'encode', 'normal', '{{ user }}:{{ pass }}' %}` | Codifica/decodifica base64 (normal ou URL-safe) |
| `{% file '~/chave.pem' %}` | Conteúdo de um arquivo |
| `{% prompt 'Código 2FA', 'Digite o código', '', 'otp', true %}` | Pergunta na hora de enviar (uma vez por envio; pode lembrar até fechar o app). Cancelar não envia |
| `{% jsonpath '{{ perfil_json }}', '$.id' %}` | JSONPath sobre um texto JSON (ex.: variável) |

Os argumentos aceitam `{{ variáveis }}`. Clicar no badge abre um formulário próprio de cada função, com prévia do valor.

A sintaxe é a mesma do Insomnia, então coleções importadas funcionam sem ajuste. Nos campos (URL, params, headers, auth, body) e no JSON dos ambientes e das variáveis da pasta, a tag aparece como badge, por exemplo `ƒ Resposta ⇒ Login · $.access_token`; clique nele pra editar request, atributo, filtro e gatilho, com prévia do valor. `Ctrl+Espaço` lista variáveis e tags (escolha *Outra tag…* pra abrir o editor); nos editores (body, ambientes) também dá pra digitar `respon…`, `uuid` ou `now` e escolher a sugestão. Badge vermelho = request referenciado não existe.

## Cookies

Cada workspace tem um jar de cookies, como no Insomnia: o `Set-Cookie` das respostas (inclusive nos redirects, como no login que devolve 302) fica guardado e vai automaticamente nos requests seguintes, respeitando domínio, caminho, `Secure` e expiração. Cookies expirados são descartados. `Ctrl+K` (ou **Cookies** no rodapé da lateral) abre a tela para ver, editar, apagar e limpar. Na aba **Headers** de cada request dá para desligar *Enviar cookies* ou *Guardar cookies da resposta*. O jar fica em `<pasta de dados>/.cookies/`, fora dos YAML e do git.

## Scripts e testes

Cada request (e cada pasta) tem uma aba *Scripts* com dois editores: **antes do envio** e **depois da resposta**. Os da pasta rodam antes dos do request.

```js
// depois do login: guarda o token pro próximo request usar em {{ token }}
const body = zeno.response.json()
zeno.environment.set('token', body.access_token)

zeno.test('login ok', () => {
  zeno.expect(zeno.response.code).to.equal(200)
  zeno.expect(body).to.have.property('access_token').that.is.a('string')
})
```

| API | O que faz |
|---|---|
| `zeno.environment` / `zeno.baseEnvironment` | `get`, `set`, `unset`, `has`, `toObject` no ambiente ativo / Base. O que muda é salvo no YAML; nomes como `token` e `senha` vão cifrados pro cofre |
| `zeno.variables` | Variáveis só deste envio (`{{ nome }}` no request) |
| `zeno.request` | `method`, `url`, `headers.add/upsert/remove`, `url.addQueryParams`, `body.raw` (antes do envio) |
| `zeno.response` | `code`, `status`, `headers.get`, `json()`, `text()`, `responseTime` (depois da resposta) |
| `zeno.test(nome, fn)` / `zeno.expect` | Testes com asserções no estilo chai; o resultado aparece na aba *Testes* da resposta |

`insomnia.*` e `pm.*` são apelidos de `zeno.*`, então scripts importados do Insomnia e do Postman funcionam nos casos comuns. Os scripts rodam isolados: sem rede, arquivos, `require` ou timers, com limite de 5 s. Erro no script aparece no painel; se for no pré-request, o envio não acontece.

### Asserções

Na aba *Asserções* do request dá pra checar a resposta sem escrever código: status, header, campo por JSONPath (`$.user.id`, `$.items[*].id`, `$..id`), body e tempo, com `=`, `≠`, `contém`, `<`, `>`, `existe` e regex. O valor esperado aceita `{{ variáveis }}`. O resultado aparece junto dos testes dos scripts.

### Rodar uma pasta (executor de coleção)

Clique com o botão direito numa pasta e escolha **Rodar pasta…** (ou, no espaço vazio da lateral, **Rodar workspace…**). Os requests rodam na ordem da lateral e o que um script grava (um token, por exemplo) vale para os seguintes. Dá pra escolher o ambiente, repetir em várias iterações, esperar entre requests, parar na primeira falha e usar um CSV (com cabeçalho) ou JSON (lista de objetos) em que cada linha vira variáveis de uma iteração. O relatório mostra cada request e cada asserção, e pode ser exportado como JUnit XML.

### Linha de comando (CI)

```sh
zeno run "Minha API" Usuários --env Homolog --junit relatorio.xml
zeno run ./api-workspace --data usuarios.csv --var token=$API_TOKEN   # pasta com workspace.yaml, ex.: no repositório
```

| Opção | |
|---|---|
| `-e, --env <nome>` | sub-ambiente |
| `-n, --iterations <n>` / `-d, --delay <ms>` | repetições e atraso entre requests |
| `--data <arquivo>` | CSV ou JSON; uma iteração por linha |
| `--var nome=valor` | variável extra (vale sobre ambiente e dados); repita quantas vezes quiser |
| `--junit <arquivo>` | relatório JUnit XML |
| `--bail` | para no primeiro request que falhar |
| `--data-dir <dir>` | pasta de dados do Zeno |

Sai com `0` se tudo passou, `1` se algum request ou teste falhou e `2` em erro de uso. Na CLI, o que os scripts gravam nos ambientes vale só durante a execução: os YAML não mudam. No app instalado, `zeno run` usa o chaveiro pra abrir os segredos cifrados; sem chaveiro (ex.: no CI, com `npm run build && node out/main/cli.js run …`), passe-os com `--var`.

## Cofre de segredos

- Valores marcados como secretos ficam no YAML como `$zeno$v1$…` (AES-256-GCM). **Esses arquivos podem ir para o git.**
- A chave mestra (256 bits, aleatória) fica em `.vault/key`, cifrada pelo chaveiro do sistema via `safeStorage` do Electron. Sem um chaveiro de verdade, o Zeno se recusa a criar o cofre.
- Só o processo principal decifra, e só na hora de enviar ou quando você clica em *mostrar*. A interface exibe `••••••`.
- Em *Configurações do workspace → Cofre de segredos*, o Zeno encontra e cifra de uma vez senhas, tokens, headers `Authorization` e valores repetidos de segredos.
- Em outro computador, sem a chave, o Zeno avisa e pede para redefinir o valor.

Detalhes e limitações em [SECURITY.md](SECURITY.md).

## Git e trabalho em equipe

Um workspace pode morar dentro do repositório do seu projeto, junto do código:

1. *Configurações do workspace → Local e git → Mover para pasta…* e escolha uma pasta do repo (ex.: `meu-projeto/api/`). Se a pasta já tiver outros arquivos, o Zeno cria uma subpasta com o nome do workspace.
2. O botão de branch ao lado do nome do workspace abre o painel Git: arquivos alterados com o nome do request, diff, commit, pull, push e troca ou criação de branch.
3. Quem clona o repo usa *Abrir workspace de uma pasta…* no menu de workspaces.

Detalhes:

- Cada request é um arquivo, então duas pessoas editando requests diferentes fazem merge sem conflito. O pull usa `--rebase --autostash`; se mesmo assim houver conflito, o painel avisa e oferece desfazer.
- O commit leva só a pasta do workspace, nunca o resto do repositório.
- Respostas, estado da tela e a chave do cofre ficam na pasta de dados, fora do repo. Se houver segredo em texto puro, o painel bloqueia o commit e oferece criptografar antes.
- Quem não tem a chave do cofre vê os segredos como indisponíveis e define o próprio valor.
- Usa o `git` instalado, com a sua configuração, chaves SSH e credential helpers.
- Remover um workspace vinculado só o tira do Zeno; os arquivos continuam no repo.

## Onde ficam os dados

Por padrão em `~/.local/share/zeno/` (ou na pasta indicada por `ZENO_DATA_DIR`):

```text
<workspace>/workspace.yaml
<workspace>/_env/<ambiente>.yaml        # Base (parentId: null) e sub-ambientes
<workspace>/<pasta>/folder.yaml         # headers, auth e variáveis herdadas
<workspace>/<pasta>/<request>.yaml
.vault/key                              # chave do cofre, protegida pelo chaveiro
.responses/<requestId>.json             # últimas 20 respostas (não versionar)
state.json                              # workspace, request e ambiente ativos
links.json                              # workspaces que moram em outras pastas (ex.: num repo)
```

Exemplo de request:

```yaml
id: req_produtos
name: Listar produtos
method: GET
url: "{{ base_url }}/produtos"
params:
  - { name: limit, value: "{{ page_size }}", enabled: true }
headers:
  - { name: X-Tenant, value: "{{ tenant }}", enabled: true }
auth:
  type: bearer
  token: "{% response 'body', 'req_login', '$.token', 'when-expired', 3600 %}"
sortKey: 1
```

## Roadmap

Os próximos passos estão nas [issues abertas](https://github.com/chmenegatti/zeno/issues), entre eles:

- GraphQL, gRPC, WebSocket e SSE
- OAuth 2.0, cookies, proxy e mTLS
- paleta de comandos e plugins

Quer ajudar em algum? Comente na issue antes de começar.

## Desenvolvimento

| Comando | O que faz |
|---|---|
| `npm run dev` | App em modo desenvolvimento com recarga |
| `npm test` | Testes (Vitest) |
| `npm run typecheck` | Checagem de tipos do main e do renderer |
| `npm run build` | Build de produção em `out/` |
| `npm run dist` | Gera `.deb` e AppImage em `dist/` |
| `npm run release` | Nova versão: changelog, tag e commit de release |

Stack: Electron, React, TypeScript, Vite (electron-vite), Tailwind CSS, CodeMirror 6, Zustand e undici.

```text
src/main/       processo principal: armazenamento YAML, HTTP, cofre, git, import, tags
src/preload/    ponte segura entre main e interface (contextBridge)
src/renderer/   interface React
src/shared/     tipos e lógica pura usada pelos dois lados (variáveis, templates)
test/           testes Vitest
```

Para verificar a interface sem abrir a janela manualmente:

```bash
ZENO_DATA_DIR=/tmp/zeno-teste ZENO_SCREENSHOT=/tmp/tela.png npx electron . --no-sandbox
```

`ZENO_SCRIPT` executa JavaScript na página antes da captura. Mais detalhes em [CONTRIBUTING.md](CONTRIBUTING.md).

## Contribuindo

Contribuições são muito bem-vindas: correções, recursos, documentação e traduções. Leia o [guia de contribuição](CONTRIBUTING.md) e o [código de conduta](CODE_OF_CONDUCT.md).

## Licença

[MIT](LICENSE) © Cesar Menegatti

O Zeno é um projeto independente, inspirado no fluxo de trabalho do [Insomnia](https://insomnia.rest) e do [Yaak](https://yaak.app), sem afiliação com eles. A paleta de cores segue a identidade visual da [TOTVS](https://marca.totvs.com).
