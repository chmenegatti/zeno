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
    const { location, ...rest } = loaded[0]
    expect(location).toEqual({ dir: path.join(dir, 'loja'), linked: false })
    expect(JSON.parse(JSON.stringify(rest))).toEqual(JSON.parse(JSON.stringify(workspaces[0])))
    expect(fs.existsSync(path.join(dir, 'loja', 'itens', 'listar-v2.yaml'))).toBe(true)
  })

  it('opções de cookie do request sobrevivem a reabrir; .gitignore na raiz cobre o jar', () => {
    const [ws] = store.createWorkspace('Cookies')
    const { id } = store.createRequest(ws.id, 'Login')
    const req = findNode(store.load()[0], id)!.node as RequestDoc
    store.saveRequest({ ...req, sendCookies: false, storeCookies: false })
    const again = findNode(new Store(dir).load()[0], id)!.node as RequestDoc
    expect([again.sendCookies, again.storeCookies]).toEqual([false, false])
    expect(fs.readFileSync(path.join(dir, '.gitignore'), 'utf8')).toContain('.cookies/')
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

describe('workspaces fora da pasta de dados', () => {
  it('move pra outra pasta, continua aberto e sobrevive a reabrir o Store', () => {
    const [ws] = store.createWorkspace('API')
    store.createRequest(ws.id, 'Listar')
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'zeno-repo-'))
    fs.writeFileSync(path.join(repo, 'README.md'), 'projeto')
    const [moved] = store.moveWorkspace(ws.id, repo)
    // pasta com outros arquivos: cria subpasta com o nome do workspace
    expect(moved.location).toEqual({ dir: path.join(repo, 'api'), linked: true })
    expect(fs.existsSync(path.join(dir, 'api'))).toBe(false)
    expect(fs.existsSync(path.join(repo, 'api', 'listar.yaml'))).toBe(true)
    expect(fs.readFileSync(path.join(repo, 'api', '.gitignore'), 'utf8')).toContain('.vault/')
    const again = new Store(dir).load()
    expect(again.map((w) => w.id)).toEqual([ws.id])
    expect(again[0].children[0].name).toBe('Listar')
  })

  it('vincula pasta existente; remover não apaga os arquivos', () => {
    const other = new Store(fs.mkdtempSync(path.join(os.tmpdir(), 'zeno-b-')))
    const [ws] = other.createWorkspace('Compartilhado')
    const wsPath = ws.location!.dir
    const r = store.linkWorkspace(wsPath)
    expect(r.id).toBe(ws.id)
    expect(() => store.linkWorkspace(wsPath)).toThrow(/já está aberto/)
    store.createRequest(ws.id, 'Novo')
    expect(fs.existsSync(path.join(wsPath, 'novo.yaml'))).toBe(true)
    expect(store.deleteWorkspace(ws.id)).toEqual([])
    expect(fs.existsSync(path.join(wsPath, 'workspace.yaml'))).toBe(true)
  })

  it('recusa mover pra dentro da pasta de dados', () => {
    const [ws] = store.createWorkspace('X')
    expect(() => store.moveWorkspace(ws.id, path.join(dir, 'sub'))).toThrow(/fora da pasta de dados/)
  })
})
