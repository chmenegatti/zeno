# Changelog

Mudanças relevantes do Zeno, por versão. Gerado a partir dos commits ([Conventional Commits](https://www.conventionalcommits.org/pt-br/)) com `npm run release`.

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
