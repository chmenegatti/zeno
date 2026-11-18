// Origem das variáveis (de onde vem cada valor) e referências usadas num request.

import type { Environment, Folder, RequestDoc, Workspace } from './types'

export type VarSource =
  | { kind: 'env'; envId: string; label: string }
  | { kind: 'folder'; folderId: string; label: string }

export interface VarInfo {
  name: string
  value: unknown
  source: VarSource
  /** origens sobrescritas (da mais geral pra mais específica) */
  shadowed: VarSource[]
}

export function varSources(ws: Workspace, activeEnvId: string | null | undefined, ancestors: Folder[] = []): Map<string, VarInfo> {
  const out = new Map<string, VarInfo>()
  const put = (data: Record<string, unknown>, source: VarSource): void => {
    for (const [name, value] of Object.entries(data ?? {})) {
      const prev = out.get(name)
      out.set(name, { name, value, source, shadowed: prev ? [...prev.shadowed, prev.source] : [] })
    }
  }
  const base = ws.environments.find((e) => e.parentId === null)
  if (base) put(base.data, envSource(base))
  const sub = activeEnvId ? ws.environments.find((e) => e.id === activeEnvId && e.parentId !== null) : undefined
  if (sub) put(sub.data, envSource(sub))
  for (const f of ancestors) put(f.vars ?? {}, { kind: 'folder', folderId: f.id, label: `pasta ${f.name}` })
  return out
}

export function envSource(e: Environment): VarSource {
  return { kind: 'env', envId: e.id, label: e.parentId === null ? 'Base' : e.name }
}

export type Token = { t: 'text'; v: string } | { t: 'var'; name: string; raw: string } | { t: 'tag'; name: string; raw: string }

const TOKEN_RE = /\{\{\s*([A-Za-z0-9_$.\-[\]'"]+)\s*\}\}|\{%\s*(\w+).*?%\}/g

/** nome de topo da variável: `_.a.b` -> `a` */
export function rootName(path: string): string {
  return path.replace(/^_\./, '').split(/[.[]/)[0]
}

export function tokenize(s: string): Token[] {
  const out: Token[] = []
  let last = 0
  for (const m of s.matchAll(TOKEN_RE)) {
    if (m.index! > last) out.push({ t: 'text', v: s.slice(last, m.index) })
    if (m[1]) out.push({ t: 'var', name: rootName(m[1]), raw: m[0] })
    else out.push({ t: 'tag', name: m[2], raw: m[0] })
    last = m.index! + m[0].length
  }
  if (last < s.length) out.push({ t: 'text', v: s.slice(last) })
  return out
}

/** variáveis referenciadas em todos os campos do request, na ordem em que aparecem */
export function requestVarRefs(req: RequestDoc): string[] {
  const texts = [
    req.url,
    ...req.params.flatMap((p) => [p.name, p.value]),
    ...req.headers.flatMap((h) => [h.name, h.value]),
    req.body.text ?? '',
    ...(req.body.fields ?? []).flatMap((f) => [f.name, f.value]),
    ...Object.values(req.auth).filter((v): v is string => typeof v === 'string')
  ]
  const names: string[] = []
  for (const t of texts) for (const tok of tokenize(t ?? '')) if (tok.t === 'var' && !names.includes(tok.name)) names.push(tok.name)
  return names
}

export function formatValue(v: unknown): string {
  return typeof v === 'string' ? v : JSON.stringify(v)
}

export function isSecret(name: string): boolean {
  return /pass|senha|secret|token|key|cred/i.test(name)
}
