import { describe, expect, it } from 'vitest'
import { collapseSame, diffLines, sortedJson } from '../src/shared/diff'

describe('diffLines', () => {
  it('marca linhas trocadas, novas e removidas', () => {
    const a = '{\n  "id": 1,\n  "nome": "Ana",\n  "x": true\n}'
    const b = '{\n  "id": 2,\n  "nome": "Ana",\n  "novo": 1\n}'
    expect(diffLines(a, b).lines.filter((l) => l.t !== 'same')).toEqual([
      { t: 'del', text: '  "id": 1,' },
      { t: 'add', text: '  "id": 2,' },
      { t: 'del', text: '  "x": true' },
      { t: 'add', text: '  "novo": 1' }
    ])
  })
  it('iguais e cortados', () => {
    expect(diffLines('a\nb', 'a\nb').lines.every((l) => l.t === 'same')).toBe(true)
    const big = Array.from({ length: 5000 }, (_, i) => String(i)).join('\n')
    const r = diffLines(big, big.replace('\n1500\n', '\nx\n'))
    expect(r.cut).toBe(true)
    expect(r.lines.filter((l) => l.t !== 'same')).toHaveLength(2)
  })
})

describe('comparar respostas (#156)', () => {
  it('ordem das chaves não conta', () => {
    expect(sortedJson('{"b":1,"a":{"d":2,"c":[{"y":1,"x":2}]}}')).toBe(sortedJson('{"a":{"c":[{"x":2,"y":1}],"d":2},"b":1}'))
    expect(sortedJson('não é json')).toBeNull()
  })
  it('recolhe trechos iguais longos', () => {
    const a = Array.from({ length: 30 }, (_, i) => `l${i}`)
    const b = [...a]
    b[15] = 'mudou'
    const rows = collapseSame(diffLines(a.join('\n'), b.join('\n')).lines)
    const gaps = rows.filter((r) => r.t === 'gap')
    expect(gaps.map((g) => (g as { count: number }).count)).toEqual([12, 11])
    expect(rows.filter((r) => r.t === 'add' || r.t === 'del').length).toBe(2)
    expect(collapseSame(diffLines('a\nb', 'a\nc').lines).some((r) => r.t === 'gap')).toBe(false)
  })
})
