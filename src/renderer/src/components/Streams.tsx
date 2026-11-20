// WebSocket e SSE (#6): log da conexão WebSocket e lista de eventos do text/event-stream.

import { useEffect, useMemo, useRef, useState } from 'react'
import type { SSEEvent, WsEvent } from '@shared/stream'
import { useStore } from '../state'
import { locale, t, tk } from '@shared/i18n'

const time = (ms: number): string => {
  const d = new Date(ms)
  return `${d.toLocaleTimeString(locale(), { hour12: false })}.${String(d.getMilliseconds()).padStart(3, '0')}`
}

function pretty(s: string): string {
  const v = s.trim()
  if (!(v.startsWith('{') || v.startsWith('['))) return s
  try {
    return JSON.stringify(JSON.parse(v), null, 2)
  } catch {
    return s
  }
}

/** rola pro fim quando chega coisa nova, se o usuário já estava no fim */
function useStick(dep: unknown): React.RefObject<HTMLDivElement | null> {
  const ref = useRef<HTMLDivElement>(null)
  const atEnd = useRef(true)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const on = (): void => {
      atEnd.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40
    }
    el.addEventListener('scroll', on)
    return () => el.removeEventListener('scroll', on)
  }, [])
  useEffect(() => {
    const el = ref.current
    if (el && atEnd.current) el.scrollTop = el.scrollHeight
  }, [dep])
  return ref
}

const KIND: Record<WsEvent['kind'], { icon: string; cls: string; label: string }> = {
  open: { icon: '●', cls: 'text-tgreen', label: tk('conectado') },
  in: { icon: '↓', cls: 'text-tblue', label: tk('recebida') },
  out: { icon: '↑', cls: 'text-tgreen', label: tk('enviada') },
  close: { icon: '○', cls: 'text-faint', label: tk('fechado') },
  error: { icon: '✕', cls: 'text-tpink', label: tk('erro') }
}

export function WsPane({ reqId }: { reqId: string }) {
  const log = useStore((s) => s.wsLog[reqId]) ?? []
  const state = useStore((s) => s.wsState[reqId]) ?? 'closed'
  const [filter, setFilter] = useState('')
  const [fmt, setFmt] = useState(true)
  const shown = useMemo(() => (filter ? log.filter((e) => (e.data ?? '').toLowerCase().includes(filter.toLowerCase())) : log), [log, filter])
  const box = useStick(log.length)
  const counts = { in: log.filter((e) => e.kind === 'in').length, out: log.filter((e) => e.kind === 'out').length }
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-2 px-3 py-3">
        <span className={`rounded-md px-2 py-0.5 font-mono text-[12px] font-semibold ${state === 'open' ? 'bg-tgreen/15 text-tgreen' : state === 'connecting' ? 'bg-tblue/15 text-tblue' : 'bg-raised text-dim'}`}>
          {state === 'open' ? t('CONECTADO') : state === 'connecting' ? t('CONECTANDO…') : t('DESCONECTADO')}
        </span>
        <span className="text-[12px] text-dim">↑ {counts.out} · ↓ {counts.in}</span>
        <div className="flex-1" />
        <input className="field w-[150px] py-0.5 text-[11.5px]" placeholder={t('filtrar mensagens')} value={filter} onChange={(e) => setFilter(e.target.value)} />
        <label className="flex items-center gap-1 text-[11.5px] text-dim">
          <input type="checkbox" checked={fmt} onChange={(e) => setFmt(e.target.checked)} /> {t('formatar')}
        </label>
        <button className="btn btn-ghost px-1.5 py-0.5 text-[11.5px]" onClick={() => useStore.setState((s) => ({ wsLog: { ...s.wsLog, [reqId]: [] } }))}>
          {t('limpar')}
        </button>
      </div>
      <div ref={box} className="min-h-0 flex-1 overflow-auto border-t border-line font-mono text-[12px]" data-ws-log>
        {shown.length === 0 && <p className="p-3 font-sans text-faint">{log.length ? t('Nada com esse filtro.') : t('Conecte (Ctrl+Enter) e mande a mensagem do body. O log fica só enquanto o app está aberto.')}</p>}
        {shown.map((e, i) => {
          const k = KIND[e.kind]
          const text = e.kind === 'close' ? `${e.code ? t('código {code}', { code: e.code }) : ''}${e.reason ? ` ${e.reason}` : ''}`.trim() : e.kind === 'open' ? `HTTP ${e.status ?? 101}` : (e.data ?? '')
          return (
            <div key={i} className={`flex gap-2 border-b border-line/50 px-3 py-1 ${e.kind === 'out' ? 'bg-tgreen/5' : ''}`} data-ws-kind={e.kind}>
              <span className={`w-3 shrink-0 ${k.cls}`} title={t(k.label)}>{k.icon}</span>
              <span className="shrink-0 text-[11px] text-faint">{time(e.at)}</span>
              <span className={`min-w-0 flex-1 whitespace-pre-wrap break-all select-text ${e.kind === 'error' ? 'text-tpink' : e.kind === 'open' || e.kind === 'close' ? 'text-dim' : ''}`}>
                {e.binary ? <span className="text-faint">[{t('binário, base64')}] </span> : null}
                {fmt && (e.kind === 'in' || e.kind === 'out') ? pretty(text) : text}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

/** eventos de um text/event-stream (ao vivo enquanto chega, ou do body guardado) */
export function SseEvents({ events, live }: { events: (Omit<SSEEvent, 'atMs'> & { atMs?: number })[]; live?: boolean }) {
  const [fmt, setFmt] = useState(true)
  const box = useStick(events.length)
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-2 px-3 py-1.5 text-[11.5px] text-dim">
        <span>{t('{n} evento(s)', { n: events.length })}</span>
        {live && <span className="animate-pulse text-accent">● {t('ao vivo')}</span>}
        <div className="flex-1" />
        <label className="flex items-center gap-1">
          <input type="checkbox" checked={fmt} onChange={(e) => setFmt(e.target.checked)} /> {t('formatar')}
        </label>
      </div>
      <div ref={box} className="min-h-0 flex-1 overflow-auto border-t border-line font-mono text-[12px]" data-sse-events>
        {events.map((e, i) => (
          <div key={i} className="flex gap-2 border-b border-line/50 px-3 py-1">
            <span className="w-[64px] shrink-0 text-[11px] text-faint">{e.atMs !== undefined ? `+${e.atMs} ms` : `#${i + 1}`}</span>
            <span className="shrink-0 text-tpurple">{e.event}</span>
            {e.id && <span className="shrink-0 text-[11px] text-faint">id {e.id}</span>}
            <span className="min-w-0 flex-1 whitespace-pre-wrap break-all select-text">{fmt ? pretty(e.data) : e.data}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
