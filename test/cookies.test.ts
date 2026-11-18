import fs from 'node:fs'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Cookies } from '../src/main/cookies'
import { send, type CookieHooks } from '../src/main/http'
import type { SendInput } from '../src/shared/types'

let server: http.Server
let base = ''
beforeAll(async () => {
  server = http.createServer((req, res) => {
    const u = new URL(req.url ?? '/', 'http://x')
    if (u.pathname === '/login') {
      // login clássico: 302 com cookie de sessão
      res.writeHead(302, { location: '/me', 'set-cookie': ['sid=abc; Path=/; HttpOnly', 'old=1; Path=/; Expires=Thu, 01 Jan 2015 00:00:00 GMT'] })
      return res.end()
    }
    if (u.pathname === '/short') {
      res.writeHead(200, { 'set-cookie': 'tmp=x; Path=/; Max-Age=1' })
      return res.end('ok')
    }
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ method: req.method, cookie: req.headers.cookie ?? null }))
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})
afterAll(() => server.close())

const input = (url: string, method = 'GET', extra: Partial<SendInput> = {}): SendInput => ({ requestId: 'r', method, url, headers: [], body: { kind: 'none' }, insecureTLS: false, timeoutMs: 5000, ...extra })
const hooks = (c: Cookies): CookieHooks => ({ header: (u) => c.header('w', u), store: (u, s) => void c.store('w', u, s) })

describe('cookies', () => {
  it('login com 302 guarda a sessão e as chamadas seguintes mandam sem header manual', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zeno-ck-'))
    const c = new Cookies(dir)
    const r = await send(input(`${base}/login`, 'POST', { body: { kind: 'text', text: 'u=a' }, headers: [['content-type', 'text/plain']] }), hooks(c))
    // redirect seguido como GET, já com o cookie do 302
    expect(JSON.parse(r.body)).toEqual({ method: 'GET', cookie: 'sid=abc' })
    expect(r.url).toBe(`${base}/me`)
    const r2 = await send(input(`${base}/qualquer`, 'GET', { headers: [['Cookie', 'manual=1']] }), hooks(c))
    expect(JSON.parse(r2.body).cookie).toBe('manual=1; sid=abc')
    // expirado não entra; persiste no disco e volta numa instância nova
    expect(c.list('w').map((x) => x.key)).toEqual(['sid'])
    expect(new Cookies(dir).header('w', `${base}/`)).toBe('sid=abc')
  })

  it('cookie que expira some', async () => {
    const c = new Cookies(null)
    await send(input(`${base}/short`), hooks(c))
    expect(c.header('w', `${base}/`)).toBe('tmp=x')
    await new Promise((r) => setTimeout(r, 1100))
    expect(c.header('w', `${base}/`)).toBe('')
    expect(c.list('w')).toEqual([])
  })

  it('sem hooks não manda nem guarda', async () => {
    const r = await send(input(`${base}/login`))
    expect(JSON.parse(r.body).cookie).toBeNull()
  })

  it('editar e limpar pela tela', () => {
    const c = new Cookies(null)
    const list = c.replace('w', [
      { key: 'a', value: '1', domain: 'api.local', path: '/', secure: false, httpOnly: false },
      { key: 'b', value: '2', domain: '.exemplo.com', path: '/v1', secure: true, httpOnly: true, expires: '2999-01-01T00:00:00.000Z' },
      { key: 'velho', value: '3', domain: 'api.local', path: '/', secure: false, httpOnly: false, expires: '2001-01-01T00:00:00.000Z' }
    ])
    expect(list.map((x) => x.key)).toEqual(['a', 'b'])
    expect(c.header('w', 'http://api.local/x')).toBe('a=1')
    expect(c.header('w', 'https://sub.exemplo.com/v1/y')).toBe('b=2')
    expect(c.header('w', 'http://sub.exemplo.com/v1/y')).toBe('')
    c.clear('w')
    expect(c.list('w')).toEqual([])
  })
})
