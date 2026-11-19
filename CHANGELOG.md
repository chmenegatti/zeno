# Changelog

Mudanças relevantes do Zeno, por versão. Gerado a partir dos commits ([Conventional Commits](https://www.conventionalcommits.org/pt-br/)) com `npm run release`.

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
