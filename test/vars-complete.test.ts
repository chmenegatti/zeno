import { describe, expect, it } from 'vitest'
import { matchVars, openVarAt } from '../src/shared/vars'

describe('autocomplete de variáveis', () => {
  it('acha o {{ aberto antes do cursor', () => {
    expect(openVarAt('Bearer {{')).toEqual({ start: 7, query: '' })
    expect(openVarAt('{{ base_u')).toEqual({ start: 0, query: 'base_u' })
    expect(openVarAt('{{ _.tok')).toEqual({ start: 0, query: '_.tok' })
    expect(openVarAt('{{ a }} x')).toBeNull()
    expect(openVarAt('{ a')).toBeNull()
  })
  it('ordena: começo do nome, depois contém', () => {
    const v = [{ name: 'user_token' }, { name: 'token' }, { name: 'base_url' }, { name: 'tokenRefresh' }]
    expect(matchVars(v, 'tok').map((x) => x.name)).toEqual(['token', 'tokenRefresh', 'user_token'])
    expect(matchVars(v, '_.tok').map((x) => x.name)[0]).toBe('token')
    expect(matchVars(v, '').map((x) => x.name)).toEqual(['base_url', 'token', 'tokenRefresh', 'user_token'])
  })
})
