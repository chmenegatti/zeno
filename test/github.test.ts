import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { devicePoll, GitHubApi, GitHubSync, workspaceFiles } from '../src/main/github'

/** GitHub de mentira: um repositório, commits como mapas caminho → conteúdo */
function fakeGitHub() {
  let repo: { branch: string } | null = null
  const trees = new Map<string, Map<string, string>>()
  const commits = new Map<string, { tree: string }>()
  const blobs = new Map<string, string>()
  let head: string | null = null
  let n = 0
  const id = (p: string): string => `${p}${++n}`
  const calls: string[] = []
  const json = (status: number, body?: unknown) => new Response(body === undefined ? null : JSON.stringify(body), { status })
  const f = (async (url: string, init: RequestInit = {}) => {
    const u = new URL(url)
    const m = init.method ?? 'GET'
    const body = init.body ? JSON.parse(String(init.body)) : undefined
    const p = u.pathname
    calls.push(`${m} ${p}`)
    if ((init.headers as Record<string, string>).Authorization !== 'Bearer tk') return json(401, { message: 'Bad credentials' })
    if (p === '/user') return json(200, { login: 'ana', name: 'Ana', avatar_url: 'x' })
    if (p === '/repos/ana/zeno-collections' && m === 'GET') return repo ? json(200, { default_branch: 'main' }) : json(404, { message: 'Not Found' })
    if (p === '/user/repos') {
      expect(body).toMatchObject({ name: 'zeno-collections', private: true })
      repo = { branch: 'main' }
      return json(201, { default_branch: 'main' })
    }
    const g = p.replace('/repos/ana/zeno-collections/git', '')
    if (g === '/ref/heads/main') return head ? json(200, { object: { sha: head } }) : json(404, {})
    if (g.startsWith('/trees/') && m === 'GET') {
      const t = trees.get(commits.get(g.slice(7))!.tree)!
      return json(200, { tree: [...t.keys()].map((path) => { const b = id('b'); blobs.set(b, t.get(path)!); return { path, type: 'blob', sha: b } }) })
    }
    if (g.startsWith('/commits/') && m === 'GET') return json(200, { tree: { sha: commits.get(g.slice(9))!.tree } })
    if (g === '/trees') {
      const t = new Map(body.base_tree ? trees.get(body.base_tree) : [])
      for (const e of body.tree) if (e.sha === null) t.delete(e.path); else t.set(e.path, e.content)
      // mesma árvore = mesmo sha (como no git)
      const key = JSON.stringify([...t.entries()].sort())
      const same = [...trees.entries()].find(([, v]) => JSON.stringify([...v.entries()].sort()) === key)
      if (same) return json(201, { sha: same[0] })
      const s = id('t')
      trees.set(s, t)
      return json(201, { sha: s })
    }
    if (g === '/commits') { const s = id('c'); commits.set(s, { tree: body.tree }); return json(201, { sha: s, html_url: `https://github.com/ana/zeno-collections/commit/${s}` }) }
    if (g === '/refs/heads/main' || g === '/refs') { head = body.sha; return json(200, {}) }
    if (g.startsWith('/blobs/')) return json(200, { content: Buffer.from(blobs.get(g.slice(7))!).toString('base64') })
    return json(500, { message: `rota não simulada: ${m} ${p}` })
  }) as typeof fetch
  return { f, calls, files: () => (head ? trees.get(commits.get(head)!.tree)! : new Map()) }
}

const ws = (): string => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zeno-gh-'))
  fs.mkdirSync(path.join(dir, 'loja', 'api'), { recursive: true })
  fs.writeFileSync(path.join(dir, 'loja', 'workspace.yaml'), 'id: wrk_loja\nname: Loja\n')
  fs.writeFileSync(path.join(dir, 'loja', 'api', 'listar.yaml'), 'id: req_1\nname: Listar\n')
  fs.writeFileSync(path.join(dir, 'loja', 'api', 'criar.yaml'), 'id: req_2\nname: Criar\n')
  fs.mkdirSync(path.join(dir, 'loja', '.git'))
  fs.writeFileSync(path.join(dir, 'loja', '.git', 'config'), 'nao vai')
  return path.join(dir, 'loja')
}

describe('GitHub: salvar coleções', () => {
  it('cria o repo privado, envia, apaga o removido, baixa e não faz commit vazio', async () => {
    const gh = fakeGitHub()
    const sync = new GitHubSync(new GitHubApi('tk', gh.f), 'ana', 'zeno-collections')
    const local = ws()
    expect(workspaceFiles(local).map((f) => f.rel)).toEqual(['api/criar.yaml', 'api/listar.yaml', 'workspace.yaml'])

    const r1 = await sync.push([{ dir: 'loja', name: 'Loja', localDir: local }], 'Zeno: Loja')
    expect(r1).toMatchObject({ files: 3 })
    expect([...gh.files().keys()].sort()).toEqual(['loja/api/criar.yaml', 'loja/api/listar.yaml', 'loja/workspace.yaml'])
    expect(await sync.list()).toEqual([{ dir: 'loja', id: 'wrk_loja', name: 'Loja', files: 3 }])

    // sem mudança: nada de commit novo
    expect(await sync.push([{ dir: 'loja', name: 'Loja', localDir: local }], 'de novo')).toBeNull()

    // request apagado no app some do repo
    fs.rmSync(path.join(local, 'api', 'criar.yaml'))
    fs.writeFileSync(path.join(local, 'api', 'listar.yaml'), 'id: req_1\nname: Listar todos\n')
    await sync.push([{ dir: 'loja', name: 'Loja', localDir: local }], 'Zeno: Loja')
    expect([...gh.files().keys()].sort()).toEqual(['loja/api/listar.yaml', 'loja/workspace.yaml'])

    // baixar em outra máquina
    const other = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'zeno-gh2-')), 'loja')
    expect(await sync.pull('loja', other)).toBe(2)
    expect(fs.readFileSync(path.join(other, 'api', 'listar.yaml'), 'utf8')).toContain('Listar todos')
    await expect(sync.pull('nao-existe', other)).rejects.toThrow('não está no repositório')
  })

  it('token inválido vira mensagem clara', async () => {
    const gh = fakeGitHub()
    await expect(new GitHubApi('errado', gh.f).user()).rejects.toThrow('token do GitHub inválido')
  })

  it('device flow espera a autorização e respeita slow_down', async () => {
    const answers = [{ error: 'authorization_pending' }, { error: 'slow_down' }, { access_token: 'tk-device' }]
    const waits: number[] = []
    const f = (async () => new Response(JSON.stringify(answers.shift()))) as unknown as typeof fetch
    expect(await devicePoll('cid', 'dc', 5, 900, f, async (ms) => void waits.push(ms))).toBe('tk-device')
    expect(waits).toEqual([5000, 5000, 10000])
  })
})
