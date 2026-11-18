// Git do workspace pela linha de comando (`git` do sistema): usa a configuração, as chaves SSH
// e os credential helpers que a pessoa já tem. Toda operação fica restrita à pasta do workspace.

import { execFile } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import YAML from 'yaml'
import type { GitFile, GitStatus } from '../shared/types'

const env = (): NodeJS.ProcessEnv => ({
  ...process.env,
  // sem prompt interativo: sem terminal, o git ficaria esperando senha pra sempre
  GIT_TERMINAL_PROMPT: '0',
  GIT_SSH_COMMAND: process.env.GIT_SSH_COMMAND || 'ssh -o BatchMode=yes',
  LC_ALL: 'C'
})

export function git(cwd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) =>
    execFile('git', args, { cwd, env: env(), maxBuffer: 32 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) reject(new Error((stderr || stdout || err.message).trim().replace(/^(fatal|error): /, '')))
      else resolve(stdout)
    })
  )
}

const ok = (p: Promise<string>): Promise<string | null> => p.catch(() => null)

/** nome legível do arquivo: request, pasta ou ambiente */
function labelOf(dir: string, rel: string): string {
  const file = path.join(dir, rel)
  const base = path.basename(rel)
  try {
    const doc = YAML.parse(fs.readFileSync(file, 'utf8')) as { name?: string } | null
    const name = doc?.name
    if (name) {
      if (base === 'workspace.yaml') return `workspace ${name}`
      if (base === 'folder.yaml') return `pasta ${name}`
      if (rel.split(/[\\/]/)[0] === '_env') return `ambiente ${name}`
      return name
    }
  } catch {
    /* apagado ou não é YAML */
  }
  return rel
}

function code(xy: string): GitFile['status'] {
  if (xy.includes('U') || xy === 'AA' || xy === 'DD') return 'U'
  if (xy === '??' || xy.includes('A')) return 'A'
  if (xy.includes('D')) return 'D'
  if (xy.includes('R')) return 'R'
  return 'M'
}

export async function status(dir: string): Promise<GitStatus> {
  const empty: GitStatus = { repo: false, ahead: 0, behind: 0, branches: [], hasRemote: false, conflict: false, files: [] }
  const root = (await ok(git(dir, ['rev-parse', '--show-toplevel'])))?.trim()
  if (!root) return empty
  const raw = await git(dir, ['status', '--porcelain=v1', '-z', '-b', '-uall', '--', '.'])
  const parts = raw.split('\0')
  const head = parts.shift() ?? ''
  // "## main...origin/main [ahead 1, behind 2]" ou "## No commits yet on main"
  const m = /^## (?:No commits yet on |Initial commit on )?(.+?)(?:\.\.\.(\S+))?(?: \[(.*)\])?$/.exec(head)
  const files: GitFile[] = []
  for (let i = 0; i < parts.length; i++) {
    const rec = parts[i]
    if (!rec) continue
    const xy = rec.slice(0, 2)
    const repoRel = rec.slice(3)
    if (xy[0] === 'R' || xy[0] === 'C') i++ // próximo registro é o nome antigo
    const rel = path.relative(dir, path.join(root, repoRel))
    files.push({ path: rel, status: code(xy), label: labelOf(dir, rel) })
  }
  files.sort((a, b) => a.path.localeCompare(b.path))
  const branches = (await ok(git(dir, ['for-each-ref', '--format=%(refname:short)', 'refs/heads'])))?.split('\n').filter(Boolean) ?? []
  const remotes = (await ok(git(dir, ['remote'])))?.trim()
  const rebaseDir = (p: string) => ok(git(dir, ['rev-parse', '--git-path', p])).then((r) => !!r && fs.existsSync(path.resolve(dir, r.trim())))
  const conflict = (await rebaseDir('rebase-merge')) || (await rebaseDir('rebase-apply'))
  const track = m?.[3] ?? ''
  return {
    repo: true,
    root,
    branch: !m || m[1].startsWith('HEAD') ? undefined : m[1],
    upstream: m?.[2],
    ahead: Number(/ahead (\d+)/.exec(track)?.[1] ?? 0),
    behind: Number(/behind (\d+)/.exec(track)?.[1] ?? 0),
    branches,
    hasRemote: !!remotes,
    conflict,
    files
  }
}

/** diff de um arquivo contra o último commit (arquivo novo: tudo como adição) */
export async function diff(dir: string, rel: string): Promise<string> {
  const tracked = await ok(git(dir, ['ls-files', '--error-unmatch', '--', rel]))
  const hasHead = await ok(git(dir, ['rev-parse', '--verify', 'HEAD']))
  if (tracked && hasHead) return git(dir, ['diff', 'HEAD', '--', rel])
  const file = path.join(dir, rel)
  if (!fs.existsSync(file)) return ''
  const text = fs.readFileSync(file, 'utf8')
  return `+++ ${rel}\n` + text.replace(/\n$/, '').split('\n').map((l) => `+${l}`).join('\n')
}

/** commita só o que está na pasta do workspace (o resto do repo fica como está) */
export async function commit(dir: string, message: string): Promise<void> {
  if (!message.trim()) throw new Error('escreva a mensagem do commit')
  await git(dir, ['add', '-A', '--', '.'])
  await git(dir, ['commit', '-m', message.trim(), '--', '.'])
}

/** rebase evita commit de merge; --autostash leva junto o que ainda não foi commitado */
export async function pull(dir: string): Promise<void> {
  await git(dir, ['pull', '--rebase', '--autostash'])
}

export async function push(dir: string): Promise<void> {
  const upstream = await ok(git(dir, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}']))
  await git(dir, upstream ? ['push'] : ['push', '-u', 'origin', 'HEAD'])
}

export async function switchBranch(dir: string, branch: string, create: boolean): Promise<void> {
  const name = branch.trim()
  if (!name) throw new Error('informe o nome do branch')
  await git(dir, create ? ['switch', '-c', name] : ['switch', name])
}

export async function abortRebase(dir: string): Promise<void> {
  await git(dir, ['rebase', '--abort'])
}

export async function init(dir: string): Promise<void> {
  await git(dir, ['init'])
}
