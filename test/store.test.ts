import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { Store } from '../src/main/store'
import { convert, readNedbDir } from '../src/main/import-insomnia'
import { findNode } from '../src/shared/tree'
import type { RequestDoc } from '../src/shared/types'

let dir: string
let store: Store
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zeno-'))
  store = new Store(dir)
})

describe('Store', () => {
  it('round-trip do import', () => {
    const { workspaces } = convert(readNedbDir(path.join(__dirname, 'fixtures')))
    store.writeWorkspace(workspaces[0])
    const loaded = store.load()
    expect(loaded).toHaveLength(1)
    expect(JSON.parse(JSON.stringify(loaded[0]))).toEqual(JSON.parse(JSON.stringify(workspaces[0])))
    expect(fs.existsSync(path.join(dir, 'loja', 'itens', 'listar-v2.yaml'))).toBe(true)
  })

  it('cria, renomeia, move, duplica e apaga', () => {
    const [ws] = store.createWorkspace('Meu WS')
    const { id: fid } = store.createFolder(ws.id, 'Pasta A')
    const { id: rid, workspaces } = store.createRequest(ws.id, 'Req')
    const req = findNode(workspaces[0], rid)!.node as RequestDoc
    store.saveRequest({ ...req, name: 'Req Renomeado', url: 'http://x' })
    expect(path.basename(store.pathOf(rid)!)).toBe('req-renomeado.yaml')
    store.moveNode(rid, fid, 1)
    expect(path.dirname(store.pathOf(rid)!)).toBe(store.pathOf(fid))
    const dup = store.duplicate(rid)
    const copy = findNode(dup.workspaces[0], dup.id)!.node as RequestDoc
    expect(copy.url).toBe('http://x')
    expect(copy.name).toBe('Req Renomeado (cópia)')
    const after = store.deleteNode(fid)
    expect(after[0].children).toHaveLength(0)
  })

  it('nome repetido gera arquivo com sufixo', () => {
    const [ws] = store.createWorkspace('W')
    store.createRequest(ws.id, 'Igual')
    store.createRequest(ws.id, 'Igual')
    expect(fs.readdirSync(store.pathOf(ws.id)!).filter((f) => f.endsWith('.yaml')).sort()).toEqual(['igual-2.yaml', 'igual.yaml', 'workspace.yaml'])
  })
})
