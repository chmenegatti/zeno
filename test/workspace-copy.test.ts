import { describe, expect, it } from 'vitest'
import { cloneWorkspace } from '../src/shared/tree'
import type { RequestDoc, Workspace } from '../src/shared/types'

const req = (id: string, name: string, url: string): RequestDoc => ({ kind: 'request', id, name, method: 'GET', url, params: [], headers: [], body: { mime: null }, auth: { type: 'inherit' }, sortKey: 0 }) as RequestDoc

describe('duplicar workspace (cloneWorkspace)', () => {
  const ws: Workspace = {
    id: 'wrk_a1',
    name: 'Loja',
    settings: { insecureTLS: false, timeoutMs: 30000 },
    location: { dir: '/x/loja', linked: true },
    environments: [
      { id: 'env_b1', name: 'Base', parentId: null, data: { token: 'x' }, sortKey: 0 },
      { id: 'env_b2', name: 'Dev', parentId: 'env_b1', data: {}, sortKey: 1 }
    ],
    children: [
      {
        kind: 'folder', id: 'fld_c1', name: 'API', sortKey: 0, headers: [], auth: { type: 'inherit' }, vars: {},
        children: [req('req_d1', 'login', 'https://x/login'), req('req_d12', 'me', "https://x/{% response 'body', 'req_d1', '', 'never' %}")]
      }
    ]
  } as Workspace
  let n = 0
  const copy = cloneWorkspace(ws, 'Loja (cópia)', (p) => `${p}_novo${++n}`)

  it('ids novos em todos os níveis, sem local', () => {
    const s = JSON.stringify(copy)
    for (const old of ['wrk_a1', 'env_b1', 'env_b2', 'fld_c1', '"req_d1"', 'req_d12']) expect(s).not.toContain(old)
    expect(copy.name).toBe('Loja (cópia)')
    expect(copy.location).toBeUndefined()
  })
  it('referências trocadas (ambiente pai e tag), sem trocar id dentro de outro', () => {
    expect(copy.environments[1].parentId).toBe(copy.environments[0].id)
    const f = copy.children[0]
    const [login, me] = f.kind === 'folder' ? (f.children as RequestDoc[]) : []
    expect(me.url).toBe(`https://x/{% response 'body', '${login.id}', '', 'never' %}`)
    expect(me.id).not.toBe(login.id)
  })
})
