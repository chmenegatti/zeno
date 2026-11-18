import { describe, expect, it } from 'vitest'
import { diffLines } from '../src/shared/diff'

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
