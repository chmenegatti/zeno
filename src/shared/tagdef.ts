// Tags {% %} no formato do Insomnia: ler e montar (usado no main e no renderer).
//   {% response 'body'|'header'|'url'|'raw', 'req_id', 'b64::<base64>::46b', 'never'|'no-history'|'when-expired'|'always', maxAgeSeg %}
//   {% uuid 'v4' %}   {% now %}

export type ResponseField = 'body' | 'raw' | 'header' | 'url'
export type Trigger = 'never' | 'no-history' | 'when-expired' | 'always'

export interface ResponseTag {
  name: 'response'
  field: ResponseField
  requestId: string
  /** JSONPath/XPath (body) ou nome do header; já decodificado */
  filter: string
  trigger: Trigger
  /** segundos (when-expired) */
  maxAge?: number
}

export type TagDef = ResponseTag | { name: 'uuid' } | { name: 'now' } | { name: 'other'; tag: string; raw: string }

export const TRIGGERS: { id: Trigger; label: string; hint: string }[] = [
  { id: 'never', label: 'Nunca', hint: 'usa a última resposta; nunca reenvia' },
  { id: 'no-history', label: 'Sem histórico', hint: 'reenvia só se ainda não houver resposta' },
  { id: 'when-expired', label: 'Quando expirar', hint: 'reenvia quando a última resposta passar da idade máxima' },
  { id: 'always', label: 'Sempre', hint: 'reenvia o request toda vez' }
]

export const FIELDS: { id: ResponseField; label: string }[] = [
  { id: 'body', label: 'Atributo do body' },
  { id: 'raw', label: 'Body inteiro' },
  { id: 'header', label: 'Header' },
  { id: 'url', label: 'URL do request' }
]

export function parseArgs(tag: string): { name: string; args: string[] } {
  const inner = tag.replace(/^\{%\s*/, '').replace(/\s*%\}$/, '')
  const name = inner.split(/\s+/, 1)[0]
  const rest = inner.slice(name.length)
  const args: string[] = []
  const re = /'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)"|([^,\s]+)/g
  for (const m of rest.matchAll(re)) args.push((m[1] ?? m[2] ?? m[3]).replace(/\\(['"\\])/g, '$1'))
  return { name, args }
}

const fromB64 = (s: string): string => {
  const bin = atob(s)
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)))
}
const toB64 = (s: string): string => {
  let bin = ''
  for (const b of new TextEncoder().encode(s)) bin += String.fromCharCode(b)
  return btoa(bin)
}

/** 'b64::JC5h…::46b' (Insomnia) ou texto puro */
export function decodeFilter(f: string | undefined): string {
  if (!f) return ''
  const m = /^b64::([A-Za-z0-9+/=]*)(?:::\w+)?$/.exec(f)
  if (!m) return f
  try {
    return fromB64(m[1])
  } catch {
    return f
  }
}

export function encodeFilter(f: string): string {
  return f ? `b64::${toB64(f)}::46b` : ''
}

export function parseTag(raw: string): TagDef {
  const { name, args } = parseArgs(raw)
  if (name === 'uuid') return { name: 'uuid' }
  if (name === 'now') return { name: 'now' }
  if (name === 'response') {
    const [field = 'body', requestId = '', filter, trigger = 'never', maxAge] = args
    return {
      name: 'response',
      field: (['body', 'raw', 'header', 'url'].includes(field) ? field : 'body') as ResponseField,
      requestId,
      filter: decodeFilter(filter),
      trigger: (['never', 'no-history', 'when-expired', 'always'].includes(trigger) ? trigger : 'never') as Trigger,
      maxAge: maxAge && /^\d+$/.test(maxAge) ? Number(maxAge) : undefined
    }
  }
  return { name: 'other', tag: name, raw }
}

const q = (s: string): string => `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`

export function buildTag(t: TagDef): string {
  switch (t.name) {
    case 'uuid':
      return "{% uuid 'v4' %}"
    case 'now':
      return '{% now %}'
    case 'other':
      return t.raw
    case 'response': {
      const args = [q(t.field), q(t.requestId), q(t.field === 'body' || t.field === 'header' ? encodeFilter(t.filter) : ''), q(t.trigger)]
      if (t.trigger === 'when-expired') args.push(String(t.maxAge ?? 60))
      return `{% response ${args.join(', ')} %}`
    }
  }
}
