import { describe, expect, it } from 'vitest'
import { NavHistory, type NavEntry } from '../src/shared/navhistory'

const e = (id: string, ws = 'w'): NavEntry => ({ ws, id })
const all = () => true

describe('NavHistory', () => {
  it('volta e avança como um navegador', () => {
    const h = new NavHistory()
    for (const id of ['a', 'b', 'c']) h.visit(e(id))
    expect(h.go(-1, all)?.id).toBe('b')
    expect(h.go(-1, all)?.id).toBe('a')
    expect(h.go(-1, all)).toBeUndefined()
    expect(h.go(1, all)?.id).toBe('b')
    h.visit(e('d'))
    expect(h.go(1, all)).toBeUndefined()
    expect(h.go(-1, all)?.id).toBe('b')
  })
  it('pula apagados e repetidos; recentes sem repetir', () => {
    const h = new NavHistory()
    for (const id of ['a', 'b', 'a', 'c']) h.visit(e(id))
    expect(h.recent.map((x) => x.id)).toEqual(['c', 'a', 'b'])
    expect(h.go(-1, (x) => x.id !== 'a')?.id).toBe('b')
    h.visit(e('b'))
    expect(h.back.map((x) => x.id)).toEqual(["a"])
  })
  it('limite', () => {
    const h = new NavHistory(3)
    for (const id of ['a', 'b', 'c', 'd', 'e']) h.visit(e(id))
    expect(h.back.map((x) => x.id)).toEqual(['b', 'c', 'd'])
  })
})
