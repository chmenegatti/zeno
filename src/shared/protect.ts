// Acha valores que parecem segredo e ainda estão em texto puro.
//
// Regras:
// 1. variável (de ambiente ou pasta, inclusive aninhada) com nome de segredo e valor literal;
// 2. senha/token/valor de auth literal (request ou pasta);
// 3. header literal com nome sensível (Authorization, X-API-Key, *token*…);
// 4. qualquer outra variável cujo valor seja IGUAL a um segredo achado acima (senha guardada com nome "p-poc", por ex.).
// Segredos escritos no meio de URL/body não dá pra cifrar sem quebrar o texto: viram aviso.

import { isLiteral, looksSecret } from './secret'
import { walk } from './tree'
import type { Workspace } from './types'

export type Path = (string | number)[]

export interface SecretSpot {
  /** onde está: ambiente, pasta ou request */
  target: { kind: 'env'; id: string } | { kind: 'folder'; id: string } | { kind: 'request'; id: string }
  /** caminho do valor dentro do objeto (ex.: ['data','password'], ['auth','token'], ['headers',0,'value']) */
  path: Path
  label: string
}

export interface ScanResult {
  spots: SecretSpot[]
  /** segredos literais dentro de URL/body/params: precisam virar variável à mão */
  warnings: string[]
}

const SENSITIVE_HEADER = /^(authorization|proxy-authorization|cookie|x-api-key|api-key|x-auth-token)$/i

type Obj = Record<string, unknown>

function eachLeaf(obj: unknown, path: Path, fn: (path: Path, key: string, value: unknown) => void): void {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return
  for (const [k, v] of Object.entries(obj as Obj)) {
    if (v && typeof v === 'object' && !Array.isArray(v)) eachLeaf(v, [...path, k], fn)
    else fn([...path, k], k, v)
  }
}

export function getAt(obj: unknown, path: Path): unknown {
  return path.reduce<unknown>((o, k) => (o == null ? undefined : (o as Obj)[k as string]), obj)
}

export function setAt(obj: unknown, path: Path, value: unknown): void {
  const parent = getAt(obj, path.slice(0, -1)) as Obj
  parent[path[path.length - 1] as string] = value
}

/** valores literais que já são segredo pelas regras 1–3 (pra cruzar entre workspaces) */
export function literalSecrets(ws: Workspace): string[] {
  return scanSecrets(ws).spots.filter((s) => !s.label.endsWith('(mesmo valor de um segredo)')).map((s) => String(getAt(spotObject(ws, s), s.path)))
}

function spotObject(ws: Workspace, s: SecretSpot): unknown {
  if (s.target.kind === 'env') return ws.environments.find((e) => e.id === s.target.id)
  let found: unknown
  walk(ws.children, (n) => {
    if (n.id === s.target.id) found = n
  })
  return found
}

/** extraKnown: segredos conhecidos de outros workspaces (ou já cifrados), pra regra 4 e avisos */
export function scanSecrets(ws: Workspace, extraKnown: Iterable<string> = []): ScanResult {
  const spots: SecretSpot[] = []
  /** candidatos da regra 4: variáveis literais com nome comum */
  const others: { spot: SecretSpot; value: string }[] = []
  const known = new Set<string>(extraKnown)
  const add = (spot: SecretSpot, value: string): void => {
    spots.push(spot)
    known.add(value)
  }

  const vars = (target: SecretSpot['target'], data: unknown, base: Path, where: string): void => {
    eachLeaf(data, base, (path, key, v) => {
      if (!isLiteral(v)) return
      const spot = { target, path, label: `${where} · ${path.slice(base.length).join('.')}` }
      if (looksSecret(key)) add(spot, v)
      else others.push({ spot, value: v })
    })
  }

  const authAndHeaders = (target: SecretSpot['target'], node: { auth: unknown; headers: { name: string; value: string }[] }, where: string): void => {
    const a = node.auth as Obj
    const field = a.type === 'basic' ? 'password' : a.type === 'bearer' ? 'token' : a.type === 'apikey' ? 'value' : null
    if (field && isLiteral(a[field])) add({ target, path: ['auth', field], label: `${where} · auth ${a.type}` }, a[field] as string)
    node.headers.forEach((h, i) => {
      if ((SENSITIVE_HEADER.test(h.name) || looksSecret(h.name)) && isLiteral(h.value)) add({ target, path: ['headers', i, 'value'], label: `${where} · header ${h.name}` }, h.value)
    })
  }

  for (const env of ws.environments) vars({ kind: 'env', id: env.id }, env.data, ['data'], env.parentId ? env.name : 'Base')
  walk(ws.children, (n) => {
    if (n.kind === 'folder') {
      vars({ kind: 'folder', id: n.id }, n.vars, ['vars'], `pasta ${n.name}`)
      authAndHeaders({ kind: 'folder', id: n.id }, n, `pasta ${n.name}`)
    } else authAndHeaders({ kind: 'request', id: n.id }, n, n.name)
  })

  // regra 4: mesma senha guardada com outro nome
  for (const o of others) {
    if (o.value.length >= 6 && known.has(o.value)) spots.push({ ...o.spot, label: `${o.spot.label} (mesmo valor de um segredo)` })
  }

  // segredos conhecidos escritos no meio de textos
  const warnings: string[] = []
  const secrets = [...known].filter((s) => s.length >= 6)
  if (secrets.length) {
    walk(ws.children, (n) => {
      if (n.kind !== 'request') return
      const texts: [string, string][] = [
        ['URL', n.url],
        ['body', n.body.text ?? ''],
        ...n.params.map((p): [string, string] => [`param ${p.name}`, p.value]),
        ...(n.body.fields ?? []).map((f): [string, string] => [`campo ${f.name}`, f.value]),
        ...n.headers.filter((h) => !SENSITIVE_HEADER.test(h.name) && !looksSecret(h.name)).map((h): [string, string] => [`header ${h.name}`, h.value])
      ]
      for (const [where, t] of texts) if (t && secrets.some((s) => t.includes(s))) warnings.push(`${n.name} · ${where}`)
    })
  }
  return { spots, warnings }
}
