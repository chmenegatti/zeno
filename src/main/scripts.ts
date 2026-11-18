// Scripts pré-request e pós-resposta.
//
// Isolamento: cada script roda num contexto `node:vm` criado a partir de Object.create(null), sem nenhum
// objeto do processo principal lá dentro (nada de require, process, fs, timers ou rede). A entrada entra
// como string JSON e a saída sai como string JSON; a API (`zeno`, e os apelidos `insomnia` e `pm`) é
// montada dentro do próprio contexto. eval/new Function ficam desligados e o timeout cobre também as
// promises (microtaskMode afterEvaluate).

import vm from 'node:vm'
import type { KV, ScriptTest } from '../shared/types'

export const SCRIPT_TIMEOUT_MS = 5000

export interface ScriptRequest {
  method: string
  url: string
  headers: KV[]
  params: KV[]
  body: { mime: string | null; text?: string }
}

export interface ScriptResponse {
  code: number
  status: string
  headers: [string, string][]
  body: string
  time: number
}

export interface ScriptInput {
  phase: 'pre' | 'post'
  /** quem é o dono do script (pra mensagens) */
  where: string
  /** ambiente ativo (sub-ambiente, ou o Base se nenhum) */
  env: Record<string, unknown>
  base: Record<string, unknown>
  /** variáveis só deste envio (zeno.variables.set) */
  vars: Record<string, unknown>
  request: ScriptRequest
  response?: ScriptResponse
}

export interface ScriptOutput {
  env: Record<string, unknown>
  base: Record<string, unknown>
  vars: Record<string, unknown>
  request: ScriptRequest
  logs: string[]
  tests: ScriptTest[]
  error?: string
}

// roda dentro do contexto: monta a API em cima de S (estado) e grava S.out em __output
const BOOTSTRAP = String.raw`
const S = JSON.parse(__input); __input = undefined
if (S.envIsBase) S.base = S.env
const logs = [], tests = [], pending = []
const fmt = (v) => typeof v === 'string' ? v : v && v.__isUrl ? String(v) : (() => { try { return JSON.stringify(v) } catch { return String(v) } })()
const console = { log: (...a) => logs.push(a.map(fmt).join(' ')) }
console.info = console.log; console.debug = console.log
console.warn = (...a) => logs.push('⚠ ' + a.map(fmt).join(' '))
console.error = (...a) => logs.push('✖ ' + a.map(fmt).join(' '))

const vars = (obj, fallback) => ({
  get: (k) => (k in obj ? obj[k] : fallback ? fallback(k) : undefined),
  set: (k, v) => { obj[k] = v },
  unset: (k) => { delete obj[k] },
  has: (k) => k in obj,
  clear: () => { for (const k of Object.keys(obj)) delete obj[k] },
  toObject: () => ({ ...obj }),
  replaceIn: (s) => String(s).replace(/\{\{\s*(?:_\.)?([\w.$-]+)\s*\}\}/g, (m, k) => (k in obj ? String(obj[k]) : m))
})
const environment = vars(S.env)
const baseEnvironment = S.envIsBase ? environment : vars(S.base)
const variables = vars(S.vars, (k) => (k in S.env ? S.env[k] : S.base[k]))
variables.replaceIn = (s) => String(s).replace(/\{\{\s*(?:_\.)?([\w.$-]+)\s*\}\}/g, (m, k) => { const v = variables.get(k); return v === undefined ? m : String(v) })

// ---------- base64 (scripts costumam montar Basic auth) ----------
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
const btoa = (s) => { s = String(s); let o = ''; for (let i = 0; i < s.length; i += 3) { const a = s.charCodeAt(i), b = s.charCodeAt(i + 1), c = s.charCodeAt(i + 2); if (a > 255 || b > 255 || c > 255) throw new Error('btoa: caractere fora de Latin-1'); const n = (a << 16) | ((b || 0) << 8) | (c || 0); o += B64[(n >> 18) & 63] + B64[(n >> 12) & 63] + (i + 1 < s.length ? B64[(n >> 6) & 63] : '=') + (i + 2 < s.length ? B64[n & 63] : '=') } return o }
const atob = (s) => { s = String(s).replace(/[^A-Za-z0-9+/]/g, ''); let o = ''; for (let i = 0; i < s.length; i += 4) { const n = (B64.indexOf(s[i]) << 18) | (B64.indexOf(s[i + 1]) << 12) | ((B64.indexOf(s[i + 2]) & 63) << 6) | (B64.indexOf(s[i + 3]) & 63); o += String.fromCharCode((n >> 16) & 255); if (s[i + 2]) o += String.fromCharCode((n >> 8) & 255); if (s[i + 3]) o += String.fromCharCode(n & 255) } return o }

// ---------- expect (subconjunto do chai) ----------
class AssertionError extends Error { constructor(m) { super(m); this.name = 'AssertionError' } }
const show = (v) => { try { return JSON.stringify(v) } catch { return String(v) } }
const deepEq = (a, b) => {
  if (Object.is(a, b)) return true
  if (typeof a !== 'object' || typeof b !== 'object' || !a || !b) return false
  if (Array.isArray(a) !== Array.isArray(b)) return false
  const ka = Object.keys(a), kb = Object.keys(b)
  return ka.length === kb.length && ka.every((k) => deepEq(a[k], b[k]))
}
const typeOf = (v) => v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v
function expect(target, msg) {
  let actual = target
  const flags = { not: false, deep: false }
  const check = (ok, text) => {
    if (ok === flags.not) throw new AssertionError((msg ? msg + ': ' : '') + 'esperado ' + show(actual) + (flags.not ? ' não ' : ' ') + text)
    return api
  }
  const api = {
    equal: (v) => check(flags.deep ? deepEq(actual, v) : actual === v, 'igual a ' + show(v)),
    eql: (v) => check(deepEq(actual, v), 'igual (profundo) a ' + show(v)),
    a: (t) => check(typeOf(actual) === String(t).toLowerCase(), 'do tipo ' + t),
    include: (v) => check(typeof actual === 'string' ? actual.includes(v) : Array.isArray(actual) ? actual.some((x) => deepEq(x, v)) : actual && typeof v === 'object' ? Object.entries(v).every(([k, x]) => deepEq(actual[k], x)) : false, 'contendo ' + show(v)),
    // como no chai: depois de .property(k), o alvo passa a ser o valor da propriedade
    property: (k, ...v) => { check(actual != null && k in Object(actual), 'com a propriedade ' + show(k)); const val = actual[k]; if (v.length) check(deepEq(val, v[0]), 'com ' + k + ' = ' + show(v[0])); if (!flags.not) actual = val; return api },
    lengthOf: (n) => check(actual != null && actual.length === n, 'com tamanho ' + n),
    above: (n) => check(actual > n, 'maior que ' + n),
    least: (n) => check(actual >= n, 'maior ou igual a ' + n),
    below: (n) => check(actual < n, 'menor que ' + n),
    most: (n) => check(actual <= n, 'menor ou igual a ' + n),
    within: (a, b) => check(actual >= a && actual <= b, 'entre ' + a + ' e ' + b),
    oneOf: (list) => check(list.some((x) => deepEq(x, actual)), 'um de ' + show(list)),
    match: (re) => check(re.test(String(actual)), 'casando com ' + re),
    instanceOf: (C) => check(actual instanceof C, 'instância de ' + (C && C.name)),
    status: (n) => check(actual && actual.code === n, 'com status ' + n),
    header: (k, ...v) => check(actual && actual.headers && actual.headers.has(k) && (!v.length || actual.headers.get(k) === v[0]), 'com header ' + k)
  }
  const alias = { equals: 'equal', eq: 'equal', eqls: 'eql', an: 'a', includes: 'include', contain: 'include', contains: 'include', length: 'lengthOf', gt: 'above', greaterThan: 'above', gte: 'least', lt: 'below', lessThan: 'below', lte: 'most', matches: 'match', instanceof: 'instanceOf', have_property: 'property' }
  for (const [a, b] of Object.entries(alias)) api[a] = api[b]
  for (const w of ['to', 'be', 'been', 'is', 'that', 'which', 'and', 'has', 'have', 'with', 'at', 'of', 'same', 'does', 'still']) Object.defineProperty(api, w, { get: () => api })
  Object.defineProperty(api, 'not', { get: () => { flags.not = !flags.not; return api } })
  Object.defineProperty(api, 'deep', { get: () => { flags.deep = true; return api } })
  const is = { ok: (v) => (v && v === response ? v.code >= 200 && v.code < 300 : !!v), true: (v) => v === true, false: (v) => v === false, null: (v) => v === null, undefined: (v) => v === undefined, exist: (v) => v != null, empty: (v) => v != null && (typeof v === 'object' ? Object.keys(v).length === 0 : v.length === 0), NaN: (v) => Number.isNaN(v) }
  for (const [k, f] of Object.entries(is)) Object.defineProperty(api, k, { get: () => check(f(actual), k === 'ok' ? 'verdadeiro' : k) })
  return api
}

// ---------- request ----------
const R = S.request
const findH = (k) => R.headers.findIndex((h) => h.name.toLowerCase() === String(k).toLowerCase())
const headerArg = (h, v) => typeof h === 'string' ? (v === undefined && h.includes(':') ? { key: h.slice(0, h.indexOf(':')).trim(), value: h.slice(h.indexOf(':') + 1).trim() } : { key: h, value: v }) : { key: h.key ?? h.name, value: h.value }
const reqHeaders = {
  add: (h, v) => { const x = headerArg(h, v); R.headers.push({ name: String(x.key), value: String(x.value ?? ''), enabled: true }) },
  upsert: (h, v) => { const x = headerArg(h, v); const i = findH(x.key); if (i >= 0) R.headers[i] = { name: String(x.key), value: String(x.value ?? ''), enabled: true }; else reqHeaders.add(x) },
  remove: (k) => { R.headers = R.headers.filter((h) => h.name.toLowerCase() !== String(k).toLowerCase()) },
  get: (k) => { const i = findH(k); return i >= 0 ? R.headers[i].value : undefined },
  has: (k) => findH(k) >= 0,
  toObject: () => Object.fromEntries(R.headers.filter((h) => h.enabled).map((h) => [h.name, h.value])),
  all: () => R.headers.map((h) => ({ key: h.name, value: h.value, disabled: !h.enabled })),
  each: (fn) => R.headers.forEach((h) => fn({ key: h.name, value: h.value }))
}
const url = {
  __isUrl: true,
  toString: () => R.url, valueOf: () => R.url, toJSON: () => R.url,
  getHost: () => { const m = /^[a-z]+:\/\/([^/?#]+)/i.exec(R.url); return m ? m[1] : '' },
  getPath: () => R.url.replace(/^[a-z]+:\/\/[^/?#]+/i, '').replace(/[?#].*$/, '') || '/',
  getQueryString: () => R.params.filter((p) => p.enabled).map((p) => encodeURIComponent(p.name) + '=' + encodeURIComponent(p.value)).join('&'),
  addQueryParams: (q) => {
    const list = typeof q === 'string' ? q.split('&').filter(Boolean).map((x) => { const i = x.indexOf('='); return i < 0 ? { key: x, value: '' } : { key: x.slice(0, i), value: x.slice(i + 1) } }) : Array.isArray(q) ? q : Object.entries(q).map(([key, value]) => ({ key, value }))
    for (const x of list) R.params.push({ name: String(x.key ?? x.name), value: String(x.value ?? ''), enabled: true })
  },
  removeQueryParams: (keys) => { const ks = [].concat(keys).map(String); R.params = R.params.filter((p) => !ks.includes(p.name)) }
}
const request = {
  get method() { return R.method }, set method(v) { R.method = String(v).toUpperCase() },
  // como no Insomnia/Postman: objeto com toString (concatenar e comparar com String() funcionam)
  get url() { return url }, set url(v) { R.url = String(v) },
  get name() { return S.where },
  headers: reqHeaders,
  addHeader: reqHeaders.add, setHeader: reqHeaders.upsert, removeHeader: reqHeaders.remove, getHeader: reqHeaders.get,
  params: {
    add: (p, v) => { const x = typeof p === 'string' ? { key: p, value: v } : p; R.params.push({ name: String(x.key ?? x.name), value: String(x.value ?? ''), enabled: true }) },
    remove: (k) => { R.params = R.params.filter((p) => p.name !== k) },
    toObject: () => Object.fromEntries(R.params.filter((p) => p.enabled).map((p) => [p.name, p.value]))
  },
  body: {
    get raw() { return R.body.text ?? '' }, set raw(v) { R.body.text = String(v); if (!R.body.mime) R.body.mime = 'text/plain' },
    get mode() { return R.body.mime ? 'raw' : undefined },
    update: (b) => { if (typeof b === 'string') request.body.raw = b; else if (b && typeof b.raw === 'string') request.body.raw = b.raw },
    toString: () => R.body.text ?? ''
  },
  auth: { get type() { return undefined } }
}

// ---------- response ----------
let response
if (S.response) {
  const P = S.response
  const rh = (k) => { const h = P.headers.find(([n]) => n.toLowerCase() === String(k).toLowerCase()); return h ? h[1] : undefined }
  let parsed
  response = {
    code: P.code, status: P.status, statusText: P.status, responseTime: P.time,
    headers: { get: rh, has: (k) => rh(k) !== undefined, toObject: () => Object.fromEntries(P.headers), all: () => P.headers.map(([key, value]) => ({ key, value })) },
    text: () => P.body,
    json: () => { if (parsed === undefined) { try { parsed = JSON.parse(P.body) } catch (e) { throw new Error('a resposta não é JSON válido') } } return parsed },
    get body() { return P.body }
  }
  response.getStatusCode = () => P.code
  response.getBody = () => P.body
  response.getHeader = rh
  Object.defineProperty(response, 'to', { get: () => expect(response).to })
}

const test = (name, fn) => {
  const done = (ok, e) => tests.push({ name: String(name), ok, error: e ? String(e.message || e) : undefined, where: S.where })
  try {
    const r = fn && fn()
    if (r && typeof r.then === 'function') pending.push(r.then(() => done(true), (e) => done(false, e)))
    else done(true)
  } catch (e) { done(false, e) }
}
test.skip = () => {}

const unsupported = (what) => () => { throw new Error(what + ' não é suportado nos scripts do Zeno') }
const zeno = {
  environment, baseEnvironment, collectionVariables: baseEnvironment, globals: vars({}), variables, iterationData: vars({}),
  request, response, test, expect,
  info: { get eventName() { return S.phase === 'pre' ? 'prerequest' : 'test' }, get requestName() { return S.where } },
  sendRequest: unsupported('sendRequest'), require: unsupported('require')
}
const insomnia = zeno, pm = zeno
`

/** roda um script; nunca lança: erro de script volta em `error` */
export async function runScript(code: string, input: ScriptInput, timeoutMs = SCRIPT_TIMEOUT_MS): Promise<ScriptOutput> {
  const sandbox = Object.create(null) as Record<string, unknown>
  sandbox.__input = JSON.stringify({ ...input, envIsBase: input.env === input.base })
  const ctx = vm.createContext(sandbox, { codeGeneration: { strings: false, wasm: false }, microtaskMode: 'afterEvaluate', name: 'zeno-script' })
  const source = `${BOOTSTRAP}
;(async () => {
  try {
    await (async () => {
${code}
    })()
    await Promise.all(pending)
  } catch (e) {
    S.error = (e && e.name && e.name !== 'Error' ? e.name + ': ' : '') + (e && e.message !== undefined ? e.message : String(e))
  }
  __output = JSON.stringify({ env: S.env, base: S.envIsBase ? S.env : S.base, vars: S.vars, request: S.request, logs, tests, error: S.error })
})()`
  const fail = (error: string): ScriptOutput => ({ env: input.env, base: input.base, vars: input.vars, request: input.request, logs: [], tests: [], error })
  try {
    new vm.Script(source, { filename: `${input.where}.js` }).runInContext(ctx, { timeout: timeoutMs })
  } catch (e) {
    const msg = String((e as Error)?.message ?? e)
    if (/timed out/i.test(msg)) return fail(`passou de ${timeoutMs / 1000} s (laço infinito?)`)
    return fail((e as Error)?.name === 'SyntaxError' ? `erro de sintaxe: ${msg}` : msg)
  }
  const out = sandbox.__output
  if (typeof out !== 'string') return fail('o script não terminou (await em algo que nunca resolve?)')
  try {
    return JSON.parse(out) as ScriptOutput
  } catch {
    return fail('não deu pra ler o resultado do script (valor não serializável em variável?)')
  }
}

export interface PhaseState {
  env: Record<string, unknown>
  base: Record<string, unknown>
  /** o ambiente ativo é o próprio Base (nenhum sub-ambiente escolhido) */
  envIsBase: boolean
  vars: Record<string, unknown>
  request: ScriptRequest
  response?: ScriptResponse
}

/** roda os scripts de uma fase em ordem (pastas de fora pra dentro, depois o request), passando o estado adiante */
export async function runPhase(
  phase: 'pre' | 'post',
  scripts: { where: string; code: string }[],
  state: PhaseState,
  report: { logs: string[]; tests: ScriptTest[]; errors: string[] }
): Promise<{ state: PhaseState; failed: boolean }> {
  let cur = state
  for (const s of scripts) {
    const env = cur.envIsBase ? cur.base : cur.env
    const out = await runScript(s.code, { phase, where: s.where, env, base: cur.base, vars: cur.vars, request: cur.request, response: cur.response })
    // mesmo objeto quando o ativo é o Base: runScript compara por identidade
    report.logs.push(...out.logs.map((l) => (scripts.length > 1 ? `[${s.where}] ${l}` : l)))
    report.tests.push(...out.tests)
    cur = { ...cur, env: cur.envIsBase ? out.base : out.env, base: out.base, vars: out.vars, request: out.request }
    if (out.error) {
      report.errors.push(`${phase === 'pre' ? 'pré-request' : 'pós-resposta'} (${s.where}): ${out.error}`)
      return { state: cur, failed: true }
    }
  }
  return { state: cur, failed: false }
}
