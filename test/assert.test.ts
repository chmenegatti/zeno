// Asserções sem código e JSONPath (shared/assert), usados pela interface.
import { describe, expect, it } from 'vitest'
import { evaluate, queryJson } from '../src/shared/assert'
import type { Assertion, ResponseRecord } from '../src/shared/types'

const a = (source: Assertion['source'], op: Assertion['op'], value?: string, p?: string): Assertion => ({ enabled: true, source, op, value, path: p })

describe('JSONPath e asserções', () => {
  const doc = { a: { b: [{ id: 1 }, { id: 2, deep: { id: 3 } }] }, 'x y': true }
  it('caminhos', () => {
    expect(queryJson(doc, '$.a.b[0].id').values).toEqual([1])
    expect(queryJson(doc, '$.a.b[-1].id').values).toEqual([2])
    expect(queryJson(doc, '$.a.b[*].id')).toEqual({ values: [1, 2], many: true })
    expect(queryJson(doc, '$..id').values).toEqual([1, 2, 3])
    expect(queryJson(doc, "$['x y']").values).toEqual([true])
    expect(queryJson(doc, '$.nada').values).toEqual([])
    // só chaves próprias, nada herdado do protótipo
    expect(queryJson(doc, '$.constructor').values).toEqual([])
    expect(queryJson(doc, '$.a.toString').values).toEqual([])
  })

  const res: ResponseRecord = {
    id: 'r', requestId: 'q', at: 0, method: 'GET', url: 'u', status: 201, statusText: 'Created',
    headers: [['Content-Type', 'application/json; charset=utf-8']], body: '{"user":{"id":7,"tags":["a","b"]},"n":null}',
    bodyEncoding: 'utf8', size: 10, timing: { headersMs: 1, totalMs: 120 }
  }
  it('cada operador', () => {
    const r = evaluate(
      [
        a('status', 'eq', '201'),
        a('status', 'lt', '300'),
        a('header', 'contains', 'json', 'content-type'),
        a('header', 'notExists', undefined, 'x-nada'),
        a('json', 'eq', '7', '$.user.id'),
        a('json', 'eq', '["a","b"]', '$.user.tags'),
        a('json', 'contains', 'b', '$.user.tags'),
        a('json', 'eq', 'null', '$.n'),
        a('json', 'exists', undefined, '$.user'),
        a('body', 'matches', '"id":\\d+'),
        a('time', 'lt', '{{ limite }}'),
        a('status', 'eq', '200'),
        a('json', 'exists', undefined, '$.user.email'),
        { ...a('status', 'eq', '999'), enabled: false }
      ],
      res,
      (s) => s.replace('{{ limite }}', '500')
    )
    expect(r.map((t) => t.ok)).toEqual([true, true, true, true, true, true, true, true, true, true, true, false, false])
    expect(r[11]).toMatchObject({ name: 'status = 200', error: 'valor: 201' })
    expect(r[12]).toMatchObject({ name: '$.user.email existe', error: 'não encontrado' })
  })
  it('JSON inválido vira falha, não exceção', () => {
    const [t] = evaluate([a('json', 'exists', undefined, '$.a')], { ...res, body: '<html>' })
    expect(t).toMatchObject({ ok: false, error: 'resposta não é JSON' })
  })
})
