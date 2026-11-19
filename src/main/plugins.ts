// Plugins no formato do Insomnia (templateTags, requestHooks, responseHooks, requestActions) + importers.
// Cada plugin mora em <dataDir>/plugins/<pasta>/ com package.json ("main") e roda num contexto vm próprio:
// require só de módulos sem efeito colateral (crypto, url, buffer…) e de arquivos da própria pasta;
// sem fs, rede ou processos. Chamadas síncronas têm tempo máximo; erro num plugin não derruba o app.

import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { createRequire } from 'node:module'
import type { PluginArg, PluginInfo } from '../shared/types'

export type { PluginArg, PluginInfo }

/** módulos do Node liberados pros plugins */
const ALLOWED = new Set(['crypto', 'url', 'buffer', 'util', 'querystring', 'string_decoder', 'punycode', 'events', 'assert', 'zlib'])
const LOAD_TIMEOUT = 2000
const CALL_TIMEOUT = 5000

/** request que os requestHooks podem mudar (mesma ideia da API do Insomnia) */
export interface HookRequest {
  method: string
  url: string
  headers: [string, string][]
  body?: string
}

export interface HookResponse {
  status: number
  headers: [string, string][]
  body: string
}

type Fn = (...a: unknown[]) => unknown
interface Loaded {
  info: PluginInfo
  ctx: vm.Context
  tags: Map<string, Fn>
  requestHooks: Fn[]
  responseHooks: Fn[]
  actions: Fn[]
  importers: { name: string; detect?: Fn; convert: Fn }[]
}

const str = (v: unknown, max = 200): string | undefined => (typeof v === 'string' ? v.slice(0, max) : undefined)

export class Plugins {
  private loaded: Loaded[] = []

  constructor(
    readonly dir: string | null,
    private isDisabled: (id: string) => boolean = () => false
  ) {}

  /** (re)carrega tudo da pasta; nunca lança */
  load(): PluginInfo[] {
    this.loaded = []
    if (!this.dir || !fs.existsSync(this.dir)) return []
    for (const ent of fs.readdirSync(this.dir, { withFileTypes: true })) {
      if (!ent.isDirectory() || ent.name.startsWith('.')) continue
      this.loaded.push(this.loadOne(path.join(this.dir, ent.name)))
    }
    this.loaded.sort((a, b) => a.info.displayName.localeCompare(b.info.displayName))
    return this.list()
  }

  list(): PluginInfo[] {
    return this.loaded.map((l) => ({ ...l.info, enabled: !l.info.error && !this.isDisabled(l.info.id) }))
  }

  private active(): Loaded[] {
    return this.loaded.filter((l) => !l.info.error && !this.isDisabled(l.info.id))
  }

  private loadOne(dir: string): Loaded {
    const id = path.basename(dir)
    const empty: Loaded = {
      info: { id, name: id, displayName: id, dir, enabled: false, templateTags: [], requestHooks: 0, responseHooks: 0, requestActions: [], importers: [] },
      ctx: vm.createContext({}),
      tags: new Map(),
      requestHooks: [],
      responseHooks: [],
      actions: [],
      importers: []
    }
    try {
      const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'))
      const meta = pkg.insomnia ?? pkg.zeno ?? {}
      empty.info.name = String(pkg.name ?? id)
      empty.info.displayName = String(meta.displayName ?? meta.name ?? pkg.name ?? id)
      empty.info.description = str(meta.description ?? pkg.description, 300)
      empty.info.version = str(pkg.version, 40)
      const main = path.resolve(dir, pkg.main ?? 'index.js')
      if (!main.startsWith(dir + path.sep)) throw new Error('"main" aponta pra fora da pasta do plugin')
      const ctx = vm.createContext({ console: quietConsole(id), setTimeout, clearTimeout, URL, URLSearchParams, TextEncoder, TextDecoder, Buffer, atob, btoa, structuredClone })
      const exp = runModule(main, dir, ctx, new Map())
      const l: Loaded = { ...empty, ctx }
      for (const t of arr(exp.templateTags)) {
        if (!t || typeof t.name !== 'string' || typeof t.run !== 'function') continue
        if (!/^[A-Za-z_]\w*$/.test(t.name)) throw new Error(`templateTag com nome inválido: ${t.name}`)
        l.tags.set(t.name, t.run)
        l.info.templateTags.push({ name: t.name, displayName: str(t.displayName) ?? t.name, description: str(t.description, 300), args: arr(t.args).map(argInfo) })
      }
      l.requestHooks = arr(exp.requestHooks).filter((f) => typeof f === 'function')
      l.responseHooks = arr(exp.responseHooks).filter((f) => typeof f === 'function')
      for (const a of arr(exp.requestActions)) {
        if (!a || typeof a.action !== 'function') continue
        l.actions.push(a.action)
        l.info.requestActions.push({ label: str(a.label) ?? 'Ação', icon: str(a.icon, 8) })
      }
      for (const im of arr(exp.importers)) {
        if (!im || typeof im.convert !== 'function') continue
        l.importers.push({ name: str(im.name) ?? id, detect: typeof im.detect === 'function' ? im.detect : undefined, convert: im.convert })
        l.info.importers.push({ name: str(im.name) ?? id })
      }
      l.info.requestHooks = l.requestHooks.length
      l.info.responseHooks = l.responseHooks.length
      if (!l.tags.size && !l.requestHooks.length && !l.responseHooks.length && !l.actions.length && !l.importers.length)
        throw new Error('o plugin não exporta nada (templateTags, requestHooks, responseHooks, requestActions ou importers)')
      return l
    } catch (e) {
      empty.info.error = (e as Error).message ?? String(e)
      return empty
    }
  }

  /** chama uma função do plugin: parte síncrona com tempo máximo, parte assíncrona com corrida contra o relógio */
  private async call(l: Loaded, fn: Fn, args: unknown[], what: string): Promise<unknown> {
    const g = l.ctx as Record<string, unknown>
    g.__zenoFn = fn
    g.__zenoArgs = args
    let out: unknown
    try {
      out = vm.runInContext('__zenoFn(...__zenoArgs)', l.ctx, { timeout: CALL_TIMEOUT })
    } catch (e) {
      throw new Error(`plugin ${l.info.displayName} (${what}): ${(e as Error).message}`)
    } finally {
      g.__zenoFn = undefined
      g.__zenoArgs = undefined
    }
    if (out && typeof (out as Promise<unknown>).then === 'function') {
      let t: ReturnType<typeof setTimeout> | undefined
      try {
        return await Promise.race([
          out as Promise<unknown>,
          new Promise((_, rej) => (t = setTimeout(() => rej(new Error(`plugin ${l.info.displayName} (${what}): passou de ${CALL_TIMEOUT / 1000} s`)), CALL_TIMEOUT)))
        ])
      } catch (e) {
        const m = (e as Error).message ?? String(e)
        throw new Error(m.startsWith('plugin ') ? m : `plugin ${l.info.displayName} (${what}): ${m}`)
      } finally {
        clearTimeout(t)
      }
    }
    return out
  }

  hasTag(name: string): boolean {
    return this.active().some((l) => l.tags.has(name))
  }

  /** roda {% nome args %}; render resolve {{ variáveis }} nos argumentos (como no Insomnia) */
  async runTag(name: string, args: unknown[], ctx: { render: (s: string) => string; vars: Record<string, unknown> }): Promise<string> {
    const l = this.active().find((x) => x.tags.has(name))
    if (!l) throw new Error(`tag "${name}" não suportada`)
    const context = { util: { render: async (s: string) => ctx.render(String(s)) }, context: structuredClone(ctx.vars), renderPurpose: 'send' }
    // converte pelo tipo declarado (number → Number, boolean → true/false), como o Insomnia
    const spec = l.info.templateTags.find((t) => t.name === name)?.args ?? []
    const typed = args.map((a, i) => coerce(typeof a === 'string' ? ctx.render(a) : a, spec[i]?.type))
    const v = await this.call(l, l.tags.get(name)!, [context, ...typed], `{% ${name} %}`)
    return v === undefined || v === null ? '' : typeof v === 'string' ? v : JSON.stringify(v)
  }

  /** requestHooks de todos os plugins ativos, em ordem; erros viram avisos */
  async beforeSend(req: HookRequest, vars: Record<string, unknown>): Promise<{ req: HookRequest; warnings: string[] }> {
    const warnings: string[] = []
    let cur = req
    for (const l of this.active())
      for (const h of l.requestHooks) {
        const r = mutableRequest(cur, vars)
        try {
          await this.call(l, h, [{ request: r.api }], 'requestHook')
          cur = r.get()
        } catch (e) {
          warnings.push((e as Error).message)
        }
      }
    return { req: cur, warnings }
  }

  async afterResponse(res: HookResponse): Promise<string[]> {
    const warnings: string[] = []
    for (const l of this.active())
      for (const h of l.responseHooks) {
        const header = (n: string): string | undefined => res.headers.find(([k]) => k.toLowerCase() === n.toLowerCase())?.[1]
        const api = { getStatusCode: () => res.status, getHeader: header, getHeaders: () => res.headers.map(([name, value]) => ({ name, value })), getBody: () => Buffer.from(res.body) }
        try {
          await this.call(l, h, [{ response: api }], 'responseHook')
        } catch (e) {
          warnings.push((e as Error).message)
        }
      }
    return warnings
  }

  /** ação do menu do request; devolve as mensagens que o plugin mostrou (app.alert) */
  async runAction(pluginId: string, index: number, request: HookRequest & { name: string }): Promise<{ messages: string[]; clipboard?: string }> {
    const l = this.active().find((x) => x.info.id === pluginId)
    const fn = l?.actions[index]
    if (!l || !fn) throw new Error('ação de plugin não encontrada')
    const messages: string[] = []
    let clipboard: string | undefined
    const context = {
      app: {
        alert: (title: unknown, msg?: unknown) => void messages.push([title, msg].filter((x) => x !== undefined).map(String).join(': ')),
        clipboard: { writeText: (t: unknown) => void (clipboard = String(t)) }
      }
    }
    await this.call(l, fn, [context, { request: structuredClone(request) }], 'requestAction')
    return { messages, clipboard }
  }

  /** importadores de plugin: detect(texto) e convert(texto) → export do Insomnia v4 */
  importers(): { name: string; detect: (text: string) => boolean; convert: (text: string) => unknown }[] {
    return this.active().flatMap((l) =>
      l.importers.map((im) => ({
        name: im.name,
        detect: (text: string) => {
          if (!im.detect) return false
          try {
            return !!syncCall(l, im.detect, [text])
          } catch {
            return false
          }
        },
        convert: (text: string) => syncCall(l, im.convert, [text])
      }))
    )
  }
}

function coerce(v: unknown, type: PluginArg['type'] | undefined): unknown {
  if (type === 'number' && typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v)
  if (type === 'boolean' && typeof v === 'string') return v === 'true' ? true : v === 'false' ? false : v
  return v
}

function syncCall(l: Loaded, fn: Fn, args: unknown[]): unknown {
  const g = l.ctx as Record<string, unknown>
  g.__zenoFn = fn
  g.__zenoArgs = args
  try {
    return vm.runInContext('__zenoFn(...__zenoArgs)', l.ctx, { timeout: CALL_TIMEOUT })
  } finally {
    g.__zenoFn = undefined
    g.__zenoArgs = undefined
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const arr = (v: unknown): any[] => (Array.isArray(v) ? v : [])

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function argInfo(a: any): PluginArg {
  const type = ['string', 'number', 'boolean', 'enum'].includes(a?.type) ? a.type : 'string'
  return {
    displayName: str(typeof a?.displayName === 'string' ? a.displayName : '') || 'Valor',
    type,
    defaultValue: ['string', 'number', 'boolean'].includes(typeof a?.defaultValue) ? a.defaultValue : undefined,
    placeholder: str(a?.placeholder),
    options: type === 'enum' ? arr(a.options).map((o) => ({ displayName: String(o?.displayName ?? o?.value ?? ''), value: String(o?.value ?? '') })) : undefined
  }
}

function quietConsole(id: string): Pick<Console, 'log' | 'warn' | 'error' | 'info'> {
  const out = (...a: unknown[]): void => console.log(`[plugin ${id}]`, ...a)
  return { log: out, info: out, warn: out, error: out }
}

/** executa um arquivo como módulo CommonJS dentro do contexto do plugin */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function runModule(file: string, root: string, ctx: vm.Context, cache: Map<string, any>): any {
  if (cache.has(file)) return cache.get(file).exports
  const mod = { exports: {} as unknown }
  cache.set(file, mod)
  const nodeRequire = createRequire(file)
  const req = (spec: string): unknown => {
    const name = spec.replace(/^node:/, '')
    if (ALLOWED.has(name)) return nodeRequire(name)
    if (spec.startsWith('./') || spec.startsWith('../')) {
      let target = path.resolve(path.dirname(file), spec)
      if (!target.startsWith(root + path.sep)) throw new Error(`require fora da pasta do plugin: ${spec}`)
      if (!fs.existsSync(target) && fs.existsSync(`${target}.js`)) target = `${target}.js`
      else if (fs.existsSync(target) && fs.statSync(target).isDirectory()) target = path.join(target, 'index.js')
      if (target.endsWith('.json')) return JSON.parse(fs.readFileSync(target, 'utf8'))
      return runModule(target, root, ctx, cache)
    }
    throw new Error(`módulo "${spec}" não é permitido em plugins (liberados: ${[...ALLOWED].join(', ')} e arquivos do próprio plugin)`)
  }
  const code = fs.readFileSync(file, 'utf8')
  const wrapper = vm.runInContext(`(function (exports, require, module, __filename, __dirname) {${code}\n})`, ctx, { filename: file, timeout: LOAD_TIMEOUT })
  vm.runInContext('__zenoInit()', Object.assign(ctx, { __zenoInit: () => wrapper(mod.exports, req, mod, file, path.dirname(file)) }), { timeout: LOAD_TIMEOUT })
  ;(ctx as Record<string, unknown>).__zenoInit = undefined
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (mod as any).exports
}

/** request mutável no formato da API de requestHooks do Insomnia */
function mutableRequest(r0: HookRequest, vars: Record<string, unknown>) {
  const r: HookRequest = { ...r0, headers: r0.headers.map(([k, v]) => [k, v] as [string, string]) }
  const find = (n: string): number => r.headers.findIndex(([k]) => k.toLowerCase() === n.toLowerCase())
  const api = {
    getMethod: () => r.method,
    setMethod: (m: unknown) => void (r.method = String(m).toUpperCase()),
    getUrl: () => r.url,
    setUrl: (u: unknown) => void (r.url = String(u)),
    getHeader: (n: string) => (find(n) >= 0 ? r.headers[find(n)][1] : null),
    hasHeader: (n: string) => find(n) >= 0,
    getHeaders: () => r.headers.map(([name, value]) => ({ name, value })),
    setHeader: (n: string, v: unknown) => {
      const i = find(n)
      if (i >= 0) r.headers[i] = [r.headers[i][0], String(v)]
      else r.headers.push([String(n), String(v)])
    },
    addHeader: (n: string, v: unknown) => void r.headers.push([String(n), String(v)]),
    removeHeader: (n: string) => void (r.headers = r.headers.filter(([k]) => k.toLowerCase() !== String(n).toLowerCase())),
    getBody: () => ({ text: r.body ?? '' }),
    setBody: (b: unknown) => void (r.body = typeof b === 'string' ? b : String((b as { text?: unknown })?.text ?? '')),
    getEnvironmentVariable: (n: string) => structuredClone(vars[n]),
    getEnvironment: () => structuredClone(vars)
  }
  return { api, get: () => r }
}
