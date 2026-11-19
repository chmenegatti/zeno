// Resolução de variáveis: {{ nome }}, {{ _.nome }}, {{ _.a.b }} (sintaxe compatível com Insomnia).
// Tags {% ... %} não são suportadas: ficam intactas e geram aviso.

import type { Environment, Folder, Workspace } from './types'

export type Vars = Record<string, unknown>

const VAR_RE = /\{\{\s*([A-Za-z0-9_$.\-[\]'"]+)\s*\}\}/g
const TAG_RE = /\{%.*?%\}/g

export interface RenderResult {
  value: string
  missing: string[]
  unsupported: string[]
}

/** caminho da variável em partes: nome, _.nome, _['X-API-Key'], a.b, a[0], a["x.y"] (o _ inicial é o ambiente) */
export function varPath(path: string): string[] {
  const parts: string[] = []
  for (const m of path.matchAll(/\[\s*(['"])(.*?)\1\s*\]|\[\s*([^\]]*?)\s*\]|([^.[\]]+)/g)) parts.push(m[2] ?? m[3] ?? m[4])
  return parts[0] === '_' && parts.length > 1 ? parts.slice(1) : parts
}

function lookup(vars: Vars, path: string): unknown {
  let cur: unknown = vars
  for (const part of varPath(path)) {
    if (cur == null || typeof cur !== 'object' || !(part in (cur as object))) return undefined
    cur = (cur as Record<string, unknown>)[part]
  }
  return cur
}

/** tags {% %} já resolvidas (texto exato da tag -> valor) */
export type TagValues = Map<string, string>

export function render(input: string, vars: Vars, tags?: TagValues, depth = 0): RenderResult {
  const missing: string[] = []
  const unsupported: string[] = []
  if (!input || (!input.includes('{{') && !input.includes('{%'))) return { value: input ?? '', missing, unsupported }
  const withTags = input.replace(TAG_RE, (tag) => {
    const v = tags?.get(tag)
    if (v === undefined) unsupported.push(tag)
    return v ?? tag
  })
  const value = withTags.replace(VAR_RE, (whole, path: string) => {
    const v = lookup(vars, path)
    if (v === undefined) {
      missing.push(path)
      return whole
    }
    if (typeof v === 'string') {
      if (depth < 5 && (v.includes('{{') || v.includes('{%'))) {
        const inner = render(v, vars, tags, depth + 1)
        missing.push(...inner.missing)
        unsupported.push(...inner.unsupported)
        return inner.value
      }
      return v
    }
    return typeof v === 'object' ? JSON.stringify(v) : String(v)
  })
  return { value, missing, unsupported }
}

function deepMerge(a: Vars, b: Vars): Vars {
  const out: Vars = { ...a }
  for (const [k, v] of Object.entries(b)) {
    const prev = out[k]
    out[k] =
      v && typeof v === 'object' && !Array.isArray(v) && prev && typeof prev === 'object' && !Array.isArray(prev)
        ? deepMerge(prev as Vars, v as Vars)
        : v
  }
  return out
}

/** base -> sub-ambiente ativo -> pastas (da raiz até a mais próxima) */
export function buildVars(ws: Workspace, activeEnvId: string | null | undefined, folders: Folder[]): Vars {
  const base = ws.environments.find((e) => e.parentId === null)
  let vars: Vars = base ? { ...base.data } : {}
  const sub: Environment | undefined = activeEnvId ? ws.environments.find((e) => e.id === activeEnvId) : undefined
  if (sub && sub.parentId !== null) vars = deepMerge(vars, sub.data)
  for (const f of folders) vars = deepMerge(vars, f.vars ?? {})
  return vars
}
