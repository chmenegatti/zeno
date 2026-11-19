# Contribuindo com o Zeno

Obrigado pelo interesse! Este guia explica como propor mudanças de um jeito que facilite a revisão.

## Antes de começar

- **Bugs:** abra uma [issue de bug](https://github.com/chmenegatti/zeno/issues/new?template=bug_report.yml) com passos para reproduzir.
- **Recursos novos:** procure nas [issues](https://github.com/chmenegatti/zeno/issues) se já existe uma. Se não existir, abra uma [sugestão](https://github.com/chmenegatti/zeno/issues/new?template=feature_request.yml) e espere um retorno antes de escrever muito código.
- **Já existe issue?** Comente que vai trabalhar nela, para ninguém duplicar esforço.
- **Falhas de segurança:** não abra issue pública; siga o [SECURITY.md](SECURITY.md).

## Ambiente de desenvolvimento

Requisitos: Node.js 22+ (veja `.nvmrc`), git e Linux, macOS ou Windows.

```bash
git clone https://github.com/<seu-usuario>/zeno.git
cd zeno
npm install
npm run dev
```

No Linux, se o Electron reclamar do `chrome-sandbox`, o `npm run dev` já passa `--noSandbox`. Para não misturar com seus dados reais, use outra pasta:

```bash
ZENO_DATA_DIR=/tmp/zeno-dev npm run dev
```

## Fluxo

1. Faça um fork e crie uma branch a partir da `main`: `feat/123-descricao-curta` ou `fix/123-descricao-curta`.
2. Escreva testes para o que mudou (`test/*.test.ts`). Lógica pura vai em `src/shared/` para ser testável sem Electron.
3. Rode tudo antes de abrir o PR:
   ```bash
   npm run typecheck
   npm test
   npm run build
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

- TypeScript estrito; evite `any`.
- Interface em português do Brasil: textos curtos e diretos.
- Cores sempre pelas variáveis do tema em `src/renderer/src/styles.css`, nunca valores soltos.
- Segredos nunca chegam decifrados ao renderer, exceto quando o usuário pede para mostrar.
- O formato YAML é contrato com o usuário: mudanças nele precisam continuar lendo arquivos antigos.

## Estrutura

```text
src/main/       processo principal: store YAML, HTTP, cofre, import, tags, IPC
src/preload/    contextBridge: API tipada exposta como window.zeno
src/renderer/   interface React (componentes em src/renderer/src/components)
src/shared/     tipos e lógica pura (templates, variáveis, varredura de segredos)
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

- **README.md**: recursos novos na tabela e nas seções, atalhos e capturas.
- **Site** (`site/`, publicado no GitHub Pages pelo workflow *Site*): textos das seções, capturas em `site/img/` (WebP, 1400×843, dados de exemplo, nunca dados reais). Os links de download e a versão do selo vêm da API de releases, então não precisam de edição.

## Código de conduta

Ao participar, você concorda com o [Código de Conduta](CODE_OF_CONDUCT.md).
