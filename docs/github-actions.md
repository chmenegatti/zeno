# Rodar coleções no GitHub Actions

O `zeno run` roda uma pasta ou um workspace inteiro e sai com código `≠ 0` quando algum request ou teste falha, então o job do CI falha junto. Opções em [Linha de comando](../README.pt-BR.md#linha-de-comando-ci).

## Workspace no repositório

Deixe o workspace numa pasta do projeto (com o `workspace.yaml`), por exemplo `api/`. A CLI roda direto dela, sem pasta de dados do Zeno, e não altera os YAML: o que os scripts gravam (um token, por exemplo) vale só durante a execução.

Segredos cifrados do cofre (`$zeno$v1$…`) não abrem no CI, porque a chave fica no chaveiro da sua máquina. Passe esses valores com `--var`, a partir dos *secrets* do repositório, sempre por uma variável de ambiente do passo (`env:`) e entre aspas (`--var "token=$API_TOKEN"`): colocar `${{ secrets.… }}` direto no `run:` deixa o valor virar código do shell.

## Com o `zeno-cli`

Binário estático, sem interface nem WebKit. Instale com o Go (abaixo) ou baixe pronto da [release](https://github.com/chmenegatti/zeno/releases/latest) (`Zeno-*-linux-cli.tar.gz`).

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
      - run: go install github.com/chmenegatti/zeno/wails/cmd/zeno-cli@latest
      # sobe a API do projeto antes, se for testar local (docker compose up -d, npm start &…)
      - run: zeno-cli run ./api Smoke --env CI --var "token=$API_TOKEN" --junit zeno-junit.xml
        env:
          API_TOKEN: ${{ secrets.API_TOKEN }}
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
