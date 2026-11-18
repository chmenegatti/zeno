import { describe, expect, it } from 'vitest'
import { fuzzy, indexRequests, norm, searchRequests, type PaletteRequest } from '../src/shared/palette'
import type { Workspace } from '../src/shared/types'

const req = (id: string, name: string, url = '', method = 'GET') => ({ kind: 'request', id, name, url, method, sortKey: 0 }) as never

describe('palette', () => {
  it('fuzzy: subsequência, contíguo vale mais, sem acento', () => {
    expect(fuzzy('xyz', 'login')).toBe(-1)
    expect(fuzzy('logn', 'login')).toBeGreaterThan(0)
    expect(fuzzy('cs', 'criar sessao')).toBeGreaterThan(0)
    expect(fuzzy('itens', 'editar ambientes')).toBe(-1)
    expect(fuzzy('logi', 'login')).toBeGreaterThan(fuzzy('logn', 'login'))
    expect(fuzzy(norm('sessão'), norm('Criar Sessão'))).toBeGreaterThan(0)
  })

  it('indexa todos os workspaces com caminho', () => {
    const ws = [
      { id: 'w1', name: 'Loja', children: [{ kind: 'folder', id: 'f1', name: 'Auth', sortKey: 0, children: [req('r1', 'Login', '{{ base }}/login', 'POST')] }] },
      { id: 'w2', name: 'ERP', children: [req('r2', 'Listar pedidos', '/pedidos')] }
    ] as unknown as Workspace[]
    const idx = indexRequests(ws)
    expect(idx.map((r) => [r.id, r.wsId, r.path])).toEqual([['r1', 'w1', 'Loja / Auth'], ['r2', 'w2', 'ERP']])
    expect(searchRequests(idx, 'pedi')[0].id).toBe('r2')
    expect(searchRequests(idx, 'loja auth')[0].id).toBe('r1')
    expect(searchRequests(idx, 'post login').map((r) => r.id)).toEqual(['r1'])
    expect(searchRequests(idx, 'nada disso')).toEqual([])
  })

  it('nome bate antes da url', () => {
    const list: PaletteRequest[] = [
      { id: 'a', wsId: 'w', name: 'Outro', method: 'GET', url: '/users', path: 'W' },
      { id: 'b', wsId: 'w', name: 'Users', method: 'GET', url: '/x', path: 'W' }
    ]
    expect(searchRequests(list, 'users')[0].id).toBe('b')
  })

  it('1.000+ requests sem travar', () => {
    const list: PaletteRequest[] = Array.from({ length: 5000 }, (_, i) => ({ id: `r${i}`, wsId: 'w', name: `Request número ${i}`, method: 'GET', url: `https://api.local/v1/recurso/${i}?q=a`, path: `Workspace ${i % 23} / Pasta ${i % 120}` }))
    const t = performance.now()
    for (const q of ['r', 're', 'req', 'req 42', 'pasta 7 recurso']) searchRequests(list, q)
    expect(performance.now() - t).toBeLessThan(500)
    expect(searchRequests(list, 'número 4242')[0].id).toBe('r4242')
  })
})
