import { describe, expect, it } from 'vitest'
import { getTheme, THEMES, themeVars } from '../src/shared/themes'

const lum = (hex: string): number => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
const contrast = (a: string, b: string): number => {
  const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m)
  return (x + 0.05) / (y + 0.05)
}

describe('temas', () => {
  it('catálogo: 20 temas, ids únicos, 15 escuros e 5 claros, TOTVS primeiro', () => {
    expect(THEMES).toHaveLength(20)
    expect(new Set(THEMES.map((t) => t.id)).size).toBe(20)
    expect(THEMES.filter((t) => t.dark)).toHaveLength(15)
    expect(THEMES[0].id).toBe('totvs')
    expect(getTheme('nao-existe').id).toBe('totvs')
    for (const id of ['aura-dark', 'monokai', 'synthwave', 'dracula']) expect(getTheme(id).id).toBe(id)
  })
  it('cores válidas e legíveis (texto ≥ 7:1 no fundo, botão principal ≥ 3:1)', () => {
    for (const t of THEMES) {
      for (const v of [...Object.values(t.colors), ...Object.values(t.syntax)]) expect(v, `${t.id} ${v}`).toMatch(/^#[0-9a-f]{6}$/i)
      expect(contrast(t.colors.ink, t.colors.bg), `${t.id} texto`).toBeGreaterThanOrEqual(7)
      expect(contrast(t.colors.dim, t.colors.bg), `${t.id} texto secundário`).toBeGreaterThanOrEqual(4.5)
      expect(contrast(t.colors.accentInk, t.colors.accent), `${t.id} botão`).toBeGreaterThanOrEqual(3)
      expect(Object.keys(themeVars(t))).toContain('--syn-prop')
    }
  })
})
