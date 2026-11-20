# Contribuindo com o Zeno

Obrigado pelo interesse! Este guia explica como propor mudanças de um jeito que facilite a revisão.

## Antes de começar

- **Bugs:** abra uma [issue de bug](https://github.com/chmenegatti/zeno/issues/new?template=bug_report.yml) com passos para reproduzir.
- **Recursos novos:** procure nas [issues](https://github.com/chmenegatti/zeno/issues) se já existe uma. Se não existir, abra uma [sugestão](https://github.com/chmenegatti/zeno/issues/new?template=feature_request.yml) e espere um retorno antes de escrever muito código.
- **Já existe issue?** Comente que vai trabalhar nela, para ninguém duplicar esforço.
- **Falhas de segurança:** não abra issue pública; siga o [SECURITY.md](SECURITY.md).

## Ambiente de desenvolvimento

Requisitos: Go 1.26+, Node.js 22+ (veja `.nvmrc`), git e Linux, macOS ou Windows. No Linux, também `libgtk-3-dev` e `libwebkit2gtk-4.1-dev` (WebKitGTK); no Windows, o WebView2 (já vem no Windows 10/11).

```bash
git clone https://github.com/<seu-usuario>/zeno.git
cd zeno
npm install
npm run dev        # compila a interface (Vite) e o app (Go + Wails) e abre
```

Para não misturar com seus dados reais, use outra pasta:

```bash
ZENO_DATA_DIR=/tmp/zeno-dev npm run dev
```

## Fluxo

1. Faça um fork e crie uma branch a partir da `main`: `feat/123-descricao-curta` ou `fix/123-descricao-curta`.
2. Escreva testes para o que mudou: Go em `wails/internal/*/…_test.go`, interface em `test/*.test.ts` (lógica pura vai em `src/shared/`).
3. Rode tudo antes de abrir o PR:
   ```bash
   npm run typecheck && npm test
   cd wails && make test vet && make e2e   # e2e abre o app (no Linux sem tela: xvfb-run make e2e)
   ```
4. Abra o PR preenchendo o modelo, com prints ou GIF quando mexer na interface.

## Mensagens de commit

Usamos [Conventional Commits](https://www.conventionalcommits.org/pt-br/), porque o `CHANGELOG.md` é gerado a partir deles.

| Tipo | Quando usar | Entra no changelog |
|---|---|---|
| `feat` | recurso novo | sim, em *Novidades* |
| `fix` | correção de bug | sim, em *Correções* |
| `perf` | melhoria de desempenho | sim |
| `security` | correção de segurança | sim |
| `refactor`, `docs`, `test`, `build`, `ci`, `chore`, `style` | o resto | não |

Exemplos:

```text
feat(import): importa coleções do Postman v2.1
fix(cofre): avisa quando a chave é de outro computador
docs: explica tags de template no README
```

Use um escopo quando ajudar (`cofre`, `import`, `ui`, `http`, `tags`…). Referencie a issue no corpo (`Closes #12`). Mudança que quebra compatibilidade leva `!` (`feat!: …`) e uma linha `BREAKING CHANGE:` explicando a migração.

## Padrões de código

- Go com `gofmt`; TypeScript estrito, evite `any`.
- Interface em português do Brasil: textos curtos e diretos.
- Cores sempre pelas variáveis do tema em `src/renderer/src/styles.css`, nunca valores soltos.
- Segredos nunca chegam decifrados à interface, exceto quando o usuário pede para mostrar.
- Canal novo da interface: método em `src/shared/api.ts` e handler em `wails/handlers.go` (ou num `*ops.go`).
- O formato YAML é contrato com o usuário: mudanças nele precisam continuar lendo arquivos antigos.

## Estrutura

```text
wails/          app em Go + Wails: main.go, canais da interface (handlers.go, *ops.go)
wails/internal/ store YAML, HTTP, motor de envio, cofre, importadores, git, GitHub, executor, CLI, plugins
wails/e2e/      teste ponta a ponta no app (make e2e)
src/renderer/   interface React (componentes em src/renderer/src/components; bridge.ts = window.zeno)
src/shared/     tipos e lógica pura da interface (templates, variáveis, tags, cURL)
test/           Vitest; fixtures em test/fixtures
```

## Releases

Só mantenedores publicam versões:

```bash
npm run release:dry   # confere versão e changelog
npm run release       # atualiza CHANGELOG.md e package.json, cria commit e tag
git push --follow-tags origin main
```

O workflow de release gera `.deb` e AppImage e publica no GitHub com as notas do changelog.

Toda release também atualiza:

- **README.md** (inglês) e **README.pt-BR.md**: recursos novos na tabela e nas seções, atalhos e capturas, nas duas línguas.
- **Site** (`site/`, publicado no GitHub Pages pelo workflow *Site*; inglês em `site/index.html`, português em `site/pt/index.html`): textos das seções nas duas línguas, `softwareVersion` do JSON-LD, capturas em `site/img/` (WebP, 1400×843, dados de exemplo, nunca dados reais). Os links de download e a versão do selo vêm da API de releases, então não precisam de edição.

## Código de conduta

Ao participar, você concorda com o [Código de Conduta](CODE_OF_CONDUCT.md).
