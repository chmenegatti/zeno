# Rodar coleções no GitHub Actions

O `zeno run` roda uma pasta ou um workspace inteiro e sai com código `≠ 0` quando algum request ou teste falha, então o job do CI falha junto. Opções em [Linha de comando](../README.md#linha-de-comando-ci).

## Workspace no repositório

Deixe o workspace numa pasta do projeto (com o `workspace.yaml`), por exemplo `api/`. A CLI roda direto dela, sem pasta de dados do Zeno, e não altera os YAML: o que os scripts gravam (um token, por exemplo) vale só durante a execução.

Segredos cifrados do cofre (`$zeno$v1$…`) não abrem no CI, porque a chave fica no chaveiro da sua máquina. Passe esses valores com `--var`, a partir dos *secrets* do repositório.

## Com o binário em Go (`zeno-cli`)

Binário estático, sem interface nem WebKit: só precisa do Go pra compilar.

```yaml
name: API

on: [push, pull_request]

jobs:
  api:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - uses: actions/setup-go@v6
        with:
          go-version: stable
      - run: go install github.com/chmenegatti/zeno/wails/cmd/zeno-cli@main
      # sobe a API do projeto antes, se for testar local (docker compose up -d, npm start &…)
      - run: zeno-cli run ./api Smoke --env CI --var token=${{ secrets.API_TOKEN }} --junit zeno-junit.xml
      - uses: actions/upload-artifact@v4
        if: always()
        with:
          name: zeno-junit
          path: zeno-junit.xml
```

- `./api`: pasta com o `workspace.yaml`; `Smoke`: pasta dentro dele (nome, caminho como `Usuários/Admin` ou id). Sem pasta, roda o workspace todo.
- `--env CI`: sub-ambiente com as URLs do CI.
- `--data massa.csv`: uma iteração por linha do CSV/JSON, cada coluna vira variável.
- `--bail`: para no primeiro request que falhar.
- Cores: ligadas só em terminal; `NO_COLOR=1` desliga.

O relatório JUnit pode ir pra qualquer action que leia JUnit (ex.: `mikepenz/action-junit-report`) pra aparecer no resumo do job.

## Com o app Electron (Node)

Enquanto a versão em Go não sai num release, dá pra usar a CLI do app atual com Node:

```yaml
      - uses: actions/checkout@v7
      - uses: actions/checkout@v7
        with:
          repository: chmenegatti/zeno
          path: zeno
      - uses: actions/setup-node@v7
        with:
          node-version: 22
      - run: cd zeno && npm ci && npx electron-vite build
      - run: node zeno/out/main/cli.js run ./api Smoke --var token=${{ secrets.API_TOKEN }} --junit zeno-junit.xml
```

As opções e os códigos de saída são os mesmos.
