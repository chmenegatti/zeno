import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { EN } from '../src/shared/i18n/en'
import { setLang, t } from '../src/shared/i18n'

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f)
    if (statSync(p).isDirectory()) return f === 'i18n' ? [] : files(p)
    return /\.(ts|tsx)$/.test(f) ? [p] : []
  })
}

// literais passados pra t()/tk(): t('…'), t("…") e t(`…`) sem ${}
const CALL = /\bt[k]?\(\s*(?:'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)"|`((?:[^`\\$]|\\.)*)`)/g
const unescape = (s: string): string => s.replace(/\\(['"`\\])/g, '$1').replace(/\\n/g, '\n')

describe('i18n', () => {
  const keys = new Map<string, string>()
  for (const f of [...files('src/renderer/src'), ...files('src/shared')]) {
    const src = readFileSync(f, 'utf8')
    for (const m of src.matchAll(CALL)) keys.set(unescape(m[1] ?? m[2] ?? m[3]), f)
  }

  it('toda chave usada tem tradução em inglês', () => {
    const missing = [...keys].filter(([k]) => !(k in EN)).map(([k, f]) => `${f}: ${k}`)
    expect(missing).toEqual([])
  })

  it('tradução mantém as mesmas variáveis', () => {
    const vars = (s: string): string => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',')
    const bad = Object.entries(EN).filter(([pt, en]) => vars(pt) !== vars(en)).map(([pt]) => pt)
    expect(bad).toEqual([])
  })

  it('t() troca de idioma e preenche variáveis', () => {
    setLang('pt')
    expect(t('chave sem tradução {n}', { n: 2 })).toBe('chave sem tradução 2')
    setLang('en')
  })
})
