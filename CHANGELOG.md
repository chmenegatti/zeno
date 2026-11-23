# Changelog

Mudanças relevantes do Zeno, por versão. Gerado a partir dos commits ([Conventional Commits](https://www.conventionalcommits.org/pt-br/)) com `npm run release`.

## [1.5.1](https://github.com/chmenegatti/zeno/compare/v1.5.0...v1.5.1) (2026-11-23)

### Novidades

* **Snap**: o Zeno passa a ser publicado na Snap Store e aparece no App Center do Ubuntu (`sudo snap install zeno-rest`) ([#185](https://github.com/chmenegatti/zeno/pull/185))

### Correções

* **`.deb` e `.rpm` nas lojas**: os pacotes trazem o metainfo AppStream, então App Center, GNOME Software e Discover mostram nome, ícone, descrição e capturas em vez de "zeno" com ícone genérico; descrição do pacote e do atalho em inglês ([#183](https://github.com/chmenegatti/zeno/pull/183))


## [1.5.0](https://github.com/chmenegatti/zeno/compare/v1.4.1...v1.5.0) (2026-11-21)

### Novidades

* **Aviso de versão nova**: ao abrir (e a cada 24 h) o app consulta a última release no GitHub e avisa com *Novidades*, *Baixar* e *Pular esta versão*; no Flatpak e no Scoop mostra o comando do gerenciador. Consulta anônima, sem enviar dados; desliga em **Preferências › Atualizações** ou com `ZENO_NO_UPDATE_CHECK=1` ([#180](https://github.com/chmenegatti/zeno/pull/180))
* **Splash screen** enquanto o app carrega: logo animado, versão e crédito, no idioma da interface ([#182](https://github.com/chmenegatti/zeno/pull/182))


## [1.4.1](https://github.com/chmenegatti/zeno/compare/v1.4.0...v1.4.1) (2026-11-21)

### Correções

* **Memória depois de resposta grande**: a prévia de 256 KB guardada no histórico segurava o body inteiro (48 MB no teste) na memória; em repouso o app caiu de ~267 MB pra ~231 MB ([#175](https://github.com/chmenegatti/zeno/pull/175))

### Novidades

* **`ZENO_MEMSTATS=1`** grava a memória do Go e de cada processo do app (incluindo os do WebKit no Linux) a cada 10 s, pra diagnosticar problemas de memória ([#175](https://github.com/chmenegatti/zeno/pull/175))


## [1.4.0](https://github.com/chmenegatti/zeno/compare/v1.3.0...v1.4.0) (2026-11-21)

### Novidades

* **Parâmetros de caminho**: `:id` e `{id}` na URL viram linhas na aba *Params*, com valor e variáveis; import e export do Insomnia, Postman e OpenAPI levam junto ([#160](https://github.com/chmenegatti/zeno/pull/160))
* **Valores locais**: o valor de uma variável pode ficar só na sua máquina (`local-vars.yaml`, fora do git), por cima do ambiente; `zeno run --env-file` lê um `.env` ([#161](https://github.com/chmenegatti/zeno/pull/161))
* **Editar como texto**: params, headers e form viram texto `chave: valor` pra colar ou editar em bloco ([#162](https://github.com/chmenegatti/zeno/pull/162))
* **Voltar e avançar** entre requests com <kbd>Alt</kbd>+<kbd>←</kbd>/<kbd>→</kbd> (e botões do mouse); <kbd>Ctrl</kbd>+<kbd>Tab</kbd> abre os recentes na paleta ([#163](https://github.com/chmenegatti/zeno/pull/163))
* **Lixeira**: apagar pasta ou request não pede mais confirmação; *Desfazer* no aviso ou <kbd>Ctrl</kbd>+<kbd>Z</kbd> traz de volta, e a lixeira guarda os itens por 30 dias ([#164](https://github.com/chmenegatti/zeno/pull/164))
* **Opções por request**: timeout, seguir redirects, máximo de redirects e ignorar TLS inválido, na aba *Opções*; import/export do Insomnia e Postman ([#165](https://github.com/chmenegatti/zeno/pull/165))
* **Docs em Markdown** pra requests, pastas e workspaces, com prévia formatada ([#172](https://github.com/chmenegatti/zeno/pull/172))
* **Auth Digest e AWS Signature v4** ([#173](https://github.com/chmenegatti/zeno/pull/173))
* **Comparar respostas** ignorando a ordem das chaves do JSON, com resumo de status/tempo/tamanho, trechos iguais recolhidos e comparação com exemplos salvos ([#174](https://github.com/chmenegatti/zeno/pull/174))
* **Versão no título da janela** ([#158](https://github.com/chmenegatti/zeno/pull/158))


## [1.3.0](https://github.com/chmenegatti/zeno/compare/v1.2.0...v1.3.0) (2026-11-20)

### Novidades

* **Arrastar variáveis pros campos**: chips do painel *Variáveis* podem ser arrastados pra URL, params, headers e auth, entrando na posição em que você solta; badges mudam de lugar dentro do campo e saem quando arrastados pra fora ([#147](https://github.com/chmenegatti/zeno/pull/147))
* **Trocar o badge por outra variável**: o popover do badge tem um seletor com as variáveis do contexto e prévia do valor, como o *Edit Variable* do Insomnia ([#147](https://github.com/chmenegatti/zeno/pull/147))
* **Pacote Flatpak** anexado a cada release; instruções pro Arch (AUR) e winget atualizado automaticamente ([#138](https://github.com/chmenegatti/zeno/pull/138), [#139](https://github.com/chmenegatti/zeno/pull/139), [#140](https://github.com/chmenegatti/zeno/pull/140))
* **Site**: comparações com Insomnia, Postman e Bruno e guia de migração do Insomnia ([#141](https://github.com/chmenegatti/zeno/pull/141))

### Correções

* **Arrastar na lateral** voltou a funcionar no Linux e no macOS: pastas, requests e workspaces ([#146](https://github.com/chmenegatti/zeno/pull/146))
* **Import do Insomnia**: a mensagem do compositor de WebSocket vira a mensagem do request ([#142](https://github.com/chmenegatti/zeno/pull/142))
* Clicar na lista de um seletor dentro do popover de variável não fecha mais o popover ([#147](https://github.com/chmenegatti/zeno/pull/147))


## [1.2.0](https://github.com/chmenegatti/zeno/compare/v1.1.0...v1.2.0) (2026-11-20)

**Zeno em inglês.** A interface e as mensagens agora saem em inglês por padrão; quem prefere português escolhe em **Preferences › Language / Idioma** (a escolha vale também pras mensagens geradas pelo app). Na linha de comando, `ZENO_LANG=pt` mantém a saída em português.

> **Atualizando de 1.1 ou anterior:** o app abre em inglês. Pra voltar ao português: Preferences › Language / Idioma › Português (Brasil).

### Novidades

* **Interface em inglês ou português**: todos os textos da interface, datas e horas no formato do idioma, nomes padrão de request/pasta/ambiente no idioma escolhido ([#136](https://github.com/chmenegatti/zeno/pull/136))
* **Mensagens do app no idioma escolhido**: erros, avisos de envio, import/exportação, OAuth, rede, gRPC/WebSocket/mock, mensagens do `expect` dos scripts e toda a saída da CLI (`ZENO_LANG=pt` pra português) ([#137](https://github.com/chmenegatti/zeno/pull/137))
* **Homebrew e Scoop**: `brew install --cask chmenegatti/tap/zeno` e `scoop bucket add zeno https://github.com/chmenegatti/scoop-bucket` ([#127](https://github.com/chmenegatti/zeno/pull/127))
* **README e site em inglês** (português em `README.pt-BR.md` e `/zeno/pt/`) ([#126](https://github.com/chmenegatti/zeno/pull/126))


## [1.1.0](https://github.com/chmenegatti/zeno/compare/v1.0.0...v1.1.0) (2026-11-20)

Além do REST: **GraphQL, WebSocket, SSE e gRPC**, **OAuth 2.0** completo, rede corporativa (proxy, CA própria e mTLS), **mock server** a partir de exemplos e **exportação** pro Insomnia e Postman.

### Novidades

* **gRPC**: URL `grpc://` ou `grpcs://`; serviços por server reflection ou arquivo `.proto`, mensagem em JSON com exemplo gerado do schema, unary, server, client e bidi streaming com log de cada mensagem, status e trailers; headers viram metadata; importa o gRPC do Insomnia ([#125](https://github.com/chmenegatti/zeno/pull/125))
* **WebSocket**: URL `ws://` ou `wss://`; conectar, mandar o body como mensagem (com variáveis e tags), log com horário, filtro e JSON formatado; importa o WebSocket do Insomnia ([#123](https://github.com/chmenegatti/zeno/pull/123))
* **Server-Sent Events**: respostas `text/event-stream` mostram cada evento conforme chega, com parar; aba *Eventos* no histórico ([#123](https://github.com/chmenegatti/zeno/pull/123))
* **GraphQL**: editor com autocomplete e validação pelo schema (introspecção na URL do request, sem gravar histórico), variáveis em JSON com `{{ }}`, escolha da operação e formatação; GraphQL do Insomnia e do Postman importa sem ajuste ([#121](https://github.com/chmenegatti/zeno/pull/121))
* **OAuth 2.0**: authorization code (com PKCE), client credentials, senha, device code e implicit; login no navegador do sistema, token em cache cifrado no cofre e renovado sozinho; herança por pasta; importa do Insomnia e do Postman ([#120](https://github.com/chmenegatti/zeno/pull/120))
* **Rede por workspace**: proxy (do sistema ou personalizado, HTTP/HTTPS/SOCKS5, com exceções), CA própria somada às do sistema e certificado de cliente (mTLS) por host, PEM ou PFX com a senha no cofre ([#119](https://github.com/chmenegatti/zeno/pull/119))
* **Mock server**: ★ *exemplo* salva uma resposta no request (aba *Exemplos*: status, headers, body, atraso); *Ligar mock* sobe um servidor local por workspace que responde cada rota com o exemplo (`GET {{ base_url }}/users/{{ id }}` → `GET /users/1`), com CORS liberado ([#124](https://github.com/chmenegatti/zeno/pull/124))
* **Exportar workspaces**: zip com os YAML do Zeno, Insomnia (JSON v4) e Postman (coleção v2.1 + ambientes), de um ou vários, com prévia do que não cabe no outro formato e segredos vazios ou abertos (você escolhe) ([#122](https://github.com/chmenegatti/zeno/pull/122))
* **GitHub na tela de workspaces**: quando cada workspace foi enviado/baixado e se mudou desde então; *Salvar no GitHub* direto do cartão e da seleção ([#122](https://github.com/chmenegatti/zeno/pull/122))


## [1.0.0](https://github.com/chmenegatti/zeno/compare/v0.7.1...v1.0.0) (2026-11-20)

O Zeno foi reescrito em **Go** ([Wails](https://wails.io)): a janela usa o navegador do próprio sistema (WebKitGTK no Linux, WebView2 no Windows, WKWebView no macOS) no lugar do Electron. A interface é a mesma.

**Seus dados continuam iguais.** Mesma pasta (`~/.local/share/zeno`), mesmos YAML, mesmo cofre (a chave criada pelas versões em Electron abre na versão Go), histórico, cookies e estado. No Debian/Ubuntu, o `.deb` novo atualiza por cima do antigo.

### Novidades

* **Windows e macOS**: instalador e versão portátil pro Windows 10/11 (cofre com DPAPI) e `.dmg` universal pro macOS, Intel e Apple Silicon (cofre no Keychain); `.rpm` pro Fedora ([#109](https://github.com/chmenegatti/zeno/pull/109)) ([#110](https://github.com/chmenegatti/zeno/pull/110)) ([#111](https://github.com/chmenegatti/zeno/pull/111)) ([#112](https://github.com/chmenegatti/zeno/pull/112)) ([#113](https://github.com/chmenegatti/zeno/pull/113))
* **Mais leve**: pacote de 6 a 17 MB (era 97 MB), cerca de 220 MB de memória com o app parado (eram ~350 MB), abre e envia mais rápido; respostas grandes e histórico longo sem engasgar ([#108](https://github.com/chmenegatti/zeno/pull/108))
* **Tela de workspaces** (`Ctrl+Shift+O`): cartões ou lista, busca em todos os requests, grupos, cores, favoritos, arquivar, ordem arrastando, git e cofre de cada workspace, duplicar workspace ([#117](https://github.com/chmenegatti/zeno/pull/117))
* **`zeno-cli`**: a CLI (`zeno run`) também como binário único, sem interface, pra CI em Linux, Windows e macOS; exemplo de GitHub Actions em `docs/github-actions.md` ([#105](https://github.com/chmenegatti/zeno/pull/105))
* **Listas de seleção no tema** em todos os sistemas, com teclado e acessibilidade; caixas de seleção e campos numéricos no tema; no macOS, menu Editar e atalhos com ⌘ ([#106](https://github.com/chmenegatti/zeno/pull/106)) ([#107](https://github.com/chmenegatti/zeno/pull/107))
* **Collection de exemplo** da API do GitHub em `examples/insomnia/` pra experimentar ([#115](https://github.com/chmenegatti/zeno/pull/115))

### Correções

* importar do Insomnia avisava "template tag não suportada" pra qualquer `{% %}`; agora só pras tags que o Zeno não tem, dizendo quais ([#115](https://github.com/chmenegatti/zeno/pull/115))
* asserção de header e `{% response 'header' %}` sobre a resposta recém-enviada ([#104](https://github.com/chmenegatti/zeno/pull/104))

### Mudanças que quebram compatibilidade

* O app é o binário Go; o Electron saiu do projeto ([#118](https://github.com/chmenegatti/zeno/pull/118)).
* O AppImage usa o WebKitGTK 4.1 do sistema (`libwebkit2gtk-4.1-0` no Debian/Ubuntu, `webkit2gtk4.1` no Fedora); se faltar, ele diz como instalar.
* Plugins rodam num interpretador JavaScript próprio (goja): `require('string_decoder')`, `punycode` e `zlib` ainda não existem.
* Build a partir do código: Go 1.26+ e Node.js 22+ (`npm run dev`).

## [0.7.1](https://github.com/chmenegatti/zeno/compare/v0.7.0...v0.7.1) (2026-11-19)

### Novidades

* **ui:** gerar código com realce de sintaxe de cada linguagem (como numa IDE) e indentação de 2 espaços; Go mantém tab ([#50](https://github.com/chmenegatti/zeno/pull/50)) ([a396c25](https://github.com/chmenegatti/zeno/commit/a396c25))

### Correções

* **vars:** `{{ _['X-API-Key'] }}` (colchetes, sintaxe do Insomnia pra nomes com hífen) agora resolve ([#51](https://github.com/chmenegatti/zeno/pull/51)) ([183ecbe](https://github.com/chmenegatti/zeno/commit/183ecbe))
* **ui:** painel de resposta respeita a largura da janela; não espreme mais o painel do request ([#52](https://github.com/chmenegatti/zeno/pull/52)) ([8d17d18](https://github.com/chmenegatti/zeno/commit/8d17d18))

## [0.7.0](https://github.com/chmenegatti/zeno/compare/v0.6.0...v0.7.0) (2026-11-19)

### Novidades

* **github:** salvar coleções no GitHub: **Entrar com GitHub** pelo navegador (ou sessão do GitHub CLI, ou token, cifrado no cofre), enviar workspaces pra um repositório privado num commit só (só os YAML do Zeno) e baixar em outra máquina ([#48](https://github.com/chmenegatti/zeno/pull/48)) ([#49](https://github.com/chmenegatti/zeno/pull/49)) ([0860c30](https://github.com/chmenegatti/zeno/commit/0860c30)) ([215af20](https://github.com/chmenegatti/zeno/commit/215af20))
* **ui:** menu de método colorido (descrição, teclado, método personalizado) e gerar código em 20 linguagens e 37 bibliotecas com o httpsnippet, com variáveis e tags resolvidas ([#45](https://github.com/chmenegatti/zeno/pull/45)) ([28182a5](https://github.com/chmenegatti/zeno/commit/28182a5))
* **body:** botão **Formatar JSON** no rodapé do body, mantendo `{{ variáveis }}` e `{% tags %}` ([#46](https://github.com/chmenegatti/zeno/pull/46)) ([511bd74](https://github.com/chmenegatti/zeno/commit/511bd74))
* **site:** [site do Zeno](https://www.cesarmenegatti.com/zeno/) com tema claro/escuro, publicado no GitHub Pages; README revisto ([#47](https://github.com/chmenegatti/zeno/pull/47)) ([db68cfd](https://github.com/chmenegatti/zeno/commit/db68cfd))

## [0.6.0](https://github.com/chmenegatti/zeno/compare/v0.5.1...v0.6.0) (2026-11-19)

### Novidades

* **response:** filtro do body com JSONPath (JSON) ou XPath (XML/HTML), ao vivo e salvo por request; busca `Ctrl+F`; clicar numa chave do JSON copia o caminho ou uma tag `{% response %}` pronta ([#40](https://github.com/chmenegatti/zeno/pull/40)) ([4cb4c2a](https://github.com/chmenegatti/zeno/commit/4cb4c2a)), closes [#15](https://github.com/chmenegatti/zeno/issues/15)
* **response:** visualizadores de imagem, PDF, HTML (sem scripts), áudio e vídeo, com Visual/Texto; salvar em arquivo; respostas acima de 5 MB guardadas à parte, com prévia e carregar tudo sob demanda ([#41](https://github.com/chmenegatti/zeno/pull/41)) ([d7907b5](https://github.com/chmenegatti/zeno/commit/d7907b5)), closes [#16](https://github.com/chmenegatti/zeno/issues/16)
* **response:** linha do tempo com o request exatamente como saiu (headers brutos, `Authorization` mascarado), saltos de redirect, tempos de DNS/conexão/TLS/espera/download e certificado TLS; aba Comparar com diff entre respostas do histórico ([#42](https://github.com/chmenegatti/zeno/pull/42)) ([ba39268](https://github.com/chmenegatti/zeno/commit/ba39268)), closes [#17](https://github.com/chmenegatti/zeno/issues/17)
* **plugins:** plugins no formato do Insomnia (`templateTags`, `requestHooks`, `responseHooks`, `requestActions`) e importadores, em contexto isolado com `require` limitado; liga/desliga em Preferências; plugin com erro fica desativado com o motivo; [documentação](https://github.com/chmenegatti/zeno/blob/main/docs/plugins.md) e plugin de exemplo ([#43](https://github.com/chmenegatti/zeno/pull/43)) ([ed84297](https://github.com/chmenegatti/zeno/commit/ed84297)), closes [#19](https://github.com/chmenegatti/zeno/issues/19)
* **themes:** 20 temas embutidos: TOTVS, Aura Dark, Monokai, Synthwave '84, Dracula, One Dark, Nord, Tokyo Night, Catppuccin Mocha, Gruvbox Dark, Solarized Dark, Night Owl, GitHub Dark, Rosé Pine, Material Palenight e os claros GitHub Light, Solarized Light, Catppuccin Latte, One Light e Rosé Pine Dawn ([#44](https://github.com/chmenegatti/zeno/pull/44)) ([cad904a](https://github.com/chmenegatti/zeno/commit/cad904a))

## [0.5.1](https://github.com/chmenegatti/zeno/compare/v0.5.0...v0.5.1) (2026-11-18)

### Correções

* **linux:** ícone aparecia como engrenagem genérica no GNOME: o pacote só instalava o tamanho 1024 px, que o tema hicolor não usa. Agora instala de 16 a 512 px e liga a janela ao `zeno.desktop` no Wayland ([#39](https://github.com/chmenegatti/zeno/pull/39)) ([bb72747](https://github.com/chmenegatti/zeno/commit/bb72747))

## [0.5.0](https://github.com/chmenegatti/zeno/compare/v0.4.1...v0.5.0) (2026-11-18)

### Novidades

* **hotkeys:** atalhos padrão do Insomnia (zoom `Ctrl+=`/`-`/`0`, fonte dos editores, lateral `Ctrl+\`, foco na URL/resposta, ambientes `Ctrl+E`/`Ctrl+Shift+E`…), tela de atalhos editável e Preferências de zoom e fontes ([#33](https://github.com/chmenegatti/zeno/pull/33)) ([31c3640](https://github.com/chmenegatti/zeno/commit/31c3640)), refs [#32](https://github.com/chmenegatti/zeno/issues/32)
* **palette:** paleta de comandos (`Ctrl+P`) com busca difusa em requests de todos os workspaces e ações (trocar ambiente/workspace, importar, preferências) ([#34](https://github.com/chmenegatti/zeno/pull/34)) ([b850077](https://github.com/chmenegatti/zeno/commit/b850077)), closes [#3](https://github.com/chmenegatti/zeno/issues/3)
* **hotkeys:** formatar JSON no editor (`Ctrl+Shift+F`), fixar request (`Ctrl+Shift+P`), opções de envio com atraso e repetição (`Ctrl+Shift+Enter`), valor das variáveis nos badges (`Alt+Shift+U`) e importar atalhos do Insomnia ([#35](https://github.com/chmenegatti/zeno/pull/35)) ([146aeac](https://github.com/chmenegatti/zeno/commit/146aeac)), closes [#32](https://github.com/chmenegatti/zeno/issues/32)
* **cookies:** cookie jar por workspace: `Set-Cookie` guardado (inclusive em redirects) e enviado nos requests seguintes, tela de cookies (`Ctrl+K`) e opção por request de não enviar/guardar ([#36](https://github.com/chmenegatti/zeno/pull/36)) ([0d2cf2d](https://github.com/chmenegatti/zeno/commit/0d2cf2d)), closes [#10](https://github.com/chmenegatti/zeno/issues/10)
* **vars:** `{{ var }}` como badge também nos editores de body e ambientes; digitar `{{` ou `Ctrl+Espaço` sugere variáveis (com valor e origem) e tags ([#37](https://github.com/chmenegatti/zeno/pull/37)) ([d08152b](https://github.com/chmenegatti/zeno/commit/d08152b)), closes [#13](https://github.com/chmenegatti/zeno/issues/13)
* **tags:** funções `timestamp`, `faker`, `hash`, `base64`, `file`, `prompt` (pergunta ao enviar) e `jsonpath`, com editor visual por função; `{% response %}` aceita o request por nome ([#38](https://github.com/chmenegatti/zeno/pull/38)) ([681ea50](https://github.com/chmenegatti/zeno/commit/681ea50)), closes [#14](https://github.com/chmenegatti/zeno/issues/14)

### Mudanças

* `Ctrl+K` passa a abrir os cookies (padrão do Insomnia); a paleta fica em `Ctrl+P`.

## [0.4.1](https://github.com/chmenegatti/zeno/compare/v0.4.0...v0.4.1) (2026-11-18)

### Novidades

* **tags:** tags `{% response %}` como badge clicável também no JSON dos ambientes e nas variáveis da pasta; digitar `respon…`, `uuid` ou `now` sugere a tag, e o editor abre por cima do modal ([#31](https://github.com/chmenegatti/zeno/pull/31)) ([356a45c](https://github.com/chmenegatti/zeno/commit/356a45c))

## [0.4.0](https://github.com/chmenegatti/zeno/compare/v0.3.0...v0.4.0) (2026-11-18)

### Novidades

* **runner:** asserções sem código por request (status, header, JSONPath, body e tempo) ([#29](https://github.com/chmenegatti/zeno/issues/29)) ([becefc7](https://github.com/chmenegatti/zeno/commit/becefc7)), closes [#8](https://github.com/chmenegatti/zeno/issues/8)
* **runner:** executor de coleção: rodar pasta ou workspace com iterações, atraso, dados CSV/JSON, parar na 1ª falha e relatório JUnit XML ([#29](https://github.com/chmenegatti/zeno/issues/29)) ([becefc7](https://github.com/chmenegatti/zeno/commit/becefc7))
* **cli:** `zeno run <workspace> [pasta]` para CI, com `--env`, `--data`, `--var`, `--junit` e `--bail`; sai ≠ 0 quando algo falha ([#29](https://github.com/chmenegatti/zeno/issues/29)) ([becefc7](https://github.com/chmenegatti/zeno/commit/becefc7))
* **tags:** tags `{% response %}`, `{% uuid %}` e `{% now %}` como badge nos campos e no body, com editor igual ao do Insomnia e prévia do valor ([#30](https://github.com/chmenegatti/zeno/pull/30)) ([becefc7](https://github.com/chmenegatti/zeno/commit/becefc7))

## [0.3.0](https://github.com/chmenegatti/zeno/compare/v0.2.0...v0.3.0) (2026-11-18)

### Novidades

* **git:** workspace no repositório do projeto com painel Git: status por request, diff, commit, pull, push e branches ([#25](https://github.com/chmenegatti/zeno/issues/25)) ([355a9fc](https://github.com/chmenegatti/zeno/commit/355a9fc)), closes [#12](https://github.com/chmenegatti/zeno/issues/12)
* **curl:** colar curl na URL, copiar como cURL e gerar código em Go, JavaScript e Python ([#26](https://github.com/chmenegatti/zeno/issues/26)) ([687a688](https://github.com/chmenegatti/zeno/commit/687a688)), closes [#1](https://github.com/chmenegatti/zeno/issues/1)
* **import:** OpenAPI 3, Swagger 2 (arquivo ou URL), Postman v2.1 com ambientes e Insomnia v5 ([#27](https://github.com/chmenegatti/zeno/issues/27)) ([8e55d92](https://github.com/chmenegatti/zeno/commit/8e55d92)), closes [#2](https://github.com/chmenegatti/zeno/issues/2)
* **scripts:** scripts pré-request e pós-resposta com testes ([#28](https://github.com/chmenegatti/zeno/issues/28)) ([154a921](https://github.com/chmenegatti/zeno/commit/154a92187523ec10d8bfc1dfd0a8ae54c897aca9)), closes [#7](https://github.com/chmenegatti/zeno/issues/7)

## [0.2.0](https://github.com/chmenegatti/zeno/compare/v0.1.0...v0.2.0) (2026-11-18)

### Novidades

* **cofre:** segredos criptografados no YAML ([#11](https://github.com/chmenegatti/zeno/issues/11)) ([2844f9f](https://github.com/chmenegatti/zeno/commit/2844f9ff9526dc23874d1d5302880a24e95be151))
* ícone do aplicativo e entrada no menu do Linux ([a7a1f68](https://github.com/chmenegatti/zeno/commit/a7a1f68eba5b3675cba6f03cde5ce6998783dd86))

## 0.1.0 (2026-11-17)

### Novidades

* cliente de API desktop sem abas: lateral com coleções, request no meio, resposta à direita
* dados em YAML legíveis (um arquivo por request), recarregados ao editar fora do app
* import do Insomnia (diretório NeDB e export JSON v4) com prévia e avisos
* variáveis `{{ var }}` / `{{ _.var }}` com herança base → sub-ambiente → pasta
* tags `{% response %}`, `{% uuid %}` e `{% now %}`
* badges de variáveis clicáveis e editáveis; tema com a paleta TOTVS
