// Tela de gestão dos workspaces (Ctrl+Shift+O): cartões ou lista, busca (também em requests), ordem,
// fixar, grupos, cor, arquivar, arrastar, ações e seleção múltipla. A organização fica no state.json
// (app.wsMeta), nunca nos YAML: não suja o git de quem versiona os workspaces.

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { countTree, walk } from '@shared/tree'
import type { GitStatus, RequestDoc, Workspace, WsMeta } from '@shared/types'
import { api, useStore } from '../state'
import { kl } from '../keys'
import { Select } from './Select'
import { MethodBadge, Segmented } from './ui'
import { ExportDialog } from './ExportWorkspaces'

const COLORS = ['#00dbff', '#a44dff', '#00ffd4', '#d9ff65', '#ff8900', '#ff009e', '#5b8cff', '#8eaab8']

type Sort = 'manual' | 'name' | 'recent'
type Status = { git?: GitStatus | null; plain?: number; secrets?: number }

const SECRET = /\$zeno\$v1\$/g

function since(ms?: number): string {
  if (!ms) return 'nunca aberto aqui'
  const m = Math.round((Date.now() - ms) / 60000)
  if (m < 1) return 'aberto agora'
  if (m < 60) return `aberto há ${m} min`
  const h = Math.round(m / 60)
  if (h < 24) return `aberto há ${h} h`
  const d = Math.round(h / 24)
  return d < 30 ? `aberto há ${d} ${d === 1 ? 'dia' : 'dias'}` : `aberto em ${new Date(ms).toLocaleDateString('pt-BR')}`
}

const norm = (s: string): string => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

export function WorkspacesModal({ onClose }: { onClose: () => void }) {
  const workspaces = useStore((s) => s.workspaces)
  const app = useStore((s) => s.app)
  const { setApp, setWorkspaces, notify, run, openModal } = useStore.getState()
  const meta = app.wsMeta ?? {}
  const view = app.ui?.wsView ?? 'grid'
  const sort: Sort = app.ui?.wsSort ?? 'manual'
  const [q, setQ] = useState('')
  const [group, setGroup] = useState<string | null>(null)
  const [showArchived, setShowArchived] = useState(false)
  const [sel, setSel] = useState<Set<string>>(new Set())
  const [focus, setFocus] = useState(0)
  const [renaming, setRenaming] = useState<string | null>(null)
  const [menu, setMenu] = useState<{ id: string; x: number; y: number } | null>(null)
  const [confirm, setConfirm] = useState<{ ids: string[] } | null>(null)
  const [ask, setAsk] = useState<{ title: string; value: string; onOk: (v: string) => void } | null>(null)
  const [status, setStatus] = useState<Record<string, Status>>({})
  const [drag, setDrag] = useState<string | null>(null)
  const [exporting, setExporting] = useState<string[] | null>(null)
  // GitHub: quando cada um foi enviado/baixado e se mudou desde então
  const [gh, setGh] = useState<Record<string, { at: number; commit: string; changed: boolean }>>({})
  useEffect(() => {
    api.githubWsStatus().then(setGh, () => undefined)
  }, [workspaces])
  const search = useRef<HTMLInputElement>(null)
  const grid = useRef<HTMLDivElement>(null)

  const setMeta = (ids: string[], patch: Partial<WsMeta> | ((m: WsMeta) => Partial<WsMeta>)): void => {
    const next = { ...meta }
    for (const id of ids) next[id] = { ...next[id], ...(typeof patch === 'function' ? patch(next[id] ?? {}) : patch) }
    setApp({ wsMeta: next })
  }
  const setUi = (patch: Partial<NonNullable<typeof app.ui>>): void => setApp({ ui: { ...app.ui, ...patch } })

  const groups = useMemo(() => [...new Set(workspaces.map((w) => meta[w.id]?.group).filter((g): g is string => !!g))].sort((a, b) => a.localeCompare(b)), [workspaces, meta])
  const archivedCount = workspaces.filter((w) => meta[w.id]?.archived).length

  // workspaces visíveis, na ordem: fixados primeiro, depois a ordem escolhida
  const visible = useMemo(() => {
    const qq = norm(q.trim())
    const list = workspaces.filter((w) => {
      const m = meta[w.id] ?? {}
      if (!showArchived && m.archived) return false
      if (group === '' && m.group) return false
      if (group && m.group !== group) return false
      return !qq || norm(`${w.name} ${w.description ?? ''} ${m.group ?? ''}`).includes(qq)
    })
    const by = (a: Workspace, b: Workspace): number => {
      if (sort === 'name') return a.name.localeCompare(b.name)
      if (sort === 'recent') return (meta[b.id]?.lastUsed ?? 0) - (meta[a.id]?.lastUsed ?? 0) || a.name.localeCompare(b.name)
      const oa = meta[a.id]?.order ?? Number.MAX_SAFE_INTEGER
      const ob = meta[b.id]?.order ?? Number.MAX_SAFE_INTEGER
      return oa - ob || a.name.localeCompare(b.name)
    }
    return list.sort((a, b) => Number(!!meta[b.id]?.pinned) - Number(!!meta[a.id]?.pinned) || by(a, b))
  }, [workspaces, meta, q, group, showArchived, sort])

  // busca também nos requests (nome e URL), em todos os workspaces
  const reqHits = useMemo(() => {
    const qq = norm(q.trim())
    if (qq.length < 2) return []
    const out: { ws: Workspace; req: RequestDoc; path: string }[] = []
    for (const ws of workspaces) {
      if (!showArchived && meta[ws.id]?.archived) continue
      walk(ws.children, (n, anc) => {
        if (n.kind === 'request' && out.length < 30 && norm(`${n.name} ${n.url}`).includes(qq)) out.push({ ws, req: n, path: anc.map((a) => a.name).join(' / ') })
      })
    }
    return out
  }, [q, workspaces, meta, showArchived])

  useEffect(() => setFocus((f) => Math.min(f, Math.max(0, visible.length - 1))), [visible.length])
  useEffect(() => search.current?.focus(), [])

  // git e cofre de cada workspace, sob demanda e poucos por vez (não trava a abertura)
  useEffect(() => {
    let alive = true
    const todo = visible.map((w) => w.id).filter((id) => !status[id])
    if (!todo.length) return
    const work = async (): Promise<void> => {
      for (let id = todo.shift(); id && alive; id = todo.shift()) {
        const ws = workspaces.find((w) => w.id === id)
        const git = await api.gitStatus(id).catch(() => null)
        const scan = await api.vaultScan(id).catch(() => null)
        const secrets = ws ? (JSON.stringify(ws).match(SECRET) ?? []).length : 0
        if (alive) setStatus((s) => ({ ...s, [id]: { git: git?.repo ? git : null, plain: scan?.plain.length ?? 0, secrets } }))
      }
    }
    void Promise.all([work(), work(), work()])
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible])

  const open = (id: string, reqId?: string): void => {
    setApp({ activeWorkspaceId: id, activeRequestId: reqId })
    if (reqId) useStore.getState().selectRequest(reqId)
    onClose()
  }
  const ws = (id: string): Workspace | undefined => workspaces.find((w) => w.id === id)

  const rename = async (id: string, name: string): Promise<void> => {
    setRenaming(null)
    const w = ws(id)
    const n = name.trim()
    if (!w || !n || n === w.name) return
    await run(api.saveWorkspace({ id: w.id, name: n, description: w.description, settings: w.settings }))
    const list = await run(api.load())
    if (list) setWorkspaces(list.workspaces)
  }
  const duplicate = async (id: string): Promise<void> => {
    const r = await run(api.duplicateWorkspace(id))
    if (!r) return
    setWorkspaces(r.workspaces)
    notify(`Duplicado: ${r.workspaces.find((w) => w.id === r.id)?.name ?? ''}`)
  }
  const remove = async (ids: string[]): Promise<void> => {
    setConfirm(null)
    let list: Workspace[] | undefined
    for (const id of ids) list = (await run(api.deleteWorkspace(id))) ?? list
    if (list) setWorkspaces(list)
    const next = { ...meta }
    ids.forEach((id) => delete next[id])
    setApp({ wsMeta: next, ...(ids.includes(app.activeWorkspaceId ?? '') ? { activeWorkspaceId: list?.[0]?.id, activeRequestId: undefined } : {}) })
    setSel(new Set())
  }
  const create = (): void =>
    setAsk({
      title: 'Novo workspace',
      value: '',
      onOk: async (name) => {
        const list = await run(api.createWorkspace(name || 'Workspace'))
        if (!list) return
        setWorkspaces(list)
        const created = list.find((w) => !workspaces.some((o) => o.id === w.id))
        if (created) open(created.id)
      }
    })
  const link = async (): Promise<void> => {
    const r = await run(api.linkWorkspace())
    if (!r) return
    setWorkspaces(r.workspaces)
    open(r.id)
  }
  const reorder = (from: string, to: string): void => {
    const ids = visible.map((w) => w.id).filter((id) => id !== from)
    ids.splice(ids.indexOf(to), 0, from)
    const next = { ...meta }
    ids.forEach((id, i) => (next[id] = { ...next[id], order: i }))
    setApp({ wsMeta: next })
  }
  const copyCmd = (w: Workspace): void => {
    // vinculado: pela pasta; senão pelo id (nome pode repetir e a CLI pegaria o primeiro)
    void navigator.clipboard.writeText(w.location?.linked ? `zeno run "${w.location.dir}"` : `zeno run ${w.id}  # ${w.name}`)
    notify('Comando copiado')
  }

  const actions = (w: Workspace): [string, () => void, string?][] => {
    const m = meta[w.id] ?? {}
    return [
      ['Abrir', () => open(w.id), 'Enter'],
      ['Renomear', () => setRenaming(w.id), 'F2'],
      ['Duplicar', () => void duplicate(w.id)],
      [m.pinned ? 'Desafixar' : 'Fixar no topo', () => setMeta([w.id], { pinned: !m.pinned })],
      ['Grupo…', () => setAsk({ title: `Grupo de "${w.name}"`, value: m.group ?? '', onOk: (g) => setMeta([w.id], { group: g.trim() || undefined }) })],
      ['Configurações…', () => openModal({ kind: 'workspace', id: w.id })],
      ['Git…', () => openModal({ kind: 'git', id: w.id })],
      ['Rodar workspace…', () => openModal({ kind: 'run', id: w.id })],
      ['Exportar…', () => setExporting([w.id])],
      ['Salvar no GitHub…', () => openModal({ kind: 'github', ids: [w.id] })],
      ['Mover para pasta…', () => void run(api.moveWorkspace(w.id)).then((l) => l && setWorkspaces(l))],
      ['Abrir a pasta', () => void run(api.openWorkspaceDir(w.id))],
      ['Copiar comando zeno run', () => copyCmd(w)],
      [m.archived ? 'Desarquivar' : 'Arquivar', () => setMeta([w.id], { archived: !m.archived })],
      ['Excluir…', () => setConfirm({ ids: [w.id] }), 'Del']
    ]
  }

  // teclado: setas, Enter, F2, Del, espaço (seleção), / (busca), Ctrl+A, Esc
  const cols = (): number => {
    if (view === 'list' || !grid.current) return 1
    const cards = [...grid.current.querySelectorAll('[data-card]')] as HTMLElement[]
    const top = cards[0]?.offsetTop
    return Math.max(1, cards.filter((c) => c.offsetTop === top).length)
  }
  const onKey = (e: React.KeyboardEvent): void => {
    const t = e.target as HTMLElement
    const inText = t.tagName === 'INPUT' || t.tagName === 'TEXTAREA'
    if (e.key === 'Escape') {
      if (menu || confirm || ask || renaming || exporting) return
      if (q) setQ('')
      else onClose()
      e.preventDefault()
      return
    }
    if (inText && t !== search.current) return
    const cur = visible[focus]
    const move = (d: number): void => {
      e.preventDefault()
      setFocus((f) => Math.max(0, Math.min(visible.length - 1, f + d)))
    }
    if (e.key === 'ArrowRight' && !inText) move(1)
    else if (e.key === 'ArrowLeft' && !inText) move(-1)
    else if (e.key === 'ArrowDown') move(cols())
    else if (e.key === 'ArrowUp') move(-cols())
    else if (e.key === 'Enter' && cur) (e.preventDefault(), open(cur.id))
    else if (e.key === 'F2' && cur) (e.preventDefault(), setRenaming(cur.id))
    else if (e.key === 'Delete' && cur && !inText) (e.preventDefault(), setConfirm({ ids: sel.size ? [...sel] : [cur.id] }))
    else if (e.key === ' ' && cur && !inText) {
      e.preventDefault()
      setSel((s) => {
        const n = new Set(s)
        if (n.has(cur.id)) n.delete(cur.id)
        else n.add(cur.id)
        return n
      })
    } else if (e.key === '/' && !inText) (e.preventDefault(), search.current?.focus())
    else if (e.key.toLowerCase() === 'a' && (e.ctrlKey || e.metaKey) && !inText) (e.preventDefault(), setSel(new Set(visible.map((w) => w.id))))
  }

  const canDrag = sort === 'manual' && !q && group === null

  const card = (w: Workspace, i: number): ReactNode => {
    const m = meta[w.id] ?? {}
    const c = countTree(w.children)
    const st = status[w.id]
    const active = w.id === app.activeWorkspaceId
    const picked = sel.has(w.id)
    const color = m.color ?? 'var(--color-line)'
    const loc = w.location?.linked ? `⎇ ${w.location.dir}` : 'pasta de dados do Zeno'
    const info = (
      <>
        <span>{c.requests} {c.requests === 1 ? 'request' : 'requests'}</span>
        <span>{c.folders} {c.folders === 1 ? 'pasta' : 'pastas'}</span>
        <span>{w.environments.length} {w.environments.length === 1 ? 'ambiente' : 'ambientes'}</span>
      </>
    )
    const badges = (
      <>
        {st?.git && (
          <span className="rounded bg-raised px-1.5 py-0.5 font-mono text-[10.5px] text-dim" title={`git: ${st.git.files.length} mudança(s)${st.git.upstream ? ` · ${st.git.upstream}` : ''}`}>
            ⎇ {st.git.branch ?? '?'}
            {st.git.files.length > 0 && <span className="text-torange"> ●{st.git.files.length}</span>}
            {st.git.ahead > 0 && <span className="text-tgreen"> ↑{st.git.ahead}</span>}
            {st.git.behind > 0 && <span className="text-tblue"> ↓{st.git.behind}</span>}
          </span>
        )}
        {gh[w.id] && (
          <span
            className={`rounded bg-raised px-1.5 py-0.5 text-[10.5px] ${gh[w.id].changed ? 'text-torange' : 'text-dim'}`}
            title={`GitHub: sincronizado em ${new Date(gh[w.id].at).toLocaleString('pt-BR')}${gh[w.id].commit ? ` (commit ${gh[w.id].commit.slice(0, 7)})` : ''}${gh[w.id].changed ? ' · mudou desde então' : ''}`}
          >
            ☁ {gh[w.id].changed ? '● mudou' : since(gh[w.id].at).replace('aberto ', '')}
          </span>
        )}
        {!!st?.secrets && <span className="rounded bg-raised px-1.5 py-0.5 text-[10.5px] text-tag" title="valores no cofre">🔒 {st.secrets}</span>}
        {!!st?.plain && (
          <span className="rounded bg-raised px-1.5 py-0.5 text-[10.5px] text-torange" title="senhas/tokens em texto puro: proteja em Configurações › Cofre">
            ⚠ {st.plain} em texto puro
          </span>
        )}
        {m.group && <span className="rounded border border-line px-1.5 py-0.5 text-[10.5px] text-dim">{m.group}</span>}
        {m.archived && <span className="rounded border border-line px-1.5 py-0.5 text-[10.5px] text-faint">arquivado</span>}
      </>
    )
    const name =
      renaming === w.id ? (
        <input
          autoFocus
          className="field min-w-0 flex-1 py-0.5 font-semibold"
          defaultValue={w.name}
          onClick={(e) => e.stopPropagation()}
          onBlur={(e) => void rename(w.id, e.target.value)}
          onKeyDown={(e) => {
            e.stopPropagation()
            if (e.key === 'Enter') void rename(w.id, (e.target as HTMLInputElement).value)
            if (e.key === 'Escape') setRenaming(null)
          }}
        />
      ) : (
        <span className={`truncate font-semibold ${active ? 'text-accent' : 'text-ink'}`}>{w.name}</span>
      )
    const common = {
      'data-card': '',
      role: 'option',
      'aria-selected': picked,
      tabIndex: -1,
      draggable: canDrag && renaming !== w.id,
      onDragStart: () => setDrag(w.id),
      onDragOver: (e: React.DragEvent) => canDrag && drag && drag !== w.id && e.preventDefault(),
      onDrop: () => drag && reorder(drag, w.id),
      onDragEnd: () => setDrag(null),
      onClick: (e: React.MouseEvent) => {
        setFocus(i)
        if (e.ctrlKey || e.metaKey || e.shiftKey) {
          setSel((s) => {
            const n = new Set(s)
            if (n.has(w.id)) n.delete(w.id)
            else n.add(w.id)
            return n
          })
        } else open(w.id)
      },
      onContextMenu: (e: React.MouseEvent) => {
        e.preventDefault()
        setFocus(i)
        setMenu({ id: w.id, x: e.clientX, y: e.clientY })
      }
    }
    const ring = i === focus ? 'ring-1 ring-accent/70' : ''
    const tools = (
      <div className="flex shrink-0 items-center gap-0.5" onClick={(e) => e.stopPropagation()}>
        <input type="checkbox" className={picked || sel.size ? '' : 'opacity-0 group-hover:opacity-100'} checked={picked} onChange={() => setSel((s) => { const n = new Set(s); if (n.has(w.id)) n.delete(w.id); else n.add(w.id); return n })} title="Selecionar" />
        <button className={`btn btn-ghost px-1 py-0 ${m.pinned ? 'text-accent' : 'text-faint opacity-0 group-hover:opacity-100'}`} title={m.pinned ? 'Desafixar' : 'Fixar no topo'} onClick={() => setMeta([w.id], { pinned: !m.pinned })}>
          {m.pinned ? '★' : '☆'}
        </button>
        <button className="btn btn-ghost px-1.5 py-0 text-faint" title="Ações" onClick={(e) => setMenu({ id: w.id, x: e.clientX, y: e.clientY })}>
          ⋯
        </button>
      </div>
    )
    if (view === 'list')
      return (
        <div key={w.id} {...common} className={`group flex cursor-pointer items-center gap-3 rounded-md px-2.5 py-2 hover:bg-raised ${picked ? 'bg-accent/10' : ''} ${ring} ${drag === w.id ? 'opacity-40' : ''}`}>
          <span className="h-6 w-1 shrink-0 rounded-full" style={{ background: color }} />
          <div className="flex min-w-0 flex-1 items-center gap-2">{name}</div>
          <div className="hidden min-w-0 items-center gap-1.5 md:flex">{badges}</div>
          <div className="flex shrink-0 gap-2 text-[11.5px] text-faint">{info}</div>
          <span className="w-[130px] shrink-0 truncate text-right text-[11px] text-faint">{active ? 'em uso' : since(m.lastUsed)}</span>
          {tools}
        </div>
      )
    return (
      <div key={w.id} {...common} className={`group flex cursor-pointer flex-col gap-2 rounded-xl border border-line bg-panel p-3 hover:border-accent/50 ${picked ? 'bg-accent/10' : ''} ${ring} ${drag === w.id ? 'opacity-40' : ''}`} style={{ borderTopColor: m.color, borderTopWidth: m.color ? 3 : undefined }}>
        <div className="flex items-center gap-2">
          <div className="flex min-w-0 flex-1 items-center gap-2">{name}</div>
          {tools}
        </div>
        <p className="line-clamp-2 min-h-[2.6em] text-[12px] text-dim">{w.description || <span className="text-faint">sem descrição</span>}</p>
        <div className="flex flex-wrap gap-x-2 text-[11.5px] text-faint">{info}</div>
        <div className="flex min-h-[22px] flex-wrap items-center gap-1.5">{badges}</div>
        <div className="mt-auto flex items-center justify-between gap-2 border-t border-line/60 pt-2 text-[11px] text-faint">
          <span className="truncate" title={w.location?.dir}>{loc}</span>
          <span className="shrink-0">{active ? 'em uso' : since(m.lastUsed)}</span>
        </div>
      </div>
    )
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55" onMouseDown={(e) => e.target === e.currentTarget && onClose()} onKeyDown={onKey}>
      <div className="flex h-[88vh] w-[min(1240px,95vw)] flex-col rounded-xl border border-line bg-bg shadow-2xl" role="dialog" aria-label="Workspaces">
        {/* topo: busca, ordem, visão e criação */}
        <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3">
          <span className="mr-1 text-[15px] font-semibold">Workspaces</span>
          <span className="text-faint">{workspaces.length - archivedCount}</span>
          <input ref={search} className="field ml-2 min-w-[220px] flex-1" placeholder="Buscar workspace ou request…  ( / )" value={q} onChange={(e) => setQ(e.target.value)} />
          <Select className="w-[180px] py-1" value={sort} onChange={(v) => setUi({ wsSort: v as Sort })} aria-label="Ordem">
            <option value="manual">Ordem manual</option>
            <option value="name">Nome</option>
            <option value="recent">Usados recentemente</option>
          </Select>
          <Segmented value={view} onChange={(v) => setUi({ wsView: v })} options={[{ id: 'grid', label: '▦ Cartões' }, { id: 'list', label: '☰ Lista' }]} />
          <button className="btn btn-accent" onClick={create}>＋ Novo</button>
          <button className="btn" onClick={() => void link()}>Abrir pasta…</button>
          <button className="btn" onClick={() => openModal({ kind: 'import' })}>⇣ Importar…</button>
          <button className="btn" onClick={() => openModal({ kind: 'github' })} title="Salvar no GitHub ou baixar de lá">☁ GitHub…</button>
          <button className="btn btn-ghost px-2" onClick={onClose} title="Fechar (Esc)">✕</button>
        </div>
        {/* filtros por grupo e arquivados */}
        {(groups.length > 0 || archivedCount > 0) && (
          <div className="flex flex-wrap items-center gap-1.5 border-b border-line/60 px-4 py-2 text-[12px]">
            {groups.length > 0 && (
              <>
                {[{ id: null as string | null, label: 'Todos' }, ...groups.map((g) => ({ id: g, label: g })), { id: '', label: 'Sem grupo' }].map((g) => (
                  <button key={String(g.id)} className={`rounded-full border px-2.5 py-0.5 ${group === g.id ? 'border-accent text-accent' : 'border-line text-dim hover:text-ink'}`} onClick={() => setGroup(g.id)}>
                    {g.label}
                  </button>
                ))}
              </>
            )}
            <div className="flex-1" />
            {archivedCount > 0 && (
              <label className="flex items-center gap-1.5 text-dim">
                <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} /> mostrar arquivados ({archivedCount})
              </label>
            )}
          </div>
        )}
        {/* ações em lote */}
        {sel.size > 0 && (
          <div className="flex items-center gap-2 border-b border-line/60 bg-accent/5 px-4 py-1.5 text-[12px]">
            <span>{sel.size} selecionado(s)</span>
            <button className="btn btn-ghost py-0.5" onClick={() => setMeta([...sel], { pinned: true })}>★ Fixar</button>
            <button className="btn btn-ghost py-0.5" onClick={() => setAsk({ title: `Grupo de ${sel.size} workspace(s)`, value: '', onOk: (g) => setMeta([...sel], { group: g.trim() || undefined }) })}>Grupo…</button>
            <button className="btn btn-ghost py-0.5" onClick={() => (setMeta([...sel], (m) => ({ archived: !m.archived })), setSel(new Set()))}>Arquivar/desarquivar</button>
            <button className="btn btn-ghost py-0.5" onClick={() => setExporting([...sel])}>⇡ Exportar…</button>
            <button className="btn btn-ghost py-0.5" onClick={() => openModal({ kind: 'github', ids: [...sel] })}>☁ Salvar no GitHub…</button>
            <button className="btn btn-ghost py-0.5 text-tpink" onClick={() => setConfirm({ ids: [...sel] })}>Excluir…</button>
            <div className="flex-1" />
            <button className="btn btn-ghost py-0.5" onClick={() => setSel(new Set(visible.map((w) => w.id)))}>Selecionar todos ({kl('Ctrl+A')})</button>
            <button className="btn btn-ghost py-0.5" onClick={() => setSel(new Set())}>Limpar</button>
          </div>
        )}

        <div className="min-h-0 flex-1 overflow-auto p-4">
          {workspaces.length === 0 ? (
            <div className="mx-auto mt-16 flex max-w-[460px] flex-col items-center gap-3 text-center">
              <p className="text-[15px] font-semibold">Nenhum workspace ainda</p>
              <p className="text-dim">Crie um do zero, traga do Insomnia, abra uma pasta com workspace.yaml (ex.: num repositório) ou baixe do GitHub.</p>
              <div className="flex flex-wrap justify-center gap-2">
                <button className="btn btn-accent" onClick={create}>＋ Novo workspace</button>
                <button className="btn" onClick={() => openModal({ kind: 'import' })}>⇣ Importar do Insomnia…</button>
                <button className="btn" onClick={() => void link()}>Abrir pasta…</button>
                <button className="btn" onClick={() => openModal({ kind: 'github' })}>☁ Baixar do GitHub…</button>
              </div>
            </div>
          ) : (
            <>
              {reqHits.length > 0 && (
                <div className="mb-4">
                  <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-faint">Requests</p>
                  <div className="flex flex-col">
                    {reqHits.map(({ ws: w, req, path }) => (
                      <button key={req.id} className="flex items-center gap-2 rounded-md px-2 py-1 text-left hover:bg-raised" onClick={() => open(w.id, req.id)}>
                        <MethodBadge method={req.method} className="w-[38px] shrink-0" />
                        <span className="truncate">{req.name}</span>
                        <span className="truncate text-[11.5px] text-faint">{w.name}{path ? ` / ${path}` : ''}</span>
                        <span className="ml-auto truncate font-mono text-[11px] text-faint">{req.url}</span>
                      </button>
                    ))}
                  </div>
                  <p className="mb-1.5 mt-4 text-[11px] font-semibold uppercase tracking-wide text-faint">Workspaces</p>
                </div>
              )}
              {visible.length === 0 ? (
                <p className="mt-10 text-center text-faint">Nenhum workspace com esse filtro.</p>
              ) : (
                <div ref={grid} role="listbox" aria-multiselectable className={view === 'grid' ? 'grid grid-cols-[repeat(auto-fill,minmax(270px,1fr))] gap-3' : 'flex flex-col gap-0.5'}>
                  {visible.map((w, i) => card(w, i))}
                </div>
              )}
            </>
          )}
        </div>
        <div className="flex items-center gap-3 border-t border-line px-4 py-1.5 text-[11px] text-faint">
          <span>↑↓←→ navegar · Enter abrir · F2 renomear · Del excluir · espaço/Ctrl+clique selecionar · / buscar · Esc fechar</span>
          <div className="flex-1" />
          {canDrag ? <span>arraste pra reordenar</span> : sort === 'manual' && <span>limpe a busca e o filtro pra reordenar</span>}
        </div>
      </div>

      {menu &&
        (() => {
          const w = ws(menu.id)
          if (!w) return null
          return (
            <div className="fixed inset-0 z-[60]" onMouseDown={() => setMenu(null)} onContextMenu={(e) => (e.preventDefault(), setMenu(null))}>
              <div className="absolute min-w-[220px] rounded-lg border border-line bg-raised py-1 shadow-xl" style={{ left: Math.min(menu.x, window.innerWidth - 240), top: Math.min(menu.y, window.innerHeight - 480) }} onMouseDown={(e) => e.stopPropagation()}>
                <div className="flex gap-1 px-3 py-1.5">
                  {COLORS.map((c) => (
                    <button key={c} className="h-4 w-4 rounded-full border border-black/20" style={{ background: c }} title="Cor" onClick={() => (setMeta([w.id], { color: c }), setMenu(null))} />
                  ))}
                  <button className="h-4 w-4 rounded-full border border-line text-[9px] text-faint" title="Sem cor" onClick={() => (setMeta([w.id], { color: undefined }), setMenu(null))}>✕</button>
                </div>
                <div className="my-1 border-t border-line" />
                {actions(w).map(([label, fn, key]) => (
                  <button key={label} className={`flex w-full items-center justify-between px-3 py-1.5 text-left hover:bg-line ${label.startsWith('Excluir') ? 'text-tpink' : ''}`} onClick={() => (setMenu(null), fn())}>
                    {label}
                    {key && <span className="text-[10.5px] text-faint">{key}</span>}
                  </button>
                ))}
              </div>
            </div>
          )
        })()}

      {exporting && <ExportDialog ids={exporting} onClose={() => setExporting(null)} />}

      {confirm && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40" onMouseDown={() => setConfirm(null)}>
          <div className="w-[min(460px,92vw)] rounded-xl border border-line bg-panel p-4 shadow-2xl" onMouseDown={(e) => e.stopPropagation()}>
            <p className="mb-2 font-semibold">Excluir {confirm.ids.length === 1 ? `"${ws(confirm.ids[0])?.name}"` : `${confirm.ids.length} workspaces`}?</p>
            <p className="mb-4 text-[12.5px] text-dim">
              {confirm.ids.some((id) => ws(id)?.location?.linked) && 'Workspace em pasta vinculada só sai da lista (os arquivos ficam). '}
              {confirm.ids.some((id) => !ws(id)?.location?.linked) && 'Os da pasta de dados do Zeno têm os arquivos apagados. Se só quer tirar da frente, use Arquivar.'}
            </p>
            <div className="flex justify-end gap-2">
              <button className="btn" onClick={() => setConfirm(null)}>Cancelar</button>
              <button autoFocus className="btn bg-tpink text-bg" onClick={() => void remove(confirm.ids)}>Excluir</button>
            </div>
          </div>
        </div>
      )}

      {ask && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40" onMouseDown={() => setAsk(null)}>
          <form
            className="flex w-[min(420px,92vw)] flex-col gap-3 rounded-xl border border-line bg-panel p-4 shadow-2xl"
            onMouseDown={(e) => e.stopPropagation()}
            onSubmit={(e) => {
              e.preventDefault()
              const v = (new FormData(e.currentTarget).get('v') as string) ?? ''
              setAsk(null)
              ask.onOk(v)
            }}
          >
            <span className="font-semibold">{ask.title}</span>
            <input autoFocus name="v" className="field" defaultValue={ask.value} list="zeno-ws-groups" onKeyDown={(e) => e.key === 'Escape' && (e.stopPropagation(), setAsk(null))} />
            <datalist id="zeno-ws-groups">
              {groups.map((g) => (
                <option key={g} value={g} />
              ))}
            </datalist>
            <div className="flex justify-end gap-2">
              <button type="button" className="btn" onClick={() => setAsk(null)}>Cancelar</button>
              <button className="btn btn-accent">OK</button>
            </div>
          </form>
        </div>
      )}
    </div>
  )
}
