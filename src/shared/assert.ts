// Asserções sem código: status, header, JSONPath, body e tempo. Viram ScriptTest (mesma aba Testes dos scripts).

import type { Assertion, ResponseRecord, ScriptTest } from './types'

export const OP_LABEL: Record<Assertion['op'], string> = {
  eq: '=',
  neq: '≠',
  contains: 'contém',
  notContains: 'não contém',
  lt: '<',
  gt: '>',
  exists: 'existe',
  notExists: 'não existe',
  matches: 'casa regex'
}

export const SOURCE_LABEL: Record<Assertion['source'], string> = {
  status: 'status',
  header: 'header',
  json: 'JSON',
  body: 'body',
  time: 'tempo (ms)'
}

/** operadores que não usam valor */
export const NO_VALUE: Assertion['op'][] = ['exists', 'notExists']

type Seg = { k: 'key'; name: string } | { k: 'idx'; i: number } | { k: 'all' } | { k: 'deep'; name: string }

/** JSONPath simples: $.a.b, $['a b'], $.list[0], $.list[-1], $.list[*].id, $..id */
export function parsePath(path: string): Seg[] {
  const p = path.trim().replace(/^\$/, '')
  const out: Seg[] = []
  let i = 0
  const name = (): string => {
    const m = /^[^.[\]]+/.exec(p.slice(i))
    if (!m) throw new Error(`JSONPath inválido: ${path}`)
    i += m[0].length
    return m[0]
  }
  while (i < p.length) {
    if (p.startsWith('..', i)) {
      i += 2
      out.push({ k: 'deep', name: name() })
    } else if (p[i] === '.') {
      i++
      if (p[i] === '*') {
        i++
        out.push({ k: 'all' })
      } else out.push({ k: 'key', name: name() })
    } else if (p[i] === '[') {
      const end = p.indexOf(']', i)
      if (end < 0) throw new Error(`JSONPath inválido: ${path}`)
      const inner = p.slice(i + 1, end).trim()
      i = end + 1
      if (inner === '*') out.push({ k: 'all' })
      else if (/^-?\d+$/.test(inner)) out.push({ k: 'idx', i: Number(inner) })
      else if (/^(['"]).*\1$/.test(inner)) out.push({ k: 'key', name: inner.slice(1, -1) })
      else throw new Error(`JSONPath inválido: ${path}`)
    } else out.push({ k: 'key', name: name() })
  }
  return out
}

/** valores encontrados; `many` = o caminho tem curinga (o resultado é uma lista) */
export function queryJson(doc: unknown, path: string): { values: unknown[]; many: boolean } {
  const segs = parsePath(path)
  let cur: unknown[] = [doc]
  const deep = (v: unknown, key: string, acc: unknown[]): void => {
    if (Array.isArray(v)) v.forEach((x) => deep(x, key, acc))
    else if (v && typeof v === 'object') {
      for (const [k, x] of Object.entries(v)) {
        if (k === key) acc.push(x)
        deep(x, key, acc)
      }
    }
  }
  for (const s of segs) {
    const next: unknown[] = []
    for (const v of cur) {
      if (s.k === 'key') {
        if (v && typeof v === 'object' && !Array.isArray(v) && s.name in v) next.push((v as Record<string, unknown>)[s.name])
      } else if (s.k === 'idx') {
        if (Array.isArray(v)) {
          const j = s.i < 0 ? v.length + s.i : s.i
          if (j >= 0 && j < v.length) next.push(v[j])
        }
      } else if (s.k === 'all') {
        if (Array.isArray(v)) next.push(...v)
        else if (v && typeof v === 'object') next.push(...Object.values(v))
      } else deep(v, s.name, next)
    }
    cur = next
  }
  return { values: cur, many: segs.some((s) => s.k === 'all' || s.k === 'deep') }
}

const text = (v: unknown): string => (v === undefined ? '' : typeof v === 'string' ? v : JSON.stringify(v))
const num = (v: unknown): number => (typeof v === 'number' ? v : Number(String(v).trim()))

function equal(actual: unknown, expected: string): boolean {
  if (text(actual) === expected) return true
  if (typeof actual === 'number' || typeof actual === 'boolean' || actual === null) return String(actual) === expected.trim()
  // valor esperado escrito como JSON ("abc", {"a":1}) compara pelo conteúdo
  try {
    return JSON.stringify(actual) === JSON.stringify(JSON.parse(expected))
  } catch {
    return false
  }
}

function contains(actual: unknown, expected: string): boolean {
  if (Array.isArray(actual)) return actual.some((x) => equal(x, expected))
  return text(actual).includes(expected)
}

export function assertionName(a: Assertion): string {
  const what = a.source === 'header' || a.source === 'json' ? `${a.source === 'header' ? 'header ' : ''}${a.path || '?'}` : SOURCE_LABEL[a.source]
  return NO_VALUE.includes(a.op) ? `${what} ${OP_LABEL[a.op]}` : `${what} ${OP_LABEL[a.op]} ${a.value ?? ''}`.trim()
}

/** avalia as asserções ativas. `resolve` troca {{ variáveis }} no valor esperado */
export function evaluate(assertions: Assertion[] | undefined, res: ResponseRecord, resolve: (s: string) => string = (s) => s): ScriptTest[] {
  const out: ScriptTest[] = []
  let parsed: { ok: true; doc: unknown } | { ok: false; error: string } | null = null
  const json = (): unknown => {
    if (!parsed) {
      try {
        parsed = { ok: true, doc: JSON.parse(res.bodyEncoding === 'utf8' ? res.body : '') }
      } catch {
        parsed = { ok: false, error: 'resposta não é JSON' }
      }
    }
    if (!parsed.ok) throw new Error(parsed.error)
    return parsed.doc
  }

  for (const a of assertions ?? []) {
    if (!a.enabled) continue
    let name = assertionName(a)
    try {
      const expected = resolve(a.value ?? '')
      name = assertionName({ ...a, value: expected })
      let actual: unknown
      let found = true
      switch (a.source) {
        case 'status':
          actual = res.status
          break
        case 'time':
          actual = res.timing.totalMs
          break
        case 'body':
          actual = res.bodyEncoding === 'utf8' ? res.body : ''
          break
        case 'header': {
          const key = (a.path ?? '').trim().toLowerCase()
          const hs = res.headers.filter(([k]) => k.toLowerCase() === key).map(([, v]) => v)
          found = hs.length > 0
          actual = hs.join(', ')
          break
        }
        case 'json': {
          const q = queryJson(json(), a.path || '$')
          found = q.values.length > 0
          actual = q.many ? q.values : q.values[0]
          break
        }
      }
      let ok: boolean
      switch (a.op) {
        case 'exists':
          ok = found
          break
        case 'notExists':
          ok = !found
          break
        case 'eq':
          ok = found && equal(actual, expected)
          break
        case 'neq':
          ok = !found || !equal(actual, expected)
          break
        case 'contains':
          ok = found && contains(actual, expected)
          break
        case 'notContains':
          ok = !found || !contains(actual, expected)
          break
        case 'lt':
          ok = found && num(actual) < num(expected)
          break
        case 'gt':
          ok = found && num(actual) > num(expected)
          break
        case 'matches':
          ok = found && new RegExp(expected).test(text(actual))
          break
      }
      out.push(ok ? { name, ok, where: 'asserção' } : { name, ok, where: 'asserção', error: found ? `valor: ${clip(text(actual))}` : 'não encontrado' })
    } catch (e) {
      out.push({ name, ok: false, where: 'asserção', error: (e as Error).message })
    }
  }
  return out
}

const clip = (s: string): string => (s.length > 200 ? `${s.slice(0, 200)}…` : s)
