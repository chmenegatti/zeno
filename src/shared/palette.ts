// Paleta de comandos: índice de requests de todos os workspaces e busca difusa.

import { walk } from './tree'
import type { Workspace } from './types'

export interface PaletteRequest {
  id: string
  wsId: string
  name: string
  method: string
  url: string
  /** "Workspace / Pasta / Sub" */
  path: string
}

export function indexRequests(workspaces: Workspace[]): PaletteRequest[] {
  const out: PaletteRequest[] = []
  for (const ws of workspaces)
    walk(ws.children, (n, anc) => {
      if (n.kind === 'request') out.push({ id: n.id, wsId: ws.id, name: n.name, method: n.method, url: n.url, path: [ws.name, ...anc.map((a) => a.name)].join(' / ') })
    })
  return out
}

/** minúsculas e sem acento */
export const norm = (s: string): string => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()

const SEP = /[\s/\-_.:{}?&=]/

/** pontua `q` (já normalizado) como subsequência de `text` (já normalizado); -1 = não casa */
export function fuzzy(q: string, text: string): number {
  if (!q) return 0
  let score = 0
  let from = 0
  let prev = -2
  let jumps = 0
  for (const ch of q) {
    const i = text.indexOf(ch, from)
    if (i < 0) return -1
    score += 1
    const wordStart = i === 0 || SEP.test(text[i - 1])
    if (i === prev + 1) score += 3
    else if (prev >= 0 && !wordStart) jumps++
    if (wordStart) score += 2
    prev = i
    from = i + 1
  }
  const sub = text.indexOf(q)
  // letras muito espalhadas não contam ("itens" ≠ "edItar ambiENteS")
  if (sub < 0 && jumps > Math.max(1, Math.floor(q.length / 3))) return -1
  if (sub >= 0) score += 8 + (sub === 0 || SEP.test(text[sub - 1]) ? 6 : 0)
  return score
}

/** cada palavra da busca tem que casar em algum campo; o nome vale o dobro */
export function scoreFields(query: string, fields: { text: string; weight: number }[]): number {
  const words = norm(query).split(/\s+/).filter(Boolean)
  let total = 0
  for (const w of words) {
    let best = -1
    for (const f of fields) {
      const s = fuzzy(w, f.text)
      if (s >= 0) best = Math.max(best, s * f.weight)
    }
    if (best < 0) return -1
    total += best
  }
  return total
}

export function searchRequests(list: PaletteRequest[], query: string, limit = 50): PaletteRequest[] {
  if (!query.trim()) return list.slice(0, limit)
  const scored: { r: PaletteRequest; s: number }[] = []
  for (const r of list) {
    const s = scoreFields(query, [
      { text: norm(r.name), weight: 2 },
      { text: norm(r.path), weight: 1 },
      { text: norm(`${r.method} ${r.url}`), weight: 1 }
    ])
    if (s >= 0) scored.push({ r, s })
  }
  return scored.sort((a, b) => b.s - a.s || a.r.name.localeCompare(b.r.name)).slice(0, limit).map((x) => x.r)
}
