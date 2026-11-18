import fs from 'node:fs'
import { Cookies } from './cookies'
import path from 'node:path'
import { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, shell } from 'electron'
import { watch, type FSWatcher } from 'chokidar'
import { Store } from './store'
import * as Git from './git'
import { cancel } from './http'
import { randomUUID } from 'node:crypto'
import { Engine } from './engine'
import { evalFn, extract, type PromptAsk } from './tags'
import { findRequestRef, parseTag } from '../shared/tagdef'
import { buildVars, render } from '../shared/template'
import { parseData, runCollection, toJUnit, type RunHandle } from './runner'
import { runCli } from './cli'
import { electronProtector, Vault } from './vault'
import { getAt, literalSecrets, scanSecrets, setAt, type SecretSpot } from '../shared/protect'
import { SECRET_RE } from '../shared/secret'
import { convert, insomniaSkipsTLS, INSOMNIA_DIR, readNedbDir, type ParseResult } from './import-insomnia'
import { fetchSource, parseSources } from './import-sources'
import { prepare } from '../shared/prepare'
import { generate, type CodeLang } from '../shared/curl'
import { countTree, findNode, slugify } from '../shared/tree'
import type { CookieInfo, Environment, Folder, ImportPreview, RequestDoc, RunOptions, RunReport, Workspace } from '../shared/types'

// promise rejeitada sem tratamento (ex.: num script do usuário) não derruba o app
process.on('unhandledRejection', (e) => console.error('promise rejeitada sem tratamento:', e))

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
    // em dev usa o ícone do repositório; empacotado, o ícone vem do .desktop
    ...(fs.existsSync(path.join(__dirname, '../../build/icon.png')) ? { icon: path.join(__dirname, '../../build/icon.png') } : {}),
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

let watcher: FSWatcher | null = null

function watchDataDir(): void {
  let timer: NodeJS.Timeout | null = null
  const hidden = (p: string): boolean => /[\\/]\.(responses|vault|git)([\\/]|$)/.test(p) || p.endsWith('state.json') || p.endsWith('links.json')
  watcher = watch([store.dir, ...store.linkedDirs()], { ignoreInitial: true, ignored: hidden })
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

/** vigia também as pastas vinculadas (pull do git aparece na hora) */
function watchLinks(): void {
  watcher?.add(store.linkedDirs())
}

async function pickDir(title: string): Promise<string | null> {
  const r = await dialog.showOpenDialog(win!, { title, properties: ['openDirectory', 'createDirectory'] })
  return r.canceled ? null : (r.filePaths[0] ?? null)
}

handle('linkWorkspace', async () => {
  const dir = await pickDir('Pasta do workspace (com workspace.yaml)')
  if (!dir) return null
  const r = store.linkWorkspace(dir)
  watchLinks()
  return r
})
handle('moveWorkspace', async (id: string) => {
  const dir = await pickDir('Mover workspace para… (ex.: uma pasta dentro do repositório do projeto)')
  if (!dir) return null
  const list = store.moveWorkspace(id, dir)
  watchLinks()
  return list
})

// ---------- git ----------

function wsDir(wsId: string): string {
  const dir = store.list().find((w) => w.id === wsId)?.location?.dir
  if (!dir) throw new Error('workspace não encontrado')
  return dir
}

/** roda a operação e devolve o status novo; mudanças nos arquivos chegam pelo watcher */
const gitOp =
  <A extends unknown[]>(fn: (dir: string, ...a: A) => Promise<unknown>) =>
  async (wsId: string, ...a: A) => {
    const dir = wsDir(wsId)
    await fn(dir, ...a)
    return Git.status(dir)
  }

handle('gitStatus', (wsId: string) => Git.status(wsDir(wsId)))
handle('gitDiff', (wsId: string, file: string) => Git.diff(wsDir(wsId), file))
handle('gitCommit', gitOp(Git.commit))
handle('gitPull', gitOp(Git.pull))
handle('gitPush', gitOp(Git.push))
handle('gitSwitch', gitOp(Git.switchBranch))
handle('gitAbort', gitOp(Git.abortRebase))
handle('gitInit', gitOp(Git.init))

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

const cookies = new Cookies(store.dir)

// {% prompt %}: pergunta na janela; "lembrar" guarda o valor só enquanto o app estiver aberto
const promptMemory = new Map<string, string>()
const promptWaiting = new Map<number, (v: { value: string; remember: boolean } | null) => void>()
let promptSeq = 0
async function askPrompt(p: PromptAsk): Promise<string | null> {
  const key = p.key || `${p.title}|${p.label}`
  if (promptMemory.has(key)) return promptMemory.get(key)!
  if (!win) return null
  const id = ++promptSeq
  const answer = await new Promise<{ value: string; remember: boolean } | null>((resolve) => {
    promptWaiting.set(id, resolve)
    win!.webContents.send('prompt:ask', id, p)
  })
  if (answer?.remember) promptMemory.set(key, answer.value)
  return answer ? answer.value : null
}
handle('promptReply', (id: number, answer: { value: string; remember: boolean } | null) => {
  promptWaiting.get(id)?.(answer)
  promptWaiting.delete(id)
})
handle('promptForget', () => promptMemory.clear())

const engine = new Engine(store, vault, {
  onChanged: (list) => win?.webContents.send('store:changed', list),
  onResponse: (id, history) => win?.webContents.send('response:added', id, history),
  prompt: askPrompt
}, { cookies })

handle('cookiesList', (wsId: string) => cookies.list(wsId))
handle('cookiesSave', (wsId: string, list: CookieInfo[]) => cookies.replace(wsId, list))

handle('send', (wsId: string, req: RequestDoc, envId: string | null) => {
  const ws = store.list().find((w) => w.id === wsId)
  if (!ws) throw new Error('workspace não encontrado')
  return engine.execute(ws, req, envId)
})

// ---------- executor de coleção ----------

let running: RunHandle | null = null
handle('runCollection', async (opts: RunOptions) => {
  if (running) throw new Error('já tem uma execução em andamento')
  running = { cancelled: false }
  try {
    return await runCollection(engine, store, opts, (step, index, total) => {
      win?.webContents.send('response:added', step.requestId, store.getResponses(step.requestId))
      win?.webContents.send('run:step', step, index, total)
    }, running)
  } finally {
    running = null
  }
})
handle('runCancel', () => {
  if (running) running.cancelled = true
})
handle('runPickData', async () => {
  const r = await dialog.showOpenDialog(win!, {
    title: 'Dados para as iterações (CSV ou JSON)',
    filters: [{ name: 'CSV ou JSON', extensions: ['csv', 'json'] }, { name: 'Todos', extensions: ['*'] }],
    properties: ['openFile']
  })
  const file = r.filePaths[0]
  if (r.canceled || !file) return null
  return { name: path.basename(file), rows: parseData(fs.readFileSync(file, 'utf8'), file) }
})
handle('runSaveJUnit', async (report: RunReport) => {
  const r = await dialog.showSaveDialog(win!, { title: 'Salvar relatório JUnit', defaultPath: `${slugify(report.name) || 'zeno'}-junit.xml`, filters: [{ name: 'XML', extensions: ['xml'] }] })
  if (r.canceled || !r.filePath) return null
  fs.writeFileSync(r.filePath, toJUnit(report))
  return r.filePath
})
handle('cancel', (id: string) => cancel(id))

/** prévia do valor de uma tag {% response %}; send=true envia o request de origem antes */
handle('tagPreview', async (raw: string, send: boolean) => {
  const t = parseTag(raw)
  if (t.name === 'uuid') return { value: randomUUID() }
  if (t.name === 'now') return { value: new Date().toISOString() }
  if (t.name === 'fn') {
    // prévia com as variáveis do workspace e ambiente ativos; prompt não pergunta aqui
    const st = store.getState()
    const ws = store.list().find((w) => w.id === st.activeWorkspaceId) ?? store.list()[0]
    const vars = ws ? buildVars(ws, st.activeEnv[ws.id] ?? null, []) : {}
    try {
      return { value: await evalFn(t.tag, t.args, { render: (x) => render(x, vars).value }) }
    } catch (e) {
      return { error: (e as Error).message }
    }
  }
  if (t.name !== 'response') return { error: 'tag não suportada' }
  const ws = store.list().find((w) => findRequestRef(w.children, t.requestId))
  const node = ws && findRequestRef(ws.children, t.requestId)
  if (!ws || node?.kind !== 'request') return { error: 'request não encontrado' }
  let res = store.getResponses(node.id)[0]
  if (send) {
    const r = await engine.execute(ws, node, store.getState().activeEnv[ws.id] ?? null)
    win?.webContents.send('response:added', r.response.requestId, r.history)
    res = r.response
  }
  if (!res) return { error: 'ainda sem resposta: envie o request' }
  try {
    return { value: extract(res, t.field, t.filter), at: res.at }
  } catch (e) {
    return { error: (e as Error).message, at: res.at }
  }
})

/** código do request (cURL, Go…). resolveVars=false mantém {{ var }}; segredos literais são decifrados (pedido explícito) */
handle('codeSnippet', async (wsId: string, reqRaw: RequestDoc, envId: string | null, lang: CodeLang, resolveVars: boolean) => {
  const wsRaw = store.list().find((w) => w.id === wsId)
  if (!wsRaw) throw new Error('workspace não encontrado')
  const req: RequestDoc = await vault.decryptDeep(reqRaw)
  let ancestors: Folder[] = await vault.decryptDeep(findNode(wsRaw, reqRaw.id)?.ancestors ?? [])
  let environments = await vault.decryptDeep(wsRaw.environments)
  if (!resolveVars) {
    environments = []
    ancestors = ancestors.map((a) => ({ ...a, vars: {} }))
  }
  return generate(lang, prepare({ ...wsRaw, environments }, req, ancestors, envId).input)
})
handle('copyText', (text: string) => clipboard.writeText(text))
// atalhos de janela: o menu padrão do Electron sai (Ctrl+R recarregava a página); o renderer cuida de tudo
handle('windowAction', (action: 'fullscreen' | 'devtools' | 'quit') => {
  if (action === 'quit') return app.quit()
  if (!win) return
  if (action === 'fullscreen') win.setFullScreen(!win.isFullScreen())
  if (action === 'devtools') win.webContents.toggleDevTools()
})
// atalhos personalizados do Insomnia (NeDB: vale o último registro)
handle('insomniaHotkeys', () => {
  const file = path.join(INSOMNIA_DIR, 'insomnia.Settings.db')
  if (!fs.existsSync(file)) return null
  let reg: unknown = null
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    try {
      const doc = JSON.parse(line)
      if (doc?.hotKeyRegistry) reg = doc.hotKeyRegistry
    } catch {
      /* linha vazia ou quebrada */
    }
  }
  return reg
})
handle('responses', (id: string) => store.getResponses(id))
handle('clearResponses', (id: string) => store.clearResponses(id))

handle('importPreview', async (source: 'insomnia' | 'file' | { url: string }): Promise<ImportPreview | null> => {
  let result: ParseResult
  let label: string
  if (source === 'insomnia') {
    result = convert(readNedbDir(), { insecureTLS: insomniaSkipsTLS() })
    label = INSOMNIA_DIR
  } else if (source === 'file') {
    const r = await dialog.showOpenDialog(win!, {
      title: 'Importar (Insomnia, OpenAPI/Swagger, Postman)',
      filters: [{ name: 'JSON ou YAML', extensions: ['json', 'yaml', 'yml'] }, { name: 'Todos', extensions: ['*'] }],
      properties: ['openFile', 'multiSelections']
    })
    if (r.canceled || !r.filePaths.length) return null
    result = parseSources(r.filePaths.map((f) => ({ name: path.basename(f), text: fs.readFileSync(f, 'utf8') })))
    label = r.filePaths.join(', ')
  } else {
    result = parseSources([await fetchSource(source.url)])
    label = source.url
  }
  const { workspaces, warnings } = result
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

/** `zeno run …` na linha de comando: roda a coleção sem abrir janela */
function cliArgs(): string[] | null {
  const rest = process.argv.slice(app.isPackaged ? 1 : 2)
  const i = rest.findIndex((a) => !a.startsWith('-'))
  return i >= 0 && rest[i] === 'run' ? rest.slice(i) : null
}

const cli = cliArgs()
if (cli) {
  app.whenReady().then(async () => app.exit(await runCli(cli, electronProtector())))
} else app.whenReady().then(() => {
  Menu.setApplicationMenu(null)
  createWindow()
  watchDataDir()
  app.on('activate', () => BrowserWindow.getAllWindows().length === 0 && createWindow())
})
app.on('window-all-closed', () => process.platform !== 'darwin' && app.quit())
