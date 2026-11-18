import { useEffect, useMemo, useRef, useState } from 'react'
import type { Folder, TreeNode, Workspace } from '@shared/types'
import { walk } from '@shared/tree'
import {
  activeEnvId,
  activeWorkspace,
  api,
  createFolderIn,
  createRequestIn,
  deleteNode,
  duplicateNode,
  moveNode,
  renameNode,
  useStore
} from '../state'
import { GitButton } from './Git'
import { copyAsCurl } from './Code'
import { Chevron, FolderIcon, MethodBadge } from './ui'
import { EnvVarList } from './Vars'

const EXPANDED_KEY = 'zeno:expanded'

function loadExpanded(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(EXPANDED_KEY) || '[]'))
  } catch {
    return new Set()
  }
}

interface Menu {
  x: number
  y: number
  node: TreeNode | null
}

type DropPos = 'before' | 'after' | 'inside'

export function Sidebar() {
  const workspaces = useStore((s) => s.workspaces)
  const app = useStore((s) => s.app)
  const ws = activeWorkspace({ workspaces, app })
  const [query, setQuery] = useState('')
  const [expanded, setExpanded] = useState<Set<string>>(loadExpanded)
  const [menu, setMenu] = useState<Menu | null>(null)
  const [renaming, setRenaming] = useState<string | null>(null)
  const [drag, setDrag] = useState<{ id: string; over?: string; pos?: DropPos } | null>(null)
  const searchRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    try {
      localStorage.setItem(EXPANDED_KEY, JSON.stringify([...expanded]))
    } catch {
      /* sem storage */
    }
  }, [expanded])

  // abre as pastas do request ativo
  useEffect(() => {
    if (!ws || !app.activeRequestId) return
    walk(ws.children, (n, anc) => {
      if (n.id === app.activeRequestId && anc.some((a) => !expanded.has(a.id))) setExpanded((s) => new Set([...s, ...anc.map((a) => a.id)]))
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [app.activeRequestId, ws?.id])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        searchRef.current?.focus()
        searchRef.current?.select()
      }
    }
    const close = () => setMenu(null)
    window.addEventListener('keydown', onKey)
    window.addEventListener('click', close)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('click', close)
    }
  }, [])

  const visible = useMemo(() => (ws ? filterTree(ws.children, query.trim().toLowerCase()) : []), [ws, query])

  if (!ws)
    return (
      <aside className="flex w-[290px] shrink-0 flex-col border-r border-line bg-panel">
        <WorkspaceBar />
        <div className="flex flex-col gap-2 p-3">
          <p className="text-dim">Nenhum workspace ainda.</p>
          <button className="btn btn-accent" onClick={() => useStore.getState().openModal({ kind: 'import' })}>Importar (Insomnia, OpenAPI, Postman)</button>
          <button className="btn" onClick={() => api.createWorkspace('Meu workspace').then((list) => { useStore.getState().setWorkspaces(list); useStore.getState().setApp({ activeWorkspaceId: list[0]?.id }) })}>Criar workspace vazio</button>
        </div>
      </aside>
    )

  const toggle = (id: string) => setExpanded((s) => {
    const n = new Set(s)
    if (n.has(id)) n.delete(id)
    else n.add(id)
    return n
  })

  const onDrop = (target: TreeNode, pos: DropPos, parentId: string, siblings: TreeNode[]) => {
    if (!drag || drag.id === target.id) return
    let sortKey: number
    let newParent = parentId
    if (pos === 'inside' && target.kind === 'folder') {
      newParent = target.id
      sortKey = Math.max(0, ...target.children.map((c) => c.sortKey)) + 1000
      setExpanded((s) => new Set([...s, target.id]))
    } else {
      const i = siblings.findIndex((s) => s.id === target.id)
      const neighbor = siblings[pos === 'before' ? i - 1 : i + 1]
      const fallback = target.sortKey + (pos === 'before' ? -1000 : 1000)
      sortKey = (target.sortKey + (neighbor && neighbor.id !== drag.id ? neighbor.sortKey : fallback)) / 2
    }
    moveNode(drag.id, newParent, sortKey)
  }

  const renderNodes = (nodes: TreeNode[], parentId: string, depth: number) =>
    nodes.map((n) => {
      const isOpen = query ? true : expanded.has(n.id)
      const active = n.id === app.activeRequestId
      const over = drag?.over === n.id ? drag.pos : undefined
      return (
        <div key={n.id}>
          <div
            draggable={renaming !== n.id}
            onDragStart={(e) => {
              e.dataTransfer.effectAllowed = 'move'
              setDrag({ id: n.id })
            }}
            onDragEnd={() => setDrag(null)}
            onDragOver={(e) => {
              if (!drag) return
              e.preventDefault()
              const r = e.currentTarget.getBoundingClientRect()
              const y = (e.clientY - r.top) / r.height
              const pos: DropPos = n.kind === 'folder' && y > 0.28 && y < 0.72 ? 'inside' : y < 0.5 ? 'before' : 'after'
              if (drag.over !== n.id || drag.pos !== pos) setDrag({ ...drag, over: n.id, pos })
            }}
            onDrop={(e) => {
              e.preventDefault()
              if (drag?.pos) onDrop(n, drag.pos, parentId, nodes)
              setDrag(null)
            }}
            onClick={() => (n.kind === 'folder' ? toggle(n.id) : useStore.getState().selectRequest(n.id))}
            onDoubleClick={() => setRenaming(n.id)}
            onContextMenu={(e) => {
              e.preventDefault()
              e.stopPropagation()
              setMenu({ x: e.clientX, y: e.clientY, node: n })
            }}
            className={`relative flex h-[26px] cursor-pointer items-center gap-1.5 rounded-md pr-2 ${active ? 'bg-raised text-ink' : 'text-dim hover:bg-raised/60 hover:text-ink'} ${over === 'inside' ? 'outline outline-1 outline-accent' : ''}`}
            style={{ paddingLeft: 8 + depth * 14 }}
          >
            {over === 'before' && <div className="absolute inset-x-1 top-0 h-0.5 bg-accent" />}
            {over === 'after' && <div className="absolute inset-x-1 bottom-0 h-0.5 bg-accent" />}
            {n.kind === 'folder' ? (
              <span className="flex w-[30px] shrink-0 items-center justify-end gap-1">
                <span className="text-faint"><Chevron open={isOpen} /></span>
                <span className={isOpen ? 'text-tblue' : 'text-dim'}><FolderIcon open={isOpen} /></span>
              </span>
            ) : (
              <MethodBadge method={n.method} className="w-[30px] shrink-0 text-right" />
            )}
            {renaming === n.id ? (
              <input
                autoFocus
                defaultValue={n.name}
                className="field h-[22px] min-w-0 flex-1 py-0"
                onClick={(e) => e.stopPropagation()}
                onBlur={(e) => {
                  renameNode(n, e.target.value)
                  setRenaming(null)
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') e.currentTarget.blur()
                  if (e.key === 'Escape') setRenaming(null)
                }}
              />
            ) : (
              <span className={`truncate ${n.kind === 'folder' ? 'text-ink/90' : ''}`}>{n.name}</span>
            )}
          </div>
          {n.kind === 'folder' && isOpen && renderNodes(n.children, n.id, depth + 1)}
        </div>
      )
    })

  return (
    <aside className="flex w-[290px] shrink-0 flex-col border-r border-line bg-panel">
      <WorkspaceBar />
      <EnvPicker ws={ws} />
      <EnvVarList ws={ws} />
      <div className="flex items-center gap-1.5 px-2 pb-2">
        <input ref={searchRef} className="field min-w-0 flex-1" placeholder="Buscar  (Ctrl+K)" value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => e.key === 'Escape' && setQuery('')} />
        <button className="btn px-2" title="Novo request (Ctrl+N)" onClick={() => createRequestIn(ws.id)}>＋</button>
        <button className="btn px-2" title="Nova pasta" onClick={() => createFolderIn(ws.id)}>▤</button>
      </div>
      <div
        className="min-h-0 flex-1 overflow-y-auto px-1.5 pb-6"
        onContextMenu={(e) => {
          e.preventDefault()
          setMenu({ x: e.clientX, y: e.clientY, node: null })
        }}
      >
        {visible.length ? renderNodes(visible, ws.id, 0) : <p className="px-3 py-6 text-center text-faint">{query ? 'Nada encontrado' : 'Vazio. Crie um request ou importe do Insomnia.'}</p>}
      </div>
      {menu && <ContextMenu menu={menu} ws={ws} onRename={setRenaming} />}
    </aside>
  )
}

function ContextMenu({ menu, ws, onRename }: { menu: Menu; ws: Workspace; onRename: (id: string) => void }) {
  const n = menu.node
  const parentId = n?.kind === 'folder' ? n.id : ws.id
  const items: [string, () => void][] = []
  if (!n || n.kind === 'folder') {
    items.push(['Novo request', () => createRequestIn(parentId)])
    items.push(['Nova pasta', () => createFolderIn(parentId)])
  }
  if (n?.kind === 'folder') {
    items.push(['Rodar pasta…', () => useStore.getState().openModal({ kind: 'run', id: ws.id, folderId: n.id })])
    items.push(['Configurar pasta…', () => useStore.getState().openModal({ kind: 'folder', id: n.id })])
  }
  if (!n) items.push(['Rodar workspace…', () => useStore.getState().openModal({ kind: 'run', id: ws.id })])
  if (n?.kind === 'request') {
    items.push(['Copiar como cURL', () => copyAsCurl(n.id)])
    items.push(['Gerar código…', () => useStore.getState().openModal({ kind: 'code', id: n.id })])
  }
  if (n) {
    items.push(['Renomear', () => onRename(n.id)])
    items.push(['Duplicar', () => duplicateNode(n.id)])
    items.push(['Excluir', () => deleteNode(n)])
  }
  return (
    <div className="fixed z-40 min-w-[180px] rounded-lg border border-line bg-raised py-1 shadow-xl" style={{ left: menu.x, top: Math.min(menu.y, window.innerHeight - items.length * 30 - 12) }}>
      {items.map(([label, fn]) => (
        <button key={label} className={`block w-full px-3 py-1.5 text-left hover:bg-line ${label === 'Excluir' ? 'text-tpink' : ''}`} onClick={fn}>
          {label}
        </button>
      ))}
    </div>
  )
}

function WorkspaceBar() {
  const workspaces = useStore((s) => s.workspaces)
  const app = useStore((s) => s.app)
  const ws = activeWorkspace({ workspaces, app })
  const { setApp, openModal } = useStore.getState()
  const [open, setOpen] = useState(false)
  return (
    <div className="relative flex items-center gap-1 p-2">
      <button className="btn flex min-w-0 flex-1 items-center justify-between gap-2 text-left" onClick={(e) => { e.stopPropagation(); setOpen(!open) }}>
        <span className="truncate font-semibold">{ws?.name ?? 'Nenhum workspace'}</span>
        <span className="text-faint">▾</span>
      </button>
      {ws && <GitButton ws={ws} />}
      {ws && <button className="btn btn-ghost px-2" title="Configurações do workspace" onClick={() => openModal({ kind: 'workspace', id: ws.id })}>⚙</button>}
      {open && (
        <div className="absolute left-2 right-2 top-[42px] z-40 max-h-[60vh] overflow-auto rounded-lg border border-line bg-raised py-1 shadow-xl" onMouseLeave={() => setOpen(false)}>
          {workspaces.map((w) => (
            <button key={w.id} className={`block w-full truncate px-3 py-1.5 text-left hover:bg-line ${w.id === ws?.id ? 'text-accent' : ''}`} onClick={() => { setApp({ activeWorkspaceId: w.id, activeRequestId: undefined }); setOpen(false) }}>
              {w.name}
              {w.location?.linked && <span className="ml-1.5 text-[10.5px] text-faint" title={w.location.dir}>⎇</span>}
            </button>
          ))}
          <div className="my-1 border-t border-line" />
          <button className="block w-full px-3 py-1.5 text-left hover:bg-line" onClick={() => {
            setOpen(false)
            openModal({ kind: 'prompt', title: 'Novo workspace', value: '', onOk: async (name) => {
              const list = await useStore.getState().run(api.createWorkspace(name || 'Workspace'))
              if (!list) return
              useStore.getState().setWorkspaces(list)
              const created = list.find((w) => w.name === (name || 'Workspace') && !workspaces.some((o) => o.id === w.id))
              if (created) setApp({ activeWorkspaceId: created.id, activeRequestId: undefined })
            } })
          }}>＋ Novo workspace</button>
          <button className="block w-full px-3 py-1.5 text-left hover:bg-line" onClick={async () => {
            setOpen(false)
            const r = await useStore.getState().run(api.linkWorkspace())
            if (!r) return
            useStore.getState().setWorkspaces(r.workspaces)
            setApp({ activeWorkspaceId: r.id, activeRequestId: undefined })
          }}>Abrir workspace de uma pasta…</button>
          <button className="block w-full px-3 py-1.5 text-left hover:bg-line" onClick={() => { setOpen(false); openModal({ kind: 'import' }) }}>⇣ Importar (Insomnia, OpenAPI, Postman)…</button>
          <button className="block w-full px-3 py-1.5 text-left hover:bg-line" onClick={() => { setOpen(false); api.openDataDir() }}>Abrir pasta de dados</button>
        </div>
      )}
    </div>
  )
}

function EnvPicker({ ws }: { ws: Workspace }) {
  const app = useStore((s) => s.app)
  const workspaces = useStore((s) => s.workspaces)
  const current = activeEnvId({ workspaces, app })
  const subs = ws.environments.filter((e) => e.parentId !== null)
  const env = subs.find((e) => e.id === current)
  const ref = useRef<HTMLSelectElement>(null)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'e') {
        e.preventDefault()
        ref.current?.focus()
        ref.current?.showPicker?.()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  return (
    <div className="flex items-center gap-1 px-2 pb-2">
      <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: env?.color ?? 'var(--color-faint)' }} />
      <select
        ref={ref}
        className="field min-w-0 flex-1 py-1"
        value={current ?? ''}
        onChange={(e) => useStore.getState().setApp({ activeEnv: { ...app.activeEnv, [ws.id]: e.target.value || null } })}
        title="Ambiente (Ctrl+E)"
      >
        <option value="">Só base</option>
        {subs.map((e) => (
          <option key={e.id} value={e.id}>{e.name}</option>
        ))}
      </select>
      <button className="btn btn-ghost px-2" title="Editar ambientes" onClick={() => useStore.getState().openModal({ kind: 'env', id: ws.id })}>✎</button>
    </div>
  )
}

/** mantém só requests que batem com a busca (nome, url ou método) e as pastas que os contêm */
function filterTree(nodes: TreeNode[], q: string): TreeNode[] {
  if (!q) return nodes
  const out: TreeNode[] = []
  for (const n of nodes) {
    if (n.kind === 'folder') {
      const children = filterTree(n.children, q)
      if (children.length || n.name.toLowerCase().includes(q)) out.push({ ...n, children: children.length ? children : n.children } as Folder)
    } else if (`${n.method} ${n.name} ${n.url}`.toLowerCase().includes(q)) out.push(n)
  }
  return out
}
