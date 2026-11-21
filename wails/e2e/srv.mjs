// Servidor do teste ponta a ponta (make e2e): eco, redirect com cookie, login/token, rota lenta e fixtures de importação.
import http from 'node:http'
import fs from 'node:fs'
import crypto from 'node:crypto'
import { buildSchema, graphqlSync } from 'graphql'
const gqlSchema = buildSchema('type Query { produto(id: ID!): Produto } type Produto { id: ID! nome: String }')
const gqlRoot = { produto: ({ id }) => ({ id, nome: 'Caneta ' + id }) }
const spec = JSON.stringify({ openapi: '3.0.0', info: { title: 'Loja E2E', version: '1' }, servers: [{ url: 'http://127.0.0.1:4777' }], paths: { '/itens': { get: { summary: 'Listar itens', responses: { 200: { description: 'ok' } } } } } })
const server = http.createServer((req, res) => {
  let body = ''
  req.on('data', (c) => (body += c))
  req.on('end', () => {
    const u = new URL(req.url, 'http://x')
    const json = (code, v, h = {}) => { res.writeHead(code, { 'content-type': 'application/json', ...h }); res.end(JSON.stringify(v)) }
    if (u.pathname === '/echo') return json(200, { method: req.method, query: Object.fromEntries(u.searchParams), headers: req.headers, body })
    // aviso de versão nova (#176): formato da API de releases do GitHub
    if (u.pathname === '/gh/latest') return json(200, { tag_name: 'v99.0.0', html_url: 'http://127.0.0.1:4777/gh/v99', draft: false, prerelease: false })
    // Digest (#150): MD5, qop=auth, usuário ana / senha s3nha
    if (u.pathname === '/digest') {
      const md5 = (s) => crypto.createHash('md5').update(s).digest('hex')
      const a = Object.fromEntries([...(req.headers.authorization ?? '').matchAll(/(\w+)="?([^",]*)"?/g)].map((m) => [m[1], m[2]]))
      const ok = a.username === 'ana' && a.response === md5(`${md5('ana:e2e:s3nha')}:n1:${a.nc}:${a.cnonce}:auth:${md5(`${req.method}:${a.uri}`)}`)
      if (ok) return json(200, { digest: 'ok' })
      res.writeHead(401, { 'www-authenticate': 'Digest realm="e2e", nonce="n1", qop="auth"' })
      return res.end()
    }
    if (u.pathname === '/redirect') { res.writeHead(302, { location: '/echo?from=redirect', 'set-cookie': 'sessao=abc123; Path=/' }); return res.end() }
    // OAuth 2.0 client credentials (Basic cliente:segredo)
    if (u.pathname === '/token') return req.headers.authorization === 'Basic ' + Buffer.from('cliente:segredo').toString('base64') && /grant_type=client_credentials/.test(body) ? json(200, { access_token: 'oauth-e2e', token_type: 'Bearer', expires_in: 3600 }) : json(401, { error: 'invalid_client' })
    if (u.pathname === '/graphql') {
      const q = JSON.parse(body || '{}')
      return json(200, graphqlSync({ schema: gqlSchema, rootValue: gqlRoot, source: q.query, variableValues: q.variables, operationName: q.operationName }))
    }
    // SSE: 3 eventos com intervalo, depois fecha
    if (u.pathname === '/sse') {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' })
      let n = 0
      const t = setInterval(() => {
        n++
        res.write(`event: tick\nid: ${n}\ndata: {"n":${n}}\n\n`)
        if (n === 3) (clearInterval(t), res.end())
      }, 150)
      return
    }
    if (u.pathname === '/login') return json(200, { token: 'tk-e2e' })
    if (u.pathname === '/me') return req.headers.authorization === 'Bearer tk-e2e' ? json(200, { nome: 'Ana' }) : json(401, { erro: 'sem token' })
    if (u.pathname === '/slow') return setTimeout(() => json(200, { ok: true }), 3000)
    if (u.pathname.startsWith('/fx/')) { res.writeHead(200); return res.end(fs.readFileSync(new URL('../../test/fixtures/import/', import.meta.url).pathname + u.pathname.slice(4))) }
    if (u.pathname === '/spec.json') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(spec) }
    json(404, {})
  })
})
// WebSocket mínimo (eco de texto) pra /ws: handshake + frames curtos do cliente (mascarados)
server.on('upgrade', (req, sock) => {
  const key = req.headers['sec-websocket-key']
  const accept = crypto.createHash('sha1').update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64')
  sock.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\nX-Auth-Echo: ${req.headers.authorization ?? ''}\r\n\r\n`)
  const frame = (op, payload) => {
    const b = Buffer.from(payload)
    const head = b.length < 126 ? Buffer.from([0x80 | op, b.length]) : Buffer.from([0x80 | op, 126, b.length >> 8, b.length & 255])
    sock.write(Buffer.concat([head, b]))
  }
  let buf = Buffer.alloc(0)
  sock.on('data', (d) => {
    buf = Buffer.concat([buf, d])
    while (buf.length >= 2) {
      const op = buf[0] & 15
      let len = buf[1] & 127, off = 2
      if (len === 126) (len = buf.readUInt16BE(2)), (off = 4)
      if (buf.length < off + 4 + len) return
      const mask = buf.subarray(off, off + 4)
      const data = Buffer.from(buf.subarray(off + 4, off + 4 + len)).map((x, i) => x ^ mask[i % 4])
      buf = buf.subarray(off + 4 + len)
      if (op === 1) frame(1, 'eco: ' + data.toString())
      else if (op === 8) (frame(8, data), sock.end())
      else if (op === 9) frame(10, data)
    }
  })
  sock.on('error', () => {})
})
server.listen(4777, '127.0.0.1', () => console.log('ok'))
