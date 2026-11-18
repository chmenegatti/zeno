import { describe, expect, it } from 'vitest'
import { beautifyJson } from '../src/shared/format'

describe('beautifyJson', () => {
  it('formata JSON comum', () => {
    expect(beautifyJson('{"a":1,"b":[1,2]}')).toBe('{\n  "a": 1,\n  "b": [\n    1,\n    2\n  ]\n}')
  })
  it('mantém tags fora e dentro de string', () => {
    const src = `{"id":{{ user_id }},"auth":"Bearer {{ token }}","t":{% response 'body', 'r', '', 'never' %},"s":"a\\"b"}`
    expect(beautifyJson(src)).toBe(`{\n  "id": {{ user_id }},\n  "auth": "Bearer {{ token }}",\n  "t": {% response 'body', 'r', '', 'never' %},\n  "s": "a\\"b"\n}`)
  })
  it('JSON inválido lança erro', () => {
    expect(() => beautifyJson('{a:1')).toThrow()
  })
})
