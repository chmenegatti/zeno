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
  it('texto do usuário igual ao marcador não é trocado', () => {
    expect(beautifyJson('{"a":"__ZENO_TAG_0__","b":{{ x }}}')).toBe('{\n  "a": "__ZENO_TAG_0__",\n  "b": {{ x }}\n}')
  })
  it('JSON inválido lança erro', () => {
    expect(() => beautifyJson('{a:1')).toThrow()
  })
})

import { insomniaDir } from '../src/main/import-insomnia'
describe('insomniaDir', () => {
  it('por sistema', () => {
    expect(insomniaDir('linux', { HOME: '/h' })).toBe('/h/.config/Insomnia')
    expect(insomniaDir('linux', { HOME: '/h', XDG_CONFIG_HOME: '/x' })).toBe('/x/Insomnia')
    expect(insomniaDir('darwin', { HOME: '/h' })).toBe('/h/Library/Application Support/Insomnia')
    expect(insomniaDir('win32', { APPDATA: '/ad' })).toBe('/ad/Insomnia')
  })
})
