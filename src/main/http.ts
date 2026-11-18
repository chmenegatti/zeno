import fs from 'node:fs'
import path from 'node:path'
import dc from 'node:diagnostics_channel'
import type { Socket } from 'node:net'
import type { TLSSocket } from 'node:tls'
import { Agent, buildConnector, fetch, FormData, Headers } from 'undici'
import type { ResponseRecord, SendInput, Timeline } from '../shared/types'

const inflight = new Map<string, AbortController>()

// cabeçalho bruto que o undici escreve no socket; só dos sockets do envio em andamento
const headCapture = new WeakMap<object, (raw: string) => void>()
dc.subscribe('undici:client:sendHeaders', (m) => {
  const { headers, socket } = m as { headers: string; socket: object }
  headCapture.get(socket)?.(headers)
})

interface Conn {
  dnsMs?: number
  connectMs?: number
  tlsMs?: number
  remote?: Timeline['remote']
  tls?: Timeline['tls']
}

/** agente de um envio só: mede DNS, TCP e TLS e lê o certificado de cada conexão */
function tracedAgent(insecure: boolean, onSocket: (s: Socket, c: Conn) => void): Agent {
  const base = buildConnector({ timeout: 15000, rejectUnauthorized: !insecure })
  return new Agent({
    connect: (opts, cb) => {
      const t0 = performance.now()
      const c: Conn = {}
      let tLookup: number | undefined
      let tConnect: number | undefined
      const sock = base(opts, cb) as unknown as Socket
      sock.once('lookup', () => {
        tLookup = performance.now()
        c.dnsMs = Math.round(tLookup - t0)
      })
      sock.once('connect', () => {
        tConnect = performance.now()
        c.connectMs = Math.round(tConnect - (tLookup ?? t0))
        if (sock.remoteAddress) c.remote = { address: sock.remoteAddress, port: sock.remotePort ?? 0 }
      })
      sock.once('secureConnect', () => {
        const t = sock as TLSSocket
        c.tlsMs = Math.round(performance.now() - (tConnect ?? t0))
        const cert = t.getPeerCertificate?.()
        const name = (o: unknown): string | undefined => {
          const x = o as Record<string, string | string[]> | undefined
          const v = x?.CN ?? x?.O
          return Array.isArray(v) ? v.join(', ') : v
        }
        c.tls = {
          protocol: t.getProtocol?.() ?? undefined,
          cipher: t.getCipher?.()?.name,
          authorized: t.authorized,
          error: t.authorizationError ? String(t.authorizationError) : undefined,
          subject: name(cert?.subject),
          issuer: name(cert?.issuer),
          validFrom: cert?.valid_from,
          validTo: cert?.valid_to,
          altNames: cert?.subjectaltname,
          fingerprint: cert?.fingerprint256
        }
      })
      onSocket(sock, c)
      return sock as never
    }
  })
}

/** body enviado em texto pra linha do tempo */
function bodyText(b: SendInput['body']): string | undefined {
  const cut = (t: string): string => (t.length > 65536 ? `${t.slice(0, 65536)}\n… (${t.length - 65536} caracteres a mais)` : t)
  if (b.kind === 'text') return cut(b.text)
  if (b.kind === 'form') return cut(new URLSearchParams(b.fields).toString())
  if (b.kind === 'multipart') return b.fields.map((f) => `--- ${f.name}: ${f.file ? `arquivo ${f.file}` : f.value}`).join('\n')
  return undefined
}

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

  // linha do tempo: conexões abertas por este envio e o cabeçalho bruto de cada salto
  const conns: Conn[] = []
  const hops: Timeline['hops'] = []
  let lastHead: string | undefined
  const agent = tracedAgent(input.insecureTLS, (sock, c) => {
    conns.push(c)
    headCapture.set(sock, (raw) => (lastHead = raw))
  })
  const timeline = (headersMs: number, totalMs: number): Timeline => {
    const first = conns[0] ?? {}
    const setup = (first.dnsMs ?? 0) + (first.connectMs ?? 0) + (first.tlsMs ?? 0)
    return {
      requestBody: bodyText(input.body),
      hops,
      timing: { dnsMs: first.dnsMs, connectMs: first.connectMs, tlsMs: first.tlsMs, ttfbMs: Math.max(0, headersMs - setup), downloadMs: totalMs - headersMs, totalMs },
      remote: conns.at(-1)?.remote,
      tls: conns.find((c) => c.tls)?.tls
    }
  }

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
      lastHead = undefined
      res = await fetch(url, { method, headers, body, redirect: 'manual', signal: ctrl.signal, dispatcher: agent })
      hops.push({ method, url, requestHead: lastHead, status: res.status, statusText: res.statusText, headers: [...res.headers.entries()], atMs: Math.round(performance.now() - t0) })
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
      timing: { headersMs: Math.round(headersMs), totalMs: Math.round(totalMs) },
      timeline: timeline(Math.round(headersMs), Math.round(totalMs))
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
      // falhou no meio (TLS inválido, redirect…): o que deu pra registrar ajuda a entender
      timeline: hops.length || conns.length ? timeline(0, Math.round(performance.now() - t0)) : undefined,
      error: reason ?? ([e.message, cause].filter(Boolean).join(' — ') || 'erro desconhecido')
    }
  } finally {
    agent.close().catch(() => undefined)
    if (timer) clearTimeout(timer)
    if (inflight.get(input.requestId) === ctrl) inflight.delete(input.requestId)
  }
}
