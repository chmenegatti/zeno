import { useEffect, useMemo, useState } from 'react'
import { bindings, comboFromEvent, conflicts, HOTKEYS, type HotkeyGroup } from '@shared/hotkeys'
import { useStore } from '../state'
import { EDITOR_FONT, recording, setUi, UI_FONT, ZOOM_STEPS } from '../hotkeys'
import { Modal } from './ui'

const GROUPS: HotkeyGroup[] = ['Interface', 'Request', 'Ambientes']

export function Kbd({ combo }: { combo: string }) {
  return <kbd className="rounded border border-line bg-raised px-1.5 py-0.5 font-mono text-[11px] text-ink">{combo}</kbd>
}

// ---------- preferências ----------

export function PrefsModal({ onClose }: { onClose: () => void }) {
  const p = useStore((s) => s.app.ui) ?? {}
  const zoom = p.zoom ?? 1
  const num = (v: string, lim: { min: number; max: number; def: number }): number => {
    const n = Number(v)
    return Number.isFinite(n) && n > 0 ? Math.min(lim.max, Math.max(lim.min, n)) : lim.def
  }
  return (
    <Modal title="Preferências" onClose={onClose}>
      <div className="flex flex-col gap-4">
        <label className="flex items-center gap-3">
          <span className="w-[170px] text-dim">Zoom</span>
          <select className="field flex-1" value={String(zoom)} onChange={(e) => setUi({ zoom: Number(e.target.value) })}>
            {[...new Set([...ZOOM_STEPS, zoom])].sort((a, b) => a - b).map((z) => (
              <option key={z} value={String(z)}>{Math.round(z * 100)}%</option>
            ))}
          </select>
          <span className="w-[130px] text-faint">Ctrl+= / - / 0</span>
        </label>
        <label className="flex items-center gap-3">
          <span className="w-[170px] text-dim">Fonte da interface (px)</span>
          <input type="number" className="field flex-1" min={UI_FONT.min} max={UI_FONT.max} step={0.5} value={p.fontSize ?? UI_FONT.def} onChange={(e) => setUi({ fontSize: num(e.target.value, UI_FONT) })} />
          <span className="w-[130px] text-faint">padrão {UI_FONT.def}</span>
        </label>
        <label className="flex items-center gap-3">
          <span className="w-[170px] text-dim">Fonte dos editores (px)</span>
          <input type="number" className="field flex-1" min={EDITOR_FONT.min} max={EDITOR_FONT.max} step={0.5} value={p.editorFontSize ?? EDITOR_FONT.def} onChange={(e) => setUi({ editorFontSize: num(e.target.value, EDITOR_FONT) })} />
          <span className="w-[130px] text-faint">Ctrl+Shift+= / -</span>
        </label>
        <div className="flex items-center gap-2">
          <button className="btn" onClick={() => useStore.getState().openModal({ kind: 'shortcuts' })}>Atalhos de teclado…</button>
          <div className="flex-1" />
          <button className="btn" onClick={() => setUi({ zoom: 1, fontSize: undefined, editorFontSize: undefined })}>Restaurar padrão</button>
          <button className="btn btn-accent" onClick={onClose}>Fechar</button>
        </div>
      </div>
    </Modal>
  )
}

// ---------- atalhos ----------

export function ShortcutsModal({ onClose }: { onClose: () => void }) {
  const overrides = useStore((s) => s.app.ui?.hotkeys) ?? {}
  const [query, setQuery] = useState('')
  /** id gravando; add = acrescenta em vez de trocar */
  const [rec, setRec] = useState<{ id: string; add: boolean } | null>(null)
  const b = useMemo(() => bindings(overrides), [overrides])
  const clash = useMemo(() => conflicts(overrides), [overrides])

  const save = (id: string, keys: string[] | undefined): void => {
    const next = { ...overrides }
    const def = HOTKEYS.find((h) => h.id === id)!.keys
    if (!keys || JSON.stringify(keys) === JSON.stringify(def)) delete next[id]
    else next[id] = keys
    setUi({ hotkeys: Object.keys(next).length ? next : undefined })
  }

  // gravação: a próxima combinação vira o atalho; Esc cancela
  useEffect(() => {
    if (!rec) return
    recording.on = true
    const onKey = (e: KeyboardEvent): void => {
      e.preventDefault()
      e.stopPropagation()
      if (e.key === 'Escape') return setRec(null)
      const combo = comboFromEvent(e)
      if (!combo) return
      save(rec.id, rec.add ? [...new Set([...b[rec.id], combo])] : [combo])
      setRec(null)
    }
    window.addEventListener('keydown', onKey, true)
    return () => {
      recording.on = false
      window.removeEventListener('keydown', onKey, true)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rec])

  const q = query.trim().toLowerCase()
  const rows = HOTKEYS.filter((h) => !q || `${h.label} ${b[h.id].join(' ')}`.toLowerCase().includes(q))

  return (
    <Modal title="Atalhos de teclado" onClose={() => !rec && onClose()} wide>
      <div className="flex flex-col gap-3">
        <input autoFocus className="field" placeholder="Buscar ação ou tecla…" value={query} onChange={(e) => setQuery(e.target.value)} />
        {GROUPS.map((g) => {
          const list = rows.filter((h) => h.group === g)
          if (!list.length) return null
          return (
            <div key={g}>
              <h3 className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-faint">{g}</h3>
              <div className="flex flex-col">
                {list.map((h) => {
                  const custom = !!overrides[h.id]
                  return (
                    <div key={h.id} className="group flex items-center gap-2 rounded px-2 py-1 hover:bg-raised/60">
                      <span className="flex-1">{h.label}{custom && <span className="ml-2 text-[11px] text-tpurple">alterado</span>}</span>
                      {rec?.id === h.id ? (
                        <span className="animate-pulse text-accent">pressione a combinação… (Esc cancela)</span>
                      ) : (
                        <span className="flex flex-wrap items-center gap-1">
                          {b[h.id].length ? (
                            b[h.id].map((c) => (
                              <span key={c} className={`flex items-center gap-0.5 ${clash[c] ? 'text-tpink' : ''}`} title={clash[c] ? `também usado em: ${clash[c].filter((x) => x !== h.id).map((x) => HOTKEYS.find((y) => y.id === x)?.label).join(', ')}` : undefined}>
                                <Kbd combo={c} />
                                <button className="invisible px-0.5 text-faint hover:text-tpink group-hover:visible" title="remover" onClick={() => save(h.id, b[h.id].filter((x) => x !== c))}>×</button>
                              </span>
                            ))
                          ) : (
                            <span className="text-faint">sem atalho</span>
                          )}
                        </span>
                      )}
                      <span className="invisible flex gap-1 group-hover:visible">
                        <button className="btn btn-ghost px-1.5 py-0 text-[11.5px]" onClick={() => setRec({ id: h.id, add: false })}>trocar</button>
                        <button className="btn btn-ghost px-1.5 py-0 text-[11.5px]" onClick={() => setRec({ id: h.id, add: true })}>+</button>
                        {custom && <button className="btn btn-ghost px-1.5 py-0 text-[11.5px]" onClick={() => save(h.id, undefined)}>padrão</button>}
                      </span>
                    </div>
                  )
                })}
              </div>
            </div>
          )
        })}
        <p className="text-[11.5px] text-faint">Padrão igual ao do Insomnia. Em vermelho: combinação usada por mais de uma ação.</p>
      </div>
    </Modal>
  )
}
