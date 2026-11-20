import { create } from 'zustand'
import type { SendResult } from '@shared/api'
import { findNode } from '@shared/tree'
import { prepare } from '@shared/prepare'
import { isWsUrl, type SSEEvent, type WsEvent } from '@shared/stream'
import type { AppState, Environment, PluginInfo, Folder, FolderDoc, RequestDoc, ResponseRecord, TreeNode, Workspace } from '@shared/types'

const api = window.zeno

interface Modal {
  kind: 'env' | 'folder' | 'workspace' | 'import' | 'prompt' | 'confirm' | 'code' | 'git' | 'run' | 'shortcuts' | 'prefs' | 'palette' | 'cookies' | 'plugins' | 'github' | 'workspaces'
  /** id do alvo (pasta/workspace) */
  id?: string
  /** github: workspaces já marcados */
  ids?: string[]
  /** run: pasta a rodar (sem = workspace inteiro) */
  folderId?: string
  title?: string
  value?: string
  message?: string
  onOk?: (value: string) => void
}

export interface VarEdit {
  /** vazio = nova variável */
  name: string
  x: number
  y: number
}

interface Store {
  ready: boolean
  dataDir: string
  workspaces: Workspace[]
  app: AppState
  /** histórico de respostas por request */
  responses: Record<string, ResponseRecord[]>
  /** resposta escolhida no histórico */
  selectedResponse: Record<string, string>
  sending: Record<string, boolean>
  lastSend: Record<string, Pick<SendResult, 'missing' | 'warnings' | 'scripts'>>
  modal: Modal | null
  /** editor de tag {% %}: fica por cima do modal aberto (ambientes, pasta) */
  tagEdit: { value: string; onOk: (raw: string) => void; onCancel?: () => void } | null
  /** popover de edição de variável */
  varEdit: VarEdit | null
  error: string | null
  /** aviso curto que some sozinho */
  notice: string | null
  /** badges mostram o valor da variável (Alt+Shift+U) */
  showValues: boolean
  /** lista de métodos aberta (Ctrl+Shift+L) */
  methodMenu: boolean
  /** menu de opções de envio aberto (Ctrl+Shift+Enter) */
  sendMenu: boolean
  /** plugins carregados (tags, ações) */
  plugins: PluginInfo[]
  loadPlugins(reload?: boolean): Promise<void>
  /** SSE (#6): eventos do envio em andamento (ou do último), por request */
  live: Record<string, SSEEvent[]>
  /** WebSocket (#6): log da conexão e estado, por request (só na memória) */
  wsLog: Record<string, WsEvent[]>
  wsState: Record<string, 'connecting' | 'open' | 'closed'>
  /** conecta (ou, conectado, manda o body como mensagem) */
  wsAction(id?: string, action?: 'connect' | 'send' | 'close'): Promise<void>
  /** envio agendado por request: atrasado (uma vez) ou repetindo */
  sendTimers: Record<string, { mode: 'delay' | 'repeat'; seconds: number }>

  init(): Promise<void>
  setApp(patch: Partial<AppState>): void
  setWorkspaces(ws: Workspace[]): void
  selectRequest(id: string | undefined): void
  updateRequest(req: RequestDoc): void
  flushSaves(): Promise<void>
  /** envia o request ativo (ou o id dado, mesmo que não esteja aberto) */
  sendActive(id?: string): Promise<void>
  openModal(m: Modal): void
  closeModal(): void
  showError(e: unknown): void
  notify(msg: string): void
  run<T>(p: Promise<T>): Promise<T | undefined>
}

// ---------- helpers ----------

function replaceNode(nodes: TreeNode[], next: TreeNode): TreeNode[] {
  return nodes.map((n) => {
    if (n.id === next.id) return next.kind === 'folder' ? next : { ...next }
    if (n.kind === 'folder') {
      const children = replaceNode(n.children, next)
      return children === n.children ? n : { ...n, children }
    }
    return n
  })
}

export function activeWorkspace(s: Pick<Store, 'workspaces' | 'app'>): Workspace | undefined {
  return s.workspaces.find((w) => w.id === s.app.activeWorkspaceId) ?? s.workspaces[0]
}

export function activeEnvId(s: Pick<Store, 'workspaces' | 'app'>): string | null {
  const ws = activeWorkspace(s)
  if (!ws) return null
  const id = s.app.activeEnv[ws.id]
  return id && ws.environments.some((e) => e.id === id) ? id : null
}

export function activeRequest(s: Pick<Store, 'workspaces' | 'app'>): { req: RequestDoc; ancestors: Folder[]; ws: Workspace } | null {
  const ws = activeWorkspace(s)
  const id = s.app.activeRequestId
  if (!ws || !id) return null
  const f = findNode(ws, id)
  return f && f.node.kind === 'request' ? { req: f.node, ancestors: f.ancestors, ws } : null
}

/** request em qualquer workspace */
export function findRequest(s: Pick<Store, 'workspaces'>, id: string): { req: RequestDoc; ws: Workspace } | null {
  for (const ws of s.workspaces) {
    const f = findNode(ws, id)
    if (f?.node.kind === 'request') return { req: f.node, ws }
  }
  return null
}

// saves pendentes por request (debounce)
const pending = new Map<string, { req: RequestDoc; timer: ReturnType<typeof setTimeout> }>()

async function saveNow(id: string): Promise<void> {
  const p = pending.get(id)
  if (!p) return
  clearTimeout(p.timer)
  pending.delete(id)
  await api.saveRequest(p.req)
}

const LOG_MAX = 2000

let stateTimer: ReturnType<typeof setTimeout> | null = null

export const useStore = create<Store>((set, get) => ({
  ready: false,
  dataDir: '',
  workspaces: [],
  app: { activeEnv: {} },
  responses: {},
  selectedResponse: {},
  sending: {},
  lastSend: {},
  modal: null,
  tagEdit: null,
  varEdit: null,
  error: null,
  notice: null,
  showValues: false,
  sendMenu: false,
  methodMenu: false,
  sendTimers: {},
  plugins: [],
  live: {},
  wsLog: {},
  wsState: {},

  async init() {
    const { workspaces, state, dataDir } = await api.load()
    set({ workspaces, app: state, dataDir, ready: true })
    get().loadPlugins()
    api.onChanged(async (ws) => {
      await get().flushSaves()
      set({ workspaces: ws })
    })
    api.onResponse((id, history) => set((s) => ({ responses: { ...s.responses, [id]: history } })))
    api.onSseEvent((id, e) => set((s) => ({ live: { ...s.live, [id]: [...(s.live[id] ?? []), e].slice(-LOG_MAX) } })))
    api.onWsEvent((e) =>
      set((s) => ({
        wsLog: { ...s.wsLog, [e.reqId]: [...(s.wsLog[e.reqId] ?? []), e].slice(-LOG_MAX) },
        wsState: e.kind === 'open' || e.kind === 'close' ? { ...s.wsState, [e.reqId]: e.kind === 'open' ? 'open' : 'closed' } : s.wsState
      }))
    )
    const id = get().app.activeRequestId
    if (id) get().selectRequest(id)
  },

  setApp(patch) {
    // trocou de workspace: guarda quando (ordenar por "usados recentemente")
    const prev = get().app
    if (patch.activeWorkspaceId && patch.activeWorkspaceId !== prev.activeWorkspaceId) {
      const meta = { ...(patch.wsMeta ?? prev.wsMeta) }
      meta[patch.activeWorkspaceId] = { ...meta[patch.activeWorkspaceId], lastUsed: Date.now() }
      patch = { ...patch, wsMeta: meta }
    }
    set((s) => ({ app: { ...s.app, ...patch } }))
    if (stateTimer) clearTimeout(stateTimer)
    stateTimer = setTimeout(() => api.setState(get().app), 300)
  },

  setWorkspaces(workspaces) {
    set({ workspaces })
  },

  selectRequest(id) {
    get().setApp({ activeRequestId: id })
    if (id && !get().responses[id]) {
      api.responses(id).then((list) => set((s) => ({ responses: { ...s.responses, [id]: list } })))
    }
  },

  updateRequest(req) {
    set((s) => ({ workspaces: s.workspaces.map((w) => (findNode(w, req.id) ? { ...w, children: replaceNode(w.children, req) } : w)) }))
    const prev = pending.get(req.id)
    if (prev) clearTimeout(prev.timer)
    // renomear mexe no arquivo: salva mais devagar pra não renomear a cada tecla
    pending.set(req.id, { req, timer: setTimeout(() => get().run(saveNow(req.id)), 500) })
  },

  async flushSaves() {
    await Promise.all([...pending.keys()].map(saveNow))
  },

  async wsAction(target, action) {
    const s = get()
    const cur = target ? findRequest(s, target) : activeRequest(s)
    if (!cur) return
    const id = cur.req.id
    const env = cur.ws.id === activeWorkspace(s)?.id ? activeEnvId(s) : (s.app.activeEnv[cur.ws.id] ?? null)
    const state = s.wsState[id]
    const act = action ?? (state === 'open' ? 'send' : 'connect')
    const log = (e: Omit<WsEvent, 'reqId' | 'at'>): void =>
      set((st) => ({ wsLog: { ...st.wsLog, [id]: [...(st.wsLog[id] ?? []), { ...e, reqId: id, at: Date.now() }].slice(-LOG_MAX) } }))
    if (act === 'close') return void api.wsClose(id)
    if (act === 'send') {
      if (state !== 'open') return get().notify('Conecte primeiro')
      if (cur.req.body.fields) return get().notify('Formulário não vira mensagem de WebSocket: escolha JSON ou texto na aba Mensagem')
      await api.wsSend(cur.ws.id, cur.req, env, cur.req.body.text ?? '').catch((e: unknown) => log({ kind: 'error', data: e instanceof Error ? e.message : String(e) }))
      return
    }
    if (state === 'connecting') return
    await saveNow(id).catch(() => undefined)
    set((st) => ({ wsState: { ...st.wsState, [id]: 'connecting' } }))
    try {
      await api.wsConnect(cur.ws.id, cur.req, env)
    } catch (e) {
      log({ kind: 'error', data: e instanceof Error ? e.message : String(e) })
      set((st) => ({ wsState: { ...st.wsState, [id]: 'closed' } }))
    }
  },

  async sendActive(target) {
    const s = get()
    const cur = target ? findRequest(s, target) : activeRequest(s)
    if (!cur || s.sending[cur.req.id]) return
    const id = cur.req.id
    // ws:// e wss://: conectar/mandar mensagem em vez de enviar HTTP
    const f = findNode(cur.ws, id)
    const env0 = cur.ws.id === activeWorkspace(s)?.id ? activeEnvId(s) : (s.app.activeEnv[cur.ws.id] ?? null)
    if (isWsUrl(prepare(cur.ws, cur.req, f?.ancestors ?? [], env0).input.url)) return get().wsAction(id)
    await saveNow(id).catch(() => undefined)
    set((st) => ({ sending: { ...st.sending, [id]: true }, live: { ...st.live, [id]: [] } }))
    try {
      const env = cur.ws.id === activeWorkspace(s)?.id ? activeEnvId(s) : (s.app.activeEnv[cur.ws.id] ?? null)
      const r = await api.send(cur.ws.id, cur.req, env)
      // não enviado (prompt cancelado): não entra no histórico, só avisa
      if (r.response.error && !r.history.some((h) => h.id === r.response.id)) return get().showError(r.response.error)
      set((st) => ({
        responses: { ...st.responses, [id]: r.history },
        selectedResponse: { ...st.selectedResponse, [id]: r.response.id },
        lastSend: { ...st.lastSend, [id]: { missing: r.missing, warnings: r.warnings, scripts: r.scripts } }
      }))
    } catch (e) {
      get().showError(e)
    } finally {
      set((st) => ({ sending: { ...st.sending, [id]: false } }))
    }
  },

  async loadPlugins(reload) {
    const list = await get().run(reload ? api.pluginsReload() : api.pluginsList())
    if (list) set({ plugins: list })
  },

  openModal(m) {
    set({ modal: m })
  },
  closeModal() {
    set({ modal: null })
  },
  showError(e) {
    const msg = e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(e)
    set({ error: msg })
    setTimeout(() => get().error === msg && set({ error: null }), 6000)
  },
  notify(msg) {
    set({ notice: msg })
    setTimeout(() => get().notice === msg && set({ notice: null }), 3500)
  },
  async run(p) {
    try {
      return await p
    } catch (e) {
      get().showError(e)
      return undefined
    }
  }
}))

// ---------- ações estruturais (retornam workspaces novos do main) ----------

const st = (): Store => useStore.getState()

export async function createRequestIn(parentId: string): Promise<void> {
  await st().flushSaves()
  const r = await st().run(api.createRequest(parentId, 'Novo request'))
  if (!r) return
  st().setWorkspaces(r.workspaces)
  st().selectRequest(r.id)
  // foca o nome pra renomear direto
  setTimeout(() => document.getElementById('request-name')?.focus(), 50)
}

export function createFolderIn(parentId: string): void {
  st().openModal({
    kind: 'prompt',
    title: 'Nova pasta',
    value: '',
    onOk: async (name) => {
      const r = await st().run(api.createFolder(parentId, name || 'Nova pasta'))
      if (r) st().setWorkspaces(r.workspaces)
    }
  })
}

export async function duplicateNode(id: string): Promise<void> {
  await st().flushSaves()
  const r = await st().run(api.duplicate(id))
  if (!r) return
  st().setWorkspaces(r.workspaces)
  const ws = activeWorkspace(st())
  if (ws && findNode(ws, r.id)?.node.kind === 'request') st().selectRequest(r.id)
}

export function deleteNode(node: TreeNode): void {
  st().openModal({
    kind: 'confirm',
    title: node.kind === 'folder' ? 'Excluir pasta' : 'Excluir request',
    message: node.kind === 'folder' ? `Excluir a pasta "${node.name}" e tudo dentro dela?` : `Excluir "${node.name}"?`,
    onOk: async () => {
      await st().flushSaves()
      const ws = await st().run(api.deleteNode(node.id))
      if (!ws) return
      st().setWorkspaces(ws)
      const cur = activeWorkspace(st())
      if (cur && st().app.activeRequestId && !findNode(cur, st().app.activeRequestId!)) st().selectRequest(undefined)
    }
  })
}

export async function moveNode(id: string, parentId: string, sortKey: number): Promise<void> {
  await st().flushSaves()
  const ws = await st().run(api.moveNode(id, parentId, sortKey))
  if (ws) st().setWorkspaces(ws)
}

export async function renameNode(node: TreeNode, name: string): Promise<void> {
  if (!name.trim() || name === node.name) return
  if (node.kind === 'request') st().updateRequest({ ...node, name: name.trim() })
  else await saveFolder({ ...node, name: name.trim() })
}

export async function saveFolder(doc: FolderDoc): Promise<void> {
  const { children: _c, ...rest } = doc as Folder
  await st().flushSaves()
  const ws = await st().run(api.saveFolder(rest))
  if (ws) st().setWorkspaces(ws)
}

export async function saveEnvironment(wsId: string, env: Environment): Promise<void> {
  const ws = await st().run(api.saveEnvironment(wsId, env))
  if (ws) st().setWorkspaces(ws)
}

export async function deleteEnvironment(id: string): Promise<void> {
  const ws = await st().run(api.deleteEnvironment(id))
  if (ws) st().setWorkspaces(ws)
}

export { api }
