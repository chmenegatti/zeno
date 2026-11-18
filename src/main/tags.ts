// Tags {% %} compatíveis com Insomnia:
//   {% response 'body'|'header'|'url', 'req_id', 'b64::<filtro>'|'<filtro>', 'never'|'no-history'|'when-expired'|'always', maxAgeSeg %}
//   {% uuid 'v4' %}   {% now %}
// Filtro de body: JSONPath simples ($.a.b[0]) ou caminho XML (a/b/c).

import { randomUUID } from 'node:crypto'
import type { TagValues } from '../shared/template'
import type { ResponseRecord } from '../shared/types'

export interface TagContext {
  /** última resposta guardada do request */
  latest(requestId: string): ResponseRecord | undefined
  /** envia o request (com as próprias dependências) e devolve a resposta */
  sendById(requestId: string): Promise<ResponseRecord>
}

export function parseArgs(tag: string): { name: string; args: string[] } {
  const inner = tag.replace(/^\{%\s*/, '').replace(/\s*%\}$/, '')
  const name = inner.split(/\s+/, 1)[0]
  const rest = inner.slice(name.length)
  const args: string[] = []
  const re = /'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)"|([^,\s]+)/g
  for (const m of rest.matchAll(re)) args.push(m[1] ?? m[2] ?? m[3])
  return { name, args }
}

function decodeFilter(f: string | undefined): string {
  if (!f) return ''
  return f.startsWith('b64::') ? Buffer.from(f.slice(5), 'base64').toString('utf8') : f
}

/** JSONPath mínimo: $.a.b[0].c, $['a'] */
function jsonPath(data: unknown, path: string): unknown {
  const parts = path
    .replace(/^\$\.?/, '')
    .replace(/\[['"]?([^\]'"]+)['"]?\]/g, '.$1')
    .split(/[./]/)
    .filter(Boolean)
  let cur = data
  for (const p of parts) {
    if (cur == null || typeof cur !== 'object') return undefined
    cur = (cur as Record<string, unknown>)[p]
  }
  return cur
}

/** caminho XML mínimo: a/b/c ou /a/b/c (primeira ocorrência de cada nível) */
function xmlPath(xml: string, path: string): string | undefined {
  let cur = xml
  for (const seg of path.split('/').filter(Boolean)) {
    const m = cur.match(new RegExp(`<${seg}(?:\\s[^>]*)?>([\\s\\S]*?)</${seg}>`))
    if (!m) return undefined
    cur = m[1]
  }
  return cur.trim()
}

export function extract(res: ResponseRecord, field: string, filterRaw: string | undefined): string {
  if (res.error) throw new Error(`request de origem falhou: ${res.error}`)
  if (field === 'url') return res.url
  const filter = decodeFilter(filterRaw)
  if (field === 'header') {
    const h = res.headers.find(([k]) => k.toLowerCase() === filter.toLowerCase())
    if (!h) throw new Error(`header "${filter}" não está na resposta`)
    return h[1]
  }
  if (!filter) return res.body
  let json: unknown
  try {
    json = JSON.parse(res.body)
  } catch {
    json = undefined
  }
  const v = json !== undefined ? jsonPath(json, filter) : xmlPath(res.body, filter)
  if (v === undefined) throw new Error(`filtro "${filter}" não achou nada na resposta`)
  return typeof v === 'string' ? v : JSON.stringify(v)
}

export async function resolveTags(tags: string[], ctx: TagContext): Promise<{ values: TagValues; errors: string[] }> {
  const values: TagValues = new Map()
  const errors: string[] = []
  for (const tag of new Set(tags)) {
    const { name, args } = parseArgs(tag)
    try {
      if (name === 'uuid') values.set(tag, randomUUID())
      else if (name === 'now') values.set(tag, new Date().toISOString())
      else if (name === 'response') {
        const [field, reqId, filter, trigger = 'never', maxAge] = args
        let res = ctx.latest(reqId)
        const stale = !res || (maxAge && Date.now() - res.at > Number(maxAge) * 1000)
        const mustSend = trigger === 'always' || (trigger === 'no-history' && !res) || (trigger === 'when-expired' && stale)
        if (mustSend) res = await ctx.sendById(reqId)
        if (!res) throw new Error(`request ${reqId} ainda não tem resposta (envie ele antes)`)
        values.set(tag, extract(res, field, filter))
      } else errors.push(`tag "${name}" não suportada`)
    } catch (e) {
      errors.push(`${tag.slice(0, 60)}…: ${(e as Error).message}`)
    }
  }
  return { values, errors }
}
