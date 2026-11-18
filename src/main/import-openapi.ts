// OpenAPI 3.x e Swagger 2.0 -> workspace: uma pasta por tag, um request por operação,
// base_url no ambiente Base, parâmetros de path como {{ variável }} e body de exemplo.

import { createHash } from 'node:crypto'
import type { Auth, Body, BodyField, Environment, Folder, KV, RequestDoc, TreeNode, Workspace } from '../shared/types'
import type { ParseResult } from './import-insomnia'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any

/** id estável: reimportar o mesmo spec substitui o workspace em vez de duplicar */
export function stableId(prefix: string, ...parts: string[]): string {
  return `${prefix}_${createHash('sha1').update(parts.join('\0')).digest('hex').slice(0, 24)}`
}

export function isOpenApi(doc: Any): boolean {
  return !!doc && typeof doc === 'object' && (typeof doc.openapi === 'string' || String(doc.swagger) === '2.0')
}

const METHODS = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options'] as const

/** resolve $ref locais (#/components/..., #/definitions/...); refs externas ficam vazias */
function resolver(root: Any, warn: (m: string) => void): (node: Any) => Any {
  const seen = new Set<string>()
  const get = (ref: string): Any => {
    if (!ref.startsWith('#/')) {
      if (!seen.has(ref)) warn(`$ref externo não resolvido: ${ref}`)
      seen.add(ref)
      return {}
    }
    return ref
      .slice(2)
      .split('/')
      .map((p) => p.replace(/~1/g, '/').replace(/~0/g, '~'))
      .reduce((o, k) => (o == null ? undefined : o[k]), root)
  }
  return (node: Any) => {
    let n = node
    for (let i = 0; n && typeof n === 'object' && typeof n.$ref === 'string' && i < 20; i++) n = get(n.$ref) ?? {}
    return n
  }
}

/** valor de exemplo a partir do schema */
function sample(schema: Any, deref: (n: Any) => Any, depth = 0, stack: Set<Any> = new Set()): unknown {
  const s = deref(schema)
  if (!s || typeof s !== 'object' || depth > 8 || stack.has(s)) return null
  if (s.example !== undefined) return s.example
  if (Array.isArray(s.examples) && s.examples.length) return s.examples[0]
  if (s.default !== undefined) return s.default
  if (Array.isArray(s.enum) && s.enum.length) return s.enum[0]
  if (s.const !== undefined) return s.const
  const next = new Set(stack).add(s)
  if (Array.isArray(s.allOf)) {
    const parts = s.allOf.map((p: Any) => sample(p, deref, depth + 1, next))
    return parts.every((p: unknown) => p && typeof p === 'object' && !Array.isArray(p)) ? Object.assign({}, ...parts) : parts[0]
  }
  for (const k of ['oneOf', 'anyOf']) if (Array.isArray(s[k]) && s[k].length) return sample(s[k][0], deref, depth + 1, next)
  const type = Array.isArray(s.type) ? s.type.find((t: string) => t !== 'null') : s.type
  if (type === 'object' || (!type && s.properties)) {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(s.properties ?? {})) {
      const p = deref(v)
      if (p?.readOnly) continue
      out[k] = sample(p, deref, depth + 1, next)
    }
    return out
  }
  if (type === 'array') return [sample(s.items, deref, depth + 1, next)]
  if (type === 'integer' || type === 'number') return s.minimum ?? 0
  if (type === 'boolean') return true
  if (type === 'string') {
    const fmt: Record<string, string> = {
      'date-time': '2026-01-01T00:00:00Z',
      date: '2026-01-01',
      email: 'usuario@exemplo.com',
      uuid: '00000000-0000-4000-8000-000000000000',
      uri: 'https://exemplo.com',
      binary: '',
      byte: ''
    }
    return fmt[s.format] ?? 'string'
  }
  return null
}

const str = (v: unknown): string => (v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v))

/** URL do servidor: variáveis {x} trocadas pelo default; relativa resolvida contra a URL do spec */
function serverUrl(doc: Any, sourceUrl?: string): string {
  let url = ''
  if (doc.openapi) {
    const s = doc.servers?.[0]
    url = s?.url ?? '/'
    for (const [k, v] of Object.entries<Any>(s?.variables ?? {})) url = url.replaceAll(`{${k}}`, str(v?.default))
  } else {
    const scheme = doc.schemes?.[0] ?? 'https'
    url = doc.host ? `${scheme}://${doc.host}${doc.basePath ?? ''}` : (doc.basePath ?? '/')
  }
  if (!/^[a-z]+:\/\//i.test(url) && sourceUrl) {
    try {
      url = new URL(url, sourceUrl).toString()
    } catch {
      /* fica relativa */
    }
  }
  return url.replace(/\/+$/, '')
}

export function convertOpenApi(doc: Any, opts: { sourceUrl?: string } = {}): ParseResult {
  const warnings: string[] = []
  const warned = new Set<string>()
  const warn = (m: string): void => {
    if (!warned.has(m)) warnings.push(m)
    warned.add(m)
  }
  const deref = resolver(doc, warn)
  const v3 = !!doc.openapi
  const title = str(doc.info?.title) || 'API'
  const wsId = stableId('wrk', 'openapi', title)
  const baseData: Record<string, unknown> = { base_url: serverUrl(doc, opts.sourceUrl) }
  if (!v3 && !doc.host) warn(`${title}: spec sem host; ajuste base_url no ambiente Base`)
  if (v3 && !doc.servers?.length) warn(`${title}: spec sem servers; ajuste base_url no ambiente Base`)

  // ---------- segurança -> auth com variáveis ----------
  const schemes: Record<string, Any> = v3 ? (doc.components?.securitySchemes ?? {}) : (doc.securityDefinitions ?? {})
  const addVar = (name: string, value: unknown = ''): string => {
    if (!(name in baseData)) baseData[name] = value
    return `{{ ${name} }}`
  }
  const authFor = (security: Any[] | undefined): Auth => {
    if (!security) return { type: 'inherit' }
    if (!security.length) return { type: 'none' }
    for (const req of security) {
      for (const name of Object.keys(req ?? {})) {
        const s = deref(schemes[name])
        if (!s) continue
        if ((s.type === 'http' && /^bearer$/i.test(s.scheme)) || s.type === 'oauth2' || s.type === 'openIdConnect') {
          if (s.type !== 'http') warn(`${title}: segurança "${name}" (${s.type}) virou Bearer {{ token }}; obtenha o token à parte`)
          return { type: 'bearer', token: addVar('token') }
        }
        if ((s.type === 'http' && /^basic$/i.test(s.scheme)) || s.type === 'basic') return { type: 'basic', username: addVar('username'), password: addVar('password') }
        if (s.type === 'apiKey') {
          const v = addVar(name.replace(/\W+/g, '_').toLowerCase())
          if (s.in === 'query') return { type: 'apikey', key: s.name, value: v, addTo: 'query' }
          if (s.in === 'cookie') return { type: 'apikey', key: 'Cookie', value: `${s.name}=${v}`, addTo: 'header' }
          return { type: 'apikey', key: s.name, value: v, addTo: 'header' }
        }
        warn(`${title}: segurança "${name}" (${s.type}) não suportada`)
      }
    }
    return { type: 'none' }
  }

  // ---------- operações ----------
  const tagDesc = new Map<string, string>((doc.tags ?? []).map((t: Any) => [t.name, t.description]))
  const tagOrder: string[] = (doc.tags ?? []).map((t: Any) => t.name)
  const folders = new Map<string, Folder>()
  const root: TreeNode[] = []
  const rootAuth = authFor(doc.security)
  let order = 0

  for (const [path, itemRaw] of Object.entries<Any>(doc.paths ?? {})) {
    const item = deref(itemRaw)
    for (const m of METHODS) {
      const op = item?.[m]
      if (!op) continue
      const name = str(op.summary).trim().replace(/\.$/, '') || str(op.operationId) || `${m.toUpperCase()} ${path}`
      const where = `${title} / ${name}`
      const params: KV[] = []
      const headers: KV[] = []
      const all = [...(item.parameters ?? []), ...(op.parameters ?? [])].map(deref)
      // o da operação vale mais que o do path com mesmo nome/lugar
      const byKey = new Map<string, Any>()
      for (const p of all) byKey.set(`${p.in}:${p.name}`, p)
      let body: Body = { mime: null }
      const formFields: BodyField[] = []
      for (const p of byKey.values()) {
        let ex = p.example ?? p.schema?.example ?? p.default ?? p.schema?.default ?? (p.schema ? sample(p.schema, deref) : p.type ? sample(p, deref) : '')
        // lista em query/header: um valor só (o usuário repete o param se quiser mais)
        if (Array.isArray(ex) && p.in !== 'body') ex = ex[0]
        const value = str(ex)
        if (p.in === 'path') addVar(p.name, value === 'string' ? '' : value)
        else if (p.in === 'query') params.push({ name: p.name, value: value === 'string' ? '' : value, enabled: !!p.required })
        else if (p.in === 'header') headers.push({ name: p.name, value: value === 'string' ? '' : value, enabled: !!p.required })
        else if (p.in === 'cookie') warn(`${where}: parâmetro de cookie "${p.name}" ignorado`)
        else if (p.in === 'body') body = { mime: 'application/json', text: JSON.stringify(sample(p.schema, deref), null, 2) }
        else if (p.in === 'formData') formFields.push({ name: p.name, value: p.type === 'file' ? '' : value === 'string' ? '' : value, enabled: true, ...(p.type === 'file' ? { file: '' } : {}) })
      }
      if (formFields.length) {
        const consumes: string[] = op.consumes ?? doc.consumes ?? []
        body = { mime: consumes.includes('multipart/form-data') || formFields.some((f) => f.file !== undefined) ? 'multipart/form-data' : 'application/x-www-form-urlencoded', fields: formFields }
      }
      if (v3 && op.requestBody) body = requestBody(deref(op.requestBody), deref, where, warn)
      if (!v3 && body.mime === 'application/json') {
        const consumes: string[] = op.consumes ?? doc.consumes ?? []
        if (consumes.length && !consumes.some((c) => /json/.test(c))) body.mime = consumes[0]
      }

      const req: RequestDoc = {
        kind: 'request',
        id: stableId('req', wsId, m, path),
        name,
        description: str(op.description) || undefined,
        method: m.toUpperCase(),
        url: `{{ base_url }}${path.replace(/\{([^}]+)\}/g, '{{ $1 }}')}`,
        params,
        headers,
        body,
        auth: op.security ? authFor(op.security) : rootAuth.type === 'inherit' ? { type: 'inherit' } : rootAuth,
        sortKey: order++
      }
      if (op.deprecated) req.name += ' (obsoleto)'
      const tag: string | undefined = op.tags?.[0]
      if (!tag) {
        root.push(req)
        continue
      }
      let f = folders.get(tag)
      if (!f) {
        const idx = tagOrder.indexOf(tag)
        f = {
          kind: 'folder',
          id: stableId('fld', wsId, tag),
          name: tag,
          description: tagDesc.get(tag) || undefined,
          sortKey: idx >= 0 ? idx - 10000 : order,
          headers: [],
          auth: { type: 'inherit' },
          vars: {},
          children: []
        }
        folders.set(tag, f)
      }
      f.children.push(req)
    }
  }

  const base: Environment = { id: stableId('env', wsId, 'base'), name: 'Base', parentId: null, data: baseData, sortKey: 0 }
  // um sub-ambiente por servidor extra
  const extra: Environment[] = v3
    ? (doc.servers ?? []).slice(1).map((s: Any, i: number) => ({
        id: stableId('env', wsId, 'server', String(i)),
        name: str(s.description) || str(s.url),
        parentId: base.id,
        data: { base_url: serverUrl({ openapi: '3', servers: [s] }, opts.sourceUrl) },
        sortKey: i + 1
      }))
    : []

  const ws: Workspace = {
    id: wsId,
    name: title,
    description: [str(doc.info?.description), doc.info?.version ? `Versão ${doc.info.version}` : ''].filter(Boolean).join('\n\n') || undefined,
    settings: { insecureTLS: false, timeoutMs: 30000 },
    environments: [base, ...extra],
    children: [...folders.values(), ...root].sort((a, b) => a.sortKey - b.sortKey)
  }
  return { workspaces: [ws], warnings }
}

function requestBody(rb: Any, deref: (n: Any) => Any, where: string, warn: (m: string) => void): Body {
  const content: Record<string, Any> = rb?.content ?? {}
  const types = Object.keys(content)
  if (!types.length) return { mime: null }
  const pick = types.find((t) => /json/.test(t)) ?? types.find((t) => t === 'application/x-www-form-urlencoded' || t === 'multipart/form-data') ?? types[0]
  const media = content[pick] ?? {}
  const firstExample = media.example ?? (media.examples ? deref(Object.values<Any>(media.examples)[0])?.value : undefined)
  if (pick === 'application/x-www-form-urlencoded' || pick === 'multipart/form-data') {
    const schema = deref(media.schema) ?? {}
    const ex = (firstExample ?? sample(schema, deref) ?? {}) as Record<string, unknown>
    const fields: BodyField[] = Object.entries<Any>(schema.properties ?? {}).map(([k, v]) => {
      const p = deref(v)
      const isFile = p?.format === 'binary' || p?.type === 'file'
      const val = isFile ? '' : str(ex[k])
      return { name: k, value: val === 'string' ? '' : val, enabled: true, ...(isFile ? { file: '' } : {}) }
    })
    return { mime: pick, fields }
  }
  if (/json/.test(pick)) {
    const value = firstExample ?? sample(media.schema, deref)
    return { mime: 'application/json', text: typeof value === 'string' ? value : JSON.stringify(value ?? {}, null, 2) }
  }
  if (firstExample === undefined) warn(`${where}: body ${pick} sem exemplo (ficou vazio)`)
  return { mime: pick, text: firstExample === undefined ? '' : str(firstExample) }
}
