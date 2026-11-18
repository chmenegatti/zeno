import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import * as Git from '../src/main/git'
import { Store } from '../src/main/store'
import type { RequestDoc } from '../src/shared/types'

const tmp = (p: string): string => fs.mkdtempSync(path.join(os.tmpdir(), p))
const sh = (cwd: string, ...args: string[]): string => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })

beforeAll(() => {
  for (const [k, v] of Object.entries({ GIT_AUTHOR_NAME: 'Teste', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 'Teste', GIT_COMMITTER_EMAIL: 't@t' })) process.env[k] = v
})

/** pessoa com clone próprio do repo e Zeno abrindo o workspace de dentro dele */
function cloneOf(remote: string): string {
  const clone = path.join(tmp('zeno-clone-'), 'repo')
  sh(path.dirname(clone), '-c', 'advice.detachedHead=false', 'clone', '-q', remote, clone)
  return clone
}

function colleague(remote: string): { store: Store; wsDir: string } {
  const store = new Store(tmp('zeno-data-'))
  const wsDir = path.join(cloneOf(remote), 'api')
  store.linkWorkspace(wsDir)
  return { store, wsDir }
}

function editUrl(store: Store, name: string, url: string): void {
  const ws = store.load()[0]
  let req: RequestDoc | undefined
  for (const n of ws.children) if (n.kind === 'request' && n.name === name) req = n
  store.saveRequest({ ...req!, url })
}

describe('git do workspace', () => {
  it('dois colegas editam requests diferentes e fazem merge sem conflito', async () => {
    const remote = tmp('zeno-remote-')
    sh(remote, 'init', '-q', '--bare', '-b', 'main')

    // Ana cria o workspace dentro do repo e publica
    const anaClone = cloneOf(remote)
    const anaStore = new Store(tmp('zeno-data-'))
    const [ws] = anaStore.createWorkspace('API')
    anaStore.createRequest(ws.id, 'Listar')
    anaStore.createRequest(ws.id, 'Criar')
    anaStore.moveWorkspace(ws.id, path.join(anaClone, 'api'))
    const anaDir = anaStore.load()[0].location!.dir
    expect(anaDir).toBe(path.join(anaClone, 'api'))

    let st = await Git.status(anaDir)
    expect(st.repo).toBe(true)
    expect(st.files.map((f) => f.label)).toEqual(expect.arrayContaining(['Listar', 'Criar', 'workspace API', 'ambiente Base']))
    await Git.commit(anaDir, 'feat: workspace da API')
    await Git.push(anaDir)
    st = await Git.status(anaDir)
    expect(st.files).toEqual([])
    expect(st.upstream).toBe('origin/main')

    // Bruno clona e abre o mesmo workspace
    const bruno = colleague(remote)
    expect(bruno.store.load()[0].id).toBe(ws.id)

    // cada um edita um request diferente e commita
    editUrl(anaStore, 'Listar', 'https://api/itens')
    editUrl(bruno.store, 'Criar', 'https://api/itens/novo')
    const diff = await Git.diff(anaDir, 'listar.yaml')
    expect(diff).toContain('+url: https://api/itens')
    await Git.commit(anaDir, 'feat: url de listar')
    await Git.commit(bruno.wsDir, 'feat: url de criar')

    await Git.push(anaDir)
    await expect(Git.push(bruno.wsDir)).rejects.toThrow() // remoto andou
    await Git.pull(bruno.wsDir)
    await Git.push(bruno.wsDir)

    await Git.pull(anaDir)
    const urls = (s: Store) => Object.fromEntries(s.load()[0].children.map((n) => [n.name, (n as RequestDoc).url]))
    expect(urls(anaStore)).toEqual({ Listar: 'https://api/itens', Criar: 'https://api/itens/novo' })
    expect(urls(bruno.store)).toEqual(urls(anaStore))
    expect((await Git.status(anaDir)).conflict).toBe(false)
  })

  it('pasta fora de repositório e branches', async () => {
    const dir = tmp('zeno-norepo-')
    expect((await Git.status(dir)).repo).toBe(false)
    await Git.init(dir)
    fs.writeFileSync(path.join(dir, 'a.yaml'), 'name: A\n')
    const st = await Git.status(dir)
    expect(st.files).toEqual([{ path: 'a.yaml', status: 'A', label: 'A' }])
    expect(await Git.diff(dir, 'a.yaml')).toContain('+name: A')
    await Git.commit(dir, 'primeiro')
    await Git.switchBranch(dir, 'release/1.2', true)
    const s2 = await Git.status(dir)
    expect(s2.branch).toBe('release/1.2')
    expect(s2.branches).toContain('release/1.2')
    expect(s2.hasRemote).toBe(false)
  })
})
