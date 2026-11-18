import fs from 'node:fs'
import path from 'node:path'
import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { watch } from 'chokidar'
import { Store } from './store'
import { send, cancel } from './http'
import { resolveTags } from './tags'
import { electronProtector, Vault } from './vault'
import { getAt, literalSecrets, scanSecrets, setAt, type SecretSpot } from '../shared/protect'
import { SECRET_RE } from '../shared/secret'
import { convert, insomniaSkipsTLS, INSOMNIA_DIR, readExportJson, readNedbDir } from './import-insomnia'
import { prepare } from '../shared/prepare'
import { countTree, findNode } from '../shared/tree'
import type { Environment, Folder, ImportPreview, RequestDoc, Workspace } from '../shared/types'
import type { SendResult } from '../shared/api'

const store = new Store()
store.load()
const vault = new Vault(store.dir, electronProtector())
let win: BrowserWindow | null = null
let pendingImport: Workspace[] = []

function createWindow(): void {
  win = new BrowserWindow({
    width: 1400,
    height: 880,
    minWidth: 900,
    minHeight: 560,
    backgroundColor: '#00121c',
    title: 'Zeno',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true
    }
  })
  // links externos vão pro navegador; nunca abre janela nova
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url)
    return { action: 'deny' }
  })
  // verificação automática: ZENO_SCREENSHOT=arquivo.png tira print da janela e sai
  const shot = process.env.ZENO_SCREENSHOT
  if (shot) {
    win.webContents.on('console-message', (e) => console.log(`[renderer] ${e.message}`))
    win.webContents.once('did-finish-load', () =>
      setTimeout(async () => {
        if (process.env.ZENO_SCRIPT) await win!.webContents.executeJavaScript(process.env.ZENO_SCRIPT).catch((err) => console.log('script:', err))
        const img = await win!.webContents.capturePage()
        fs.writeFileSync(shot, img.toPNG())
        app.quit()
      }, Number(process.env.ZENO_SHOT_DELAY ?? 1500))
    )
  }
  if (process.env.ELECTRON_RENDERER_URL) win.loadURL(process.env.ELECTRON_RENDERER_URL)
  else win.loadFile(path.join(__dirname, '../renderer/index.html'))
}

function watchDataDir(): void {
  let timer: NodeJS.Timeout | null = null
  const watcher = watch(store.dir, {
    ignoreInitial: true,
    ignored: (p) => p.includes(`${path.sep}.responses`) || p.includes(`${path.sep}.vault`) || p.endsWith('state.json')
  })
  watcher.on('all', () => {
    if (Date.now() - store.lastWrite < 1500) return
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      if (Date.now() - store.lastWrite < 1500) return
      win?.webContents.send('store:changed', store.load())
    }, 300)
  })
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function handle(channel: string, fn: (...args: any[]) => unknown): void {
  ipcMain.handle(channel, (_e, ...args) => fn(...args))
}

handle('load', () => ({ workspaces: store.list(), state: store.getState(), dataDir: store.dir }))
handle('setState', (s) => store.setState(s))

handle('createWorkspace', (name: string) => store.createWorkspace(name))
handle('saveWorkspace', (doc) => store.saveWorkspace(doc))
handle('deleteWorkspace', (id: string) => store.deleteWorkspace(id))

handle('createRequest', (parentId: string, name: string) => store.createRequest(parentId, name))
handle('createFolder', (parentId: string, name: string) => store.createFolder(parentId, name))
handle('saveRequest', (req: RequestDoc) => store.saveRequest(req))
handle('saveFolder', (doc) => {
  store.saveFolder(doc)
  return store.list()
})
handle('deleteNode', (id: string) => store.deleteNode(id))
handle('moveNode', (id: string, parent: string, sortKey: number) => store.moveNode(id, parent, sortKey))
handle('duplicate', (id: string) => store.duplicate(id))

handle('saveEnvironment', (wsId: string, env) => store.saveEnvironment(wsId, env))
handle('deleteEnvironment', (id: string) => store.deleteEnvironment(id))

/** prepara (resolvendo tags {% response %} que podem disparar outros requests) e envia */
async function execute(wsRaw: Workspace, reqRaw: RequestDoc, envId: string | null, depth = 0): Promise<SendResult> {
  // segredos só são decifrados aqui, no main, e só para o envio
  const ws: Workspace = { ...wsRaw, environments: await vault.decryptDeep(wsRaw.environments) }
  const req: RequestDoc = await vault.decryptDeep(reqRaw)
  const ancestors: Folder[] = await vault.decryptDeep(findNode(wsRaw, reqRaw.id)?.ancestors ?? [])
  let prepared = prepare(ws, req, ancestors, envId)
  const warnings: string[] = []
  if (prepared.unsupported.length) {
    if (depth > 3) warnings.push('cadeia de {% response %} longa demais (máx. 3)')
    else {
      const { values, errors } = await resolveTags(prepared.unsupported, {
        latest: (id) => store.getResponses(id)[0],
        sendById: async (id) => {
          const dep = store.list().find((w) => findNode(w, id)?.node.kind === 'request')
          const node = dep && findNode(dep, id)?.node
          if (!dep || node?.kind !== 'request') throw new Error(`request ${id} não existe`)
          const depEnv = dep.id === ws.id ? envId : (store.getState().activeEnv[dep.id] ?? null)
          const r = await execute(dep, node, depEnv, depth + 1)
          win?.webContents.send('response:added', r.response.requestId, r.history)
          return r.response
        }
      })
      warnings.push(...errors)
      prepared = prepare(ws, req, ancestors, envId, values)
    }
  }
  warnings.push(...prepared.unsupported.map((t) => `tag não resolvida: ${t}`))
  const response = await send(prepared.input)
  const history = store.addResponse(response)
  return { response, history, missing: prepared.missing, warnings: [...new Set(warnings)] }
}

handle('send', (wsId: string, req: RequestDoc, envId: string | null) => {
  const ws = store.list().find((w) => w.id === wsId)
  if (!ws) throw new Error('workspace não encontrado')
  return execute(ws, req, envId)
})
handle('cancel', (id: string) => cancel(id))
handle('responses', (id: string) => store.getResponses(id))
handle('clearResponses', (id: string) => store.clearResponses(id))

handle('importPreview', async (source: 'insomnia' | 'file'): Promise<ImportPreview | null> => {
  let docs
  let label: string
  let insecureTLS = false
  if (source === 'insomnia') {
    docs = readNedbDir()
    label = INSOMNIA_DIR
    insecureTLS = insomniaSkipsTLS()
  } else {
    const r = await dialog.showOpenDialog(win!, { title: 'Export do Insomnia (JSON)', filters: [{ name: 'JSON', extensions: ['json'] }], properties: ['openFile'] })
    if (r.canceled || !r.filePaths[0]) return null
    docs = readExportJson(r.filePaths[0])
    label = r.filePaths[0]
  }
  const { workspaces, warnings } = convert(docs, { insecureTLS })
  pendingImport = workspaces
  const existing = new Set(store.list().map((w) => w.id))
  return {
    source: label,
    workspaces: workspaces.map((w) => ({ id: w.id, name: w.name, ...countTree(w.children), environments: w.environments.length, exists: existing.has(w.id) })),
    warnings
  }
})
handle('importRun', async (ids: string[], protect: boolean) => {
  for (const ws of pendingImport.filter((w) => ids.includes(w.id))) store.writeWorkspace(ws)
  pendingImport = []
  store.load()
  if (protect) {
    // conhece todos os segredos antes de cifrar, pra pegar senha repetida entre workspaces
    const known = await knownSecrets()
    for (const id of ids) await protectWorkspace(id, known)
  }
  return store.load()
})

// ---------- cofre ----------

/** todos os segredos conhecidos: literais (pelas regras) + já cifrados (decifrados só aqui, em memória) */
async function knownSecrets(): Promise<Set<string>> {
  const known = new Set<string>()
  for (const ws of store.list()) {
    for (const v of literalSecrets(ws)) known.add(v)
    const tokens = JSON.stringify({ e: ws.environments, c: ws.children }).match(SECRET_RE) ?? []
    for (const t of new Set(tokens)) {
      try {
        known.add(await vault.decrypt(t))
      } catch {
        /* chave de outra máquina: ignora */
      }
    }
  }
  return known
}

/** cifra no cofre todo segredo em texto puro do workspace */
async function protectWorkspace(wsId: string, known?: Set<string>): Promise<number> {
  const ws = store.list().find((w) => w.id === wsId)
  if (!ws) throw new Error('workspace não encontrado')
  const { spots } = scanSecrets(ws, known ?? (await knownSecrets()))
  // uma cópia por objeto alterado; grava cada um uma vez só
  const copies = new Map<string, { kind: SecretSpot['target']['kind']; obj: Environment | Folder | RequestDoc }>()
  for (const s of spots) {
    let c = copies.get(s.target.id)
    if (!c) {
      const src = s.target.kind === 'env' ? ws.environments.find((e) => e.id === s.target.id) : findNode(ws, s.target.id)?.node
      if (!src) continue
      c = { kind: s.target.kind, obj: structuredClone(src) }
      copies.set(s.target.id, c)
    }
    setAt(c.obj, s.path, await vault.encrypt(String(getAt(c.obj, s.path))))
  }
  const list = [...copies.values()]
  for (const c of list.filter((c) => c.kind === 'request')) store.saveRequest(c.obj as RequestDoc)
  for (const c of list.filter((c) => c.kind === 'folder')) {
    const { children: _c, ...doc } = c.obj as Folder
    store.saveFolder(doc)
  }
  for (const c of list.filter((c) => c.kind === 'env')) store.saveEnvironment(ws.id, c.obj as Environment)
  return spots.length
}

handle('vaultStatus', () => vault.status())
handle('vaultEncrypt', (plain: string) => vault.encrypt(plain))
handle('vaultReveal', (token: string) => vault.decrypt(token))
handle('vaultScan', async (wsId: string) => {
  const ws = store.list().find((w) => w.id === wsId)
  if (!ws) return { plain: [], warnings: [] }
  const r = scanSecrets(ws, await knownSecrets())
  return { plain: r.spots.map((s) => s.label), warnings: r.warnings }
})
handle('vaultProtect', async (wsId: string) => {
  const count = await protectWorkspace(wsId)
  return { count, workspaces: store.load() }
})

handle('pickFile', async () => {
  const r = await dialog.showOpenDialog(win!, { properties: ['openFile'] })
  return r.canceled ? null : (r.filePaths[0] ?? null)
})
handle('openDataDir', () => shell.openPath(store.dir).then(() => undefined))

app.whenReady().then(() => {
  createWindow()
  watchDataDir()
  app.on('activate', () => BrowserWindow.getAllWindows().length === 0 && createWindow())
})
app.on('window-all-closed', () => process.platform !== 'darwin' && app.quit())
