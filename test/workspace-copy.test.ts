import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { Store } from '../src/main/store'
import { cloneWorkspace, findNode } from '../src/shared/tree'
import type { RequestDoc } from '../src/shared/types'

describe('duplicar workspace', () => {
  it('ids novos em tudo, referências trocadas, mesmo conteúdo', () => {
    const store = new Store(fs.mkdtempSync(path.join(os.tmpdir(), 'zeno-copy-')))
    store.load()
    const ws0 = store.createWorkspace('Loja')[0]
    const fld = store.createFolder(ws0.id, 'API').id
    const login = store.createRequest(fld, 'login').id
    const me = store.createRequest(fld, 'me').id
    const ws1 = store.list()[0]
    const meDoc = findNode(ws1, me)!.node as RequestDoc
    store.saveRequest({ ...meDoc, url: `https://x/{% response 'body', '${login}', '', 'never' %}` })
    const ws = store.list()[0]

    const copy = cloneWorkspace(ws, 'Loja (cópia)')
    store.writeWorkspace(copy)
    const list = store.load()
    expect(list.map((w) => w.name).sort()).toEqual(['Loja', 'Loja (cópia)'])
    const c = list.find((w) => w.id === copy.id)!
    const idsOf = (w: typeof c): string[] => [w.id, ...w.environments.map((e) => e.id), ...JSON.stringify(w.children).match(/"id":"[^"]+"/g)!]
    // nenhum id em comum com o original
    expect(idsOf(c).filter((id) => idsOf(ws).includes(id))).toEqual([])
    const cFolder = c.children[0]
    expect(cFolder.kind === 'folder' && cFolder.children.map((n) => n.name)).toEqual(['login', 'me'])
    const cLogin = cFolder.kind === 'folder' ? cFolder.children[0].id : ''
    const cMe = (cFolder.kind === 'folder' ? cFolder.children[1] : null) as RequestDoc
    // a tag aponta pro login da cópia
    expect(cMe.url).toBe(`https://x/{% response 'body', '${cLogin}', '', 'never' %}`)
    // ambientes: mesma quantidade, parentId apontando pro base novo
    expect(c.environments.length).toBe(ws.environments.length)
    expect(c.location?.linked).toBe(false)
  })
})
