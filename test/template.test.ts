import { describe, expect, it } from 'vitest'
import { render, buildVars } from '../src/shared/template'
import type { Workspace } from '../src/shared/types'

describe('render', () => {
  it('resolve {{ x }}, {{ _.x }} e caminho aninhado', () => {
    const v = { host: 'h', o: { a: { b: 2 } } }
    expect(render('{{host}}/{{ _.host }}/{{ _.o.a.b }}', v).value).toBe('h/h/2')
  })
  it('resolve variável que referencia outra', () => {
    expect(render('{{ url }}', { url: '{{ host }}/api', host: 'h' }).value).toBe('h/api')
  })
  it('reporta faltantes e tags', () => {
    const r = render('{{ nope }} {% uuid %}', {})
    expect(r.value).toBe('{{ nope }} {% uuid %}')
    expect(r.missing).toEqual(['nope'])
    expect(r.unsupported).toEqual(['{% uuid %}'])
  })
  it('não entra em loop com referência circular', () => {
    expect(render('{{ a }}', { a: '{{ a }}' }).value).toContain('{{ a }}')
  })
})

describe('buildVars', () => {
  const ws: Workspace = {
    id: 'w', name: 'w', settings: { insecureTLS: false, timeoutMs: 0 }, children: [],
    environments: [
      { id: 'b', name: 'Base', parentId: null, data: { a: 1, o: { x: 1, y: 1 } }, sortKey: 0 },
      { id: 'd', name: 'Dev', parentId: 'b', data: { a: 2, o: { y: 2 } }, sortKey: 0 }
    ]
  }
  it('base -> sub -> pasta, com merge profundo', () => {
    const folder = { kind: 'folder' as const, id: 'f', name: 'f', sortKey: 0, headers: [], auth: { type: 'inherit' as const }, vars: { a: 3 }, children: [] }
    expect(buildVars(ws, 'd', [])).toEqual({ a: 2, o: { x: 1, y: 2 } })
    expect(buildVars(ws, null, [folder]).a).toBe(3)
  })
})

describe('tags', () => {
  it('render substitui tag resolvida', () => {
    const tag = "{% uuid 'v4' %}"
    expect(render(`id=${tag}`, {}, new Map([[tag, 'X']])).value).toBe('id=X')
  })
})

import { requestVarRefs, tokenize, varSources } from '../src/shared/vars'

describe('vars', () => {
  it('tokenize separa texto, variável e tag', () => {
    expect(tokenize("{{ _.base }}/x/{{id}}?t={% uuid 'v4' %}")).toEqual([
      { t: 'var', name: 'base', raw: '{{ _.base }}' },
      { t: 'text', v: '/x/' },
      { t: 'var', name: 'id', raw: '{{id}}' },
      { t: 'text', v: '?t=' },
      { t: 'tag', name: 'uuid', raw: "{% uuid 'v4' %}" }
    ])
  })
  it('varSources aponta a origem mais específica', () => {
    const ws: Workspace = {
      id: 'w', name: 'w', settings: { insecureTLS: false, timeoutMs: 0 }, children: [],
      environments: [
        { id: 'b', name: 'Base', parentId: null, data: { a: 1, b: 1 }, sortKey: 0 },
        { id: 'd', name: 'Dev', parentId: 'b', data: { a: 2 }, sortKey: 0 }
      ]
    }
    const m = varSources(ws, 'd')
    expect(m.get('a')?.source).toEqual({ kind: 'env', envId: 'd', label: 'Dev' })
    expect(m.get('a')?.shadowed.map((s) => s.label)).toEqual(['Base'])
    expect(m.get('b')?.source.label).toBe('Base')
  })
  it('requestVarRefs junta url, headers, body e auth', () => {
    const refs = requestVarRefs({
      kind: 'request', id: 'r', name: 'r', method: 'GET', url: '{{ host }}/{{ _.id }}', sortKey: 0,
      params: [], headers: [{ name: 'X', value: '{{ host }}{{ k }}', enabled: true }],
      body: { mime: 'application/json', text: '{"a":"{{ b }}"}' }, auth: { type: 'bearer', token: '{{ tok }}' }
    })
    expect(refs).toEqual(['host', 'id', 'k', 'b', 'tok'])
  })
})
