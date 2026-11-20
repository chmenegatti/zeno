// Servidor do teste ponta a ponta (make e2e): eco, redirect com cookie, login/token, rota lenta e fixtures de importação.
import http from 'node:http'
import fs from 'node:fs'
import { buildSchema, graphqlSync } from 'graphql'
const gqlSchema = buildSchema('type Query { produto(id: ID!): Produto } type Produto { id: ID! nome: String }')
const gqlRoot = { produto: ({ id }) => ({ id, nome: 'Caneta ' + id }) }
const spec = JSON.stringify({ openapi: '3.0.0', info: { title: 'Loja E2E', version: '1' }, servers: [{ url: 'http://127.0.0.1:4777' }], paths: { '/itens': { get: { summary: 'Listar itens', responses: { 200: { description: 'ok' } } } } } })
http.createServer((req, res) => {
  let body = ''
  req.on('data', (c) => (body += c))
  req.on('end', () => {
    const u = new URL(req.url, 'http://x')
    const json = (code, v, h = {}) => { res.writeHead(code, { 'content-type': 'application/json', ...h }); res.end(JSON.stringify(v)) }
    if (u.pathname === '/echo') return json(200, { method: req.method, query: Object.fromEntries(u.searchParams), headers: req.headers, body })
    if (u.pathname === '/redirect') { res.writeHead(302, { location: '/echo?from=redirect', 'set-cookie': 'sessao=abc123; Path=/' }); return res.end() }
    // OAuth 2.0 client credentials (Basic cliente:segredo)
    if (u.pathname === '/token') return req.headers.authorization === 'Basic ' + Buffer.from('cliente:segredo').toString('base64') && /grant_type=client_credentials/.test(body) ? json(200, { access_token: 'oauth-e2e', token_type: 'Bearer', expires_in: 3600 }) : json(401, { error: 'invalid_client' })
    if (u.pathname === '/graphql') {
      const q = JSON.parse(body || '{}')
      return json(200, graphqlSync({ schema: gqlSchema, rootValue: gqlRoot, source: q.query, variableValues: q.variables, operationName: q.operationName }))
    }
    if (u.pathname === '/login') return json(200, { token: 'tk-e2e' })
    if (u.pathname === '/me') return req.headers.authorization === 'Bearer tk-e2e' ? json(200, { nome: 'Ana' }) : json(401, { erro: 'sem token' })
    if (u.pathname === '/slow') return setTimeout(() => json(200, { ok: true }), 3000)
    if (u.pathname.startsWith('/fx/')) { res.writeHead(200); return res.end(fs.readFileSync(new URL('../../test/fixtures/import/', import.meta.url).pathname + u.pathname.slice(4))) }
    if (u.pathname === '/spec.json') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(spec) }
    json(404, {})
  })
}).listen(4777, '127.0.0.1', () => console.log('ok'))
