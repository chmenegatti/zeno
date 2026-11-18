// Persistência em YAML: um diretório por workspace, um diretório por pasta, um arquivo por request.
//
// <dataDir>/<workspace>/workspace.yaml
// <dataDir>/<workspace>/_env/<ambiente>.yaml
// <dataDir>/<workspace>/<pasta>/folder.yaml
// <dataDir>/<workspace>/<pasta>/<request>.yaml
// <dataDir>/.responses/<requestId>.json   (histórico de respostas)
// <dataDir>/state.json                     (estado da UI)
// <dataDir>/links.json                     (workspaces que moram fora da pasta de dados, ex.: num repo git)

import fs from 'node:fs'
import path from 'node:path'
import YAML from 'yaml'
import { ASSERT_OPS, ASSERT_SOURCES } from '../shared/types'
import type {
  AppState,
  Assertion,
  Environment,
  Folder,
  FolderDoc,
  RequestDoc,
  ResponseRecord,
  Scripts,
  TreeNode,
  Workspace,
  WorkspaceDoc
} from '../shared/types'
import { findNode, newId, slugify, sortNodes } from '../shared/tree'

const WS_FILE = 'workspace.yaml'
const FOLDER_FILE = 'folder.yaml'
const ENV_DIR = '_env'
const MAX_RESPONSES = 20
/** acima disso o body vai pra um arquivo próprio e o histórico guarda só a prévia */
export const LARGE_BODY = 5 * 1024 * 1024
const PREVIEW_CHARS = 256 * 1024

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
    scripts: normScripts(raw.scripts),
    assertions: normAssertions(raw.assertions),
    // só o "desligado" é gravado; ausente = ligado
    sendCookies: raw.sendCookies === false ? false : undefined,
    storeCookies: raw.storeCookies === false ? false : undefined,
    sortKey: Number(raw.sortKey ?? 0)
  }
}

function normAssertions(raw: unknown): Assertion[] | undefined {
  if (!Array.isArray(raw) || !raw.length) return undefined
  return raw
    .filter((a) => a && (ASSERT_SOURCES as readonly string[]).includes(a.source) && (ASSERT_OPS as readonly string[]).includes(a.op))
    .map((a) => stripEmpty({ enabled: a.enabled !== false, source: a.source, path: a.path ? String(a.path) : undefined, op: a.op, value: a.value == null ? undefined : String(a.value) }))
}

function normScripts(raw: unknown): Scripts | undefined {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Scripts
  const pre = typeof r.pre === 'string' && r.pre.trim() ? r.pre : undefined
  const post = typeof r.post === 'string' && r.post.trim() ? r.post : undefined
  return pre || post ? stripEmpty({ pre, post }) : undefined
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
    scripts: normScripts(raw.scripts),
    children: []
  }
}

function requestToYaml(r: RequestDoc): object {
  const { kind: _k, ...rest } = r
  return stripEmpty({ ...rest, scripts: normScripts(rest.scripts), assertions: normAssertions(rest.assertions) })
}

function folderToYaml(f: FolderDoc | Folder): object {
  const { kind: _k, children: _c, ...rest } = f as Folder
  return stripEmpty({ ...rest, scripts: normScripts(rest.scripts) })
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
  private links: string[] = []

  constructor(dir = defaultDataDir()) {
    this.dir = dir
    fs.mkdirSync(dir, { recursive: true })
    // respostas, cookies e estado nunca vão pro git, mesmo com a pasta de dados dentro de um repo
    writeGitignore(dir)
    try {
      const raw = JSON.parse(fs.readFileSync(this.linksFile, 'utf8'))
      if (Array.isArray(raw)) this.links = raw.filter((x) => typeof x === 'string')
    } catch {
      this.links = []
    }
  }

  private get linksFile(): string {
    return path.join(this.dir, 'links.json')
  }

  private saveLinks(): void {
    fs.writeFileSync(this.linksFile, JSON.stringify(this.links, null, 2))
  }

  /** pastas de workspaces vinculados (fora da pasta de dados) */
  linkedDirs(): string[] {
    return [...this.links]
  }

  // ---------- leitura ----------

  load(): Workspace[] {
    this.index.clear()
    const out: Workspace[] = []
    const dirs: [string, boolean][] = fs
      .readdirSync(this.dir, { withFileTypes: true })
      .filter((ent) => ent.isDirectory() && !ent.name.startsWith('.'))
      .map((ent) => [path.join(this.dir, ent.name), false])
    for (const l of this.links) dirs.push([l, true])
    for (const [wsDir, linked] of dirs) {
      const doc = readYaml<Partial<WorkspaceDoc>>(path.join(wsDir, WS_FILE))
      if (!doc) continue
      const id = doc.id || newId('wrk')
      // mesmo workspace em dois lugares: vale o primeiro
      if (this.index.has(id)) continue
      const ws: Workspace = {
        id,
        name: doc.name || path.basename(wsDir),
        description: doc.description || undefined,
        settings: { insecureTLS: !!doc.settings?.insecureTLS, timeoutMs: Number(doc.settings?.timeoutMs ?? 30000) },
        location: { dir: wsDir, linked },
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

  /** apaga os arquivos; workspace vinculado só sai da lista (os arquivos são do repositório do usuário) */
  deleteWorkspace(id: string): Workspace[] {
    const e = this.index.get(id)
    if (e?.kind === 'workspace') {
      if (this.links.includes(e.path)) {
        this.links = this.links.filter((l) => l !== e.path)
        this.saveLinks()
      } else {
        this.touch()
        fs.rmSync(e.path, { recursive: true, force: true })
      }
    }
    return this.load()
  }

  /** passa a abrir um workspace que já existe numa pasta (ex.: clonada de um repo) */
  linkWorkspace(dir: string): { workspaces: Workspace[]; id: string } {
    const abs = path.resolve(dir)
    const doc = readYaml<Partial<WorkspaceDoc>>(path.join(abs, WS_FILE))
    if (!doc?.id) throw new Error(`não há ${WS_FILE} em ${abs}`)
    const open = this.index.get(doc.id)
    if (open) throw new Error(`esse workspace já está aberto (${open.path})`)
    this.links.push(abs)
    this.saveLinks()
    return { workspaces: this.load(), id: doc.id }
  }

  /**
   * leva o workspace pra outra pasta (ex.: dentro do repo do projeto).
   * Pasta vazia ou inexistente: usa ela. Com outros arquivos: cria uma subpasta com o nome do workspace.
   */
  moveWorkspace(id: string, target: string): Workspace[] {
    const e = this.index.get(id)
    const ws = this.workspaces.find((w) => w.id === id)
    if (e?.kind !== 'workspace' || !ws) throw new Error('workspace não encontrado')
    let dest = path.resolve(target)
    const inside = (a: string, b: string): boolean => a === b || a.startsWith(b + path.sep)
    if (inside(dest, path.resolve(this.dir))) throw new Error('escolha uma pasta fora da pasta de dados do Zeno')
    if (inside(dest, e.path)) throw new Error('escolha uma pasta fora do workspace')
    if (fs.existsSync(path.join(dest, WS_FILE))) throw new Error('já existe um workspace nessa pasta')
    if (fs.existsSync(dest) && fs.readdirSync(dest).length) dest = this.uniquePath(dest, ws.name, '')
    this.touch()
    fs.mkdirSync(dest, { recursive: true })
    fs.cpSync(e.path, dest, { recursive: true })
    writeGitignore(dest)
    fs.rmSync(e.path, { recursive: true, force: true })
    this.links = [...this.links.filter((l) => l !== e.path), dest]
    this.saveLinks()
    return this.load()
  }

  /** grava workspace inteiro (import). Substitui o existente com mesmo id, no mesmo lugar. */
  writeWorkspace(ws: Workspace): void {
    const existing = this.index.get(ws.id)
    let dir: string
    if (existing?.kind === 'workspace') {
      this.touch()
      fs.rmSync(existing.path, { recursive: true, force: true })
      dir = existing.path
    } else dir = this.uniquePath(this.dir, ws.name, '')
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

  private bodyPath(resId: string): string {
    return path.join(this.dir, '.responses', 'bodies', resId.replace(/[^\w-]/g, '_'))
  }

  /** guarda a resposta; body grande vai pra arquivo e o registro fica só com a prévia */
  addResponse(full: ResponseRecord): ResponseRecord[] {
    let rec = full
    if (full.body.length > LARGE_BODY) {
      const bp = this.bodyPath(full.id)
      fs.mkdirSync(path.dirname(bp), { recursive: true })
      fs.writeFileSync(bp, full.body)
      rec = { ...full, body: full.bodyEncoding === 'utf8' ? full.body.slice(0, PREVIEW_CHARS) : '', bodyFile: true }
    }
    const all = [rec, ...this.getResponses(rec.requestId)]
    const list = all.slice(0, MAX_RESPONSES)
    for (const old of all.slice(MAX_RESPONSES)) if (old.bodyFile) fs.rmSync(this.bodyPath(old.id), { force: true })
    const file = this.responsesFile(rec.requestId)
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, JSON.stringify(list))
    return list
  }

  /** body completo (lê do arquivo quando foi guardado à parte) */
  responseBody(rec: ResponseRecord): string {
    if (!rec.bodyFile) return rec.body
    try {
      return fs.readFileSync(this.bodyPath(rec.id), 'utf8')
    } catch {
      return rec.body
    }
  }

  /** registro com o body completo (tags {% response %}, salvar em arquivo) */
  withBody(rec: ResponseRecord | undefined): ResponseRecord | undefined {
    return rec?.bodyFile ? { ...rec, body: this.responseBody(rec), bodyFile: false } : rec
  }

  clearResponses(requestId: string): void {
    for (const r of this.getResponses(requestId)) if (r.bodyFile) fs.rmSync(this.bodyPath(r.id), { force: true })
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

/** o que fica na máquina nunca vai pro git (hoje já mora fora do workspace; isto protege se alguém juntar as pastas) */
export function writeGitignore(dir: string): void {
  const file = path.join(dir, '.gitignore')
  const need = ['.responses/', '.vault/', '.cookies/', 'state.json', 'links.json']
  if (!fs.existsSync(file)) {
    fs.writeFileSync(file, `# gerado pelo Zeno: respostas, cookies, estado da interface e chave do cofre ficam só na máquina\n${need.join('\n')}\n`)
    return
  }
  // versões antigas não tinham tudo: só acrescenta o que falta
  const cur = fs.readFileSync(file, 'utf8')
  const lines = new Set(cur.split(/\r?\n/).map((l) => l.trim()))
  const missing = need.filter((n) => !lines.has(n))
  if (missing.length) fs.writeFileSync(file, `${cur}${cur.endsWith('\n') || !cur ? '' : '\n'}${missing.join('\n')}\n`)
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
