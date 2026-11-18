// Postman Collection v2.0/v2.1 (+ arquivos de ambiente do Postman) -> workspace.
// Pastas viram pastas, {{variáveis}} ficam como estão (mesma sintaxe), variáveis da coleção vão pro Base
// e cada arquivo de ambiente vira um sub-ambiente.

import type { Auth, Body, BodyField, Environment, Folder, KV, RequestDoc, TreeNode, Workspace } from '../shared/types'
import type { ParseResult } from './import-insomnia'
import { stableId } from './import-openapi'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any

export function isPostmanCollection(doc: Any): boolean {
  return !!doc?.info && /schema\.getpostman\.com\/json\/collection\/v2/.test(String(doc.info.schema ?? '')) && Array.isArray(doc.item)
}

export function isPostmanEnvironment(doc: Any): boolean {
  return !!doc && Array.isArray(doc.values) && (doc._postman_variable_scope === 'environment' || (typeof doc.name === 'string' && !doc.info))
}

/** eventos prerequest/test do Postman -> scripts (a API pm.* é aceita pelo Zeno) */
function scriptsOf(events: Any): { pre?: string; post?: string } | undefined {
  const code = (listen: string): string | undefined => {
    const lines = (events ?? []).filter((e: Any) => e?.listen === listen).flatMap((e: Any) => (Array.isArray(e.script?.exec) ? e.script.exec : [String(e.script?.exec ?? '')]))
    const text = lines.join('\n')
    return text.trim() ? text : undefined
  }
  const pre = code('prerequest')
  const post = code('test')
  return pre || post ? { ...(pre ? { pre } : {}), ...(post ? { post } : {}) } : undefined
}

const str = (v: unknown): string => (v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v))

/** variáveis dinâmicas do Postman com equivalente no Zeno */
const DYNAMIC: Record<string, string> = {
  $guid: "{% uuid 'v4' %}",
  $randomUUID: "{% uuid 'v4' %}",
  $isoTimestamp: '{% now %}'
}

export function convertPostman(collection: Any, envs: Any[] = []): ParseResult {
  const warnings: string[] = []
  const warned = new Set<string>()
  const warn = (m: string): void => {
    if (!warned.has(m)) warnings.push(m)
    warned.add(m)
  }
  const title = str(collection.info?.name) || 'Coleção Postman'
  const wsId = stableId('wrk', 'postman', str(collection.info?._postman_id) || title)
  const baseData: Record<string, unknown> = {}
  for (const v of collection.variable ?? []) if (v?.key && !v.disabled) baseData[v.key] = v.value ?? ''

  /** {{$guid}} -> tag; outras dinâmicas viram aviso */
  const fix = (s: unknown, where: string): string =>
    str(s).replace(/\{\{\s*(\$\w+)\s*\}\}/g, (whole, name: string) => {
      if (DYNAMIC[name]) return DYNAMIC[name]
      warn(`${where}: variável dinâmica ${name} não suportada`)
      return whole
    })

  const auth = (a: Any, where: string): Auth => {
    if (!a) return { type: 'inherit' }
    const list = (k: string): Any[] => (Array.isArray(a[k]) ? a[k] : Object.entries(a[k] ?? {}).map(([key, value]) => ({ key, value })))
    const get = (k: string, field: string): string => fix(list(k).find((x) => x.key === field)?.value, where)
    switch (a.type) {
      case 'noauth':
        return { type: 'none' }
      case 'inherit':
        return { type: 'inherit' }
      case 'basic':
        return { type: 'basic', username: get('basic', 'username'), password: get('basic', 'password') }
      case 'bearer':
        return { type: 'bearer', token: get('bearer', 'token') }
      case 'apikey':
        return { type: 'apikey', key: get('apikey', 'key'), value: get('apikey', 'value'), addTo: get('apikey', 'in') === 'query' ? 'query' : 'header' }
      default:
        warn(`${where}: auth "${a.type}" não suportada (ficou sem auth)`)
        return { type: 'none' }
    }
  }

  const kv = (list: Any, where: string): KV[] =>
    (Array.isArray(list) ? list : [])
      .filter((h) => h && (h.key || h.value))
      .map((h) => ({ name: fix(h.key, where), value: fix(h.value, where), enabled: !h.disabled }))

  const body = (b: Any, headers: KV[], where: string): Body => {
    if (!b || b.disabled) return { mime: null }
    switch (b.mode) {
      case 'raw': {
        const lang = b.options?.raw?.language
        const ct = headers.find((h) => /^content-type$/i.test(h.name))?.value.split(';')[0].trim()
        const mime = ct || ({ json: 'application/json', xml: 'application/xml', html: 'text/html', javascript: 'application/javascript' } as Record<string, string>)[lang] || 'text/plain'
        return { mime, text: fix(b.raw, where) }
      }
      case 'urlencoded':
        return { mime: 'application/x-www-form-urlencoded', fields: kv(b.urlencoded, where) }
      case 'formdata':
        return {
          mime: 'multipart/form-data',
          fields: (b.formdata ?? []).map((f: Any): BodyField => {
            const field: BodyField = { name: fix(f.key, where), value: f.type === 'file' ? '' : fix(f.value, where), enabled: !f.disabled }
            if (f.type === 'file') field.file = Array.isArray(f.src) ? str(f.src[0]) : str(f.src)
            return field
          })
        }
      case 'graphql':
        return { mime: 'application/json', text: JSON.stringify({ query: str(b.graphql?.query), variables: safeJson(b.graphql?.variables) }, null, 2) }
      case 'file':
        warn(`${where}: body de arquivo binário não importado`)
        return { mime: null }
      default:
        return { mime: null }
    }
  }

  const request = (item: Any, trail: string, i: number): RequestDoc => {
    const where = `${trail} / ${item.name ?? 'request'}`
    const r = typeof item.request === 'string' ? { url: item.request, method: 'GET' } : (item.request ?? {})
    const u = r.url
    let raw = typeof u === 'string' ? u : str(u?.raw)
    let params: KV[] = []
    if (u && typeof u === 'object' && Array.isArray(u.query)) params = kv(u.query.map((q: Any) => ({ ...q, value: q.value ?? '' })), where)
    const q = raw.indexOf('?')
    if (q >= 0) {
      if (!params.length)
        params = raw
          .slice(q + 1)
          .split('&')
          .filter(Boolean)
          .map((p) => {
            const [k, ...v] = p.split('=')
            return { name: k, value: v.join('='), enabled: true }
          })
      raw = raw.slice(0, q)
    }
    // :id no path vira {{ id }}; o valor do exemplo vai pro Base se ainda não existe
    for (const v of (u && typeof u === 'object' ? u.variable : null) ?? []) if (v?.key && !(v.key in baseData)) baseData[v.key] = v.value ?? ''
    raw = raw.replace(/(^|\/):([A-Za-z_]\w*)/g, (_m, slash: string, name: string) => {
      if (!(name in baseData)) baseData[name] = ''
      return `${slash}{{ ${name} }}`
    })
    const headers = kv(typeof r.header === 'string' ? parseHeaderBlock(r.header) : r.header, where)
    const b = body(r.body, headers, where)
    return {
      kind: 'request',
      id: stableId('req', wsId, trail, String(item.id ?? item._postman_id ?? ''), String(i), str(item.name)),
      name: str(item.name) || raw || 'request',
      description: str(typeof r.description === 'object' ? r.description?.content : r.description) || undefined,
      method: str(r.method || 'GET').toUpperCase(),
      url: fix(raw, where),
      params,
      headers,
      body: b,
      auth: auth(r.auth, where),
      scripts: scriptsOf(item.event),
      sortKey: i
    }
  }

  const items = (list: Any[], trail: string): TreeNode[] =>
    (list ?? []).map((item, i): TreeNode => {
      if (Array.isArray(item.item)) {
        const where = `${trail} / ${item.name ?? 'pasta'}`
        const folder: Folder = {
          kind: 'folder',
          id: stableId('fld', wsId, trail, String(item.id ?? item._postman_id ?? ''), String(i), str(item.name)),
          name: str(item.name) || 'Pasta',
          description: str(typeof item.description === 'object' ? item.description?.content : item.description) || undefined,
          sortKey: i,
          headers: [],
          auth: auth(item.auth, where),
          vars: Object.fromEntries((item.variable ?? []).filter((v: Any) => v?.key).map((v: Any) => [v.key, v.value ?? ''])),
          scripts: scriptsOf(item.event),
          children: items(item.item, where)
        }
        return folder
      }
      return request(item, trail, i)
    })

  let children = items(collection.item, title)
  // workspace não tem script: os da coleção vão pra cada item do primeiro nível, antes dos dele
  const rootScripts = scriptsOf(collection.event)
  if (rootScripts) {
    const join = (a?: string, b?: string): string | undefined => [a, b].filter(Boolean).join('\n\n') || undefined
    children = children.map((n) => ({ ...n, scripts: { ...(join(rootScripts.pre, n.scripts?.pre) ? { pre: join(rootScripts.pre, n.scripts?.pre) } : {}), ...(join(rootScripts.post, n.scripts?.post) ? { post: join(rootScripts.post, n.scripts?.post) } : {}) } }))
    warn(`${title}: scripts da coleção copiados para cada item do primeiro nível`)
  }
  // workspace não tem auth: a da coleção desce para o primeiro nível que herda
  const rootAuth = auth(collection.auth, title)
  if (rootAuth.type !== 'inherit') children = children.map((n) => (n.auth.type === 'inherit' ? { ...n, auth: rootAuth } : n))

  const base: Environment = { id: stableId('env', wsId, 'base'), name: 'Base', parentId: null, data: baseData, sortKey: 0 }
  const subs: Environment[] = envs.map((e, i) => ({
    id: stableId('env', wsId, 'postman-env', str(e.id) || str(e.name) || String(i)),
    name: str(e.name) || `Ambiente ${i + 1}`,
    parentId: base.id,
    data: Object.fromEntries((e.values ?? []).filter((v: Any) => v?.key && v.enabled !== false).map((v: Any) => [v.key, v.value ?? ''])),
    sortKey: i + 1
  }))

  const ws: Workspace = {
    id: wsId,
    name: title,
    description: str(typeof collection.info?.description === 'object' ? collection.info.description.content : collection.info?.description) || undefined,
    settings: { insecureTLS: false, timeoutMs: 30000 },
    environments: [base, ...subs],
    children
  }
  return { workspaces: [ws], warnings }
}

function parseHeaderBlock(s: string): { key: string; value: string }[] {
  return s
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.includes(':'))
    .map((l) => ({ key: l.slice(0, l.indexOf(':')).trim(), value: l.slice(l.indexOf(':') + 1).trim() }))
}

function safeJson(s: unknown): unknown {
  if (typeof s !== 'string' || !s.trim()) return {}
  try {
    return JSON.parse(s)
  } catch {
    return s
  }
}
