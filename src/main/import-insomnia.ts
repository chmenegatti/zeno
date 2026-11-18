// Importa dados do Insomnia: diretório NeDB (~/.config/Insomnia/*.db), export JSON v4 ou export YAML v5.

import fs from 'node:fs'
import path from 'node:path'
import type { Auth, Body, BodyField, Environment, Folder, KV, RequestDoc, TreeNode, Workspace } from '../shared/types'
import { sortNodes } from '../shared/tree'

/** registro bruto do Insomnia (campos que usamos) */
export interface InsDoc {
  _id: string
  type: string
  parentId?: string | null
  name?: string
  description?: string
  metaSortKey?: number
  // request
  method?: string
  url?: string
  parameters?: InsKV[]
  headers?: InsKV[]
  body?: { mimeType?: string | null; text?: string; params?: (InsKV & { type?: string; fileName?: string })[] }
  authentication?: Record<string, unknown>
  preRequestScript?: string
  afterResponseScript?: string
  // request group / environment
  environment?: Record<string, unknown>
  data?: Record<string, unknown>
  color?: string | null
  $$deleted?: boolean
}

interface InsKV {
  name?: string
  value?: string
  disabled?: boolean
}

export const INSOMNIA_DIR = path.join(process.env.HOME || '.', '.config', 'Insomnia')
const NEDB_FILES = ['Workspace', 'RequestGroup', 'Request', 'Environment']

const TYPE_FROM_EXPORT: Record<string, string> = {
  workspace: 'Workspace',
  request_group: 'RequestGroup',
  request: 'Request',
  environment: 'Environment'
}

/** NeDB é append-only: último registro de cada _id vence; $$deleted remove. */
export function parseNedb(text: string): InsDoc[] {
  const byId = new Map<string, InsDoc>()
  for (const line of text.split('\n')) {
    if (!line.trim()) continue
    let doc: InsDoc
    try {
      doc = JSON.parse(line)
    } catch {
      continue
    }
    if (!doc?._id) continue
    if (doc.$$deleted) byId.delete(doc._id)
    else byId.set(doc._id, doc)
  }
  return [...byId.values()]
}

export function readNedbDir(dir = INSOMNIA_DIR): InsDoc[] {
  const docs: InsDoc[] = []
  for (const t of NEDB_FILES) {
    const file = path.join(dir, `insomnia.${t}.db`)
    if (fs.existsSync(file)) docs.push(...parseNedb(fs.readFileSync(file, 'utf8')))
  }
  if (!docs.some((d) => d.type === 'Workspace')) throw new Error(`nenhum workspace do Insomnia em ${dir}`)
  return docs
}

/** Insomnia com "Validate certificates" desligado? */
export function insomniaSkipsTLS(dir = INSOMNIA_DIR): boolean {
  try {
    const settings = parseNedb(fs.readFileSync(path.join(dir, 'insomnia.Settings.db'), 'utf8'))
    return settings.some((s) => (s as unknown as { validateSSL?: boolean }).validateSSL === false)
  } catch {
    return false
  }
}

export function readExportJson(file: string): InsDoc[] {
  return fromExportV4(JSON.parse(fs.readFileSync(file, 'utf8')))
}

export function isInsomniaV4(raw: unknown): boolean {
  return !!raw && typeof raw === 'object' && (raw as { _type?: string })._type === 'export' && Array.isArray((raw as { resources?: unknown }).resources)
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function fromExportV4(raw: any): InsDoc[] {
  if (!Array.isArray(raw?.resources)) throw new Error('arquivo não é export JSON do Insomnia (v4)')
  return raw.resources
    .filter((r: { _type?: string }) => r._type && TYPE_FROM_EXPORT[r._type])
    .map((r: { _type: string }) => ({ ...r, type: TYPE_FROM_EXPORT[r._type] }))
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type V5 = any

export function isInsomniaV5(raw: V5): boolean {
  return !!raw && typeof raw === 'object' && /^(collection|spec)\.insomnia\.rest\/5\./.test(String(raw.type ?? ''))
}

/**
 * export v5 (YAML, um workspace por arquivo) -> mesmos registros do NeDB, pra reaproveitar convert().
 * collection: árvore de pastas (children) e requests; environments: base com subEnvironments.
 */
export function fromExportV5(raw: V5): InsDoc[] {
  if (!isInsomniaV5(raw)) throw new Error('arquivo não é export do Insomnia v5')
  const docs: InsDoc[] = []
  const wsId = String(raw.meta?.id ?? `wrk_v5_${String(raw.name ?? 'insomnia').replace(/\W+/g, '_')}`)
  docs.push({ _id: wsId, type: 'Workspace', name: raw.name, description: raw.meta?.description })
  let n = 0
  const meta = (x: V5, prefix: string): { _id: string; metaSortKey: number; description?: string } => ({
    _id: String(x.meta?.id ?? `${prefix}_v5_${n++}`),
    metaSortKey: Number(x.meta?.sortKey ?? n++),
    description: x.meta?.description || x.description || undefined
  })
  const walk = (list: V5[], parentId: string): void => {
    for (const x of list ?? []) {
      if (Array.isArray(x.children)) {
        const m = meta(x, 'fld')
        docs.push({ ...m, type: 'RequestGroup', parentId, name: x.name, headers: x.headers, authentication: x.authentication, environment: x.environment })
        walk(x.children, m._id)
      } else {
        const m = meta(x, 'req')
        docs.push({
          ...m,
          type: 'Request',
          parentId,
          name: x.name,
          method: x.method,
          url: x.url,
          parameters: x.parameters,
          headers: x.headers,
          body: x.body,
          authentication: x.authentication,
          preRequestScript: x.scripts?.preRequest,
          afterResponseScript: x.scripts?.afterResponse
        })
      }
    }
  }
  walk(raw.collection ?? [], wsId)
  const env = raw.environments
  if (env) {
    const base = meta(env, 'env')
    docs.push({ ...base, type: 'Environment', parentId: wsId, name: env.name ?? 'Base', data: env.data ?? {} })
    for (const sub of env.subEnvironments ?? []) docs.push({ ...meta(sub, 'env'), type: 'Environment', parentId: base._id, name: sub.name, data: sub.data ?? {}, color: sub.color })
  }
  return docs
}

function kv(list: InsKV[] | undefined): KV[] {
  return (list ?? []).filter((x) => x && (x.name || x.value)).map((x) => ({ name: x.name ?? '', value: x.value ?? '', enabled: !x.disabled }))
}

function auth(a: Record<string, unknown> | undefined, where: string, warn: (m: string) => void): Auth {
  if (!a || !a.type) return { type: 'inherit' }
  if (a.disabled) return { type: 'none' }
  const s = (k: string): string => (typeof a[k] === 'string' ? (a[k] as string) : '')
  switch (a.type) {
    case 'none':
      return { type: 'none' }
    case 'basic':
      return { type: 'basic', username: s('username'), password: s('password') }
    case 'bearer':
      return { type: 'bearer', token: s('token'), prefix: s('prefix') || undefined }
    case 'apikey':
      if (a.addTo === 'cookie') warn(`${where}: API key em cookie virou header Cookie`)
      return a.addTo === 'queryParams'
        ? { type: 'apikey', key: s('key'), value: s('value'), addTo: 'query' }
        : a.addTo === 'cookie'
          ? { type: 'apikey', key: 'Cookie', value: `${s('key')}=${s('value')}`, addTo: 'header' }
          : { type: 'apikey', key: s('key'), value: s('value'), addTo: 'header' }
    default:
      warn(`${where}: auth "${String(a.type)}" não suportada (ficou sem auth)`)
      return { type: 'none' }
  }
}

function body(b: InsDoc['body'], where: string, warn: (m: string) => void): Body {
  if (!b || (!b.mimeType && !b.text && !b.params?.length)) return { mime: null }
  const mime = b.mimeType ?? 'text/plain'
  if (mime === 'application/x-www-form-urlencoded' || mime === 'multipart/form-data') {
    const fields: BodyField[] = (b.params ?? []).map((p) => {
      const f: BodyField = { name: p.name ?? '', value: p.value ?? '', enabled: !p.disabled }
      if (p.type === 'file') f.file = p.fileName ?? ''
      return f
    })
    return { mime, fields }
  }
  if (mime === 'application/graphql') warn(`${where}: body GraphQL importado como texto`)
  return { mime, text: b.text ?? '' }
}

export interface ParseResult {
  workspaces: Workspace[]
  warnings: string[]
}

export function convert(docs: InsDoc[], opts: { insecureTLS?: boolean } = {}): ParseResult {
  const warnings: string[] = []
  const warn = (m: string): void => {
    warnings.push(m)
  }
  const children = new Map<string, InsDoc[]>()
  for (const d of docs) {
    if (!d.parentId) continue
    const list = children.get(d.parentId) ?? []
    list.push(d)
    children.set(d.parentId, list)
  }

  const sortKey = (d: InsDoc): number => (typeof d.metaSortKey === 'number' ? d.metaSortKey : 0)

  const checkTags = (where: string, ...texts: (string | undefined)[]): void => {
    if (texts.some((t) => t && t.includes('{%'))) warn(`${where}: usa template tag {% %} (não suportada)`)
  }

  const buildNodes = (parentId: string, trail: string): TreeNode[] => {
    const nodes: TreeNode[] = []
    for (const d of children.get(parentId) ?? []) {
      const name = d.name || '(sem nome)'
      const where = `${trail} / ${name}`
      if (d.type === 'RequestGroup') {
        const folder: Folder = {
          kind: 'folder',
          id: d._id,
          name,
          description: d.description || undefined,
          sortKey: sortKey(d),
          headers: kv(d.headers),
          auth: auth(d.authentication, where, warn),
          vars: d.environment && typeof d.environment === 'object' ? d.environment : {},
          children: buildNodes(d._id, where)
        }
        nodes.push(folder)
      } else if (d.type === 'Request') {
        if (d.preRequestScript?.trim() || d.afterResponseScript?.trim()) warn(`${where}: scripts ignorados`)
        const req: RequestDoc = {
          kind: 'request',
          id: d._id,
          name,
          description: d.description || undefined,
          method: (d.method || 'GET').toUpperCase(),
          url: d.url ?? '',
          params: kv(d.parameters),
          headers: kv(d.headers),
          body: body(d.body, where, warn),
          auth: auth(d.authentication, where, warn),
          sortKey: sortKey(d)
        }
        checkTags(where, req.url, req.body.text, ...req.headers.map((h) => h.value))
        nodes.push(req)
      }
    }
    return sortNodes(nodes)
  }

  const workspaces: Workspace[] = []
  for (const w of docs.filter((d) => d.type === 'Workspace')) {
    const name = w.name || '(sem nome)'
    const environments: Environment[] = []
    for (const base of (children.get(w._id) ?? []).filter((d) => d.type === 'Environment')) {
      environments.push({ id: base._id, name: base.name || 'Base', parentId: null, data: base.data ?? {}, sortKey: sortKey(base) })
      for (const sub of (children.get(base._id) ?? []).filter((d) => d.type === 'Environment')) {
        environments.push({
          id: sub._id,
          name: sub.name || 'Ambiente',
          parentId: base._id,
          color: sub.color || undefined,
          data: sub.data ?? {},
          sortKey: sortKey(sub)
        })
      }
    }
    // Insomnia pode ter mais de um base; o primeiro vira o base, os outros viram sub-ambientes dele
    const bases = environments.filter((e) => e.parentId === null)
    for (const extra of bases.slice(1)) {
      extra.parentId = bases[0].id
      warn(`${name}: ambiente base extra "${extra.name}" virou sub-ambiente`)
    }
    workspaces.push({
      id: w._id,
      name,
      description: w.description || undefined,
      settings: { insecureTLS: !!opts.insecureTLS, timeoutMs: 30000 },
      environments: sortNodes(environments),
      children: buildNodes(w._id, name)
    })
  }
  workspaces.sort((a, b) => a.name.localeCompare(b.name))
  return { workspaces, warnings }
}
