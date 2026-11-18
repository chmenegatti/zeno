import { describe, expect, it } from 'vitest'
import { filterJson, formatPath, jsonPathAt } from '../src/shared/respfilter'

const body = JSON.stringify({ data: { users: [{ id: 1, 'nome completo': 'Ana' }, { id: 2, 'nome completo': 'Bia' }] }, ok: true }, null, 2)

describe('filtro da resposta', () => {
  it('JSONPath ao vivo', () => {
    expect(filterJson(body, '$.data.users[*].id')).toEqual({ value: '[\n  1,\n  2\n]', count: 2 })
    expect(filterJson(body, 'data.users[1].nome completo')).toEqual({ value: 'Bia', count: 1 })
    expect(filterJson(body, "$.data.users[1]['nome completo']")).toEqual({ value: 'Bia', count: 1 })
    expect(filterJson(body, '$..id')).toMatchObject({ count: 2 })
  })
  it('erros não quebram', () => {
    expect(filterJson(body, '$.nada')).toEqual({ error: 'nada encontrado' })
    expect(filterJson(body, '$.a[')).toMatchObject({ error: expect.stringContaining('inválido') })
    expect(filterJson('<xml/>', '$.a')).toEqual({ error: 'o body não é JSON válido' })
  })
  it('caminho na posição do cursor', () => {
    const at = (needle: string, off = 1) => jsonPathAt(body, body.indexOf(needle) + off)
    expect(at('"nome completo"')).toEqual({ path: ['data', 'users', 0, 'nome completo'], isKey: true })
    expect(at('"Bia"')).toEqual({ path: ['data', 'users', 1, 'nome completo'], isKey: false })
    expect(at('"id": 2', 6)).toEqual({ path: ['data', 'users', 1, 'id'], isKey: false })
    expect(at('"ok"')).toEqual({ path: ['ok'], isKey: true })
    expect(at('true', 2)).toEqual({ path: ['ok'], isKey: false })
    expect(formatPath(['data', 'users', 1, 'nome completo'])).toBe("$.data.users[1]['nome completo']")
    expect(jsonPathAt('{"a\\"b": 1}', 2)).toEqual({ path: ['a"b'], isKey: true })
    // nomes com ' ] e \ voltam pelo mesmo parser do filtro
    const odd = { "it's": { 'a]b': { 'c\\d': 7 } } }
    const p = formatPath(["it's", 'a]b', 'c\\d'])
    expect(filterJson(JSON.stringify(odd), p)).toEqual({ value: '7', count: 1 })
  })
})
