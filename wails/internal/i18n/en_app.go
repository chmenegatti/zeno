package i18n

// pt → en (app)
func init() {
	add(map[string]string{
		"ainda não disponível na versão Go":      "not available yet in the Go version",
		"nenhum workspace escolhido":             "no workspace selected",
		"workspace inválido":                     "invalid workspace",
		"formato desconhecido: %s":               "unknown format: %s",
		"Exportar workspaces":                    "Export workspaces",
		"entre no GitHub primeiro":               "sign in to GitHub first",
		"não deu pra ler a conta com esse token": "couldn't read the account with this token",
		"GitHub CLI sem sessão: rode \"gh auth login\" no terminal ou cole um token": "GitHub CLI not signed in: run \"gh auth login\" in the terminal or paste a token",
		"login pelo navegador precisa de um OAuth App (ZENO_GITHUB_CLIENT_ID)":       "browser sign-in requires an OAuth App (ZENO_GITHUB_CLIENT_ID)",
		"comece o login de novo":                  "start the sign-in again",
		"nome de repositório inválido":            "invalid repository name",
		"pasta inválida":                          "invalid folder",
		"variáveis sem valor: %s":                 "variables without a value: %s",
		"workspace não encontrado":                "workspace not found",
		"item da lixeira inválido":                "invalid trash item",
		"item não está mais na lixeira":           "item is no longer in the trash",
		"o workspace desse item não existe mais":  "this item's workspace no longer exists",
		"%s (cópia)":                              "%s (copy)",
		"Pasta do workspace (com workspace.yaml)": "Workspace folder (with workspace.yaml)",
		"Mover workspace para… (ex.: uma pasta dentro do repositório do projeto)": "Move workspace to… (e.g. a folder inside the project repository)",
		"request não encontrado":                                   "request not found",
		"Importar (Insomnia, OpenAPI/Swagger, Postman)":            "Import (Insomnia, OpenAPI/Swagger, Postman)",
		"JSON ou YAML":                                             "JSON or YAML",
		"Todos":                                                    "All files",
		"origem de importação desconhecida":                        "unknown import source",
		"sem chaveiro":                                             "no keychain",
		"%s precisa de um valor":                                   "%s needs a value",
		"%s espera um número, veio %q":                             "%s expects a number, got %q",
		"--var espera nome=valor, veio %q":                         "--var expects name=value, got %q",
		"opção desconhecida: %s":                                   "unknown option: %s",
		"falta o workspace":                                        "missing workspace",
		"argumentos demais: %s":                                    "too many arguments: %s",
		"workspace %q não encontrado. Disponíveis:\n%s":            "workspace %q not found. Available:\n%s",
		"workspace %q não encontrado":                              "workspace %q not found",
		"há %d pastas %q; use o caminho (ex.: \"Pai/%s\") ou o id": "there are %d folders %q; use the path (e.g. \"Parent/%s\") or the id",
		"pasta %q não encontrada em %s":                            "folder %q not found in %s",
		"comando desconhecido: %s\n\n%s":                           "unknown command: %s\n\n%s",
		"erro: %s\n\n%s":                                           "error: %s\n\n%s",
		"erro: %s":                                                 "error: %s",
		"workspace não encontrado em %s":                           "workspace not found in %s",
		"ambiente %q não existe em %s (há: %s)":                    "environment %q doesn't exist in %s (available: %s)",
		"ambiente %q não existe em %s":                             "environment %q doesn't exist in %s",
		"variável sem valor: %s":                                   "variable without value: %s",
		"%d com falha":                                             "%d failed",
		"\n%s: %d request(s), %s, %s · %d teste(s), %d falharam · %s ms": "\n%s: %d request(s), %s, %s · %d test(s), %d failed · %s ms",
		"nenhum request para rodar":                                      "no requests to run",
		"token do GitHub inválido ou expirado: entre de novo":            "GitHub token invalid or expired: sign in again",
		"Coleções do Zeno (cliente de API)":                              "Zeno collections (API client)",
		"%q não está no repositório":                                     "%q is not in the repository",
		"o código expirou: comece de novo":                               "the code expired: start again",
		"escreva a mensagem do commit":                                   "write the commit message",
		"informe o nome do branch":                                       "enter the branch name",
		"algoritmo %q não suportado":                                     "algorithm %q not supported",
		"sem package.json":                                               "no package.json",
		"package.json inválido: %w":                                      "invalid package.json: %w",
		"\"main\" aponta pra fora da pasta do plugin":                    "\"main\" points outside the plugin folder",
		"carga":                             "load",
		"templateTag com nome inválido: %s": "templateTag with invalid name: %s",
		"Ação":                              "Action",
		"o plugin não exporta nada (templateTags, requestHooks, responseHooks, requestActions ou importers)": "the plugin exports nothing (templateTags, requestHooks, responseHooks, requestActions or importers)",
		"módulo %q ainda não está disponível pros plugins na versão Go":                                      "module %q is not available yet for plugins in the Go version",
		"require fora da pasta do plugin: %s":                                                                "require outside the plugin folder: %s",
		"módulo %q não é permitido em plugins (liberados: %s e arquivos do próprio plugin)":                  "module %q is not allowed in plugins (allowed: %s and the plugin's own files)",
		"plugin %s (%s): parado":                          "plugin %s (%s): stopped",
		"plugin %s (%s): passou de %s s":                  "plugin %s (%s): exceeded %s s",
		"tempo esgotado":                                  "timed out",
		"tag %q não suportada":                            "tag %q not supported",
		"ação de plugin não encontrada":                   "plugin action not found",
		"pasta não encontrada":                            "folder not found",
		"falhou":                                          "failed",
		"JSON inválido: %s":                               "invalid JSON: %s",
		"JSON de dados deve ser uma lista de objetos":     "data JSON must be a list of objects",
		"resposta com erro não vira exemplo":              "a response with an error can't become an example",
		"já tem uma execução em andamento":                "a run is already in progress",
		"Dados para as iterações (CSV ou JSON)":           "Data for iterations (CSV or JSON)",
		"CSV ou JSON":                                     "CSV or JSON",
		"relatório inválido":                              "invalid report",
		"Salvar relatório JUnit":                          "Save JUnit report",
		"request inválido":                                "invalid request",
		"URL de WebSocket inválida (ws:// ou wss://): %s": "invalid WebSocket URL (ws:// or wss://): %s",
		`uso: zeno run <workspace> [pasta] [opções]

  <workspace>          nome ou id do workspace, ou caminho de uma pasta com workspace.yaml (ex.: no repositório)
  [pasta]              nome, caminho ("Usuários/Admin") ou id; sem pasta roda o workspace inteiro

opções:
  -e, --env <nome>       sub-ambiente (nome ou id)
  -n, --iterations <n>   repetições (padrão 1; com --data, uma por linha)
  -d, --delay <ms>       espera entre requests
      --data <arquivo>   CSV (com cabeçalho) ou JSON (lista de objetos); cada linha vira variáveis
      --var <nome=valor> variável extra (pode repetir); vale sobre ambiente e dados
      --env-file <arq>   variáveis de um arquivo .env (NOME=valor por linha); --var vence
      --junit <arquivo>  grava relatório JUnit XML
      --bail             para no primeiro request que falhar
      --data-dir <dir>   pasta de dados do Zeno (padrão: a do app)
  -h, --help             esta ajuda

sai com 0 se tudo passou, 1 se algum request/teste falhou, 2 em erro de uso.`: `usage: zeno run <workspace> [folder] [options]

  <workspace>          workspace name or id, or path to a folder with workspace.yaml (e.g. in the repository)
  [folder]             name, path ("Users/Admin") or id; without a folder runs the whole workspace

options:
  -e, --env <name>       sub-environment (name or id)
  -n, --iterations <n>   repetitions (default 1; with --data, one per row)
  -d, --delay <ms>       wait between requests
      --data <file>      CSV (with header) or JSON (list of objects); each row becomes variables
      --var <name=value> extra variable (repeatable); overrides environment and data
      --env-file <file>  variables from a .env file (NAME=value per line); --var wins
      --junit <file>     write a JUnit XML report
      --bail             stop at the first failing request
      --data-dir <dir>   Zeno data folder (default: the app's)
  -h, --help             this help

exits with 0 if everything passed, 1 if any request/test failed, 2 on usage error.`,
	})
}
