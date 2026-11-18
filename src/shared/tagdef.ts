// Tags {% %} no formato do Insomnia: ler e montar (usado no main e no renderer).
//   {% response 'body'|'header'|'url'|'raw', 'req_id', 'b64::<base64>::46b', 'never'|'no-history'|'when-expired'|'always', maxAgeSeg %}
//   {% uuid 'v4' %}   {% now %}   {% timestamp 'unix'|'millis'|'iso' %}   {% faker 'randomEmail' %}
//   {% hash 'sha256', 'hex', 'texto' %}   {% base64 'encode', 'normal', 'texto' %}   {% file '/caminho' %}
//   {% prompt 'Título', 'Rótulo', 'padrão', 'chave', false %}   {% jsonpath '{{ json }}', '$.a.b' %}
//   argumentos aceitam {{ variáveis }}; o request do {% response %} pode ser id ou nome ("Pasta / Nome")

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

export type FnName = 'timestamp' | 'faker' | 'hash' | 'base64' | 'file' | 'prompt' | 'jsonpath'
export interface FnTag {
  name: 'fn'
  tag: FnName
  args: string[]
}

export type TagDef = ResponseTag | { name: 'uuid' } | { name: 'now' } | FnTag | { name: 'other'; tag: string; raw: string }

export interface ArgSpec {
  label: string
  kind: 'select' | 'text' | 'textarea'
  options?: { id: string; label: string }[]
  def: string
  placeholder?: string
  hint?: string
}

const opts = (...ids: string[]): { id: string; label: string }[] => ids.map((id) => ({ id, label: id }))

/** funções com argumentos: editor visual, rótulo do badge e valores padrão */
export const FN_SPECS: Record<FnName, { label: string; args: ArgSpec[]; badge: (a: string[]) => string }> = {
  timestamp: {
    label: 'Timestamp',
    args: [{ label: 'Formato', kind: 'select', options: [{ id: 'millis', label: 'milissegundos (Date.now)' }, { id: 'unix', label: 'segundos (unix)' }, { id: 'iso', label: 'ISO 8601' }], def: 'millis' }],
    badge: (a) => `Timestamp ${a[0] || 'millis'}`
  },
  faker: {
    label: 'Dado falso (faker)',
    args: [{ label: 'Tipo', kind: 'select', options: [], def: 'randomEmail' }],
    badge: (a) => `Faker · ${(a[0] || '').replace(/^random/, '')}`
  },
  hash: {
    label: 'Hash',
    args: [
      { label: 'Algoritmo', kind: 'select', options: opts('md5', 'sha1', 'sha256', 'sha512'), def: 'sha256' },
      { label: 'Saída', kind: 'select', options: opts('hex', 'base64'), def: 'hex' },
      { label: 'Texto', kind: 'textarea', def: '', placeholder: 'texto ou {{ variavel }}' }
    ],
    badge: (a) => `Hash ${a[0] || 'sha256'} · ${short(a[2])}`
  },
  base64: {
    label: 'Base64',
    args: [
      { label: 'Ação', kind: 'select', options: [{ id: 'encode', label: 'codificar' }, { id: 'decode', label: 'decodificar' }], def: 'encode' },
      { label: 'Tipo', kind: 'select', options: [{ id: 'normal', label: 'normal' }, { id: 'url', label: 'URL-safe' }], def: 'normal' },
      { label: 'Texto', kind: 'textarea', def: '', placeholder: '{{ usuario }}:{{ senha }}' }
    ],
    badge: (a) => `Base64 ${a[0] === 'decode' ? 'decode' : 'encode'} · ${short(a[2])}`
  },
  file: {
    label: 'Conteúdo de arquivo',
    args: [{ label: 'Caminho', kind: 'text', def: '', placeholder: '/home/eu/chave.pem ou ~/dados.json' }],
    badge: (a) => `Arquivo · ${(a[0] || '?').split(/[\\/]/).pop()}`
  },
  prompt: {
    label: 'Perguntar ao enviar',
    args: [
      { label: 'Título', kind: 'text', def: 'Valor', placeholder: 'Código 2FA' },
      { label: 'Rótulo', kind: 'text', def: '', placeholder: 'Digite o código do app' },
      { label: 'Valor padrão', kind: 'text', def: '' },
      { label: 'Chave (lembra o valor entre tags com a mesma chave)', kind: 'text', def: '' },
      { label: 'Esconder o que é digitado', kind: 'select', options: [{ id: 'false', label: 'não' }, { id: 'true', label: 'sim (senha)' }], def: 'false' }
    ],
    badge: (a) => `Perguntar · ${a[0] || 'valor'}`
  },
  jsonpath: {
    label: 'JSONPath sobre texto',
    args: [
      { label: 'JSON', kind: 'textarea', def: '', placeholder: '{{ usuario_json }}' },
      { label: 'Filtro', kind: 'text', def: '$.', placeholder: '$.id' }
    ],
    badge: (a) => `JSONPath · ${a[1] || '$'}`
  }
}

const short = (s = ''): string => (s.length > 18 ? `${s.slice(0, 18)}…` : s || '…')

export const FN_NAMES = Object.keys(FN_SPECS) as FnName[]

/** argumentos completos (aceita as formas curtas: hash/base64 com 2 args) */
export function fnArgs(tag: FnName, args: string[]): string[] {
  if ((tag === 'hash' || tag === 'base64') && args.length === 2) args = [args[0], tag === 'hash' ? 'hex' : 'normal', args[1]]
  return FN_SPECS[tag].args.map((a, i) => args[i] ?? a.def)
}

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
  if ((FN_NAMES as string[]).includes(name)) return { name: 'fn', tag: name as FnName, args: fnArgs(name as FnName, args) }
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
    case 'fn': {
      const args = fnArgs(t.tag, t.args)
      // prompt: último argumento é booleano sem aspas, como no Insomnia
      const out = args.map((a, i) => (t.tag === 'prompt' && i === 4 ? (a === 'true' ? 'true' : 'false') : q(a)))
      return `{% ${t.tag} ${out.join(', ')} %}`
    }
    case 'response': {
      const args = [q(t.field), q(t.requestId), q(t.field === 'body' || t.field === 'header' ? encodeFilter(t.filter) : ''), q(t.trigger)]
      if (t.trigger === 'when-expired') args.push(String(t.maxAge ?? 60))
      return `{% response ${args.join(', ')} %}`
    }
  }
}

/** sugestões de tag no autocomplete (editores e campos); edit = abre o editor logo após inserir */
export const TAG_CHOICES: { label: string; detail: string; keys: string[]; raw: string; edit?: boolean }[] = [
  { label: 'Resposta ⇒ Atributo do body', detail: 'JSONPath', keys: ['response', 'resposta', 'body'], raw: "{% response 'body', '', '', 'never' %}", edit: true },
  { label: 'Resposta ⇒ Body inteiro', detail: 'raw', keys: ['response', 'resposta', 'raw'], raw: "{% response 'raw', '', '', 'never' %}", edit: true },
  { label: 'Resposta ⇒ Header', detail: 'header', keys: ['response', 'resposta', 'header'], raw: "{% response 'header', '', '', 'never' %}", edit: true },
  { label: 'Resposta ⇒ URL', detail: 'url', keys: ['response', 'resposta', 'url'], raw: "{% response 'url', '', '', 'never' %}", edit: true },
  { label: 'UUID', detail: 'v4', keys: ['uuid'], raw: "{% uuid 'v4' %}" },
  { label: 'Agora', detail: 'ISO', keys: ['now', 'agora'], raw: '{% now %}' },
  { label: 'Timestamp', detail: 'millis/unix/iso', keys: ['timestamp', 'unix'], raw: "{% timestamp 'millis' %}", edit: true },
  { label: 'Dado falso', detail: 'faker', keys: ['faker', 'fake', 'random', 'email'], raw: "{% faker 'randomEmail' %}", edit: true },
  { label: 'Hash', detail: 'md5/sha', keys: ['hash', 'sha', 'md5'], raw: "{% hash 'sha256', 'hex', '' %}", edit: true },
  { label: 'Base64', detail: 'encode/decode', keys: ['base64', 'b64'], raw: "{% base64 'encode', 'normal', '' %}", edit: true },
  { label: 'Arquivo', detail: 'conteúdo', keys: ['file', 'arquivo'], raw: "{% file '' %}", edit: true },
  { label: 'Perguntar ao enviar', detail: 'prompt', keys: ['prompt', 'perguntar'], raw: "{% prompt 'Valor', '', '', '', false %}", edit: true },
  { label: 'JSONPath', detail: 'sobre texto', keys: ['jsonpath'], raw: "{% jsonpath '', '$.' %}", edit: true }
]

/** request referenciado por id ou nome ("Login", "Auth / Login"); null = não achou ou ambíguo */
export function findRequestRef<T extends { kind: string; id: string; name: string; children?: T[] }>(roots: T[], ref: string): T | null {
  const all: { node: T; path: string }[] = []
  const walk = (nodes: T[], prefix: string): void => {
    for (const n of nodes) {
      const path = prefix ? `${prefix} / ${n.name}` : n.name
      if (n.kind === 'request') all.push({ node: n, path })
      if (n.children) walk(n.children, path)
    }
  }
  walk(roots, '')
  const byId = all.find((x) => x.node.id === ref)
  if (byId) return byId.node
  const norm = (s: string): string => s.trim().toLowerCase().replace(/\s*\/\s*/g, ' / ')
  const r = norm(ref)
  const hits = all.filter((x) => norm(x.path) === r || norm(x.path).endsWith(` / ${r}`) || norm(x.node.name) === r)
  // caminho exato vence; nome solto só se for único
  const exact = hits.filter((x) => norm(x.path) === r || norm(x.path).endsWith(` / ${r}`))
  if (exact.length === 1) return exact[0].node
  return hits.length === 1 ? hits[0].node : null
}

export { short as shortArg }
