import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseSources, type Source } from '../src/main/import-sources'
import { Store } from '../src/main/store'
import { prepare } from '../src/shared/prepare'
import { countTree, findNode, walk } from '../src/shared/tree'
import type { Folder, RequestDoc, Workspace } from '../src/shared/types'

const fx = (name: string, url?: string): Source => ({ name, text: fs.readFileSync(path.join(__dirname, 'fixtures', 'import', name), 'utf8'), url })

function req(ws: Workspace, name: string): RequestDoc {
  let found: RequestDoc | undefined
  walk(ws.children, (n) => {
    if (n.kind === 'request' && n.name === name) found = n
  })
  if (!found) throw new Error(`sem request ${name}`)
  return found
}

const folders = (ws: Workspace): string[] => ws.children.filter((n): n is Folder => n.kind === 'folder').map((f) => f.name)

/** envio final, como o main faz: confirma que as variáveis fecham */
function sent(ws: Workspace, r: RequestDoc, envId: string | null = null) {
  return prepare(ws, r, findNode(ws, r.id)!.ancestors, envId)
}

describe('OpenAPI 3', () => {
  const { workspaces, warnings } = parseSources([fx('loja-openapi.yaml')])
  const ws = workspaces[0]

  it('pasta por tag, na ordem das tags; operação sem tag na raiz', () => {
    expect(ws.name).toBe('Loja')
    expect(ws.children.map((n) => n.name)).toEqual(['produtos', 'pedidos', 'Saúde'])
    expect(countTree(ws.children)).toEqual({ folders: 2, requests: 7 })
    expect((ws.children[0] as Folder).description).toBe('Catálogo')
  })

  it('servers[0] vira base_url (com variável do servidor); os outros, sub-ambientes', () => {
    const base = ws.environments.find((e) => e.parentId === null)!
    expect(base.data.base_url).toBe('https://api.loja.test/v1')
    expect(ws.environments.filter((e) => e.parentId).map((e) => [e.name, e.data.base_url])).toEqual([['Local', 'http://localhost:8080/v1']])
  })

  it('path params viram {{ var }} com exemplo no Base; query e header com exemplo', () => {
    const r = req(ws, 'obterProduto')
    expect(r.url).toBe('{{ base_url }}/produtos/{{ id }}')
    expect(ws.environments[0].data.id).toBe('p-1')
    expect(sent(ws, r).input.url).toBe('https://api.loja.test/v1/produtos/p-1')
    const list = req(ws, 'Listar produtos')
    expect(list.params).toEqual([{ name: 'limit', value: '20', enabled: true }])
    expect(list.headers).toEqual([{ name: 'X-Tenant', value: 'acme', enabled: false }])
  })

  it('body de exemplo a partir do schema ($ref, readOnly, enum, recursão) e de examples', () => {
    expect(JSON.parse(req(ws, 'Criar produto').body.text!)).toEqual({ nome: 'Caneta', preco: 3.5, tags: ['string'], categoria: { nome: 'escritorio', pai: null } })
    expect(JSON.parse(req(ws, 'Criar pedido').body.text!)).toEqual({ produto: 'p-1', quantidade: 2 })
    expect(req(ws, 'Enviar foto').body).toEqual({
      mime: 'multipart/form-data',
      fields: [{ name: 'legenda', value: 'Frente', enabled: true }, { name: 'arquivo', value: '', enabled: true, file: '' }]
    })
  })

  it('segurança: global bearer, apiKey por operação, security vazia = sem auth', () => {
    expect(req(ws, 'Listar produtos').auth).toEqual({ type: 'bearer', token: '{{ token }}' })
    expect(req(ws, 'obterProduto').auth).toEqual({ type: 'apikey', key: 'X-API-Key', value: '{{ chave }}', addTo: 'header' })
    expect(req(ws, 'Apagar produto (obsoleto)').auth).toEqual({ type: 'none' })
    expect(ws.environments[0].data).toMatchObject({ token: '', chave: '' })
  })

  it('avisa o que não converteu', () => {
    expect(warnings).toEqual(['Loja / Saúde: parâmetro de cookie "sessao" ignorado'])
  })

  it('id estável: reimportar substitui', () => {
    expect(parseSources([fx('loja-openapi.yaml')]).workspaces[0].id).toBe(ws.id)
    expect(req(parseSources([fx('loja-openapi.yaml')]).workspaces[0], 'Criar produto').id).toBe(req(ws, 'Criar produto').id)
  })

  it('server relativo resolvido pela URL do spec', () => {
    const text = 'openapi: 3.0.0\ninfo: { title: R }\nservers: [{ url: /api/v3 }]\npaths: {}'
    expect(parseSources([{ name: 'r', text, url: 'https://x.test/docs/openapi.yaml' }]).workspaces[0].environments[0].data.base_url).toBe('https://x.test/api/v3')
  })
})

describe('Swagger 2.0', () => {
  const ws = parseSources([fx('loja-swagger.json')]).workspaces[0]
  it('host + basePath, body por definição, formData, query array, basic', () => {
    expect(ws.environments[0].data).toMatchObject({ base_url: 'https://loja.test/api', itemId: '0', username: '', password: '' })
    expect(folders(ws)).toEqual(['itens'])
    const put = req(ws, 'Atualizar item')
    expect(put.url).toBe('{{ base_url }}/itens/{{ itemId }}')
    expect(JSON.parse(put.body.text!)).toEqual({ nome: 'Lápis' })
    expect(put.params).toEqual([{ name: 'status', value: 'ativo', enabled: false }])
    expect(put.auth).toEqual({ type: 'basic', username: '{{ username }}', password: '{{ password }}' })
    expect(req(ws, 'Anexar').body).toEqual({
      mime: 'multipart/form-data',
      fields: [{ name: 'nota', value: '', enabled: true }, { name: 'arquivo', value: '', enabled: true, file: '' }]
    })
  })
})

describe('Postman', () => {
  const { workspaces, warnings } = parseSources([fx('loja.postman_collection.json'), fx('producao.postman_environment.json')])
  const ws = workspaces[0]

  it('pastas, variáveis da coleção no Base e ambiente como sub-ambiente', () => {
    expect(ws.name).toBe('Loja Postman')
    expect(ws.children.map((n) => n.name)).toEqual(['Produtos', 'Upload', 'Login OAuth'])
    expect(ws.environments.map((e) => [e.name, e.parentId === null])).toEqual([['Base', true], ['Produção', false]])
    expect(ws.environments[0].data).toEqual({ baseUrl: 'https://loja.test', id: 'p-1' })
    expect(ws.environments[1].data).toEqual({ baseUrl: 'https://prod.loja.test', token: '' })
  })

  it('variáveis {{x}} preservadas; :id vira {{ id }}; query vira params; {{$guid}} vira tag', () => {
    const r = req(ws, 'Obter produto')
    expect(r.url).toBe('{{baseUrl}}/produtos/{{ id }}')
    expect(r.params.map((p) => [p.name, p.value])).toEqual([['campos', 'nome'], ['x', '{{$randomInt}}']])
    expect(r.headers).toEqual([{ name: 'X-Req', value: "{% uuid 'v4' %}", enabled: true }, { name: 'X-Off', value: '1', enabled: false }])
    expect(sent(ws, r, ws.environments[1].id).input.url).toBe('https://prod.loja.test/produtos/p-1?campos=nome&x=%7B%7B%24randomInt%7D%7D')
  })

  it('auth: coleção desce pro primeiro nível, request sobrepõe, noauth = sem auth', () => {
    expect(ws.children[0].auth).toEqual({ type: 'bearer', token: '{{token}}' })
    expect(req(ws, 'Obter produto').auth).toEqual({ type: 'inherit' })
    expect(req(ws, 'Criar produto').auth).toEqual({ type: 'basic', username: 'ana', password: '{{senha}}' })
    expect(req(ws, 'Upload').auth).toEqual({ type: 'none' })
  })

  it('scripts: coleção vai pro primeiro nível, antes do script do item', () => {
    expect(ws.children[0].scripts).toEqual({ pre: 'console.log(1)' })
    expect(req(ws, 'Obter produto').scripts).toBeUndefined()
  })

  it('body raw JSON e formdata com arquivo', () => {
    expect(req(ws, 'Criar produto').body).toEqual({ mime: 'application/json', text: '{"nome":"Caneta"}' })
    expect(req(ws, 'Upload').body.fields).toEqual([{ name: 'nome', value: 'a', enabled: true }, { name: 'arq', value: '', enabled: true, file: '/tmp/a.png' }])
  })

  it('avisos', () => {
    expect(warnings).toEqual(
      expect.arrayContaining([
        'Loja Postman: scripts da coleção copiados para cada item do primeiro nível',
        'Loja Postman / Produtos / Obter produto: variável dinâmica $randomInt não suportada',
        'Loja Postman / Login OAuth: auth "oauth2" não suportada (ficou sem auth)'
      ])
    )
  })

  it('ambiente sozinho é recusado', () => {
    expect(() => parseSources([fx('producao.postman_environment.json')])).toThrow(/junto com a coleção/)
  })
})

describe('Insomnia v5', () => {
  const { workspaces, warnings } = parseSources([fx('loja.insomnia-v5.yaml')])
  const ws = workspaces[0]
  it('árvore, auth/headers da pasta, ambientes', () => {
    expect(ws.id).toBe('wrk_v5loja')
    expect(ws.children.map((n) => n.name)).toEqual(['Produtos', 'Saúde'])
    const f = ws.children[0] as Folder
    expect(f.headers).toEqual([{ name: 'X-Tenant', value: '{{ _.tenant }}', enabled: true }])
    expect(f.auth).toEqual({ type: 'bearer', token: '{{ _.token }}', prefix: undefined })
    expect(f.children.map((n) => n.name)).toEqual(['Listar', 'Criar'])
    expect(req(ws, 'Criar').body).toEqual({ mime: 'application/json', text: '{"nome": "Caneta"}' })
    expect(ws.environments.map((e) => [e.name, e.parentId])).toEqual([['Base Environment', null], ['Produção', 'env_v5base']])
    expect(warnings).toEqual([])
    expect(req(ws, 'Criar').scripts).toEqual({ pre: 'console.log(1)' })
  })
})

describe('detecção', () => {
  it('formato desconhecido e JSON inválido', () => {
    expect(() => parseSources([{ name: 'x.json', text: '{"a":1}' }])).toThrow(/não reconhecido/)
    expect(() => parseSources([{ name: 'x.yaml', text: 'a: [' }])).toThrow(/não é JSON nem YAML/)
  })

  it('import grava e recarrega igual (round-trip no Store)', () => {
    const all = parseSources([fx('loja-openapi.yaml'), fx('loja-swagger.json'), fx('loja.postman_collection.json'), fx('loja.insomnia-v5.yaml')]).workspaces
    expect(all).toHaveLength(4)
    const store = new Store(fs.mkdtempSync(path.join(os.tmpdir(), 'zeno-imp-')))
    for (const w of all) store.writeWorkspace(w)
    const loaded = store.load()
    for (const w of all) {
      const { location: _l, ...back } = loaded.find((x) => x.id === w.id)!
      expect(JSON.parse(JSON.stringify(back))).toEqual(JSON.parse(JSON.stringify(w)))
    }
  })
})
