import { useEffect, useMemo, useRef, useState } from 'react'
import { bindings, HOTKEYS } from '@shared/hotkeys'
import { indexRequests, norm, scoreFields, searchRequests } from '@shared/palette'
import { activeWorkspace, useStore } from '../state'
import { runAction } from '../hotkeys'
import { Kbd } from './Prefs'
import { MethodBadge } from './ui'

interface Command {
  id: string
  label: string
  hint?: string
  keys?: string[]
  run: () => void
}

type Item = { kind: 'cmd'; cmd: Command } | { kind: 'req'; id: string; wsId: string; name: string; method: string; path: string; url: string }

// ações da lista de atalhos que fazem sentido na paleta (as de foco precisam do painel por trás)
const SKIP = new Set(['quickSwitch', 'sidebarFilter', 'focusUrl', 'focusResponse', 'methodMenu', 'history', 'envSwitch', 'beautify'])

function useCommands(): Command[] {
  const workspaces = useStore((s) => s.workspaces)
  const app = useStore((s) => s.app)
  const ws = activeWorkspace({ workspaces, app })
  return useMemo(() => {
    const b = bindings(app.ui?.hotkeys)
    const { openModal, setApp } = useStore.getState()
    const out: Command[] = HOTKEYS.filter((h) => !SKIP.has(h.id)).map((h) => ({ id: h.id, label: h.label, keys: b[h.id], run: () => runAction(h.id) }))
    out.push({ id: 'import', label: 'Importar (Insomnia, OpenAPI, Postman)', run: () => openModal({ kind: 'import' }) })
    out.push({ id: 'plugins', label: 'Plugins', hint: 'ligar, desligar, recarregar', run: () => openModal({ kind: 'plugins' }) })
    if (ws) {
      out.push({ id: 'run', label: 'Rodar workspace', run: () => openModal({ kind: 'run', id: ws.id }) })
      out.push({ id: 'git', label: 'Git', run: () => openModal({ kind: 'git', id: ws.id }) })
      const envs = ws.environments.filter((e) => e.parentId !== null)
      const cur = app.activeEnv[ws.id] ?? null
      for (const e of [{ id: null, name: 'Só base' }, ...envs])
        if (e.id !== cur) out.push({ id: `env:${e.id}`, label: `Ambiente: ${e.name}`, hint: 'trocar ambiente', run: () => setApp({ activeEnv: { ...app.activeEnv, [ws.id]: e.id } }) })
    }
    for (const w of workspaces)
      if (w.id !== ws?.id) out.push({ id: `ws:${w.id}`, label: `Workspace: ${w.name}`, hint: 'alternar workspace', run: () => setApp({ activeWorkspaceId: w.id, activeRequestId: undefined }) })
    return out
  }, [workspaces, app, ws])
}

export function CommandPalette({ onClose }: { onClose: () => void }) {
  const workspaces = useStore((s) => s.workspaces)
  const activeWsId = useStore((s) => activeWorkspace(s)?.id)
  const commands = useCommands()
  const index = useMemo(() => indexRequests(workspaces), [workspaces])
  const [query, setQuery] = useState('')
  const [sel, setSel] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)

  // ">" no começo = só comandos
  const onlyCmds = query.startsWith('>')
  const q = onlyCmds ? query.slice(1) : query
  const items = useMemo<Item[]>(() => {
    const cmds = q.trim()
      ? commands
          .map((c) => ({ c, s: scoreFields(q, [{ text: norm(c.label), weight: 2 }, { text: norm(c.hint ?? ''), weight: 1 }]) }))
          .filter((x) => x.s >= 0)
          .sort((a, b) => b.s - a.s)
          .map((x) => x.c)
      : commands
    const cmdItems: Item[] = cmds.slice(0, q.trim() ? 8 : 50).map((cmd) => ({ kind: 'cmd', cmd }))
    if (onlyCmds) return cmdItems
    // sem busca: requests do workspace atual primeiro
    const pool = q.trim() ? index : [...index.filter((r) => r.wsId === activeWsId), ...index.filter((r) => r.wsId !== activeWsId)]
    const reqs: Item[] = searchRequests(pool, q, 60).map((r) => ({ kind: 'req', ...r }))
    return q.trim() ? [...reqs, ...cmdItems] : [...reqs.slice(0, 30), ...cmdItems]
  }, [q, onlyCmds, commands, index, activeWsId])

  useEffect(() => setSel(0), [query])
  useEffect(() => {
    listRef.current?.querySelector(`[data-i="${sel}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [sel])

  const pick = (it: Item | undefined): void => {
    if (!it) return
    onClose()
    if (it.kind === 'cmd') return it.cmd.run()
    const s = useStore.getState()
    if (it.wsId !== s.app.activeWorkspaceId) s.setApp({ activeWorkspaceId: it.wsId })
    s.selectRequest(it.id)
  }

  const onKey = (e: React.KeyboardEvent): void => {
    if (e.key === 'ArrowDown' || (e.ctrlKey && e.key === 'n')) setSel((i) => Math.min(items.length - 1, i + 1))
    else if (e.key === 'ArrowUp' || (e.ctrlKey && e.key === 'p')) setSel((i) => Math.max(0, i - 1))
    else if (e.key === 'PageDown') setSel((i) => Math.min(items.length - 1, i + 10))
    else if (e.key === 'PageUp') setSel((i) => Math.max(0, i - 10))
    else if (e.key === 'Enter') pick(items[sel])
    else if (e.key === 'Escape') onClose()
    else return
    e.preventDefault()
    e.stopPropagation()
  }

  const firstCmd = items.findIndex((it) => it.kind === 'cmd')
  return (
    <div className="fixed inset-0 z-50 flex justify-center bg-black/45 pt-[12vh]" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="flex h-fit max-h-[70vh] w-[min(680px,92vw)] flex-col overflow-hidden rounded-xl border border-line bg-panel shadow-2xl" onKeyDown={onKey}>
        <input
          autoFocus
          className="border-b border-line bg-transparent px-4 py-3 text-[14px] outline-none placeholder:text-faint"
          placeholder="Buscar request em todos os workspaces…   (> só comandos)"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto py-1">
          {!items.length && <p className="px-4 py-6 text-center text-faint">Nada encontrado</p>}
          {items.map((it, i) => (
            <div key={it.kind === 'cmd' ? `c:${it.cmd.id}` : it.id}>
              {i === firstCmd && i > 0 && <div className="mx-3 my-1 border-t border-line" />}
              <div
                data-i={i}
                className={`mx-1 flex cursor-pointer items-center gap-2.5 rounded-md px-3 py-1.5 ${i === sel ? 'bg-raised text-ink' : 'text-dim'}`}
                onMouseMove={() => i !== sel && setSel(i)}
                onClick={() => pick(it)}
              >
                {it.kind === 'req' ? (
                  <>
                    <MethodBadge method={it.method} className="w-[34px] shrink-0 text-right" />
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate text-ink">{it.name}</span>
                      <span className="truncate text-[11px] text-faint">{it.path}{it.url && <span className="ml-2 font-mono">{it.url}</span>}</span>
                    </span>
                  </>
                ) : (
                  <>
                    <span className="w-[34px] shrink-0 text-right text-faint">›</span>
                    <span className="flex-1 truncate text-ink">{it.cmd.label}{it.cmd.hint && <span className="ml-2 text-[11px] text-faint">{it.cmd.hint}</span>}</span>
                    {it.cmd.keys?.[0] && <Kbd combo={it.cmd.keys[0]} />}
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
        <div className="flex gap-3 border-t border-line px-4 py-1.5 text-[11px] text-faint">
          <span>↑↓ navegar</span>
          <span>Enter abrir</span>
          <span>Esc fechar</span>
          <span className="flex-1 text-right">{index.length} requests em {workspaces.length} workspaces</span>
        </div>
      </div>
    </div>
  )
}
