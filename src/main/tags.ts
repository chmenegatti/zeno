// Tags {% %} compatíveis com Insomnia:
//   {% response 'body'|'raw'|'header'|'url', 'req_id', 'b64::<filtro>'|'<filtro>', 'never'|'no-history'|'when-expired'|'always', maxAgeSeg %}
//   {% uuid 'v4' %}   {% now %}   e as funções de @shared/tagdef (timestamp, faker, hash, base64, file, prompt, jsonpath)
// Filtro de body: JSONPath simples ($.a.b[0]) ou caminho XML (a/b/c).

import { createHash, randomUUID } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import { fake } from '../shared/faker'
import { queryJson } from '../shared/assert'
import { decodeFilter, fnArgs, FN_NAMES, parseArgs, type FnName } from '../shared/tagdef'
import type { TagValues } from '../shared/template'
import type { ResponseRecord } from '../shared/types'

export interface TagContext {
  /** última resposta guardada do request */
  latest(requestId: string): ResponseRecord | undefined
  /** envia o request (com as próprias dependências) e devolve a resposta */
  sendById(requestId: string): Promise<ResponseRecord>
  /** id do request a partir de id ou nome ("Pasta / Nome") */
  resolveRequest?(ref: string): string | undefined
  /** resolve {{ variáveis }} dentro dos argumentos */
  render?(text: string): string
  /** pergunta ao usuário (prompt); null = cancelou */
  prompt?(p: PromptAsk): Promise<string | null>
  /** true = nunca reenvia ({% response %} usa a última resposta, qualquer gatilho): gerar código */
  noSend?: boolean
  /** tag de plugin ({% minha_funcao %}); undefined = nenhum plugin tem */
  plugin?(name: string, args: string[]): Promise<string> | undefined
}

import type { PromptAsk } from '../shared/api'
export type { PromptAsk }

/** usuário cancelou o prompt: o envio para */
export class PromptCancelled extends Error {
  constructor(title: string) {
    super(`envio cancelado (pergunta "${title}" sem resposta)`)
    this.name = 'PromptCancelled'
  }
}

/** funções sem efeito em outros requests: timestamp, faker, hash, base64, file, prompt, jsonpath */
export async function evalFn(tag: FnName, rawArgs: string[], ctx: Pick<TagContext, 'render' | 'prompt'> = {}): Promise<string> {
  const a = fnArgs(tag, rawArgs).map((x) => (ctx.render ? ctx.render(x) : x))
  switch (tag) {
    case 'timestamp':
      return a[0] === 'unix' ? String(Math.floor(Date.now() / 1000)) : a[0] === 'iso' ? new Date().toISOString() : String(Date.now())
    case 'faker':
      return fake(a[0])
    case 'hash': {
      const alg = a[0].toLowerCase()
      if (!['md5', 'sha1', 'sha256', 'sha512'].includes(alg)) throw new Error(`algoritmo "${a[0]}" não suportado`)
      return createHash(alg).update(a[2], 'utf8').digest(a[1] === 'base64' ? 'base64' : 'hex')
    }
    case 'base64': {
      const url = a[1] === 'url'
      if (a[0] === 'decode') return Buffer.from(url ? a[2].replace(/-/g, '+').replace(/_/g, '/') : a[2], 'base64').toString('utf8')
      const out = Buffer.from(a[2], 'utf8').toString('base64')
      return url ? out.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') : out
    }
    case 'file': {
      if (!a[0]) throw new Error('informe o caminho do arquivo')
      const file = a[0].replace(/^~(?=$|[\\/])/, os.homedir())
      return fs.readFileSync(file, 'utf8')
    }
    case 'prompt': {
      const p: PromptAsk = { title: a[0] || 'Valor', label: a[1], defaultValue: a[2], key: a[3], mask: a[4] === 'true' }
      if (!ctx.prompt) throw new Error(`"${p.title}" pergunta na hora de enviar (sem prévia)`)
      const v = await ctx.prompt(p)
      if (v === null) throw new PromptCancelled(p.title)
      return v
    }
    case 'jsonpath': {
      let data: unknown
      try {
        data = JSON.parse(a[0])
      } catch {
        throw new Error('o texto não é JSON válido')
      }
      const v = jsonPath(data, a[1] || '$')
      if (v === undefined) throw new Error(`filtro "${a[1]}" não achou nada`)
      return typeof v === 'string' ? v : JSON.stringify(v)
    }
  }
}

export { parseArgs }

/** filtro de body: JSONPath (mesmo das asserções) */
function jsonPath(data: unknown, path: string): unknown {
  const { values, many } = queryJson(data, path.startsWith('$') ? path : `$.${path}`)
  if (!values.length) return undefined
  return many && values.length > 1 ? values : values[0]
}

/** caminho XML mínimo: a/b/c ou /a/b/c (primeira ocorrência de cada nível) */
function xmlPath(xml: string, path: string): string | undefined {
  let cur = xml
  for (const seg of path.split('/').filter(Boolean)) {
    const m = cur.match(new RegExp(`<${seg}(?:\\s[^>]*)?>([\\s\\S]*?)</${seg}>`))
    if (!m) return undefined
    cur = m[1]
  }
  return cur.trim()
}

export function extract(res: ResponseRecord, field: string, filterRaw: string | undefined): string {
  if (res.error) throw new Error(`request de origem falhou: ${res.error}`)
  if (field === 'url') return res.url
  if (field === 'raw') return res.body
  const filter = decodeFilter(filterRaw)
  if (field === 'header') {
    const h = res.headers.find(([k]) => k.toLowerCase() === filter.toLowerCase())
    if (!h) throw new Error(`header "${filter}" não está na resposta`)
    return h[1]
  }
  if (!filter) return res.body
  let json: unknown
  try {
    json = JSON.parse(res.body)
  } catch {
    json = undefined
  }
  const v = json !== undefined ? jsonPath(json, filter) : xmlPath(res.body, filter)
  if (v === undefined) throw new Error(`filtro "${filter}" não achou nada na resposta`)
  return typeof v === 'string' ? v : JSON.stringify(v)
}

export async function resolveTags(tags: string[], ctx: TagContext): Promise<{ values: TagValues; errors: string[] }> {
  const values: TagValues = new Map()
  const errors: string[] = []
  for (const tag of new Set(tags)) {
    const { name, args } = parseArgs(tag)
    try {
      if (name === 'uuid') values.set(tag, randomUUID())
      else if (name === 'now') values.set(tag, new Date().toISOString())
      else if ((FN_NAMES as string[]).includes(name)) values.set(tag, await evalFn(name as FnName, args, ctx))
      else if (name === 'response') {
        const [field, ref, filter, trigger = 'never', maxAge] = args
        const reqId = ctx.resolveRequest?.(ref) ?? ref
        let res = ctx.latest(reqId)
        const stale = !res || (maxAge && Date.now() - res.at > Number(maxAge) * 1000)
        const mustSend = trigger === 'always' || (trigger === 'no-history' && !res) || (trigger === 'when-expired' && stale)
        if (mustSend && !ctx.noSend) res = await ctx.sendById(reqId)
        if (!res) throw new Error(`request ${reqId} ainda não tem resposta (envie ele antes)`)
        values.set(tag, extract(res, field, filter))
      } else {
        const p = ctx.plugin?.(name, args)
        if (p) values.set(tag, await p)
        else errors.push(`tag "${name}" não suportada`)
      }
    } catch (e) {
      if (e instanceof PromptCancelled) throw e
      errors.push(`${tag.slice(0, 60)}…: ${(e as Error).message}`)
    }
  }
  return { values, errors }
}
