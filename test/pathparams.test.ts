import { describe, expect, it } from 'vitest'
import { pathParamNames, replacePathParams } from '../src/shared/pathparams'

describe('pathParamNames', () => {
  it('acha :id e {id} só no path', () => {
    expect(pathParamNames('https://api.x.com:8443/users/:id/posts/{postId}?q=:nao#:nem')).toEqual(['id', 'postId'])
    expect(pathParamNames('{{ base_url }}/users/:id')).toEqual(['id'])
    expect(pathParamNames('localhost:3000/users/:userId')).toEqual(['userId'])
    expect(pathParamNames('/v{version}/items/:id/:id')).toEqual(['version', 'id'])
  })
  it('ignora variáveis, tags e dois-pontos fora de início de segmento', () => {
    expect(pathParamNames('{{ base }}/a/{{ id }}/b')).toEqual([])
    expect(pathParamNames("{{ base }}/{% uuid 'v4' %}/x")).toEqual([])
    expect(pathParamNames('https://x.com/time/10:30/:1abc')).toEqual([])
    expect(pathParamNames('')).toEqual([])
  })
})

describe('replacePathParams', () => {
  it('troca pelo valor e mantém o que não tem valor', () => {
    const v = (n: string) => ({ id: '42', postId: '{{ post }}' })[n]
    expect(replacePathParams('{{ base }}/users/:id/posts/{postId}/c/:outro?x=:id', v)).toBe('{{ base }}/users/42/posts/{{ post }}/c/:outro?x=:id')
  })
})

import { prepare } from '../src/shared/prepare'
import type { RequestDoc, Workspace } from '../src/shared/types'

describe('prepare com parâmetros de caminho', () => {
  const ws = {
    id: 'w', name: 'W', settings: { insecureTLS: false, timeoutMs: 0 }, children: [],
    environments: [{ kind: 'environment', id: 'e', name: 'Base', parentId: null, data: { base: 'https://api.x', uid: '7' }, sortKey: 0 }]
  } as unknown as Workspace
  const req = (url: string, pathParams?: RequestDoc['pathParams']) =>
    ({ kind: 'request', id: 'r', name: 'R', method: 'GET', url, params: [{ name: 'q', value: '1', enabled: true }], pathParams, headers: [], body: { mime: null }, auth: { type: 'none' }, sortKey: 0 }) as unknown as RequestDoc
  it('troca pelo valor resolvido e mantém o vazio', () => {
    expect(prepare(ws, req('{{ base }}/users/:id/posts/{post}', [{ name: 'id', value: '{{ uid }}' }]), [], null).input.url).toBe('https://api.x/users/7/posts/{post}?q=1')
  })
})
