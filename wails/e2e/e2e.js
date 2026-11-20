// Teste ponta a ponta da versão Go (#86): roda no app pelos mesmos canais da interface (window.zeno).
// Cofre (chaveiro do sistema) e GitHub (conta) ficam de fora; têm testes próprios.
(async () => {
  const w = (ms) => new Promise((r) => setTimeout(r, ms))
  while (!window.zeno || !document.body.innerText) await w(50)
  await w(1000)
  const z = window.zeno
  const B = 'http://127.0.0.1:4777'
  let pass = 0, fail = 0
  const ok = (name, cond, detail = '') => {
    if (cond) pass++
    else fail++
    console.log((cond ? 'PASS ' : 'FAIL ') + name + (cond ? '' : ' :: ' + detail))
  }
  const safe = async (name, fn) => {
    try {
      await fn()
    } catch (e) {
      ok(name, false, 'exceção ' + e)
    }
  }
  const find = (wss, id) => {
    const walk = (ns) => {
      for (const n of ns) {
        if (n.id === id) return n
        if (n.children) {
          const f = walk(n.children)
          if (f) return f
        }
      }
    }
    for (const ws of wss) {
      const f = walk(ws.children)
      if (f) return f
    }
  }
  let wss = (await z.createWorkspace('E2E'))
  let ws = wss.find((x) => x.name === 'E2E')
  const wsId = ws.id
  const reload = async () => ((wss = (await z.load()).workspaces), (ws = wss.find((x) => x.id === wsId)))
  const base = ws.environments.find((e) => e.parentId === null)
  await z.saveEnvironment(wsId, { ...base, data: { base: B, user: 'ana', token: 'tk-e2e' } })
  await z.saveEnvironment(wsId, { id: 'env_dev_e2e', name: 'Dev', parentId: base.id, data: { user: 'bia' }, sortKey: 1 })
  const fld = await z.createFolder(wsId, 'API')
  await reload()
  const folder = find(wss, fld.id)
  await z.saveFolder({ ...folder, headers: [{ name: 'X-Pasta', value: 'p1', enabled: true }], auth: { type: 'bearer', token: '{{ token }}' } })
  const mk = async (name, patch) => {
    const c = await z.createRequest(fld.id, name)
    await reload()
    const r = { ...find(wss, c.id), ...patch }
    await z.saveRequest(r)
    await reload()
    return find(wss, c.id)
  }
  const send = async (r, env = null) => {
    const res = await z.send(wsId, r, env)
    return { res, rec: res.history[0], body: (() => { try { return JSON.parse(res.history[0].body) } catch { return null } })() }
  }

  await safe('HTTP + variáveis + herança', async () => {
    const r = await mk('eco', { method: 'GET', url: '{{ base }}/echo', params: [{ name: 'q', value: '{{ user }}', enabled: true }] })
    let { body } = await send(r)
    ok('variável do base', body?.query?.q === 'ana', JSON.stringify(body?.query))
    ;({ body } = await send(r, 'env_dev_e2e'))
    ok('sub-ambiente vence o base', body?.query?.q === 'bia', JSON.stringify(body?.query))
    ok('header herdado da pasta', body?.headers?.['x-pasta'] === 'p1')
    ok('auth bearer herdada da pasta', body?.headers?.authorization === 'Bearer tk-e2e', body?.headers?.authorization)
  })
  await safe('bodies', async () => {
    const j = await mk('json', { method: 'POST', url: '{{ base }}/echo', body: { mime: 'application/json', text: '{"nome":"{{ user }}"}' } })
    let { body } = await send(j)
    ok('POST JSON com variável', body?.method === 'POST' && body?.body === '{"nome":"ana"}' && /json/.test(body?.headers?.['content-type']), body?.body)
    const f = await mk('form', { method: 'PUT', url: '{{ base }}/echo', body: { mime: 'application/x-www-form-urlencoded', fields: [{ name: 'a b', value: 'x&y', enabled: true }] } })
    ;({ body } = await send(f))
    ok('PUT form urlencoded', body?.body === 'a+b=x%26y', body?.body)
    const m = await mk('multipart', { method: 'PATCH', url: '{{ base }}/echo', body: { mime: 'multipart/form-data', fields: [{ name: 'campo', value: 'v', enabled: true }, { name: 'arq', value: '', file: '/etc/hostname', enabled: true }] } })
    ;({ body } = await send(m))
    ok('PATCH multipart com arquivo', /name="campo"[\s\S]*v[\s\S]*name="arq"; filename="hostname"/.test(body?.body || ''), (body?.body || '').slice(0, 120))
    const x = await mk('xml', { method: 'POST', url: '{{ base }}/echo', body: { mime: 'application/xml', text: '<a>1</a>' } })
    ;({ body } = await send(x))
    ok('XML', body?.body === '<a>1</a>' && /xml/.test(body?.headers?.['content-type']))
  })
  await safe('auth', async () => {
    const b = await mk('basic', { url: '{{ base }}/echo', auth: { type: 'basic', username: 'ana', password: 's3' } })
    let { body } = await send(b)
    ok('Basic', body?.headers?.authorization === 'Basic ' + btoa('ana:s3'))
    const k = await mk('apikey', { url: '{{ base }}/echo', auth: { type: 'apikey', key: 'api_key', value: 'K1', addTo: 'query' } })
    ;({ body } = await send(k))
    ok('API key na query', body?.query?.api_key === 'K1')
  })
  await safe('OAuth 2.0', async () => {
    const r = await mk('oauth', { url: '{{ base }}/echo', auth: { type: 'oauth2', grantType: 'client_credentials', tokenUrl: '{{ base }}/token', clientId: 'cliente', clientSecret: 'segredo' } })
    const { body } = await send(r)
    ok('OAuth 2.0 client credentials', body?.headers?.authorization === 'Bearer oauth-e2e', body?.headers?.authorization)
    const st = await z.oauthStatus(wsId, r, null)
    ok('token em cache', st && st.valid, JSON.stringify(st))
  })
  await safe('GraphQL', async () => {
    const text = '{\n  "query": "query P($id: ID!) { produto(id: $id) { nome } }",\n  "operationName": "P",\n  "variables": { "id": "{{ user }}" }\n}'
    const r = await mk('graphql', { method: 'POST', url: '{{ base }}/graphql', body: { mime: 'application/graphql', text } })
    const { rec } = await send(r)
    const out = JSON.parse(rec.body || '{}')
    ok('GraphQL com variáveis', out?.data?.produto?.nome === 'Caneta ana', rec.body)
    const intro = await z.graphqlIntrospect(wsId, { ...r, body: { mime: 'application/json', text: JSON.stringify({ query: '{ __schema { queryType { name } } }' }) } }, null, false)
    ok('introspecção sem histórico', JSON.parse(intro.body)?.data?.__schema?.queryType?.name === 'Query' && (await z.responses(r.id)).length === 1, intro.body)
  })
  await safe('exportar', async () => {
    const ins = await z.exportPreview([wsId], 'insomnia', false)
    ok('prévia Insomnia', ins.name === 'E2E.insomnia.json' && ins.size > 500, JSON.stringify(ins))
    const zp = await z.exportPreview([wsId], 'zeno', false)
    ok('prévia zip Zeno', zp.name === 'E2E.zeno.zip' && zp.size > 200, JSON.stringify(zp))
    const pm = await z.exportPreview([wsId], 'postman', false)
    ok('prévia Postman', /^E2E\.postman(\.zip|_collection\.json)$/.test(pm.name) && pm.warnings.length > 0, JSON.stringify(pm))
    ok('status GitHub sem conta', JSON.stringify(await z.githubWsStatus()) === '{}')
  })
  await safe('SSE', async () => {
    const r = await mk('sse', { url: '{{ base }}/sse' })
    const seen = []
    const off = z.onSseEvent((id, e) => id === r.id && seen.push(e))
    const { rec } = await send(r)
    off()
    ok('SSE eventos ao vivo', seen.length === 3 && seen[2].data === '{"n":3}' && seen[0].event === 'tick' && seen[0].atMs < seen[2].atMs, JSON.stringify(seen))
    ok('SSE body no histórico', rec.status === 200 && (rec.body.match(/event: tick/g) || []).length === 3, rec.body)
  })
  await safe('WebSocket', async () => {
    const r = await mk('ws', { url: 'ws://127.0.0.1:4777/ws', auth: { type: 'bearer', token: '{{ token }}' } })
    const evs = []
    const off = z.onWsEvent((e) => e.reqId === r.id && evs.push(e))
    const until = async (f) => { for (let i = 0; i < 50 && !f(); i++) await w(100) }
    await z.wsConnect(wsId, r, null)
    await until(() => evs.some((e) => e.kind === 'open'))
    const open = evs.find((e) => e.kind === 'open')
    ok('WS conecta com auth', open && open.status === 101 && (open.headers || []).some(([k, v]) => /x-auth-echo/i.test(k) && v === 'Bearer tk-e2e'), JSON.stringify(open))
    ok('WS aberto', await z.wsIsOpen(r.id))
    await z.wsSend(wsId, r, null, 'oi {{ user }}')
    await until(() => evs.some((e) => e.kind === 'in'))
    ok('WS eco com variável', evs.some((e) => e.kind === 'out' && e.data === 'oi ana') && evs.some((e) => e.kind === 'in' && e.data === 'eco: oi ana'), JSON.stringify(evs))
    await z.wsClose(r.id)
    await until(() => evs.some((e) => e.kind === 'close'))
    ok('WS fecha', evs.some((e) => e.kind === 'close') && !(await z.wsIsOpen(r.id)), JSON.stringify(evs.at(-1)))
    off()
  })
  await safe('mock server', async () => {
    const u = await mk('usuario', { url: '{{ base }}/echo?u={{ user }}' })
    const { rec } = await send(u)
    const ex = await z.exampleFromResponse(u.id, rec.id)
    ok('exemplo da resposta', ex.status === 200 && ex.body.includes('"method":"GET"') && !ex.headers.some((h) => /content-length|date/i.test(h.name)), JSON.stringify(ex).slice(0, 200))
    await z.saveRequest({ ...find(wss, u.id), examples: [ex, { id: 'ex_e2e', name: 'criado', status: 201, headers: [{ name: 'X-Mock', value: 'sim', enabled: true }], body: '{"id":"novo"}', delayMs: 50, default: true }] })
    await reload()
    await z.saveWorkspace({ id: ws.id, name: ws.name, description: ws.description, settings: { ...ws.settings, mock: { port: 4791 } } })
    await reload()
    const st = await z.mockStart(wsId)
    ok('mock liga', st.running && st.port === 4791 && st.routes.some((r) => r.path === '/echo'), JSON.stringify(st))
    const m = await mk('pelo mock', { url: 'http://127.0.0.1:4791/echo?x=1' })
    const r1 = (await send(m)).rec
    ok('mock responde a rota com o exemplo padrão', r1.status === 201 && r1.body === '{"id":"novo"}' && r1.headers.some(([k, v]) => k.toLowerCase() === 'x-mock' && v === 'sim'), JSON.stringify(r1).slice(0, 300))
    const m2 = await mk('sem rota', { url: 'http://127.0.0.1:4791/nada' })
    ok('mock 404 sem exemplo', (await send(m2)).rec.status === 404)
    const off = await z.mockStop(wsId)
    ok('mock para', !off.running && (await send(m)).rec.status === 0)
  })
  await safe('gRPC', async () => {
    const r = await mk('grpc', { url: 'grpc://127.0.0.1:4778', auth: { type: 'bearer', token: '{{ token }}' }, body: { mime: 'application/json', text: '{"id": "{{ user }}"}' } })
    const svcs = await z.grpcDescribe(wsId, r, null)
    ok('gRPC reflection', svcs.length === 1 && svcs[0].name === 'loja.Loja' && svcs[0].methods.length === 4, JSON.stringify(svcs).slice(0, 200))
    const evs = []
    const off = z.onGrpcEvent((e) => e.reqId === r.id && evs.push(e))
    const until = async (f) => { for (let i = 0; i < 50 && !f(); i++) await w(100) }
    const call = async (method, patch = {}) => {
      evs.length = 0
      const req = { ...r, grpc: { service: 'loja.Loja', method }, ...patch }
      await z.grpcStart(wsId, req, null)
      return req
    }
    await call('ObterProduto')
    await until(() => evs.some((e) => e.kind === 'status'))
    const msg = JSON.parse(evs.find((e) => e.kind === 'message')?.data ?? '{}')
    const st = evs.find((e) => e.kind === 'status')
    ok('gRPC unary com variáveis e auth', msg.nome === 'Caneta ana' && msg.auth === 'Bearer tk-e2e' && st.code === 0 && st.codeName === 'OK', JSON.stringify(evs).slice(0, 400))
    await call('Contar', { body: { mime: 'application/json', text: '{"ate": 3}' } })
    await until(() => evs.some((e) => e.kind === 'status'))
    const ms = evs.filter((e) => e.kind === 'message')
    ok('gRPC server streaming com horário', ms.length === 3 && ms[2].at - ms[0].at >= 150, JSON.stringify(ms.map((m) => m.at)))
    const s = await call('Somar')
    await until(() => evs.some((e) => e.kind === 'start'))
    await z.grpcSend(wsId, s, null, '{"n": 2}')
    await z.grpcSend(wsId, s, null, '{"n": 5}')
    await z.grpcCloseSend(r.id)
    await until(() => evs.some((e) => e.kind === 'status'))
    ok('gRPC client streaming', evs.filter((e) => e.kind === 'sent').length === 2 && /"7"/.test(evs.find((e) => e.kind === 'message')?.data ?? ''), JSON.stringify(evs).slice(0, 400))
    off()
  })
  await safe('redirect e cookies', async () => {
    const r = await mk('redirect', { url: '{{ base }}/redirect' })
    const { body, rec } = await send(r)
    ok('segue redirect', body?.query?.from === 'redirect' && rec.status === 200)
    ok('cookie entre hops', body?.headers?.cookie === 'sessao=abc123', body?.headers?.cookie)
    const ck = await z.cookiesList(wsId)
    ok('jar do workspace', ck.some((c) => c.key === 'sessao' && c.value === 'abc123'))
  })
  await safe('cancelar', async () => {
    const r = await mk('lento', { url: '{{ base }}/slow' })
    const p = send(r)
    await w(300)
    await z.cancel(r.id)
    const { rec } = await p
    ok('cancela envio', !!rec.error && rec.status === 0, rec.error)
  })
  let login
  await safe('scripts, asserções e encadeamento', async () => {
    login = await mk('login', { method: 'POST', url: '{{ base }}/login', auth: { type: 'none' }, scripts: { post: "zeno.environment.set('visto', 'sim'); zeno.test('tem token', () => zeno.expect(zeno.response.json().token).to.equal('tk-e2e'))" } })
    const r1 = await send(login)
    ok('zeno.test', r1.res.scripts?.tests?.some((t) => t.name === 'tem token' && t.ok), JSON.stringify(r1.res.scripts))
    await reload()
    const env = ws.environments.find((e) => e.parentId === null)
    ok('script grava no ambiente', env.data.visto === 'sim', JSON.stringify(env.data))
    const me = await mk('me', { url: '{{ base }}/me', auth: { type: 'bearer', token: "{% response 'body', '" + login.id + "', 'b64::" + btoa('$.token') + "', 'never' %}" }, assertions: [{ enabled: true, source: 'status', op: 'eq', value: '200' }, { enabled: true, source: 'json', path: '$.nome', op: 'eq', value: 'Ana' }, { enabled: true, source: 'header', path: 'content-type', op: 'contains', value: 'json' }] })
    const r2 = await send(me)
    ok('tag {% response %} (body/JSONPath)', r2.rec.status === 200, r2.rec.status)
    ok('asserções status/JSON/header', (r2.res.scripts?.tests || []).length === 3 && r2.res.scripts.tests.every((t) => t.ok), JSON.stringify(r2.res.scripts?.tests))
    const pv = await z.tagPreview("{% uuid 'v4' %}", false)
    ok('função uuid', /^[0-9a-f-]{36}$/.test(pv.value || ''), JSON.stringify(pv))
  })
  await safe('executor', async () => {
    const steps = []
    const off = z.onRunStep((s) => steps.push(s.name))
    const rep = await z.runCollection({ wsId, folderId: fld.id, envId: null, iterations: 1, delayMs: 0, data: [{ user: 'x' }, { user: 'y' }] })
    off()
    ok('executor com dados (2 iterações)', rep.steps.length > 0 && rep.steps.some((s) => s.iteration === 2), rep.steps.length)
    ok('eventos run:step', steps.length === rep.steps.length, steps.length + '/' + rep.steps.length)
  })
  await safe('gerar código', async () => {
    const r = find(wss, (await reload(), wss.find((x) => x.id === wsId).children[0].children.find((c) => c.name === 'json').id))
    const inp = await z.codeInput(wsId, r, null, true)
    ok('request pronto pro código', inp.url === B + '/echo' && inp.body.kind === 'text' && inp.body.text === '{"nome":"ana"}', JSON.stringify(inp).slice(0, 160))
  })
  await safe('organização', async () => {
    const d = await z.duplicate(login.id)
    ok('duplicar', !!find(d.workspaces, d.id))
    let list = await z.moveNode(d.id, wsId, 99)
    ok('mover pra raiz', ws && list.find((x) => x.id === wsId).children.some((c) => c.id === d.id))
    list = await z.deleteNode(d.id)
    ok('excluir', !find(list, d.id))
    const cp = await z.duplicateWorkspace(wsId)
    const copy = cp.workspaces.find((x) => x.id === cp.id)
    ok('duplicar workspace', copy && copy.name === 'E2E (cópia)' && copy.id !== wsId && copy.children.length === ws.children.length, copy && copy.name)
    await z.deleteWorkspace(cp.id)
  })
  await safe('importação', async () => {
    for (const [nome, url] of [['Insomnia v5', B + '/fx/loja.insomnia-v5.yaml'], ['OpenAPI', B + '/fx/loja-openapi.yaml'], ['Postman', B + '/fx/loja.postman_collection.json']]) {
      const pv = await z.importPreview({ url })
      ok('prévia ' + nome, pv && pv.workspaces.length > 0, JSON.stringify(pv).slice(0, 120))
      if (pv) {
        const after = await z.importRun(pv.workspaces.map((x) => x.id), false)
        ok('importa ' + nome, pv.workspaces.every((p) => after.some((a) => a.id === p.id)))
      }
    }
  })
  await safe('git', async () => {
    let st = await z.gitInit(wsId)
    ok('git init', st.repo, JSON.stringify(st).slice(0, 100))
    ok('status lista os YAML', st.files.length > 0)
    st = await z.gitCommit(wsId, 'primeiro')
    ok('commit', st.files.length === 0 && st.repo, JSON.stringify(st.files))
    const r = find(wss, login.id)
    await z.saveRequest({ ...r, url: '{{ base }}/login?v=2' })
    st = await z.gitStatus(wsId)
    const f = st.files[0]
    const diff = f ? await z.gitDiff(wsId, f.path) : ''
    ok('diff por request', /login\?v=2/.test(diff), diff.slice(0, 100))
  })
  await safe('arquivos vivos', async () => {
    let changed = false
    z.onChanged(() => (changed = true))
    console.log('EDITAR-AGORA ' + (await z.load()).dataDir)
    for (let i = 0; i < 60 && !changed; i++) await w(100)
    ok('recarrega quando o YAML muda por fora', changed)
  })
  await safe('plugins e estado', async () => {
    const pl = await z.pluginsList()
    ok('lista de plugins', Array.isArray(pl))
    const st = (await z.load()).state
    await z.setState({ ...st, activeWorkspaceId: wsId })
    ok('estado salvo', (await z.load()).state.activeWorkspaceId === wsId)
  })
  console.log('RESULTADO ' + pass + ' ok, ' + fail + ' falhas')
})()
