import fs from 'node:fs'
import path from 'node:path'
import { Agent, fetch, FormData, Headers } from 'undici'
import type { ResponseRecord, SendInput } from '../shared/types'

const secureAgent = new Agent({ connect: { timeout: 15000 } })
const insecureAgent = new Agent({ connect: { timeout: 15000, rejectUnauthorized: false } })
const inflight = new Map<string, AbortController>()

const TEXT_RE = /^(text\/|application\/([\w.+-]*\+)?(json|xml|javascript|x-www-form-urlencoded|graphql|yaml|x-yaml)|image\/svg)/i

function isText(contentType: string | undefined, buf: Buffer): boolean {
  if (contentType) return TEXT_RE.test(contentType)
  // sem content-type: heurística, sem bytes nulos nos primeiros 1k
  return !buf.subarray(0, 1024).includes(0)
}

export function cancel(requestId: string): void {
  inflight.get(requestId)?.abort()
}

/** cookie jar do workspace (opcional): header pra URL e guardar Set-Cookie */
export interface CookieHooks {
  header?: (url: string) => string
  store?: (url: string, setCookies: string[]) => void
}

const REDIRECT = new Set([301, 302, 303, 307, 308])
const MAX_REDIRECTS = 10

export async function send(input: SendInput, cookies: CookieHooks = {}): Promise<ResponseRecord> {
  inflight.get(input.requestId)?.abort()
  const ctrl = new AbortController()
  inflight.set(input.requestId, ctrl)
  const timer = input.timeoutMs > 0 ? setTimeout(() => ctrl.abort(new Error(`timeout de ${input.timeoutMs} ms`)), input.timeoutMs) : null

  const base: Omit<ResponseRecord, 'status' | 'statusText' | 'headers' | 'body' | 'bodyEncoding' | 'size' | 'timing'> = {
    id: `res_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`,
    requestId: input.requestId,
    at: Date.now(),
    method: input.method,
    url: input.url
  }
  const t0 = performance.now()

  try {
    const headers = new Headers()
    for (const [k, v] of input.headers) if (k) headers.append(k, v)

    let body: string | URLSearchParams | FormData | undefined
    if (input.body.kind === 'text') body = input.body.text
    else if (input.body.kind === 'form') body = new URLSearchParams(input.body.fields)
    else if (input.body.kind === 'multipart') {
      const fd = new FormData()
      for (const f of input.body.fields) {
        if (f.file) fd.append(f.name, new Blob([fs.readFileSync(f.file)]), path.basename(f.file))
        else fd.append(f.name, f.value)
      }
      body = fd
    }
    if (input.method === 'GET' || input.method === 'HEAD') body = undefined

    // redirects na mão: cada salto guarda/manda cookies (login com 302 + Set-Cookie)
    let url = input.url
    let method = input.method
    let res: Awaited<ReturnType<typeof fetch>>
    let userCookie = headers.get('cookie')
    for (let hop = 0; ; hop++) {
      const jarCookie = cookies.header?.(url) ?? ''
      const cookie = [userCookie, jarCookie].filter(Boolean).join('; ')
      if (cookie) headers.set('cookie', cookie)
      else headers.delete('cookie')
      res = await fetch(url, { method, headers, body, redirect: 'manual', signal: ctrl.signal, dispatcher: input.insecureTLS ? insecureAgent : secureAgent })
      const set = res.headers.getSetCookie()
      if (set.length) cookies.store?.(url, set)
      const loc = res.headers.get('location')
      if (!REDIRECT.has(res.status) || !loc || hop >= MAX_REDIRECTS) break
      await res.body?.cancel()
      const next = new URL(loc, url)
      // origem diferente: não leva credenciais escritas à mão (como o fetch faz)
      if (next.origin !== new URL(url).origin) {
        headers.delete('authorization')
        userCookie = null
      }
      if (res.status === 303 || ((res.status === 301 || res.status === 302) && method === 'POST')) {
        if (method !== 'HEAD') method = 'GET'
        body = undefined
        headers.delete('content-type')
        headers.delete('content-length')
      }
      url = next.toString()
    }
    const headersMs = performance.now() - t0
    const buf = Buffer.from(await res.arrayBuffer())
    const totalMs = performance.now() - t0
    const text = isText(res.headers.get('content-type') ?? undefined, buf)
    return {
      ...base,
      url,
      status: res.status,
      statusText: res.statusText,
      headers: [...res.headers.entries()],
      body: text ? buf.toString('utf8') : buf.toString('base64'),
      bodyEncoding: text ? 'utf8' : 'base64',
      size: buf.length,
      timing: { headersMs: Math.round(headersMs), totalMs: Math.round(totalMs) }
    }
  } catch (err) {
    const e = err as Error & { cause?: Error & { code?: string } }
    const reason = ctrl.signal.aborted ? (ctrl.signal.reason instanceof Error ? ctrl.signal.reason.message : 'cancelado') : null
    const cause = e.cause ? `${e.cause.code ? e.cause.code + ': ' : ''}${e.cause.message}` : ''
    return {
      ...base,
      status: 0,
      statusText: '',
      headers: [],
      body: '',
      bodyEncoding: 'utf8',
      size: 0,
      timing: { headersMs: 0, totalMs: Math.round(performance.now() - t0) },
      error: reason ?? ([e.message, cause].filter(Boolean).join(' — ') || 'erro desconhecido')
    }
  } finally {
    if (timer) clearTimeout(timer)
    if (inflight.get(input.requestId) === ctrl) inflight.delete(input.requestId)
  }
}
