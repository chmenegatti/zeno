import fs from 'node:fs'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Engine } from '../src/main/engine'
import { collect, parseCsv, parseData, runCollection, toJUnit } from '../src/main/runner'
import { runCli } from '../src/main/cli'
import { Store } from '../src/main/store'
import { Vault, type KeyProtector } from '../src/main/vault'
import { noKeyring } from '../src/main/cli'
import { evaluate, queryJson } from '../src/shared/assert'
import { findNode } from '../src/shared/tree'
import type { Assertion, RequestDoc, ResponseRecord, Workspace } from '../src/shared/types'

const fake: KeyProtector = {
  available: async () => ({ ok: true, backend: 'test', weak: false }),
  protect: async (t) => Buffer.from(`P:${t}`),
  unprotect: async (b) => b.toString().slice(2)
}

let server: http.Server
let base = ''

beforeAll(async () => {
  server = http.createServer((req, res) => {
    const json = (code: number, body: unknown): void => {
      res.writeHead(code, { 'content-type': 'application/json', 'x-req': req.url ?? '' })
      res.end(JSON.stringify(body))
    }
    const u = new URL(req.url ?? '/', 'http://x')
    if (u.pathname === '/login') return json(200, { token: 'tk-123' })
    if (u.pathname === '/me') return req.headers.authorization === 'Bearer tk-123' ? json(200, { id: 7, name: 'Ana' }) : json(401, { error: 'sem token' })
    if (u.pathname === '/items') return json(200, { items: [{ id: 1, tag: 'a' }, { id: 2, tag: 'b' }] })
    if (u.pathname === '/echo') return json(200, { q: u.searchParams.get('q') })
    if (u.pathname === '/text') {
      res.writeHead(200, { 'content-type': 'text/plain' })
      return res.end('olá mundo')
    }
    json(404, { error: 'nada' })
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})
afterAll(() => server.close())

const tmp = (): string => fs.mkdtempSync(path.join(os.tmpdir(), 'zeno-run-test-'))

/** workspace com pasta "API" e os requests dados (em ordem) */
function setup(reqs: Partial<RequestDoc>[]): { store: Store; ws: Workspace; folderId: string; engine: Engine; dir: string } {
  const dir = tmp()
  const store = new Store(dir)
  store.load()
  const ws0 = store.createWorkspace('Loja')[0]
  const baseEnv = ws0.environments.find((e) => e.parentId === null)!
  store.saveEnvironment(ws0.id, { ...baseEnv, data: { base_url: base } })
  const folderId = store.createFolder(ws0.id, 'API').id
  reqs.forEach((r, i) => {
    const id = store.createRequest(folderId, r.name ?? `r${i}`, i).id
    const ws = store.list()[0]
    const doc = findNode(ws, id)!.node as RequestDoc
    store.saveRequest({ ...doc, ...r, id, sortKey: i })
  })
  return { store, ws: store.list()[0], folderId, engine: new Engine(store, new Vault(dir, fake)), dir }
}

const a = (source: Assertion['source'], op: Assertion['op'], value?: string, p?: string): Assertion => ({ enabled: true, source, op, value, path: p })

describe('JSONPath e asserções', () => {
  const doc = { a: { b: [{ id: 1 }, { id: 2, deep: { id: 3 } }] }, 'x y': true }
  it('caminhos', () => {
    expect(queryJson(doc, '$.a.b[0].id').values).toEqual([1])
    expect(queryJson(doc, '$.a.b[-1].id').values).toEqual([2])
    expect(queryJson(doc, '$.a.b[*].id')).toEqual({ values: [1, 2], many: true })
    expect(queryJson(doc, '$..id').values).toEqual([1, 2, 3])
    expect(queryJson(doc, "$['x y']").values).toEqual([true])
    expect(queryJson(doc, '$.nada').values).toEqual([])
    // só chaves próprias, nada herdado do protótipo
    expect(queryJson(doc, '$.constructor').values).toEqual([])
    expect(queryJson(doc, '$.a.toString').values).toEqual([])
  })

  const res: ResponseRecord = {
    id: 'r', requestId: 'q', at: 0, method: 'GET', url: 'u', status: 201, statusText: 'Created',
    headers: [['Content-Type', 'application/json; charset=utf-8']], body: '{"user":{"id":7,"tags":["a","b"]},"n":null}',
    bodyEncoding: 'utf8', size: 10, timing: { headersMs: 1, totalMs: 120 }
  }
  it('cada operador', () => {
    const r = evaluate(
      [
        a('status', 'eq', '201'),
        a('status', 'lt', '300'),
        a('header', 'contains', 'json', 'content-type'),
        a('header', 'notExists', undefined, 'x-nada'),
        a('json', 'eq', '7', '$.user.id'),
        a('json', 'eq', '["a","b"]', '$.user.tags'),
        a('json', 'contains', 'b', '$.user.tags'),
        a('json', 'eq', 'null', '$.n'),
        a('json', 'exists', undefined, '$.user'),
        a('body', 'matches', '"id":\\d+'),
        a('time', 'lt', '{{ limite }}'),
        a('status', 'eq', '200'),
        a('json', 'exists', undefined, '$.user.email'),
        { ...a('status', 'eq', '999'), enabled: false }
      ],
      res,
      (s) => s.replace('{{ limite }}', '500')
    )
    expect(r.map((t) => t.ok)).toEqual([true, true, true, true, true, true, true, true, true, true, true, false, false])
    expect(r[11]).toMatchObject({ name: 'status = 200', error: 'valor: 201' })
    expect(r[12]).toMatchObject({ name: '$.user.email existe', error: 'não encontrado' })
  })
  it('JSON inválido vira falha, não exceção', () => {
    const [t] = evaluate([a('json', 'exists', undefined, '$.a')], { ...res, body: '<html>' })
    expect(t).toMatchObject({ ok: false, error: 'resposta não é JSON' })
  })
})

describe('dados CSV/JSON', () => {
  it('CSV com aspas, ; e quebra de linha', () => {
    expect(parseCsv('a,b\n"x, y","com ""aspas"""\n')).toEqual([['a', 'b'], ['x, y', 'com "aspas"'], ['']])
    expect(parseData('nome;idade\r\nAna;30\r\nBia;"4\n0"\r\n')).toEqual([{ nome: 'Ana', idade: '30' }, { nome: 'Bia', idade: '4\n0' }])
    expect(parseData('[{"q":1},{"q":2}]', 'd.json')).toEqual([{ q: 1 }, { q: 2 }])
    expect(() => parseData('[1,2]', 'd.json')).toThrow(/lista de objetos/)
  })
})

describe('executor de coleção', () => {
  it('pasta com 10 requests: token passa adiante e cada asserção aparece', async () => {
    const reqs: Partial<RequestDoc>[] = [
      { name: 'login', method: 'POST', url: '{{ base_url }}/login', scripts: { post: "zeno.environment.set('token', zeno.response.json().token)" }, assertions: [a('status', 'eq', '200'), a('json', 'exists', undefined, '$.token')] },
      { name: 'me', url: '{{ base_url }}/me', auth: { type: 'bearer', token: '{{ token }}' }, assertions: [a('status', 'eq', '200'), a('json', 'eq', 'Ana', '$.name')] },
      { name: 'items', url: '{{ base_url }}/items', assertions: [a('json', 'eq', '[1,2]', '$.items[*].id')] },
      { name: 'texto', url: '{{ base_url }}/text', assertions: [a('body', 'contains', 'mundo'), a('header', 'contains', 'text/plain', 'Content-Type')] },
      { name: 'echo', url: '{{ base_url }}/echo?q=oi', assertions: [a('json', 'eq', 'oi', '$.q')] },
      { name: 'tempo', url: '{{ base_url }}/items', assertions: [a('time', 'lt', '5000')] },
      { name: '404', url: '{{ base_url }}/nada', assertions: [a('status', 'eq', '200')] },
      { name: 'script', url: '{{ base_url }}/items', scripts: { post: "zeno.test('dois itens', () => zeno.expect(zeno.response.json().items).to.have.lengthOf(2))" } },
      { name: 'sem testes', url: '{{ base_url }}/items' },
      { name: 'header', url: '{{ base_url }}/echo', assertions: [a('header', 'eq', '/echo', 'x-req')] }
    ]
    const { store, ws, folderId, engine } = setup(reqs)
    const seen: string[] = []
    const report = await runCollection(engine, store, { wsId: ws.id, folderId, envId: null, iterations: 1, delayMs: 0 }, (s) => seen.push(s.name))
    expect(seen).toEqual(reqs.map((r) => r.name))
    expect(report.steps.map((s) => [s.name, s.status, s.tests.map((t) => t.ok)])).toEqual([
      ['login', 200, [true, true]],
      ['me', 200, [true, true]],
      ['items', 200, [true]],
      ['texto', 200, [true, true]],
      ['echo', 200, [true]],
      ['tempo', 200, [true]],
      ['404', 404, [false]],
      ['script', 200, [true]],
      ['sem testes', 200, []],
      ['header', 200, [true]]
    ])
    expect([report.passed, report.failed]).toEqual([9, 1])
    // token gravado cifrado (nome parece segredo)
    const env = store.list()[0].environments.find((e) => e.parentId === null)!
    expect(String(env.data.token)).toMatch(/^\$zeno\$/)
    expect(env.data.base_url).toBe(base)

    const xml = toJUnit(report)
    expect(xml).toContain('<testsuites name="API" tests="10" failures="1"')
    expect(xml).toContain('<testcase classname="API" name="404"')
    expect(xml).toContain('<failure message="status = 200: valor: 404">')
  })

  it('iterações com dados, atraso, bail e cancelar', async () => {
    const { store, ws, folderId, engine } = setup([
      { name: 'echo', url: '{{ base_url }}/echo?q={{ q }}', assertions: [a('json', 'eq', '{{ esperado }}', '$.q')] },
      { name: 'items', url: '{{ base_url }}/items' }
    ])
    const data = parseData('q,esperado\nx,x\ny,z\n')
    const r = await runCollection(engine, store, { wsId: ws.id, folderId, envId: null, iterations: 1, delayMs: 5, data })
    expect(r.steps.map((s) => `${s.iteration}:${s.name}:${s.tests.map((t) => t.ok).join()}`)).toEqual(['1:echo:true', '1:items:', '2:echo:false', '2:items:'])
    expect(r.steps[2].tests[0].error).toBe('valor: y')

    const bail = await runCollection(engine, store, { wsId: ws.id, folderId, envId: null, iterations: 3, delayMs: 0, data, bail: true })
    expect(bail.steps).toHaveLength(3)

    const handle = { cancelled: false }
    const c = await runCollection(engine, store, { wsId: ws.id, folderId: null, envId: null, iterations: 5, delayMs: 0 }, () => (handle.cancelled = true), handle)
    expect([c.steps.length, c.cancelled]).toEqual([1, true])
  })

  it('ordem segue a árvore', () => {
    const { ws } = setup([{ name: 'b' }, { name: 'a' }])
    expect(collect(ws.children).map((x) => `${x.path}:${x.req.name}`)).toEqual(['API:b', 'API:a'])
  })
})

describe('CLI', () => {
  const capture = () => {
    const lines: string[] = []
    return { lines, out: { log: (s: string) => lines.push(s), err: (s: string) => lines.push(`ERR ${s}`) } }
  }

  it('sai 0 quando tudo passa, 1 quando falha, 2 em erro de uso; grava JUnit', async () => {
    const { dir } = setup([
      { name: 'items', url: '{{ base_url }}/items', assertions: [a('status', 'eq', '200')] },
      { name: 'echo', url: '{{ base_url }}/echo?q={{ q }}', assertions: [a('json', 'eq', 'ok', '$.q')] }
    ])
    const junit = path.join(dir, 'out.xml')
    let c = capture()
    expect(await runCli(['run', 'loja', 'API', '--data-dir', dir, '--var', 'q=ok', '--junit', junit], fake, c.out, false)).toBe(0)
    expect(c.lines.join('\n')).toMatch(/✓ GET +items +200/)
    expect(fs.readFileSync(junit, 'utf8')).toContain('failures="0"')

    c = capture()
    expect(await runCli(['run', 'Loja', '--data-dir', dir, '--var=q=no'], fake, c.out, false)).toBe(1)
    expect(c.lines.join('\n')).toContain('✗ $.q = ok — valor: no')

    for (const bad of [['run'], ['run', 'Nada', '--data-dir', dir], ['run', 'Loja', 'Pasta X', '--data-dir', dir], ['run', 'Loja', '-n', 'abc'], ['voar']]) {
      c = capture()
      expect(await runCli(bad, fake, c.out, false)).toBe(2)
    }
  })

  it('roda direto de uma pasta de workspace (repo) sem tocar na pasta de dados', async () => {
    const { store, ws } = setup([
      { name: 'login', method: 'POST', url: '{{ base_url }}/login', scripts: { post: "zeno.environment.set('token', zeno.response.json().token)" } },
      { name: 'me', url: '{{ base_url }}/me', auth: { type: 'bearer', token: '{{ token }}' }, assertions: [a('status', 'eq', '200')] }
    ])
    const envFile = (): string => fs.readdirSync(path.join(ws.location!.dir, '_env')).map((f) => fs.readFileSync(path.join(ws.location!.dir, '_env', f), 'utf8')).join()
    const before = envFile()
    const c = capture()
    expect(await runCli(['run', ws.location!.dir, 'API'], fake, c.out, false)).toBe(0)
    // token passou de um request pro outro, mas não foi gravado no YAML do repo
    expect(envFile()).toBe(before)
    expect(store.getResponses(collect(ws.children)[0].req.id)).toHaveLength(0)
  })

  it('sem chaveiro: segredo cifrado não aborta; --var supre o valor', async () => {
    const { store, ws, dir } = setup([{ name: 'me', url: '{{ base_url }}/me', auth: { type: 'bearer', token: '{{ token }}' }, assertions: [a('status', 'eq', '200')] }])
    const base = ws.environments.find((e) => e.parentId === null)!
    store.saveEnvironment(ws.id, { ...base, data: { ...base.data, token: await new Vault(dir, fake).encrypt('tk-123') } })
    let c = capture()
    expect(await runCli(['run', 'Loja', '--data-dir', dir, '--var', 'token=tk-123'], noKeyring, c.out, false)).toBe(0)
    c = capture()
    expect(await runCli(['run', 'Loja', '--data-dir', dir], noKeyring, c.out, false)).toBe(1)
    expect(c.lines.join('\n')).toMatch(/segredo cifrado "token" não abriu[\s\S]*variável sem valor: token/)
    // com chaveiro, abre normalmente
    expect(await runCli(['run', 'Loja', '--data-dir', dir], fake, capture().out, false)).toBe(0)
  })
})

describe('linha do tempo e cofre', () => {
  it('segredo do cofre num header personalizado não fica em claro no histórico', async () => {
    const { store, ws, engine, dir } = setup([{ name: 'me', url: '{{ base_url }}/me', headers: [{ name: 'X-Session-Token', value: '{{ sessao }}', enabled: true }] }])
    const base = ws.environments.find((e) => e.parentId === null)!
    store.saveEnvironment(ws.id, { ...base, data: { ...base.data, sessao: await new Vault(dir, fake).encrypt('segredo-xyz-987') } })
    const w = store.list()[0]
    const req = collect(w.children)[0].req
    const r = await engine.execute(w, req, null)
    expect(r.response.timeline!.hops[0].requestHead).toMatch(/x-session-token: •••••• \(cofre\)/i)
    expect(JSON.stringify(store.getResponses(req.id))).not.toContain('segredo-xyz-987')
  })
})

describe('gerar código', () => {
  it('resolve tags com a última resposta, sem reenviar', async () => {
    const { store, engine } = setup([
      { name: 'login', method: 'POST', url: '{{ base_url }}/login' },
      { name: 'me', url: '{{ base_url }}/me', headers: [{ name: 'Authorization', value: "Bearer {% response 'body', 'login', '$.token', 'always' %}", enabled: true }, { name: 'X-Id', value: "{% uuid 'v4' %}", enabled: true }] }
    ])
    const w = store.list()[0]
    const [login, me] = collect(w.children).map((x) => x.req)
    await engine.execute(w, login, null)
    const before = store.getResponses(login.id).length
    const p = await engine.prepareOpen(store.list()[0], me.id, null)
    const h = Object.fromEntries(p.input.headers)
    expect(h.Authorization).toBe('Bearer tk-123')
    expect(h['X-Id']).toMatch(/^[0-9a-f-]{36}$/)
    // 'always' não reenviou: gerar código nunca dispara requests
    expect(store.getResponses(login.id)).toHaveLength(before)
  })
})

