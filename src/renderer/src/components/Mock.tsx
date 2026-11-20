// Mock server (#20): aba Exemplos do request (respostas salvas que o mock devolve) e a barra do mock
// do workspace (ligar/parar, porta, rotas, chamadas recebidas).

import { useEffect, useState } from 'react'
import type { MockStatus } from '@shared/api'
import type { Example, RequestDoc, Workspace } from '@shared/types'
import { api, useStore } from '../state'
import { CodeEditor, langFor } from './CodeEditor'
import { KeyValueTable } from './KeyValueTable'
import { Select } from './Select'
import { locale, t } from '@shared/i18n'

type Hit = { wsId: string; method: string; path: string; status: number; at: number }

const listeners = new Set<(h: Hit) => void>()
let subscribed = false
function onHit(f: (h: Hit) => void): () => void {
  if (!subscribed) {
    subscribed = true
    api.onMockHit((h) => listeners.forEach((l) => l(h)))
  }
  listeners.add(f)
  return () => void listeners.delete(f)
}

/** path da rota no mock (mesma regra do Go): sem base/host e sem query */
export function mockPath(url: string): string {
  let u = url.trim()
  const lead = /^\s*(\{\{.*?\}\}|\{%.*?%\})/.exec(u)
  if (lead) u = u.slice(lead[0].length)
  else if (u.includes('://')) {
    u = u.slice(u.indexOf('://') + 3)
    u = u.includes('/') ? u.slice(u.indexOf('/')) : '/'
  } else if (!u.startsWith('/')) u = u.includes('/') ? u.slice(u.indexOf('/')) : '/'
  u = u.split(/[?#]/)[0]
  return u.startsWith('/') ? u : `/${u}`
}

function MockBar({ ws, req }: { ws: Workspace; req: RequestDoc }) {
  const { run, setWorkspaces, notify } = useStore.getState()
  const [st, setSt] = useState<MockStatus | null>(null)
  const [hits, setHits] = useState<Hit[]>([])
  const [port, setPort] = useState('')
  useEffect(() => {
    let alive = true
    api.mockStatus(ws.id).then((s) => alive && (setSt(s), setPort(String(s.configuredPort))), () => undefined)
    const off = onHit((h) => h.wsId === ws.id && setHits((l) => [h, ...l].slice(0, 30)))
    return () => {
      alive = false
      off()
    }
  }, [ws.id, req.examples?.length])
  const savePort = async (): Promise<boolean> => {
    const n = Number(port)
    if (!Number.isInteger(n) || n < 1 || n > 65535) {
      notify(t('Porta inválida'))
      return false
    }
    if (n === st?.configuredPort) return true
    await run(api.saveWorkspace({ id: ws.id, name: ws.name, description: ws.description, settings: { ...ws.settings, mock: { port: n } } }))
    const list = await run(api.load())
    if (list) setWorkspaces(list.workspaces)
    return true
  }
  const start = async (): Promise<void> => {
    if (!(await savePort())) return
    const s = await run(api.mockStart(ws.id))
    if (s) setSt(s)
  }
  const stop = async (): Promise<void> => {
    const s = await run(api.mockStop(ws.id))
    if (s) setSt(s)
  }
  const base = st?.running ? `http://127.0.0.1:${st.port}` : ''
  const url = base + mockPath(req.url)
  return (
    <div className="flex flex-col gap-1.5 border-b border-line px-3 py-2 text-[12px]" data-mock-bar>
      <div className="flex flex-wrap items-center gap-2">
        <span className={`rounded-md px-2 py-0.5 font-mono text-[11px] font-semibold ${st?.running ? 'bg-tgreen/15 text-tgreen' : 'bg-raised text-dim'}`}>{st?.running ? t('MOCK LIGADO') : t('MOCK DESLIGADO')}</span>
        <label className="flex items-center gap-1 text-dim">
          {t('porta')}
          <input className="field w-[70px] py-0.5 font-mono text-[11.5px]" value={port} disabled={st?.running} onChange={(e) => setPort(e.target.value.replace(/\D/g, ''))} />
        </label>
        {st?.running ? (
          <button className="btn py-0.5 text-[12px]" onClick={() => void stop()}>{t('Parar')}</button>
        ) : (
          <button className="btn btn-accent py-0.5 text-[12px]" onClick={() => void start()} title={t('Servidor local que responde cada rota do workspace com o exemplo salvo')}>{t('Ligar mock')}</button>
        )}
        <span className="text-faint">{st ? t('{n} rota(s) com exemplo no workspace', { n: st.routes.length }) : ''}</span>
      </div>
      {st?.running && (
        <div className="flex items-center gap-2">
          <span className="text-faint">{t('esta rota:')}</span>
          <code className="min-w-0 truncate select-text">{req.method} {url}</code>
          <button className="btn btn-ghost px-1.5 py-0 text-[11px]" onClick={() => void navigator.clipboard.writeText(url).then(() => notify(t('URL copiada')))}>{t('copiar')}</button>
        </div>
      )}
      {hits.length > 0 && (
        <details className="text-[11.5px]">
          <summary className="cursor-pointer text-dim">{t('{n} chamada(s) recebida(s)', { n: hits.length })}</summary>
          <div className="mt-1 max-h-[120px] overflow-auto font-mono">
            {hits.map((h, i) => (
              <div key={i} className="flex gap-2">
                <span className="text-faint">{new Date(h.at).toLocaleTimeString(locale())}</span>
                <span className={h.status < 400 ? 'text-tgreen' : 'text-torange'}>{h.status}</span>
                <span className="truncate">{h.method} {h.path}</span>
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  )
}

export function ExamplesEditor({ ws, req, onChange }: { ws: Workspace; req: RequestDoc; onChange: (examples: Example[] | undefined) => void }) {
  const list = req.examples ?? []
  const [selId, setSelId] = useState<string | null>(null)
  const sel = list.find((e) => e.id === selId) ?? list.find((e) => e.default) ?? list[0]
  const set = (patch: Partial<Example>): void => onChange(list.map((e) => (e.id === sel?.id ? { ...e, ...patch } : e)))
  const add = (): void => {
    const ex: Example = { id: `ex_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`, name: t('Exemplo'), status: 200, headers: [{ name: 'Content-Type', value: 'application/json', enabled: true }], body: '{}' }
    onChange([...list, ex])
    setSelId(ex.id)
  }
  const ct = sel?.headers.find((h) => h.enabled && h.name.toLowerCase() === 'content-type')?.value
  return (
    <div className="flex h-full flex-col">
      <MockBar ws={ws} req={req} />
      <div className="flex flex-wrap items-center gap-2 px-3 py-2">
        {list.length > 0 && (
          <Select className="field max-w-[260px] py-1" value={sel?.id ?? ''} onChange={(v) => setSelId(v)}>
            {list.map((e) => (
              <option key={e.id} value={e.id}>{`${e.default || (!list.some((x) => x.default) && e === list[0]) ? '★ ' : ''}${e.name || t('(sem nome)')} · ${e.status}`}</option>
            ))}
          </Select>
        )}
        <button className="btn py-1" onClick={add}>＋ {t('Exemplo')}</button>
        <span className="text-[11.5px] text-faint">{t('ou ★ exemplo numa resposta do histórico')}</span>
      </div>
      {!sel ? (
        <p className="px-3 text-faint">{t('Sem exemplos. O mock só responde rotas com exemplo.')}</p>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col gap-2 px-3 pb-3">
          <div className="flex flex-wrap items-center gap-2 text-[12px]">
            <input className="field min-w-[160px] flex-1 py-1" value={sel.name} placeholder={t('nome')} onChange={(e) => set({ name: e.target.value })} />
            <label className="flex items-center gap-1 text-dim">
              status
              <input className="field w-[64px] py-1 font-mono" value={sel.status} onChange={(e) => set({ status: Number(e.target.value.replace(/\D/g, '').slice(0, 3)) || 0 })} />
            </label>
            <label className="flex items-center gap-1 text-dim">
              {t('atraso')}
              <input className="field w-[70px] py-1 font-mono" value={sel.delayMs ?? ''} placeholder="0" onChange={(e) => set({ delayMs: Number(e.target.value.replace(/\D/g, '')) || undefined })} /> ms
            </label>
            <label className="flex items-center gap-1 text-dim" title={t('O mock responde com o padrão; sem padrão, com o primeiro')}>
              <input type="checkbox" checked={!!sel.default} onChange={(e) => onChange(list.map((x) => ({ ...x, default: x.id === sel.id ? e.target.checked || undefined : undefined })))} /> {t('padrão')}
            </label>
            <button className="btn btn-ghost py-1 text-tpink" onClick={() => (onChange(list.length > 1 ? list.filter((e) => e.id !== sel.id) : undefined), setSelId(null))}>{t('Excluir')}</button>
          </div>
          <KeyValueTable rows={sel.headers} onChange={(headers) => set({ headers })} keyPlaceholder="Header" />
          <div className="min-h-[160px] flex-1 rounded-md border border-line">
            {sel.bodyEncoding === 'base64' ? (
              <p className="p-3 text-faint">{t('Body binário ({n} bytes), servido como está.', { n: Math.round((sel.body.length * 3) / 4) })}</p>
            ) : (
              <CodeEditor value={sel.body} lang={langFor(ct ?? (sel.body.trim().startsWith('{') || sel.body.trim().startsWith('[') ? 'application/json' : 'text/plain'))} onChange={(body) => set({ body })} />
            )}
          </div>
        </div>
      )}
    </div>
  )
}
