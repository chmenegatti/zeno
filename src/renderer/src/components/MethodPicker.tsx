import { useEffect, useRef, useState } from 'react'
import { METHODS } from '@shared/types'
import { useStore } from '../state'
import { kl } from '../keys'
import { t, tk } from '@shared/i18n'

/** cor de cada método (variáveis do tema) */
const COLOR: Record<string, string> = {
  GET: 'var(--color-tgreen)',
  POST: 'var(--color-torange)',
  PUT: 'var(--color-tblue)',
  PATCH: 'var(--color-tpurple)',
  DELETE: 'var(--color-tpink)',
  HEAD: 'var(--color-tlime)',
  OPTIONS: 'var(--color-dim)'
}
const HINT: Record<string, string> = {
  GET: tk('buscar§método'),
  POST: tk('criar'),
  PUT: tk('substituir'),
  PATCH: tk('alterar parte'),
  DELETE: tk('apagar'),
  HEAD: tk('só headers'),
  OPTIONS: tk('o que o servidor aceita')
}

export const methodColor = (m: string): string => COLOR[m] ?? 'var(--color-dim)'

/** seletor de método no estilo do Insomnia: botão colorido + lista com cores, teclado e método personalizado */
export function MethodPicker({ value, onChange }: { value: string; onChange: (m: string) => void }) {
  const open = useStore((s) => s.methodMenu)
  const setOpen = (v: boolean): void => useStore.setState({ methodMenu: v })
  const [sel, setSel] = useState(0)
  const [custom, setCustom] = useState('')
  const box = useRef<HTMLDivElement>(null)
  const btn = useRef<HTMLButtonElement>(null)
  const isCustom = !(METHODS as readonly string[]).includes(value)

  useEffect(() => {
    if (!open) return
    selRef.current = Math.max(0, (METHODS as readonly string[]).indexOf(value))
    setSel(selRef.current)
    setCustom(isCustom ? value : '')
    const onDown = (e: MouseEvent): void => {
      if (!box.current?.contains(e.target as Node) && !btn.current?.contains(e.target as Node)) setOpen(false)
    }
    window.addEventListener('mousedown', onDown)
    return () => window.removeEventListener('mousedown', onDown)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  // teclado com a lista aberta: setas, Enter, Esc e a inicial do método (g, p, d…)
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent): void => {
      if ((e.target as HTMLElement)?.dataset?.custom) return
      const n = METHODS.length
      const move = (i: number): void => {
        selRef.current = i
        setSel(i)
      }
      if (e.key === 'ArrowDown') move((selRef.current + 1) % n)
      else if (e.key === 'ArrowUp') move((selRef.current - 1 + n) % n)
      else if (e.key === 'Enter') pick(METHODS[selRef.current])
      else if (e.key === 'Escape') setOpen(false)
      else if (/^[a-z]$/i.test(e.key) && !e.ctrlKey && !e.metaKey && !e.altKey) {
        const hits = METHODS.map((m, i) => ({ m, i })).filter(({ m }) => m.startsWith(e.key.toUpperCase()))
        if (!hits.length) return
        const next = hits.find(({ i }) => i > selRef.current) ?? hits[0]
        move(next.i)
      } else return
      e.preventDefault()
      e.stopPropagation()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])
  const selRef = useRef(sel)
  selRef.current = sel

  const pick = (m: string): void => {
    const v = m.trim().toUpperCase()
    if (v) onChange(v)
    setOpen(false)
    btn.current?.focus()
  }

  const c = methodColor(value)
  return (
    <div className="relative shrink-0">
      <button
        ref={btn}
        data-hk="method"
        className="flex h-[30px] min-w-[96px] items-center justify-between gap-1.5 rounded-md border px-2.5 font-mono text-[12.5px] font-bold"
        style={{ color: c, borderColor: `color-mix(in srgb, ${c} 45%, transparent)`, background: `color-mix(in srgb, ${c} 12%, var(--color-bg))` }}
        onClick={() => setOpen(!open)}
        title={t('Método HTTP ({key})', { key: kl('Ctrl+Shift+L') })}
      >
        <span className="max-w-[90px] truncate">{value}</span>
        <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" aria-hidden style={{ transform: open ? 'rotate(180deg)' : undefined, transition: 'transform 120ms' }}>
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>
      {open && (
        <div ref={box} className="absolute left-0 top-[36px] z-40 w-[230px] overflow-hidden rounded-xl border border-line bg-raised p-1 shadow-2xl shadow-black/40">
          {METHODS.map((m, i) => {
            const mc = methodColor(m)
            const active = m === value
            return (
              <button
                key={m}
                className="group flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left"
                style={{ background: i === sel ? `color-mix(in srgb, ${mc} 16%, transparent)` : undefined }}
                onMouseEnter={() => setSel(i)}
                onClick={() => pick(m)}
              >
                <span className="h-5 w-1 rounded-full" style={{ background: mc, opacity: i === sel || active ? 1 : 0.55 }} />
                <span className="w-[64px] font-mono text-[12.5px] font-bold" style={{ color: mc }}>{m}</span>
                <span className="flex-1 truncate text-[11.5px] text-faint">{t(HINT[m])}</span>
                {active && <span className="text-[11px]" style={{ color: mc }}>●</span>}
              </button>
            )
          })}
          <div className="mx-1 my-1 border-t border-line" />
          <form
            className="flex items-center gap-1.5 px-1 pb-1"
            onSubmit={(e) => {
              e.preventDefault()
              if (custom.trim()) pick(custom)
            }}
          >
            <input
              data-custom="1"
              className="field min-w-0 flex-1 py-1 font-mono text-[12px] uppercase"
              placeholder={t('outro método (PROPFIND…)')}
              value={custom}
              onChange={(e) => setCustom(e.target.value.replace(/[^A-Za-z_-]/g, ''))}
              onKeyDown={(e) => e.key === 'Escape' && setOpen(false)}
            />
            <button className="btn px-2 py-1 text-[11.5px]" disabled={!custom.trim()}>{t('usar')}</button>
          </form>
        </div>
      )}
    </div>
  )
}
