// CLI: `zeno run <workspace> [pasta] [opções]` — roda a coleção e sai com código ≠ 0 se algo falhar.
// Funciona no app instalado (usa o chaveiro pra decifrar segredos) e com `node out/main/cli.js` (sem cofre).

import { Cookies } from './cookies'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Engine } from './engine'
import { parseData, runCollection, stepOk, toJUnit } from './runner'
import { defaultDataDir, Store } from './store'
import { Vault, type KeyProtector } from './vault'
import { findNode } from '../shared/tree'
import type { Folder, RunStep, TreeNode, Workspace } from '../shared/types'

export const USAGE = `uso: zeno run <workspace> [pasta] [opções]

  <workspace>          nome ou id do workspace, ou caminho de uma pasta com workspace.yaml (ex.: no repositório)
  [pasta]              nome, caminho ("Usuários/Admin") ou id; sem pasta roda o workspace inteiro

opções:
  -e, --env <nome>       sub-ambiente (nome ou id)
  -n, --iterations <n>   repetições (padrão 1; com --data, uma por linha)
  -d, --delay <ms>       espera entre requests
      --data <arquivo>   CSV (com cabeçalho) ou JSON (lista de objetos); cada linha vira variáveis
      --var <nome=valor> variável extra (pode repetir); vale sobre ambiente e dados
      --junit <arquivo>  grava relatório JUnit XML
      --bail             para no primeiro request que falhar
      --data-dir <dir>   pasta de dados do Zeno (padrão: a do app)
  -h, --help             esta ajuda

sai com 0 se tudo passou, 1 se algum request/teste falhou, 2 em erro de uso.`

/** sem chaveiro: valores cifrados não abrem (use --var) */
export const noKeyring: KeyProtector = {
  available: async () => ({ ok: false, backend: 'nenhum', weak: true }),
  protect: async () => {
    throw new Error('sem chaveiro')
  },
  unprotect: async () => {
    throw new Error('sem chaveiro')
  }
}

class UsageError extends Error {}

interface Args {
  workspace: string
  folder?: string
  env?: string
  iterations: number
  delayMs: number
  data?: string
  vars: Record<string, string>
  junit?: string
  bail: boolean
  dataDir?: string
}

function parseArgs(argv: string[]): Args | 'help' {
  const pos: string[] = []
  const a: Args = { workspace: '', iterations: 1, delayMs: 0, vars: {}, bail: false }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    const [flag, inline] = arg.startsWith('--') && arg.includes('=') ? [arg.slice(0, arg.indexOf('=')), arg.slice(arg.indexOf('=') + 1)] : [arg, undefined]
    const val = (): string => {
      const v = inline ?? argv[++i]
      if (v === undefined) throw new UsageError(`${flag} precisa de um valor`)
      return v
    }
    const int = (): number => {
      const v = val()
      if (!/^\d+$/.test(v)) throw new UsageError(`${flag} espera um número, veio "${v}"`)
      return Number(v)
    }
    switch (flag) {
      case '-h':
      case '--help':
        return 'help'
      case '-e':
      case '--env':
        a.env = val()
        break
      case '-n':
      case '--iterations':
        a.iterations = Math.max(1, int())
        break
      case '-d':
      case '--delay':
        a.delayMs = int()
        break
      case '--data':
        a.data = val()
        break
      case '--var': {
        const v = val()
        const eq = v.indexOf('=')
        if (eq <= 0) throw new UsageError(`--var espera nome=valor, veio "${v}"`)
        a.vars[v.slice(0, eq)] = v.slice(eq + 1)
        break
      }
      case '--junit':
        a.junit = val()
        break
      case '--bail':
        a.bail = true
        break
      case '--data-dir':
        a.dataDir = val()
        break
      default:
        if (arg.startsWith('-') && arg !== '-') throw new UsageError(`opção desconhecida: ${arg}`)
        pos.push(arg)
    }
  }
  if (!pos.length) throw new UsageError('falta o workspace')
  if (pos.length > 2) throw new UsageError(`argumentos demais: ${pos.slice(2).join(' ')}`)
  ;[a.workspace, a.folder] = pos
  return a
}

const norm = (s: string): string => s.trim().toLowerCase()

function pickWorkspace(store: Store, key: string): Workspace {
  const list = store.list()
  const ws = list.find((w) => w.id === key) ?? list.find((w) => norm(w.name) === norm(key))
  if (ws) return ws
  const names = list.map((w) => `  ${w.name}`).join('\n')
  throw new UsageError(`workspace "${key}" não encontrado${names ? `. Disponíveis:\n${names}` : ''}`)
}

function pickFolder(ws: Workspace, key: string): Folder {
  const byId = findNode(ws, key)
  if (byId?.node.kind === 'folder') return byId.node
  const parts = key.split('/').map(norm).filter(Boolean)
  let nodes: TreeNode[] = ws.children
  let found: Folder | undefined
  for (const p of parts) {
    found = nodes.find((n): n is Folder => n.kind === 'folder' && norm(n.name) === p)
    if (!found) break
    nodes = found.children
  }
  if (found && parts.length) return found
  // nome solto em qualquer nível
  const all: Folder[] = []
  const walk = (ns: TreeNode[]): void => ns.forEach((n) => n.kind === 'folder' && (all.push(n), walk(n.children)))
  walk(ws.children)
  const matches = all.filter((f) => norm(f.name) === norm(key))
  if (matches.length === 1) return matches[0]
  if (matches.length > 1) throw new UsageError(`há ${matches.length} pastas "${key}"; use o caminho (ex.: "Pai/${key}") ou o id`)
  throw new UsageError(`pasta "${key}" não encontrada em ${ws.name}`)
}

interface Out {
  log: (s: string) => void
  err: (s: string) => void
}

const color = (on: boolean) => (code: number, s: string) => (on ? `\x1b[${code}m${s}\x1b[0m` : s)

export async function runCli(argv: string[], protector: KeyProtector, out: Out = { log: (s) => console.log(s), err: (s) => console.error(s) }, tty = !!process.stdout.isTTY): Promise<number> {
  const c = color(tty && !process.env.NO_COLOR)
  const [cmd, ...rest] = argv
  if (!cmd || cmd === '-h' || cmd === '--help' || cmd === 'help') {
    out.log(USAGE)
    return cmd ? 0 : 2
  }
  if (cmd !== 'run') {
    out.err(`comando desconhecido: ${cmd}\n\n${USAGE}`)
    return 2
  }
  let tmp: string | null = null
  try {
    const args = parseArgs(rest)
    if (args === 'help') {
      out.log(USAGE)
      return 0
    }
    // caminho de pasta com workspace.yaml: roda direto dela, sem mexer na pasta de dados do app
    const asDir = path.resolve(args.workspace)
    const isDir = fs.existsSync(path.join(asDir, 'workspace.yaml'))
    let store: Store
    let ws: Workspace
    if (isDir) {
      tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'zeno-run-'))
      store = new Store(tmp)
      store.load()
      const r = store.linkWorkspace(asDir)
      ws = store.list().find((w) => w.id === r.id)!
    } else {
      store = new Store(args.dataDir)
      store.load()
      ws = pickWorkspace(store, args.workspace)
    }
    const vault = new Vault(isDir ? (args.dataDir ?? defaultDataDir()) : store.dir, protector)
    const folder = args.folder ? pickFolder(ws, args.folder) : null

    let envId: string | null = null
    if (args.env) {
      const env = ws.environments.find((e) => e.parentId !== null && (e.id === args.env || norm(e.name) === norm(args.env!)))
      if (!env) {
        const names = ws.environments.filter((e) => e.parentId !== null).map((e) => e.name)
        throw new UsageError(`ambiente "${args.env}" não existe em ${ws.name}${names.length ? ` (há: ${names.join(', ')})` : ''}`)
      }
      envId = env.id
    }
    const data = args.data ? parseData(fs.readFileSync(args.data, 'utf8'), args.data) : undefined

    // variáveis gravadas por scripts valem só durante a execução: a CLI não altera os YAML
    const engine = new Engine(store, vault, {}, { persist: false, softSecrets: true, cookies: new Cookies(null) })
    const report = await runCollection(
      engine,
      store,
      { wsId: ws.id, folderId: folder?.id ?? null, envId, iterations: args.iterations, delayMs: args.delayMs, data, vars: args.vars, bail: args.bail },
      (s: RunStep, _i, total) => {
        const ok = stepOk(s)
        const where = s.path ? c(2, `${s.path} / `) : ''
        const it = total > 1 && s.iteration > 1 ? c(2, ` #${s.iteration}`) : ''
        const status = s.status ? (s.status < 400 ? c(32, String(s.status)) : c(31, String(s.status))) : c(31, '---')
        out.log(`${ok ? c(32, '✓') : c(31, '✗')} ${s.method.padEnd(6)} ${where}${s.name}${it}  ${status}  ${c(2, `${s.timeMs} ms`)}`)
        if (s.error) out.log(`    ${c(31, s.error)}`)
        for (const w of s.warnings ?? []) out.log(`    ${c(33, w)}`)
        if (s.missing) out.log(`    ${c(33, `variável sem valor: ${s.missing.join(', ')}`)}`)
        for (const t of s.tests) out.log(`    ${t.ok ? c(32, '✓') : c(31, '✗')} ${t.name}${t.ok || !t.error ? '' : c(2, ` — ${t.error}`)}`)
      }
    )
    const tests = report.steps.flatMap((s) => s.tests)
    const testsFailed = tests.filter((t) => !t.ok).length
    out.log(
      `\n${report.name}: ${report.steps.length} request(s), ${c(32, `${report.passed} ok`)}, ${report.failed ? c(31, `${report.failed} com falha`) : '0 com falha'}` +
        ` · ${tests.length} teste(s), ${testsFailed} falharam · ${report.totalMs} ms`
    )
    if (args.junit) {
      fs.writeFileSync(args.junit, toJUnit(report))
      out.log(`JUnit: ${args.junit}`)
    }
    if (!report.steps.length) out.err('nenhum request para rodar')
    return report.failed || !report.steps.length ? 1 : 0
  } catch (e) {
    if (e instanceof UsageError) {
      out.err(`erro: ${e.message}\n\n${USAGE.split('\n')[0]}`)
      return 2
    }
    out.err(`erro: ${(e as Error).message}`)
    return 1
  } finally {
    if (tmp) fs.rmSync(tmp, { recursive: true, force: true })
  }
}
