// gRPC (#5): barra do request (serviço/método descobertos por reflection ou .proto, invocar, enviar
// mensagens do stream) e o log da chamada no painel da direita.

import { useEffect, useMemo, useRef, useState } from 'react'
import type { GrpcEvent, GrpcMethod } from '@shared/stream'
import type { RequestDoc, Workspace } from '@shared/types'
import { api, useStore } from '../state'
import { Select } from './Select'
import { locale, t } from '@shared/i18n'

type Svc = { name: string; methods: GrpcMethod[] }

/** serviços por request + URL + .proto, enquanto o app está aberto */
const cache = new Map<string, Svc[]>()
const keyOf = (req: RequestDoc, url: string): string => `${req.id}\n${url}\n${req.grpc?.protoFile ?? ''}`

export function kindOf(m?: GrpcMethod): string {
  if (!m) return ''
  return m.clientStream && m.serverStream ? 'bidi' : m.clientStream ? 'client stream' : m.serverStream ? 'server stream' : 'unary'
}

export function GrpcBar({ ws, req, url, envId, onChange }: { ws: Workspace; req: RequestDoc; url: string; envId: string | null; onChange: (patch: Partial<RequestDoc>) => void }) {
  const { run } = useStore.getState()
  const key = keyOf(req, url)
  const [svcs, setSvcs] = useState<Svc[] | undefined>(cache.get(key))
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const g = req.grpc ?? { service: '', method: '' }
  const discover = async (): Promise<void> => {
    setBusy(true)
    setErr('')
    try {
      const list = await api.grpcDescribe(ws.id, req, envId)
      cache.set(key, list)
      setSvcs(list)
      // escolhe o primeiro se ainda não tem
      if (!g.service && list[0]?.methods[0]) onChange({ grpc: { ...g, service: list[0].name, method: list[0].methods[0].name } })
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }
  useEffect(() => {
    setSvcs(cache.get(key))
    setErr('')
  }, [key])
  const svc = svcs?.find((s) => s.name === g.service)
  const method = svc?.methods.find((m) => m.name === g.method)
  const pick = async (): Promise<void> => {
    const f = await run(api.pickFile())
    if (f) onChange({ grpc: { ...g, protoFile: f } })
  }
  return (
    <div className="flex flex-col gap-1 px-3 pb-2 text-[12px]" data-grpc-bar>
      <div className="flex flex-wrap items-center gap-1.5">
        {svcs ? (
          <>
            <Select className="field max-w-[260px] py-1 font-mono text-[11.5px]" value={g.service} onChange={(v) => onChange({ grpc: { ...g, service: v, method: svcs.find((s) => s.name === v)?.methods[0]?.name ?? '' } })}>
              {!svc && <option value={g.service}>{g.service || t('(serviço)')}</option>}
              {svcs.map((s) => (
                <option key={s.name} value={s.name}>{s.name}</option>
              ))}
            </Select>
            <Select className="field max-w-[220px] py-1 font-mono text-[11.5px]" value={g.method} onChange={(v) => onChange({ grpc: { ...g, method: v } })}>
              {!method && <option value={g.method}>{g.method || t('(método)')}</option>}
              {(svc?.methods ?? []).map((m) => (
                <option key={m.name} value={m.name}>{m.name}</option>
              ))}
            </Select>
          </>
        ) : (
          <span className="font-mono text-[11.5px] text-dim">{g.service ? `${g.service}/${g.method}` : t('serviço e método: clique em Descobrir')}</span>
        )}
        {method && <span className="rounded bg-raised px-1.5 py-0.5 text-[10.5px] text-tpurple">{kindOf(method)}</span>}
        <button className="btn btn-ghost py-0.5 text-[12px]" disabled={busy} onClick={() => void discover()} title={g.protoFile ? t('Lê os serviços do arquivo .proto') : t('Pergunta ao servidor (server reflection)')}>
          {busy ? t('descobrindo…') : svcs ? `↻ ${t('Descobrir')}` : t('Descobrir')}
        </button>
        {method && (
          <button className="btn btn-ghost py-0.5 text-[12px]" title={t('Preenche a mensagem com os campos de {type}', { type: method.inputType })} onClick={() => onChange({ body: { mime: 'application/json', text: method.input } })}>
            {t('Exemplo de mensagem')}
          </button>
        )}
        <div className="flex-1" />
        {g.protoFile ? (
          <span className="flex min-w-0 items-center gap-1 text-[11.5px] text-dim">
            <span className="truncate font-mono" title={g.protoFile}>📄 {g.protoFile.split(/[\\/]/).pop()}</span>
            <button className="btn btn-ghost px-1 py-0 text-[11px]" title={t('Voltar pro server reflection')} onClick={() => onChange({ grpc: { ...g, protoFile: undefined } })}>✕</button>
          </span>
        ) : (
          <button className="btn btn-ghost py-0.5 text-[11.5px] text-dim" onClick={() => void pick()} title={t('Sem server reflection: escolha o .proto (imports relativos à pasta dele)')}>
            {t('usar .proto…')}
          </button>
        )}
      </div>
      {err && <div className="truncate text-[11.5px] text-tpink" title={err}>{err}</div>}
    </div>
  )
}

export function GrpcButton({ reqId }: { reqId: string }) {
  const state = useStore((s) => s.grpcState[reqId])
  const { grpcAction } = useStore.getState()
  if (state)
    return (
      <button className="btn w-[104px]" onClick={() => void grpcAction(reqId, 'cancel')}>
        {t('Cancelar')}
      </button>
    )
  return (
    <button className="btn btn-accent w-[104px]" onClick={() => void grpcAction(reqId, 'start')} title="Ctrl+Enter">
      {t('Invocar')}
    </button>
  )
}

/** rodapé da mensagem: com client streaming aberto, mandar mais uma ou finalizar */
export function GrpcSendBar({ reqId }: { reqId: string }) {
  const state = useStore((s) => s.grpcState[reqId])
  const { grpcAction } = useStore.getState()
  return (
    <div className="flex items-center gap-2 border-t border-line px-3 py-1.5 text-[11.5px]">
      <span className="text-faint">
        {state === 'streaming' ? t('Stream aberto: Ctrl+Enter manda esta mensagem; Finalizar fecha o envio') : t('Invocar manda esta mensagem (JSON); client streaming abre o stream pra mandar várias')}
      </span>
      <div className="flex-1" />
      {state === 'streaming' && (
        <>
          <button className="btn btn-accent py-0.5 text-[12px]" onClick={() => void grpcAction(reqId, 'send')}>↑ {t('Enviar mensagem')}</button>
          <button className="btn py-0.5 text-[12px]" onClick={() => void grpcAction(reqId, 'closeSend')}>{t('Finalizar envio')}</button>
        </>
      )}
    </div>
  )
}

const time = (ms: number): string => {
  const d = new Date(ms)
  return `${d.toLocaleTimeString(locale(), { hour12: false })}.${String(d.getMilliseconds()).padStart(3, '0')}`
}

export function GrpcPane({ reqId }: { reqId: string }) {
  const log = useStore((s) => s.grpcLog[reqId]) ?? []
  const state = useStore((s) => s.grpcState[reqId])
  // só a última chamada (a partir do último start)
  const [all, setAll] = useState(false)
  const shown = useMemo(() => {
    if (all) return log
    let i = -1
    log.forEach((e, k) => e.kind === 'start' && (i = k))
    return i >= 0 ? log.slice(i) : log
  }, [log, all])
  const last = [...shown].reverse().find((e) => e.kind === 'status')
  const start = shown.find((e) => e.kind === 'start')
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (box.current) box.current.scrollTop = box.current.scrollHeight
  }, [shown.length])
  const msgs = shown.filter((e) => e.kind === 'message').length
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-2 px-3 py-3">
        <span
          className={`rounded-md px-2 py-0.5 font-mono text-[12px] font-semibold ${
            state ? 'bg-tblue/15 text-tblue' : !last ? 'bg-raised text-dim' : last.code === 0 ? 'bg-tgreen/15 text-tgreen' : 'bg-tpink/15 text-tpink'
          }`}
        >
          {state ? (state === 'streaming' ? t('STREAM ABERTO') : t('CHAMANDO…')) : last ? `${last.code} ${last.codeName}` : t('SEM CHAMADA')}
        </span>
        {start && last && <span className="text-dim">{last.at - start.at} ms</span>}
        <span className="text-[12px] text-dim">{t('{n} mensagem(ns)', { n: msgs })}</span>
        <div className="flex-1" />
        <label className="flex items-center gap-1 text-[11.5px] text-dim">
          <input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} /> {t('chamadas anteriores')}
        </label>
        <button className="btn btn-ghost px-1.5 py-0.5 text-[11.5px]" onClick={() => useStore.setState((s) => ({ grpcLog: { ...s.grpcLog, [reqId]: [] } }))}>{t('limpar')}</button>
      </div>
      <div ref={box} className="min-h-0 flex-1 overflow-auto border-t border-line font-mono text-[12px]" data-grpc-log>
        {shown.length === 0 && <p className="p-3 font-sans text-faint">{t('Descubra o serviço, escolha o método e Invocar (Ctrl+Enter). O log fica só enquanto o app está aberto.')}</p>}
        {shown.map((e, i) => (
          <GrpcLine key={i} e={e} />
        ))}
      </div>
    </div>
  )
}

function GrpcLine({ e }: { e: GrpcEvent }) {
  const meta = (e.metadata ?? []).map(([k, v]) => `${k}: ${v}`).join('\n')
  const look: Record<GrpcEvent['kind'], [string, string]> = {
    start: ['▶', 'text-dim'],
    headers: ['≡', 'text-faint'],
    sent: ['↑', 'text-tgreen'],
    message: ['↓', 'text-tblue'],
    status: [e.code === 0 ? '✓' : '✕', e.code === 0 ? 'text-tgreen' : 'text-tpink'],
    error: ['✕', 'text-tpink']
  }
  const [icon, cls] = look[e.kind]
  const text =
    e.kind === 'start'
      ? `${e.method}${e.clientStream ? ` (${t('stream do cliente aberto')})` : ''}`
      : e.kind === 'headers'
        ? meta
        : e.kind === 'status'
          ? `${e.code} ${e.codeName}${e.data ? `: ${e.data}` : ''}${meta ? `\n${meta}` : ''}`
          : (e.data ?? '')
  return (
    <div className={`flex gap-2 border-b border-line/50 px-3 py-1 ${e.kind === 'sent' ? 'bg-tgreen/5' : ''}`} data-grpc-kind={e.kind}>
      <span className={`w-3 shrink-0 ${cls}`}>{icon}</span>
      <span className="shrink-0 text-[11px] text-faint">{time(e.at)}</span>
      <span className={`min-w-0 flex-1 whitespace-pre-wrap break-all select-text ${e.kind === 'status' || e.kind === 'error' ? cls : e.kind === 'headers' || e.kind === 'start' ? 'text-dim' : ''}`}>{text}</span>
    </div>
  )
}
