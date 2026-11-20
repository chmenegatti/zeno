import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { convert, readNedbDir } from '../src/main/import-insomnia'
import { prepare } from '../src/shared/prepare'
import { findNode } from '../src/shared/tree'
import type { RequestDoc } from '../src/shared/types'

const { workspaces, warnings } = convert(readNedbDir(path.join(__dirname, 'fixtures')))
const ws = workspaces[0]

describe('import Insomnia (NeDB)', () => {
  it('monta árvore, último registro vence, deletados somem', () => {
    expect(workspaces).toHaveLength(1)
    expect(ws.children.map((n) => n.name)).toEqual(['Criar', 'Itens'])
    const folder = ws.children[1]
    expect(folder.kind === 'folder' && folder.children.map((n) => n.name)).toEqual(['Tag', 'Listar v2'])
  })
  it('converte params, auth, body e ambientes', () => {
    const listar = findNode(ws, 'req_1')!.node as RequestDoc
    expect(listar.params).toEqual([{ name: 'page', value: '1', enabled: true }, { name: 'x', value: 'y', enabled: false }])
    expect(listar.auth).toEqual({ type: 'bearer', token: '{{ _.token }}', prefix: undefined })
    const criar = findNode(ws, 'req_2')!.node as RequestDoc
    expect(criar.body).toEqual({ mime: 'application/json', text: '{"a":1}' })
    expect(ws.environments.map((e) => [e.name, e.parentId])).toEqual([['Base', null], ['Dev', 'env_base']])
  })
  it('avisa o que não converteu', () => {
    expect(warnings.some((w) => w.includes('oauth2'))).toBe(true)
    expect(warnings.some((w) => w.includes('scripts'))).toBe(false)
    // {% uuid %} é do Zeno: sem aviso
    expect(warnings.some((w) => w.includes('{%'))).toBe(false)
  })
  it('prepare resolve com env + vars da pasta', () => {
    const { node, ancestors } = findNode(ws, 'req_1')!
    const p = prepare(ws, node as RequestDoc, ancestors, 'env_dev')
    expect(p.input.url).toBe('https://pasta.local/itens?page=1')
    expect(p.input.headers).toContainEqual(['Authorization', 'Bearer t-dev'])
    const c = prepare(ws, findNode(ws, 'req_2')!.node as RequestDoc, [], null)
    expect(c.input.headers).toContainEqual(['Authorization', `Basic ${Buffer.from('u:p').toString('base64')}`])
    expect(c.input.headers).toContainEqual(['Content-Type', 'application/json'])
  })
})

describe('aviso de template tags', () => {
  const doc = (url: string, extra: Record<string, unknown> = {}) => ({ _id: 'req_t', type: 'Request', parentId: 'wrk_t', name: 'T', method: 'GET', url, ...extra })
  const run = (url: string): string[] =>
    convert([{ _id: 'wrk_t', type: 'Workspace', parentId: null, name: 'W' }, doc(url)] as never).warnings.filter((w) => w.includes('tag'))
  it('tags do Zeno não geram aviso; as outras dizem qual', () => {
    expect(run("https://x/{% uuid 'v4' %}/{% response 'body', 'req_1', '', 'never' %}/{% timestamp 'unix' %}")).toEqual([])
    expect(run("https://x/{% minha_tag 'a' %}/{% outra %}/{% minha_tag 'b' %}")).toEqual(['W / T: usa a tag {% minha_tag %}, {% outra %}, que o Zeno não tem (só com plugin)'])
  })
})
