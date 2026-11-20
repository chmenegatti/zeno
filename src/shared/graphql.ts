// Body GraphQL (#4): o texto guardado é o JSON que vai pro servidor (igual ao Insomnia):
// {"query": "...", "operationName": "...", "variables": {...}}. As variáveis ficam como texto cru
// pra aceitar {{ variáveis }} fora de aspas e JSON ainda incompleto enquanto se digita.

export interface GqlBody {
  query: string
  /** texto das variáveis (JSON, pode ter {{ }}) */
  variables: string
  operationName: string
}

const STR = String.raw`"(?:[^"\\]|\\.)*"`
const LOOSE = new RegExp(String.raw`^\s*\{\s*"query"\s*:\s*(${STR})\s*,\s*(?:"operationName"\s*:\s*(${STR}|null)\s*,\s*)?"variables"\s*:\s*([\s\S]*?)\s*\}\s*$`)

export function parseGql(text: string): GqlBody {
  if (!text.trim()) return { query: '', variables: '', operationName: '' }
  try {
    const o = JSON.parse(text) as unknown
    if (o && typeof o === 'object' && !Array.isArray(o) && typeof (o as { query?: unknown }).query === 'string') {
      const g = o as { query: string; variables?: unknown; operationName?: unknown }
      const v = g.variables
      return {
        query: g.query,
        variables: v === undefined || v === null ? '' : typeof v === 'string' ? v : JSON.stringify(v, null, 2),
        operationName: typeof g.operationName === 'string' ? g.operationName : ''
      }
    }
  } catch {
    const m = LOOSE.exec(text)
    if (m) return { query: JSON.parse(m[1]) as string, operationName: m[2] && m[2] !== 'null' ? (JSON.parse(m[2]) as string) : '', variables: m[3] }
  }
  // texto solto (export antigo, "GraphQL (texto)"): é a própria consulta
  return { query: text, variables: '', operationName: '' }
}

export function buildGql(g: GqlBody): string {
  const parts = [`  "query": ${JSON.stringify(g.query)}`]
  if (g.operationName.trim()) parts.push(`  "operationName": ${JSON.stringify(g.operationName.trim())}`)
  if (g.variables.trim()) parts.push(`  "variables": ${g.variables.trim()}`)
  return `{\n${parts.join(',\n')}\n}`
}

/** nomes das operações da consulta (pra escolher qual rodar quando há mais de uma) */
export function operationNames(query: string): string[] {
  const out: string[] = []
  const re = /(?:^|[\s}])(?:query|mutation|subscription)\s+([_A-Za-z][_0-9A-Za-z]*)/g
  const clean = query.replace(/#[^\n]*/g, '').replace(/"""[\s\S]*?"""|"(?:[^"\\\n]|\\.)*"/g, '""')
  for (let m = re.exec(clean); m; m = re.exec(clean)) out.push(m[1])
  return out
}
