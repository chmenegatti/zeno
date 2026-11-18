import { create } from 'zustand'
import type { SendResult } from '@shared/api'
import { findNode } from '@shared/tree'
import type { AppState, Environment, Folder, FolderDoc, RequestDoc, ResponseRecord, TreeNode, Workspace } from '@shared/types'

const api = window.zeno

interface Modal {
  kind: 'env' | 'folder' | 'workspace' | 'import' | 'prompt' | 'confirm' | 'git'
  /** id do alvo (pasta/workspace) */
  id?: string
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
  lastSend: Record<string, Pick<SendResult, 'missing' | 'warnings'>>
  modal: Modal | null
  /** popover de edição de variável */
  varEdit: VarEdit | null
  error: string | null

  init(): Promise<void>
  setApp(patch: Partial<AppState>): void
  setWorkspaces(ws: Workspace[]): void
  selectRequest(id: string | undefined): void
  updateRequest(req: RequestDoc): void
  flushSaves(): Promise<void>
  sendActive(): Promise<void>
  openModal(m: Modal): void
  closeModal(): void
  showError(e: unknown): void
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

// saves pendentes por request (debounce)
const pending = new Map<string, { req: RequestDoc; timer: ReturnType<typeof setTimeout> }>()

async function saveNow(id: string): Promise<void> {
  const p = pending.get(id)
  if (!p) return
  clearTimeout(p.timer)
  pending.delete(id)
  await api.saveRequest(p.req)
}

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
  varEdit: null,
  error: null,

  async init() {
    const { workspaces, state, dataDir } = await api.load()
    set({ workspaces, app: state, dataDir, ready: true })
    api.onChanged(async (ws) => {
      await get().flushSaves()
      set({ workspaces: ws })
    })
    api.onResponse((id, history) => set((s) => ({ responses: { ...s.responses, [id]: history } })))
    const id = get().app.activeRequestId
    if (id) get().selectRequest(id)
  },

  setApp(patch) {
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

  async sendActive() {
    const s = get()
    const cur = activeRequest(s)
    if (!cur || s.sending[cur.req.id]) return
    const id = cur.req.id
    await saveNow(id).catch(() => undefined)
    set((st) => ({ sending: { ...st.sending, [id]: true } }))
    try {
      const r = await api.send(cur.ws.id, cur.req, activeEnvId(s))
      set((st) => ({
        responses: { ...st.responses, [id]: r.history },
        selectedResponse: { ...st.selectedResponse, [id]: r.response.id },
        lastSend: { ...st.lastSend, [id]: { missing: r.missing, warnings: r.warnings } }
      }))
    } catch (e) {
      get().showError(e)
    } finally {
      set((st) => ({ sending: { ...st.sending, [id]: false } }))
    }
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
