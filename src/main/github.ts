// Salvar coleções no GitHub: login (sessão do GitHub CLI, token colado ou device flow) e sincronização dos
// workspaces com um repositório privado pela API (sem precisar de git instalado). Um commit por envio;
// cada workspace vira uma pasta na raiz do repositório (o nome da pasta local).

import { execFile } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

export const DEFAULT_REPO = 'zeno-collections'
const API = 'https://api.github.com'

import type { GitHubAccount } from '../shared/types'
export type { GitHubAccount }

export interface RemoteWorkspace {
  dir: string
  id?: string
  name: string
  files: number
}

type Fetch = typeof fetch

/** chamadas à API do GitHub com o token; erro com a mensagem da API */
export class GitHubApi {
  constructor(
    private token: string,
    private f: Fetch = fetch
  ) {}

  async req<T>(method: string, url: string, body?: unknown, ok404 = false): Promise<T | null> {
    const res = await this.f(url.startsWith('http') ? url : `${API}${url}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'Zeno',
        ...(body ? { 'Content-Type': 'application/json' } : {})
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(30000)
    })
    if (res.status === 404 && ok404) return null
    if (res.status === 409 && ok404) return null // repositório vazio
    if (!res.ok) {
      let msg = `${res.status}`
      try {
        msg = `${res.status}: ${((await res.json()) as { message?: string }).message ?? ''}`
      } catch {
        /* sem corpo */
      }
      if (res.status === 401) throw new Error('token do GitHub inválido ou expirado: entre de novo')
      throw new Error(`GitHub ${method} ${url.replace(API, '')}: ${msg}`)
    }
    return res.status === 204 ? null : ((await res.json()) as T)
  }

  user(): Promise<{ login: string; name?: string; avatar_url?: string } | null> {
    return this.req('GET', '/user')
  }
}

/** arquivo que o Zeno gerencia: só YAML (workspace, pastas, requests, ambientes); o resto da pasta não é dele */
export const isManaged = (rel: string): boolean => /\.ya?ml$/i.test(rel) && !rel.split('/').some((p) => p.startsWith('.'))

/** arquivos de um workspace (caminhos relativos, só os YAML do Zeno; sem .git, README, package.json…) */
export function workspaceFiles(dir: string): { rel: string; text: string }[] {
  const out: { rel: string; text: string }[] = []
  const walk = (d: string): void => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (e.name.startsWith('.')) continue
      const p = path.join(d, e.name)
      if (e.isDirectory()) walk(p)
      else if (/\.ya?ml$/i.test(e.name)) out.push({ rel: path.relative(dir, p).split(path.sep).join('/'), text: fs.readFileSync(p, 'utf8') })
    }
  }
  walk(dir)
  return out.sort((a, b) => a.rel.localeCompare(b.rel))
}

interface TreeItem {
  path: string
  type: 'blob' | 'tree'
  sha: string
}

export class GitHubSync {
  constructor(
    private api: GitHubApi,
    readonly owner: string,
    readonly repo: string
  ) {}

  /** cria o repositório privado se não existir; devolve o branch padrão */
  async ensureRepo(): Promise<string> {
    const r = await this.api.req<{ default_branch: string }>('GET', `/repos/${this.owner}/${this.repo}`, undefined, true)
    if (r) return r.default_branch
    const c = await this.api.req<{ default_branch: string }>('POST', '/user/repos', {
      name: this.repo,
      private: true,
      auto_init: true,
      description: 'Coleções do Zeno (cliente de API)'
    })
    return c?.default_branch ?? 'main'
  }

  private async head(branch: string): Promise<{ commit: string; tree: TreeItem[] } | null> {
    const ref = await this.api.req<{ object: { sha: string } }>('GET', `/repos/${this.owner}/${this.repo}/git/ref/heads/${branch}`, undefined, true)
    if (!ref) return null
    const commit = ref.object.sha
    const t = await this.api.req<{ tree: TreeItem[] }>('GET', `/repos/${this.owner}/${this.repo}/git/trees/${commit}?recursive=1`)
    return { commit, tree: t?.tree ?? [] }
  }

  /** workspaces no repositório (pastas da raiz com workspace.yaml) */
  async list(): Promise<RemoteWorkspace[]> {
    const branch = await this.ensureRepo()
    const h = await this.head(branch)
    if (!h) return []
    const dirs = h.tree.filter((t) => t.type === 'blob' && /^[^/]+\/workspace\.yaml$/.test(t.path))
    const out: RemoteWorkspace[] = []
    for (const d of dirs) {
      const dir = d.path.split('/')[0]
      const blob = await this.api.req<{ content: string }>('GET', `/repos/${this.owner}/${this.repo}/git/blobs/${d.sha}`)
      const text = Buffer.from(blob?.content ?? '', 'base64').toString('utf8')
      out.push({
        dir,
        id: /^id:\s*(\S+)/m.exec(text)?.[1],
        name: (/^name:\s*(.+)$/m.exec(text)?.[1] ?? dir).replace(/^["']|["']$/g, ''),
        files: h.tree.filter((t) => t.type === 'blob' && t.path.startsWith(`${dir}/`)).length
      })
    }
    return out.sort((a, b) => a.name.localeCompare(b.name))
  }

  /** envia os workspaces (pasta local → pasta no repo) num commit só; apaga do repo o que sumiu localmente */
  async push(workspaces: { dir: string; name: string; localDir: string }[], message: string): Promise<{ commit: string; files: number; url: string } | null> {
    const branch = await this.ensureRepo()
    const h = await this.head(branch)
    const entries: { path: string; mode: '100644'; type: 'blob'; content?: string; sha?: null }[] = []
    let files = 0
    for (const w of workspaces) {
      const local = workspaceFiles(w.localDir)
      files += local.length
      const keep = new Set(local.map((f) => `${w.dir}/${f.rel}`))
      for (const f of local) entries.push({ path: `${w.dir}/${f.rel}`, mode: '100644', type: 'blob', content: f.text })
      // arquivos que só existem no repo saem (request apagado ou renomeado no app)
      // (só YAML do Zeno: .gitignore, imagens e afins no repo ficam como estão)
      for (const t of h?.tree ?? []) if (t.type === 'blob' && t.path.startsWith(`${w.dir}/`) && isManaged(t.path.slice(w.dir.length + 1)) && !keep.has(t.path)) entries.push({ path: t.path, mode: '100644', type: 'blob', sha: null })
    }
    const base = h ? (await this.api.req<{ tree: { sha: string } }>('GET', `/repos/${this.owner}/${this.repo}/git/commits/${h.commit}`))?.tree.sha : undefined
    const tree = await this.api.req<{ sha: string }>('POST', `/repos/${this.owner}/${this.repo}/git/trees`, { base_tree: base, tree: entries })
    // nada mudou: não cria commit vazio
    if (base && tree?.sha === base) return null
    const commit = await this.api.req<{ sha: string; html_url: string }>('POST', `/repos/${this.owner}/${this.repo}/git/commits`, { message, tree: tree!.sha, parents: h ? [h.commit] : [] })
    if (h) await this.api.req('PATCH', `/repos/${this.owner}/${this.repo}/git/refs/heads/${branch}`, { sha: commit!.sha })
    else await this.api.req('POST', `/repos/${this.owner}/${this.repo}/git/refs`, { ref: `refs/heads/${branch}`, sha: commit!.sha })
    return { commit: commit!.sha, files, url: commit!.html_url }
  }

  /** baixa um workspace do repo pra pasta dada (substitui os arquivos dele) */
  async pull(dir: string, target: string): Promise<number> {
    const branch = await this.ensureRepo()
    const h = await this.head(branch)
    const blobs = (h?.tree ?? []).filter((t) => t.type === 'blob' && t.path.startsWith(`${dir}/`) && isManaged(t.path.slice(dir.length + 1)))
    if (!blobs.length) throw new Error(`"${dir}" não está no repositório`)
    const files: { rel: string; data: Buffer }[] = []
    for (const b of blobs) {
      const rel = b.path.slice(dir.length + 1)
      if (rel.split('/').some((p) => p === '..' || p.startsWith('.'))) continue
      const blob = await this.api.req<{ content: string }>('GET', `/repos/${this.owner}/${this.repo}/git/blobs/${b.sha}`)
      files.push({ rel, data: Buffer.from(blob?.content ?? '', 'base64') })
    }
    // só troca depois de baixar tudo: falha no meio não deixa o workspace pela metade
    if (fs.existsSync(target)) for (const f of workspaceFiles(target)) fs.rmSync(path.join(target, f.rel))
    for (const f of files) {
      const p = path.join(target, f.rel)
      if (!p.startsWith(target + path.sep)) continue
      fs.mkdirSync(path.dirname(p), { recursive: true })
      fs.writeFileSync(p, f.data)
    }
    return files.length
  }
}

/** token da sessão do GitHub CLI (gh auth token), se houver */
export function ghCliToken(): Promise<string | null> {
  return new Promise((resolve) => {
    execFile('gh', ['auth', 'token'], { timeout: 10000 }, (err, stdout) => resolve(err ? null : stdout.trim() || null))
  })
}

// ---------- device flow (OAuth App do Zeno; ZENO_GITHUB_CLIENT_ID troca por outro) ----------

/** Client ID do OAuth App "zeno" (público: o device flow não usa segredo) */
export const ZENO_CLIENT_ID = 'Ov23liQibBJHrwEBxzCU'

export const deviceClientId = (): string | undefined => process.env.ZENO_GITHUB_CLIENT_ID || ZENO_CLIENT_ID

export async function deviceStart(clientId: string, f: Fetch = fetch): Promise<{ device_code: string; user_code: string; verification_uri: string; interval: number; expires_in: number }> {
  const res = await f('https://github.com/login/device/code', {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: clientId, scope: 'repo' })
  })
  if (!res.ok) throw new Error(`GitHub device flow: ${res.status}`)
  return (await res.json()) as never
}

/** espera o usuário autorizar no navegador; devolve o token */
export async function devicePoll(clientId: string, deviceCode: string, interval: number, expiresIn: number, f: Fetch = fetch, sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))): Promise<string> {
  const until = Date.now() + expiresIn * 1000
  let wait = Math.max(5, interval)
  while (Date.now() < until) {
    await sleep(wait * 1000)
    const res = await f('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_id: clientId, device_code: deviceCode, grant_type: 'urn:ietf:params:oauth:grant-type:device_code' })
    })
    const j = (await res.json()) as { access_token?: string; error?: string }
    if (j.access_token) return j.access_token
    if (j.error === 'slow_down') wait += 5
    else if (j.error && j.error !== 'authorization_pending') throw new Error(`GitHub: ${j.error}`)
  }
  throw new Error('o código expirou: comece de novo')
}
