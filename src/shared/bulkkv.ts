// Edição em massa (#148): tabela nome/valor ↔ texto, uma linha por par. `nome: valor` ou `nome=valor`
// (vale o separador que vier primeiro); `//` no começo = linha desligada. Variáveis e tags ficam como estão.

import type { KV } from './types'

export function kvToText(rows: KV[]): string {
  return rows.map((r) => `${r.enabled ? '' : '//'}${r.name}: ${r.value}`).join('\n')
}

export function textToKv(text: string): KV[] {
  const out: KV[] = []
  for (const raw of text.split(/\r?\n/)) {
    let line = raw.trim()
    if (!line) continue
    const enabled = !line.startsWith('//')
    if (!enabled) line = line.slice(2).trim()
    // separador fora de {{ }} e {% %}: o primeiro ':' ou '='
    const masked = line.replace(/\{\{.*?\}\}|\{%.*?%\}/g, (m) => '\u0001'.repeat(m.length))
    const at = [masked.indexOf(':'), masked.indexOf('=')].filter((i) => i > 0)
    if (!at.length) {
      out.push({ name: line, value: '', enabled })
      continue
    }
    const i = Math.min(...at)
    out.push({ name: line.slice(0, i).trim(), value: line.slice(i + 1).trim(), enabled })
  }
  return out
}
