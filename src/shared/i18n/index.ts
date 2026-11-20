// Idioma da interface (#132). O texto em português é a própria chave: t('Enviar') devolve 'Send' em
// inglês e 'Enviar' em português. Variáveis vão entre chaves: t('{n} requests', { n }).
// Os dicionários ficam em ./en/*.ts (um por área da interface); o teste test/i18n.test.ts falha se
// alguma chave usada com t('…') não tiver tradução.

import { EN } from './en'

export type Lang = 'en' | 'pt'

export const LANGS: { id: Lang; label: string }[] = [
  { id: 'en', label: 'English' },
  { id: 'pt', label: 'Português (Brasil)' }
]

let current: Lang = 'en'

export function setLang(l: Lang | undefined): void {
  current = l === 'pt' ? 'pt' : 'en'
}

export function getLang(): Lang {
  return current
}

export function t(pt: string, vars?: Record<string, string | number>): string {
  const s = current === 'en' ? (EN[pt] ?? pt) : pt
  return vars ? s.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m)) : s
}

/** locale pra datas e números (toLocaleString) */
export function locale(): string {
  return current === 'pt' ? 'pt-BR' : 'en-US'
}
