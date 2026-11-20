// Lista de seleção própria no lugar do <select> nativo: no WebKitGTK (versão Go) o nativo abre no estilo do
// GTK e ignora o tema. Mesma API de filhos <option value>; teclado e ARIA do padrão "select-only combobox".

import { Children, isValidElement, useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type ReactElement, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

interface Opt {
  value: string
  label: ReactNode
  text: string
  disabled: boolean
}

type OptionProps = { value?: string | number; children?: ReactNode; disabled?: boolean }

/** texto de um nó (busca por digitação e title) */
function textOf(n: ReactNode): string {
  if (n == null || typeof n === 'boolean') return ''
  if (typeof n === 'string' || typeof n === 'number') return String(n)
  if (Array.isArray(n)) return n.map(textOf).join('')
  if (isValidElement<{ children?: ReactNode }>(n)) return textOf(n.props.children)
  return ''
}

function readOptions(children: ReactNode): Opt[] {
  const out: Opt[] = []
  Children.forEach(children, (c) => {
    if (!isValidElement(c) || c.type !== 'option') return
    const p = (c as ReactElement<OptionProps>).props
    const text = textOf(p.children)
    out.push({ value: String(p.value ?? text), label: p.children, text, disabled: !!p.disabled })
  })
  return out
}

export interface SelectProps {
  value: string
  onChange: (value: string) => void
  children: ReactNode
  className?: string
  disabled?: boolean
  title?: string
  'data-hk'?: string
  'aria-label'?: string
}

export function Select({ value, onChange, children, className = '', disabled, title, 'data-hk': hk, 'aria-label': ariaLabel }: SelectProps) {
  const options = readOptions(children)
  const selected = options.findIndex((o) => o.value === value)
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(-1)
  const [pos, setPos] = useState<CSSProperties>({})
  const btn = useRef<HTMLButtonElement>(null)
  const list = useRef<HTMLDivElement>(null)
  const typed = useRef({ text: '', at: 0 })
  const id = useId()
  const optId = (i: number): string => `${id}-o${i}`

  const enabled = (i: number): boolean => i >= 0 && i < options.length && !options[i].disabled
  /** próximo habilitado a partir de i na direção dir (para nas pontas) */
  const step = (from: number, dir: 1 | -1, n = 1): number => {
    let i = from
    let last = from
    for (let k = 0; k < n; ) {
      i += dir
      if (i < 0 || i >= options.length) break
      if (enabled(i)) {
        last = i
        k++
      }
    }
    return last
  }
  const first = (): number => step(-1, 1)
  const lastIdx = (): number => step(options.length, -1)

  const show = (at = selected >= 0 ? selected : first()): void => {
    if (disabled || !options.length) return
    setActive(at)
    setOpen(true)
  }
  const close = (focus = true): void => {
    setOpen(false)
    if (focus) btn.current?.focus()
  }
  const choose = (i: number): void => {
    if (!enabled(i)) return
    if (options[i].value !== value) onChange(options[i].value)
    close()
  }

  /** busca por digitação: letras seguidas em até 700 ms formam o prefixo; repetir a mesma letra percorre */
  const typeAhead = (key: string, from: number): number => {
    const now = Date.now()
    const t = typed.current
    t.text = now - t.at > 700 ? key : t.text + key
    t.at = now
    const q = t.text.toLowerCase()
    const same = q.split('').every((ch) => ch === q[0])
    const prefix = same && q.length > 1 ? q[0] : q
    const n = options.length
    const start = same && q.length > 1 ? from + 1 : q.length > 1 ? from : from + 1
    for (let k = 0; k < n; k++) {
      const i = (((start + k) % n) + n) % n
      if (enabled(i) && options[i].text.toLowerCase().startsWith(prefix)) return i
    }
    return -1
  }

  // posição da lista (fixa, fora de quem corta com overflow): embaixo do botão, ou em cima se não couber
  useLayoutEffect(() => {
    if (!open || !btn.current) return
    const r = btn.current.getBoundingClientRect()
    const below = window.innerHeight - r.bottom - 8
    const above = r.top - 8
    const want = Math.min(300, options.length * 30 + 10)
    const up = below < Math.min(want, 160) && above > below
    const maxHeight = Math.max(80, Math.min(300, up ? above : below))
    setPos({
      left: Math.min(r.left, window.innerWidth - Math.max(r.width, 160) - 8),
      minWidth: r.width,
      maxWidth: Math.max(r.width, 420),
      maxHeight,
      ...(up ? { bottom: window.innerHeight - r.top + 4 } : { top: r.bottom + 4 })
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  // item ativo sempre visível
  useEffect(() => {
    if (open && active >= 0) document.getElementById(optId(active))?.scrollIntoView({ block: 'nearest' })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, active])

  // fecha ao clicar fora, rolar a página ou redimensionar
  useEffect(() => {
    if (!open) return
    const outside = (e: MouseEvent): void => {
      const t = e.target as Node
      if (!list.current?.contains(t) && !btn.current?.contains(t)) close(false)
    }
    const scroll = (e: Event): void => {
      if (!list.current?.contains(e.target as Node)) close(false)
    }
    const resize = (): void => close(false)
    window.addEventListener('mousedown', outside, true)
    window.addEventListener('scroll', scroll, true)
    window.addEventListener('resize', resize)
    return () => {
      window.removeEventListener('mousedown', outside, true)
      window.removeEventListener('scroll', scroll, true)
      window.removeEventListener('resize', resize)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const onKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>): void => {
    if (disabled) return
    const k = e.key
    const printable = k.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey
    let handled = true
    if (!open) {
      if (k === 'ArrowDown' || k === 'ArrowUp' || k === 'Enter' || k === ' ') show()
      else if (k === 'Home') show(first())
      else if (k === 'End') show(lastIdx())
      else if (printable) {
        // fechado: digitar já escolhe, como no <select>
        const i = typeAhead(k, selected)
        if (i >= 0 && options[i].value !== value) onChange(options[i].value)
      } else handled = false
    } else {
      if (k === 'ArrowDown') setActive((a) => (e.altKey ? a : step(a, 1)))
      else if (k === 'ArrowUp') {
        if (e.altKey) choose(active)
        else setActive((a) => step(a, -1))
      } else if (k === 'Home') setActive(first())
      else if (k === 'End') setActive(lastIdx())
      else if (k === 'PageDown') setActive((a) => step(a, 1, 8))
      else if (k === 'PageUp') setActive((a) => step(a, -1, 8))
      else if (k === 'Enter' || (k === ' ' && Date.now() - typed.current.at > 700)) choose(active)
      else if (k === 'Escape') close()
      else if (k === 'Tab') {
        close(false)
        handled = false
      } else if (printable) {
        const i = typeAhead(k, active)
        if (i >= 0) setActive(i)
      } else handled = false
    }
    if (handled) {
      e.preventDefault()
      // Esc/Enter com a lista aberta não chegam a quem está em volta (fechar modal, enviar request…)
      e.stopPropagation()
    }
  }

  const cur = selected >= 0 ? options[selected] : null
  return (
    <>
      <button
        ref={btn}
        type="button"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? `${id}-list` : undefined}
        aria-activedescendant={open && active >= 0 ? optId(active) : undefined}
        aria-label={ariaLabel}
        data-hk={hk}
        title={title ?? cur?.text}
        disabled={disabled}
        className={`field inline-flex min-w-0 cursor-pointer items-center justify-between gap-1.5 text-left disabled:cursor-default disabled:opacity-60 ${className}`}
        onClick={() => (open ? close() : show())}
        onKeyDown={onKeyDown}
        onBlur={(e) => {
          if (open && !list.current?.contains(e.relatedTarget as Node)) close(false)
        }}
      >
        <span className="min-w-0 truncate">{cur ? cur.label : ' '}</span>
        <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" aria-hidden className="shrink-0 text-faint" style={{ transform: open ? 'rotate(180deg)' : undefined, transition: 'transform 120ms' }}>
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>
      {open &&
        createPortal(
          <div
            ref={list}
            id={`${id}-list`}
            role="listbox"
            aria-label={ariaLabel ?? title}
            tabIndex={-1}
            className="fixed z-[80] overflow-y-auto rounded-lg border border-line bg-raised p-1 shadow-2xl shadow-black/40"
            style={pos}
            // não tira o foco do botão
            onMouseDown={(e) => e.preventDefault()}
          >
            {options.map((o, i) => (
              <div
                key={`${o.value}\u0000${i}`}
                id={optId(i)}
                role="option"
                aria-selected={i === selected}
                aria-disabled={o.disabled || undefined}
                title={o.text}
                className={`flex cursor-pointer items-center gap-2 rounded-md px-2 py-1 ${o.disabled ? 'cursor-default opacity-45' : ''} ${i === active ? 'bg-accent/15 text-ink' : i === selected ? 'text-ink' : 'text-dim'}`}
                onMouseMove={() => !o.disabled && active !== i && setActive(i)}
                onClick={() => choose(i)}
              >
                <span className="min-w-0 flex-1 truncate">{o.label}</span>
                <span className={`w-3 shrink-0 text-[10px] text-accent ${i === selected ? '' : 'invisible'}`} aria-hidden>
                  ●
                </span>
              </div>
            ))}
          </div>,
          document.body
        )}
    </>
  )
}
