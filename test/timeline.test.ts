import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import http from 'node:http'
import https from 'node:https'
import type { AddressInfo } from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { send } from '../src/main/http'
import type { SendInput } from '../src/shared/types'

let server: http.Server
let base = ''
beforeAll(async () => {
  server = http.createServer((req, res) => {
    if (req.url === '/antigo') {
      res.writeHead(301, { location: '/novo' })
      return res.end()
    }
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ path: req.url, auth: req.headers.authorization ?? null }))
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})
afterAll(() => server.close())

const input = (url: string, extra: Partial<SendInput> = {}): SendInput => ({ requestId: 'r', method: 'GET', url, headers: [], body: { kind: 'none' }, insecureTLS: false, timeoutMs: 5000, ...extra })

describe('linha do tempo', () => {
  it('redirect 301→200 lista os dois saltos com o Authorization enviado', async () => {
    const r = await send(input(`${base}/antigo`, { headers: [['Authorization', 'Bearer tk-123']] }))
    const t = r.timeline!
    expect(t.hops.map((h) => `${h.status} ${new URL(h.url).pathname}`)).toEqual(['301 /antigo', '200 /novo'])
    expect(t.hops[0].requestHead).toMatch(/^GET \/antigo HTTP\/1\.1\r\n/)
    expect(t.hops[0].requestHead).toMatch(/^authorization: Bearer tk-123\r$/im)
    expect(t.hops[1].requestHead).toMatch(/^authorization: Bearer tk-123\r$/im) // mesma origem
    expect(t.hops[0].headers).toContainEqual(['location', '/novo'])
    expect(t.timing.connectMs).toBeGreaterThanOrEqual(0)
    expect(t.timing.totalMs).toBe(r.timing.totalMs)
    expect(t.remote).toMatchObject({ address: '127.0.0.1' })
    expect(t.tls).toBeUndefined()
  })

  it('body enviado aparece', async () => {
    const r = await send(input(`${base}/x`, { method: 'POST', body: { kind: 'form', fields: [['a', '1'], ['b', 'c d']] } }))
    expect(r.timeline!.requestBody).toBe('a=1&b=c+d')
  })

  it('erro de conexão ainda devolve a resposta com erro', async () => {
    const r = await send(input('http://127.0.0.1:1/'))
    expect(r.error).toBeTruthy()
  })

  const hasOpenssl = (() => {
    try {
      execFileSync('openssl', ['version'])
      return true
    } catch {
      return false
    }
  })()

  it.runIf(hasOpenssl)('HTTPS: tempos de TLS e certificado', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zeno-tls-'))
    execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', path.join(dir, 'k.pem'), '-out', path.join(dir, 'c.pem'), '-days', '1', '-subj', '/CN=zeno.test/O=Zeno Teste'], { stdio: 'ignore' })
    const srv = https.createServer({ key: fs.readFileSync(path.join(dir, 'k.pem')), cert: fs.readFileSync(path.join(dir, 'c.pem')) }, (_q, s) => s.end('ok'))
    await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r))
    const url = `https://127.0.0.1:${(srv.address() as AddressInfo).port}/`
    try {
      const bad = await send(input(url))
      expect(bad.error).toBeTruthy()
      const r = await send(input(url, { insecureTLS: true }))
      expect(r.status).toBe(200)
      const tls = r.timeline!.tls!
      expect(tls).toMatchObject({ subject: 'zeno.test', issuer: 'zeno.test', authorized: false })
      expect(tls.protocol).toMatch(/TLS/)
      expect(tls.validTo).toBeTruthy()
      expect(r.timeline!.timing.tlsMs).toBeGreaterThanOrEqual(0)
    } finally {
      srv.close()
    }
  })
})
