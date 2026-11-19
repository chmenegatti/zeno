// Envio completo de um request: decifra segredos, roda scripts, resolve tags {% response %}, envia, avalia asserções
// e grava o que os scripts mudaram nos ambientes. Sem Electron: usado pelo app, pelo executor de coleção e pela CLI.

import { send } from './http'
import type { Cookies } from './cookies'
import type { Plugins } from './plugins'
import { PromptCancelled, resolveTags, type PromptAsk } from './tags'
import { findRequestRef } from '../shared/tagdef'
import { runPhase, type PhaseState } from './scripts'
import type { Store } from './store'
import type { Vault } from './vault'
import { evaluate } from '../shared/assert'
import { isEncrypted, looksSecret } from '../shared/secret'
import { prepare } from '../shared/prepare'
import { buildVars, render } from '../shared/template'
import { findNode } from '../shared/tree'
import type { Folder, RequestDoc, ResponseRecord, ScriptReport, Workspace } from '../shared/types'
import type { SendResult } from '../shared/api'

export interface EngineHooks {
  /** ambientes gravados pelos scripts */
  onChanged?: (workspaces: Workspace[]) => void
  /** resposta de envio indireto (dependência de {% response %}) */
  onResponse?: (requestId: string, history: ResponseRecord[]) => void
  /** {% prompt %}: pergunta ao usuário; null = cancelou (o envio para) */
  prompt?: (p: PromptAsk) => Promise<string | null>
}

export interface EngineOptions {
  /**
   * false = o que os scripts gravam em ambientes fica só na memória desta execução (CLI): não escreve YAML,
   * nem cifra, nem deixa token em texto puro no disco quando não há chaveiro
   */
  persist?: boolean
  /**
   * true = segredo cifrado que não abre (sem chaveiro, chave de outra máquina) fica sem valor em vez de abortar o envio;
   * a CLI usa pra deixar --var / dados suprirem o valor
   */
  softSecrets?: boolean
  /** cookie jar por workspace (sem = não usa cookies) */
  cookies?: Cookies
  /** plugins (tags, requestHooks, responseHooks) */
  plugins?: Plugins
}

export interface ExecOptions {
  /** variáveis com prioridade máxima (linha de dados do executor de coleção) */
  extraVars?: Record<string, unknown>
  depth?: number
}

const pseudoFolder = (id: string, vars: Record<string, unknown>): Folder => ({ kind: 'folder', id, name: id, sortKey: 0, headers: [], auth: { type: 'inherit' }, vars, children: [] })

export class Engine {
  /** envId -> dados, quando persist=false */
  private overlay = new Map<string, Record<string, unknown>>()

  constructor(
    private store: Store,
    private vault: Vault,
    private hooks: EngineHooks = {},
    private opts: EngineOptions = {}
  ) {}

  private withOverlay(ws: Workspace): Workspace {
    if (!this.overlay.size) return ws
    return { ...ws, environments: ws.environments.map((e) => (this.overlay.has(e.id) ? { ...e, data: this.overlay.get(e.id)! } : e)) }
  }

  /** prepara (resolvendo tags {% response %} que podem disparar outros requests), roda scripts e envia */
  async execute(wsIn: Workspace, reqRaw: RequestDoc, envId: string | null, opts: ExecOptions = {}): Promise<SendResult> {
    const { store, vault } = this
    const wsRaw = this.withOverlay(wsIn)
    const depth = opts.depth ?? 0
    // segredos só são decifrados aqui, e só para o envio
    const locked = new Set<string>()
    let ws: Workspace = { ...wsRaw, environments: await this.open(wsRaw.environments, locked) }
    let req: RequestDoc = await this.open(reqRaw, locked)
    let ancestors: Folder[] = await this.open(findNode(wsRaw, reqRaw.id)?.ancestors ?? [], locked)
    // valores que estavam cifrados no cofre: nunca aparecem em claro na linha do tempo gravada
    const secrets = new Set<string>()
    collectSecrets(wsRaw.environments, ws.environments, secrets)
    collectSecrets(reqRaw, req, secrets)
    collectSecrets(findNode(wsRaw, reqRaw.id)?.ancestors ?? [], ancestors, secrets)
    if (opts.extraVars && Object.keys(opts.extraVars).length) ancestors = [...ancestors, pseudoFolder('_data', opts.extraVars)]
    const report: ScriptReport = { logs: [], tests: [], errors: [] }

    // ---------- scripts: pastas de fora pra dentro, depois o request ----------
    const chain = (phase: 'pre' | 'post') =>
      [...ancestors.map((a) => ({ where: `pasta ${a.name}`, code: a.scripts?.[phase] ?? '' })), { where: req.name, code: req.scripts?.[phase] ?? '' }].filter((x) => x.code.trim())
    const pre = chain('pre')
    const post = chain('post')
    const baseEnv = ws.environments.find((e) => e.parentId === null)
    const subEnv = envId ? ws.environments.find((e) => e.id === envId && e.parentId !== null) : undefined
    let state: PhaseState | null = null
    if (pre.length || post.length) {
      const base = structuredClone(baseEnv?.data ?? {})
      state = {
        base,
        env: subEnv ? structuredClone(subEnv.data) : base,
        envIsBase: !subEnv,
        vars: {},
        request: { method: req.method, url: req.url, headers: structuredClone(req.headers), params: structuredClone(req.params), body: { mime: req.body.mime, text: req.body.text } }
      }
    }
    const before = state && { base: structuredClone(state.base), env: structuredClone(state.env) }
    const withState = (w: Workspace, s: PhaseState): Workspace => ({
      ...w,
      environments: w.environments.map((e) => (e.id === baseEnv?.id ? { ...e, data: s.base } : e.id === subEnv?.id ? { ...e, data: s.env } : e))
    })

    if (state && pre.length) {
      const r = await runPhase('pre', pre, state, report)
      state = r.state
      // o que o script mudou vale pro envio
      ws = withState(ws, state)
      const rq = state.request
      req = { ...req, method: rq.method, url: rq.url, headers: rq.headers, params: rq.params, body: req.body.fields ? req.body : { ...req.body, mime: rq.body.mime, text: rq.body.text } }
      if (Object.keys(state.vars).length) ancestors = [...ancestors, pseudoFolder('_script', state.vars)]
      if (r.failed) {
        await this.persistEnvChanges(wsRaw, baseEnv?.id, subEnv?.id, before!, state)
        const response: ResponseRecord = {
          id: `res_${Date.now().toString(36)}`,
          requestId: reqRaw.id,
          at: Date.now(),
          method: req.method,
          url: req.url,
          status: 0,
          statusText: '',
          headers: [],
          body: '',
          bodyEncoding: 'utf8',
          size: 0,
          timing: { headersMs: 0, totalMs: 0 },
          error: `Não enviado: o script ${report.errors[0]}`
        }
        return { response, history: store.addResponse(response), missing: [], warnings: [], scripts: report }
      }
    }

    let prepared = prepare(ws, req, ancestors, envId)
    const warnings: string[] = []
    if (prepared.unsupported.length) {
      if (depth > 3) warnings.push('cadeia de {% response %} longa demais (máx. 3)')
      else {
        const vars = buildVars(ws, envId, ancestors)
        // mesma pergunta (chave) só uma vez por envio
        const asked = new Map<string, string | null>()
        const prompt = this.hooks.prompt
        let tagResult: Awaited<ReturnType<typeof resolveTags>>
        try {
          tagResult = await resolveTags(prepared.unsupported, {
            resolveRequest: (ref) => findRequestRef(ws.children, ref)?.id ?? store.list().map((w) => findRequestRef(w.children, ref)).find(Boolean)?.id,
            render: (text) => render(text, vars).value,
            plugin: (name, args) => (this.opts.plugins?.hasTag(name) ? this.opts.plugins.runTag(name, args, { render: (t) => render(t, vars).value, vars }) : undefined),
            prompt: prompt
              ? async (p) => {
                  const key = p.key || `${p.title}|${p.label}`
                  if (!asked.has(key)) asked.set(key, await prompt(p))
                  return asked.get(key)!
                }
              : undefined,
            latest: (id) => store.withBody(store.getResponses(id)[0]),
            sendById: async (id) => {
              const dep = store.list().find((w) => findNode(w, id)?.node.kind === 'request')
              const node = dep && findNode(dep, id)?.node
              if (!dep || node?.kind !== 'request') throw new Error(`request ${id} não existe`)
              const depEnv = dep.id === ws.id ? envId : (store.getState().activeEnv[dep.id] ?? null)
              const r = await this.execute(dep, node, depEnv, { depth: depth + 1 })
              this.hooks.onResponse?.(r.response.requestId, r.history)
              return r.response
            }
          })
        } catch (e) {
          if (!(e instanceof PromptCancelled)) throw e
          // cancelou a pergunta: não envia nem grava no histórico
          const response: ResponseRecord = { id: `res_${Date.now().toString(36)}`, requestId: reqRaw.id, at: Date.now(), method: req.method, url: req.url, status: 0, statusText: '', headers: [], body: '', bodyEncoding: 'utf8', size: 0, timing: { headersMs: 0, totalMs: 0 }, error: e.message }
          return { response, history: store.getResponses(reqRaw.id), missing: [], warnings: [], scripts: report }
        }
        const { values, errors } = tagResult
        warnings.push(...errors)
        prepared = prepare(ws, req, ancestors, envId, values)
      }
    }
    warnings.push(...prepared.unsupported.map((t) => `tag não resolvida: ${t}`))
    for (const k of locked) if (!(opts.extraVars && k in opts.extraVars)) warnings.push(`segredo cifrado "${k}" não abriu (sem chaveiro?); passe o valor com --var`)
    const jar = this.opts.cookies
    // requestHooks dos plugins: podem mudar método, URL, headers e body (texto) antes do envio
    const plugins = this.opts.plugins
    if (plugins) {
      const inp = prepared.input
      const hooked = await plugins.beforeSend(
        { method: inp.method, url: inp.url, headers: inp.headers, body: inp.body.kind === 'text' ? inp.body.text : undefined },
        buildVars(ws, envId, ancestors)
      )
      warnings.push(...hooked.warnings)
      const h = hooked.req
      prepared = { ...prepared, input: { ...inp, method: h.method, url: h.url, headers: h.headers, body: inp.body.kind === 'text' && h.body !== undefined ? { kind: 'text', text: h.body } : inp.body } }
    }
    const response = redactTimeline(await send(prepared.input, {
      header: jar && req.sendCookies !== false ? (url) => jar.header(wsRaw.id, url) : undefined,
      store: jar && req.storeCookies !== false ? (url, set) => void jar.store(wsRaw.id, url, set) : undefined
    }), secrets)
    if (plugins && !response.error) warnings.push(...(await plugins.afterResponse({ status: response.status, headers: response.headers, body: response.bodyEncoding === 'utf8' ? response.body : '' })))

    if (state && post.length && !response.error) {
      const r = await runPhase(
        'post',
        post,
        {
          ...state,
          response: {
            code: response.status,
            status: response.statusText,
            headers: response.headers,
            body: response.bodyEncoding === 'utf8' ? response.body : '',
            time: response.timing.totalMs
          }
        },
        report
      )
      state = r.state
    }

    // asserções: depois dos scripts, com as variáveis que eles deixaram
    const assertions = req.assertions?.filter((a) => a.enabled) ?? []
    if (assertions.length && !response.error) {
      const vars = buildVars(state ? withState(ws, state) : ws, envId, state && Object.keys(state.vars).length ? [...ancestors, pseudoFolder('_script', state.vars)] : ancestors)
      report.tests.push(...evaluate(assertions, response, (s) => render(s, vars).value))
    }
    if (state) await this.persistEnvChanges(wsRaw, baseEnv?.id, subEnv?.id, before!, state)

    const history = store.addResponse(response)
    const hasReport = !!state || assertions.length > 0
    return { response, history, missing: prepared.missing, warnings: [...new Set(warnings)], scripts: hasReport ? report : undefined }
  }

  /** decifra segredos; com softSecrets, o que não abre some do objeto (e o nome vai pra `locked`) */
  /** variáveis (base + ambiente) já decifradas, pra prévia de tags; segredo que não abre fica vazio */
  async previewVars(ws: Workspace, envId: string | null): Promise<Record<string, unknown>> {
    const environments = await this.open(ws.environments, new Set<string>())
    return buildVars({ ...ws, environments }, envId, [])
  }

  private async open<T>(value: T, locked: Set<string>): Promise<T> {
    if (!this.opts.softSecrets) return this.vault.decryptDeep(value)
    const walk = async (v: unknown): Promise<unknown> => {
      if (Array.isArray(v)) return Promise.all(v.map(walk))
      if (!v || typeof v !== 'object') return v
      const out: Record<string, unknown> = {}
      for (const [k, x] of Object.entries(v)) {
        if (isEncrypted(x)) {
          try {
            out[k] = await this.vault.decrypt(x)
          } catch {
            // KV: o nome da variável/header é mais útil que "value"
            const name = (v as { name?: unknown }).name
            locked.add(k === 'value' && typeof name === 'string' ? name : k)
          }
        } else out[k] = await walk(x)
      }
      return out
    }
    return (await walk(value)) as T
  }

  /**
   * grava no YAML o que os scripts mudaram nos ambientes. Valor que já era secreto (cifrado) ou cujo nome
   * parece segredo (token, senha…) vai cifrado pro cofre quando dá.
   */
  private async persistEnvChanges(
    wsRaw: Workspace,
    baseId: string | undefined,
    subId: string | undefined,
    before: { base: Record<string, unknown>; env: Record<string, unknown> },
    after: PhaseState
  ): Promise<void> {
    const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b)
    const targets: [string | undefined, Record<string, unknown>, Record<string, unknown>][] = [[baseId, before.base, after.base]]
    if (!after.envIsBase) targets.push([subId, before.env, after.env])
    let changed = false
    for (const [id, old, next] of targets) {
      // relê do disco: num executor de coleção o ambiente pode ter mudado desde que este request começou
      const raw = this.withOverlay(this.store.list().find((w) => w.id === wsRaw.id) ?? wsRaw).environments.find((e) => e.id === id)
      if (!raw || same(old, next)) continue
      const data: Record<string, unknown> = { ...raw.data }
      for (const k of Object.keys(old)) if (!(k in next)) delete data[k]
      for (const [k, v] of Object.entries(next)) {
        if (k in old && same(old[k], v)) continue
        let value = v
        if (this.opts.persist !== false && typeof v === 'string' && v && (isEncrypted(raw.data[k]) || looksSecret(k))) value = await this.vault.encrypt(v).catch(() => v)
        data[k] = value
      }
      if (this.opts.persist === false) {
        this.overlay.set(raw.id, data)
        continue
      }
      this.store.saveEnvironment(wsRaw.id, { ...raw, data })
      changed = true
    }
    if (changed) this.hooks.onChanged?.(this.store.list())
  }
}

/** junta os textos em claro de tudo que estava cifrado (percorre o original e o decifrado em paralelo) */
function collectSecrets(raw: unknown, open: unknown, out: Set<string>): void {
  if (isEncrypted(raw)) {
    if (typeof open === 'string' && open.length >= 3) out.add(open)
    return
  }
  if (Array.isArray(raw) && Array.isArray(open)) raw.forEach((x, i) => collectSecrets(x, open[i], out))
  else if (raw && typeof raw === 'object' && open && typeof open === 'object')
    for (const k of Object.keys(raw)) collectSecrets((raw as Record<string, unknown>)[k], (open as Record<string, unknown>)[k], out)
}

/** troca segredos do cofre por ••• no head e no body enviados (o que vai pro histórico em disco) */
function redactTimeline(res: ResponseRecord, secrets: Set<string>): ResponseRecord {
  if (!res.timeline || !secrets.size) return res
  const list = [...secrets].sort((a, b) => b.length - a.length)
  const hide = (t: string | undefined): string | undefined => (t === undefined ? t : list.reduce((acc, sec) => acc.split(sec).join('•••••• (cofre)'), t))
  return {
    ...res,
    timeline: { ...res.timeline, requestBody: hide(res.timeline.requestBody), hops: res.timeline.hops.map((h) => ({ ...h, requestHead: hide(h.requestHead) })) }
  }
}
