// Persistência em YAML: um diretório por workspace, um diretório por pasta, um arquivo por request.
//
// <dataDir>/<workspace>/workspace.yaml
// <dataDir>/<workspace>/_env/<ambiente>.yaml
// <dataDir>/<workspace>/<pasta>/folder.yaml
// <dataDir>/<workspace>/<pasta>/<request>.yaml
// <dataDir>/.responses/<requestId>.json   (histórico de respostas)
// <dataDir>/state.json                     (estado da UI)

import fs from 'node:fs'
import path from 'node:path'
import YAML from 'yaml'
import type {
  AppState,
  Environment,
  Folder,
  FolderDoc,
  RequestDoc,
  ResponseRecord,
  TreeNode,
  Workspace,
  WorkspaceDoc
} from '../shared/types'
import { findNode, newId, slugify, sortNodes } from '../shared/tree'

const WS_FILE = 'workspace.yaml'
const FOLDER_FILE = 'folder.yaml'
const ENV_DIR = '_env'
const MAX_RESPONSES = 20

type Kind = 'workspace' | 'folder' | 'request' | 'env'
interface IndexEntry {
  kind: Kind
  path: string
  wsId: string
}

export function defaultDataDir(): string {
  if (process.env.ZENO_DATA_DIR) return process.env.ZENO_DATA_DIR
  const base = process.env.XDG_DATA_HOME || path.join(process.env.HOME || '.', '.local', 'share')
  return path.join(base, 'zeno')
}

function readYaml<T>(file: string): T | null {
  try {
    return YAML.parse(fs.readFileSync(file, 'utf8')) as T
  } catch {
    return null
  }
}

function kvList(v: unknown): RequestDoc['headers'] {
  if (!Array.isArray(v)) return []
  return v.map((x) => ({ name: String(x?.name ?? ''), value: String(x?.value ?? ''), enabled: x?.enabled !== false }))
}

function normRequest(raw: Partial<RequestDoc>, fallbackName: string): RequestDoc {
  return {
    kind: 'request',
    id: raw.id || newId('req'),
    name: raw.name || fallbackName,
    description: raw.description || undefined,
    method: (raw.method || 'GET').toUpperCase(),
    url: raw.url || '',
    params: kvList(raw.params),
    headers: kvList(raw.headers),
    body: raw.body && typeof raw.body === 'object' ? { mime: raw.body.mime ?? null, text: raw.body.text, fields: raw.body.fields } : { mime: null },
    auth: raw.auth && typeof raw.auth === 'object' && 'type' in raw.auth ? raw.auth : { type: 'inherit' },
    sortKey: Number(raw.sortKey ?? 0)
  }
}

function normFolder(raw: Partial<FolderDoc>, fallbackName: string): Folder {
  return {
    kind: 'folder',
    id: raw.id || newId('fld'),
    name: raw.name || fallbackName,
    description: raw.description || undefined,
    sortKey: Number(raw.sortKey ?? 0),
    headers: kvList(raw.headers),
    auth: raw.auth && typeof raw.auth === 'object' && 'type' in raw.auth ? raw.auth : { type: 'inherit' },
    vars: raw.vars && typeof raw.vars === 'object' ? raw.vars : {},
    children: []
  }
}

function requestToYaml(r: RequestDoc): object {
  const { kind: _k, ...rest } = r
  return stripEmpty(rest)
}

function folderToYaml(f: FolderDoc | Folder): object {
  const { kind: _k, children: _c, ...rest } = f as Folder
  return stripEmpty(rest)
}

function stripEmpty<T extends object>(o: T): T {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(o)) if (v !== undefined && v !== '') out[k] = v
  return out as T
}

export class Store {
  readonly dir: string
  /** timestamp da última escrita própria (pra ignorar no watcher) */
  lastWrite = 0
  private index = new Map<string, IndexEntry>()
  private workspaces: Workspace[] = []

  constructor(dir = defaultDataDir()) {
    this.dir = dir
    fs.mkdirSync(dir, { recursive: true })
  }

  // ---------- leitura ----------

  load(): Workspace[] {
    this.index.clear()
    const out: Workspace[] = []
    for (const ent of fs.readdirSync(this.dir, { withFileTypes: true })) {
      if (!ent.isDirectory() || ent.name.startsWith('.')) continue
      const wsDir = path.join(this.dir, ent.name)
      const doc = readYaml<Partial<WorkspaceDoc>>(path.join(wsDir, WS_FILE))
      if (!doc) continue
      const ws: Workspace = {
        id: doc.id || newId('wrk'),
        name: doc.name || ent.name,
        description: doc.description || undefined,
        settings: { insecureTLS: !!doc.settings?.insecureTLS, timeoutMs: Number(doc.settings?.timeoutMs ?? 30000) },
        environments: [],
        children: []
      }
      this.index.set(ws.id, { kind: 'workspace', path: wsDir, wsId: ws.id })
      ws.environments = this.loadEnvs(wsDir, ws.id)
      ws.children = this.loadDir(wsDir, ws.id)
      out.push(ws)
    }
    out.sort((a, b) => a.name.localeCompare(b.name))
    this.workspaces = out
    return out
  }

  private loadEnvs(wsDir: string, wsId: string): Environment[] {
    const envDir = path.join(wsDir, ENV_DIR)
    if (!fs.existsSync(envDir)) return []
    const envs: Environment[] = []
    for (const f of fs.readdirSync(envDir)) {
      if (!f.endsWith('.yaml')) continue
      const file = path.join(envDir, f)
      const raw = readYaml<Partial<Environment>>(file)
      if (!raw) continue
      const env: Environment = {
        id: raw.id || newId('env'),
        name: raw.name || f.replace(/\.yaml$/, ''),
        parentId: raw.parentId ?? null,
        color: raw.color || undefined,
        data: raw.data && typeof raw.data === 'object' ? raw.data : {},
        sortKey: Number(raw.sortKey ?? 0)
      }
      this.index.set(env.id, { kind: 'env', path: file, wsId })
      envs.push(env)
    }
    return sortNodes(envs)
  }

  private loadDir(dir: string, wsId: string): TreeNode[] {
    const nodes: TreeNode[] = []
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, ent.name)
      if (ent.isDirectory()) {
        if (ent.name === ENV_DIR || ent.name.startsWith('.')) continue
        const folder = normFolder(readYaml<Partial<FolderDoc>>(path.join(p, FOLDER_FILE)) ?? {}, ent.name)
        this.index.set(folder.id, { kind: 'folder', path: p, wsId })
        folder.children = this.loadDir(p, wsId)
        nodes.push(folder)
      } else if (ent.name.endsWith('.yaml') && ent.name !== FOLDER_FILE && ent.name !== WS_FILE) {
        const raw = readYaml<Partial<RequestDoc>>(p)
        if (!raw) continue
        const req = normRequest(raw, ent.name.replace(/\.yaml$/, ''))
        this.index.set(req.id, { kind: 'request', path: p, wsId })
        nodes.push(req)
      }
    }
    return sortNodes(nodes)
  }

  list(): Workspace[] {
    return this.workspaces
  }

  pathOf(id: string): string | undefined {
    return this.index.get(id)?.path
  }

  // ---------- helpers de escrita ----------

  private write(file: string, data: object): void {
    this.lastWrite = Date.now()
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, YAML.stringify(data, { lineWidth: 0 }))
  }

  private touch(): void {
    this.lastWrite = Date.now()
  }

  /** caminho livre dentro de dir: slug, slug-2, slug-3... */
  private uniquePath(dir: string, name: string, ext: '' | '.yaml', reserved: string[] = []): string {
    const slug = slugify(name)
    const bad = new Set([ENV_DIR, 'folder', 'workspace', ...reserved])
    for (let i = 1; ; i++) {
      const base = i === 1 && !bad.has(slug) ? slug : `${slug}-${i}`
      const p = path.join(dir, base + ext)
      if (!fs.existsSync(p)) return p
    }
  }

  private dirOfParent(parentId: string): string {
    const e = this.index.get(parentId)
    if (!e || (e.kind !== 'workspace' && e.kind !== 'folder')) throw new Error(`pai inválido: ${parentId}`)
    return e.path
  }

  private wsOf(id: string): Workspace {
    const e = this.index.get(id)
    const ws = e && this.workspaces.find((w) => w.id === e.wsId)
    if (!ws) throw new Error(`workspace não encontrado para ${id}`)
    return ws
  }

  // ---------- workspaces ----------

  createWorkspace(name: string): Workspace[] {
    const dir = this.uniquePath(this.dir, name, '')
    const doc: WorkspaceDoc = { id: newId('wrk'), name, settings: { insecureTLS: false, timeoutMs: 30000 } }
    this.write(path.join(dir, WS_FILE), doc)
    const base: Environment = { id: newId('env'), name: 'Base', parentId: null, data: {}, sortKey: 0 }
    this.write(path.join(dir, ENV_DIR, 'base.yaml'), base)
    return this.load()
  }

  saveWorkspace(doc: WorkspaceDoc): void {
    const e = this.index.get(doc.id)
    if (!e) throw new Error('workspace não encontrado')
    const { id, name, description, settings } = doc
    this.write(path.join(e.path, WS_FILE), stripEmpty({ id, name, description, settings }))
    const ws = this.workspaces.find((w) => w.id === doc.id)
    if (ws) Object.assign(ws, { name, description, settings })
  }

  deleteWorkspace(id: string): Workspace[] {
    const e = this.index.get(id)
    if (e?.kind === 'workspace') {
      this.touch()
      fs.rmSync(e.path, { recursive: true, force: true })
    }
    return this.load()
  }

  /** grava workspace inteiro (import). Substitui o existente com mesmo id. */
  writeWorkspace(ws: Workspace): void {
    const existing = this.index.get(ws.id)
    if (existing?.kind === 'workspace') {
      this.touch()
      fs.rmSync(existing.path, { recursive: true, force: true })
    }
    const dir = this.uniquePath(this.dir, ws.name, '')
    const { id, name, description, settings } = ws
    this.write(path.join(dir, WS_FILE), stripEmpty({ id, name, description, settings }))
    for (const env of ws.environments) this.write(this.uniquePath(path.join(dir, ENV_DIR), env.name, '.yaml'), stripEmpty(env))
    this.writeNodes(dir, ws.children)
  }

  private writeNodes(dir: string, nodes: TreeNode[]): void {
    for (const n of nodes) {
      if (n.kind === 'folder') {
        const fdir = this.uniquePath(dir, n.name, '')
        this.write(path.join(fdir, FOLDER_FILE), folderToYaml(n))
        this.writeNodes(fdir, n.children)
      } else {
        this.write(this.uniquePath(dir, n.name, '.yaml'), requestToYaml(n))
      }
    }
  }

  // ---------- pastas e requests ----------

  createRequest(parentId: string, name: string, sortKey = Date.now()): { workspaces: Workspace[]; id: string } {
    const dir = this.dirOfParent(parentId)
    const req = normRequest({ name, sortKey }, name)
    this.write(this.uniquePath(dir, name, '.yaml'), requestToYaml(req))
    return { workspaces: this.load(), id: req.id }
  }

  createFolder(parentId: string, name: string, sortKey = Date.now()): { workspaces: Workspace[]; id: string } {
    const dir = this.dirOfParent(parentId)
    const folder = normFolder({ name, sortKey }, name)
    this.write(path.join(this.uniquePath(dir, name, ''), FOLDER_FILE), folderToYaml(folder))
    return { workspaces: this.load(), id: folder.id }
  }

  /** salva request; se o nome mudou, renomeia o arquivo. */
  saveRequest(req: RequestDoc): void {
    const e = this.index.get(req.id)
    if (!e || e.kind !== 'request') throw new Error('request não encontrado')
    let file = e.path
    if (!sameSlug(path.basename(file, '.yaml'), req.name)) {
      const next = this.uniquePath(path.dirname(file), req.name, '.yaml')
      this.touch()
      fs.renameSync(file, next)
      file = next
      e.path = next
    }
    this.write(file, requestToYaml(req))
    const found = this.workspaces.length ? findNode(this.wsOf(req.id), req.id) : null
    if (found) Object.assign(found.node, req)
  }

  saveFolder(doc: FolderDoc): void {
    const e = this.index.get(doc.id)
    if (!e || e.kind !== 'folder') throw new Error('pasta não encontrada')
    if (!sameSlug(path.basename(e.path), doc.name)) {
      const next = this.uniquePath(path.dirname(e.path), doc.name, '')
      this.touch()
      fs.renameSync(e.path, next)
      // filhos mudaram de caminho: reindexa
      this.write(path.join(next, FOLDER_FILE), folderToYaml(doc))
      this.load()
      return
    }
    this.write(path.join(e.path, FOLDER_FILE), folderToYaml(doc))
    const found = findNode(this.wsOf(doc.id), doc.id)
    if (found) {
      const { children: _c, ...rest } = doc as Folder
      Object.assign(found.node, rest)
    }
  }

  deleteNode(id: string): Workspace[] {
    const e = this.index.get(id)
    if (e && (e.kind === 'request' || e.kind === 'folder')) {
      this.touch()
      fs.rmSync(e.path, { recursive: true, force: true })
    }
    return this.load()
  }

  /** move nó pra outro pai (workspace ou pasta) e ajusta sortKey */
  moveNode(id: string, newParentId: string, sortKey: number): Workspace[] {
    const e = this.index.get(id)
    if (!e || (e.kind !== 'request' && e.kind !== 'folder')) throw new Error('nó inválido')
    const targetDir = this.dirOfParent(newParentId)
    if (e.kind === 'folder' && (targetDir + path.sep).startsWith(e.path + path.sep)) throw new Error('não dá pra mover pasta pra dentro dela mesma')
    const found = findNode(this.wsOf(id), id)
    if (!found) throw new Error('nó não encontrado')
    const node = found.node
    let dest = e.path
    if (path.dirname(e.path) !== targetDir) {
      dest = this.uniquePath(targetDir, node.name, node.kind === 'request' ? '.yaml' : '')
      this.touch()
      fs.renameSync(e.path, dest)
    }
    node.sortKey = sortKey
    if (node.kind === 'request') this.write(dest, requestToYaml(node))
    else this.write(path.join(dest, FOLDER_FILE), folderToYaml(node))
    return this.load()
  }

  duplicate(id: string): { workspaces: Workspace[]; id: string } {
    const found = findNode(this.wsOf(id), id)
    const e = this.index.get(id)
    if (!found || !e) throw new Error('nó não encontrado')
    const copy = cloneWithNewIds(found.node)
    copy.name = `${copy.name} (cópia)`
    copy.sortKey = found.node.sortKey + 0.5
    this.writeNodes(path.dirname(e.path), [copy])
    return { workspaces: this.load(), id: copy.id }
  }

  // ---------- ambientes ----------

  saveEnvironment(wsId: string, env: Environment): Workspace[] {
    const e = this.index.get(env.id)
    let file = e?.path
    if (!file) {
      const wsDir = this.index.get(wsId)?.path
      if (!wsDir) throw new Error('workspace não encontrado')
      file = this.uniquePath(path.join(wsDir, ENV_DIR), env.name, '.yaml')
    }
    this.write(file, stripEmpty(env))
    return this.load()
  }

  deleteEnvironment(id: string): Workspace[] {
    const e = this.index.get(id)
    if (e?.kind === 'env') {
      this.touch()
      fs.rmSync(e.path, { force: true })
    }
    return this.load()
  }

  // ---------- respostas e estado ----------

  private responsesFile(requestId: string): string {
    return path.join(this.dir, '.responses', `${requestId.replace(/[^\w-]/g, '_')}.json`)
  }

  getResponses(requestId: string): ResponseRecord[] {
    try {
      return JSON.parse(fs.readFileSync(this.responsesFile(requestId), 'utf8'))
    } catch {
      return []
    }
  }

  addResponse(rec: ResponseRecord): ResponseRecord[] {
    const list = [rec, ...this.getResponses(rec.requestId)].slice(0, MAX_RESPONSES)
    const file = this.responsesFile(rec.requestId)
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, JSON.stringify(list))
    return list
  }

  clearResponses(requestId: string): void {
    fs.rmSync(this.responsesFile(requestId), { force: true })
  }

  getState(): AppState {
    try {
      return { activeEnv: {}, ...JSON.parse(fs.readFileSync(path.join(this.dir, 'state.json'), 'utf8')) }
    } catch {
      return { activeEnv: {} }
    }
  }

  setState(state: AppState): void {
    fs.writeFileSync(path.join(this.dir, 'state.json'), JSON.stringify(state, null, 2))
  }
}

/** arquivo `foo` ou `foo-3` corresponde ao nome `Foo`? */
function sameSlug(base: string, name: string): boolean {
  const slug = slugify(name)
  return base === slug || new RegExp(`^${slug.replace(/[-]/g, '\\-')}-\\d+$`).test(base)
}

function cloneWithNewIds<T extends TreeNode>(node: T): T {
  const copy = structuredClone(node)
  const reid = (n: TreeNode): void => {
    n.id = newId(n.kind === 'folder' ? 'fld' : 'req')
    if (n.kind === 'folder') n.children.forEach(reid)
  }
  reid(copy)
  return copy
}
