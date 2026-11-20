import { useMemo, useState } from 'react'
import type { ResponseRecord } from '@shared/types'
import { activeEnvId, activeRequest, api, useStore } from '../state'
import { ResponseView } from './ResponseBody'
import { CompareView, TimelineView } from './Timeline'
import { Count, formatBytes, Segmented } from './ui'
import { ScriptResults } from './Scripts'
import { Select } from './Select'
import { SseEvents, WsPane } from './Streams'
import { prepare } from '@shared/prepare'
import { isEventStream, isGrpcUrl, isWsUrl, parseSSE } from '@shared/stream'
import { GrpcPane } from './Grpc'
import { locale, t } from '@shared/i18n'

type Section = 'body' | 'events' | 'headers' | 'tests' | 'timeline' | 'compare'

function statusColor(r: ResponseRecord): string {
  if (r.error) return 'bg-tpink/15 text-tpink'
  if (r.status < 300) return 'bg-tgreen/15 text-tgreen'
  if (r.status < 400) return 'bg-tblue/15 text-tblue'
  if (r.status < 500) return 'bg-torange/15 text-torange'
  return 'bg-tpink/15 text-tpink'
}


export function ResponsePane({ width }: { width: number }) {
  const workspaces = useStore((s) => s.workspaces)
  const app = useStore((s) => s.app)
  const responses = useStore((s) => s.responses)
  const selected = useStore((s) => s.selectedResponse)
  const sending = useStore((s) => s.sending)
  const lastSend = useStore((s) => s.lastSend)
  const live = useStore((s) => s.live)
  const cur = activeRequest({ workspaces, app })
  const envId = activeEnvId({ workspaces, app })
  const [section, setSection] = useState<Section>('body')
  const [pretty, setPretty] = useState(true)

  const id = cur?.req.id
  const history = (id && responses[id]) || []
  const res = history.find((r) => r.id === selected[id ?? '']) ?? history[0]
  // resultado dos scripts vale para o envio mais recente
  const report = id && res && res.id === history[0]?.id ? lastSend[id]?.scripts : undefined
  const failed = report ? report.tests.filter((x) => !x.ok).length + report.errors.length : 0
  // WebSocket: o painel é o log da conexão
  const modeUrl = useMemo(() => (cur ? prepare(cur.ws, cur.req, cur.ancestors, envId).input.url : ''), [cur, envId])
  const wsMode = isWsUrl(modeUrl)
  const stream = !!res && !res.error && isEventStream(res.headers)
  const events = useMemo(() => (stream && res ? parseSSE(res.body) : []), [stream, res])
  const liveEvents = id && sending[id] ? (live[id] ?? []) : []
  if (isGrpcUrl(modeUrl) && id)
    return (
      <section data-hk="response" className="flex shrink-0 flex-col border-l border-line bg-panel" style={{ width }}>
        <GrpcPane reqId={id} />
      </section>
    )
  if (wsMode && id)
    return (
      <section data-hk="response" className="flex shrink-0 flex-col border-l border-line bg-panel" style={{ width }}>
        <WsPane reqId={id} />
      </section>
    )
  // SSE em andamento: eventos conforme chegam
  if (liveEvents.length > 0)
    return (
      <section data-hk="response" className="flex shrink-0 flex-col border-l border-line bg-panel" style={{ width }}>
        <div className="flex items-center gap-2 px-3 py-3">
          <span className="rounded-md bg-tblue/15 px-2 py-0.5 font-mono text-[12px] font-semibold text-tblue">STREAM</span>
          <span className="text-dim">text/event-stream</span>
          <div className="flex-1" />
          <button className="btn py-0.5 text-[12px]" onClick={() => api.cancel(id!)}>{t('Parar')}</button>
        </div>
        <div className="min-h-0 flex-1">
          <SseEvents events={liveEvents} live />
        </div>
      </section>
    )
  const sec = section === 'events' && !stream ? 'body' : section

  return (
    <section data-hk="response" className="flex shrink-0 flex-col border-l border-line bg-panel" style={{ width }}>
      {!res ? (
        <div className="flex flex-1 items-center justify-center text-faint">{id && sending[id] ? t('Enviando…') : t('Sem resposta ainda')}</div>
      ) : (
        <>
          <div className="flex items-center gap-2 px-3 py-3">
            <span className={`rounded-md px-2 py-0.5 font-mono text-[12px] font-semibold ${statusColor(res)}`}>{res.error ? t('ERRO') : `${res.status} ${res.statusText}`}</span>
            <span className="text-dim">{res.timing.totalMs} ms</span>
            <span className="text-dim">{formatBytes(res.size)}</span>
            {res.streamEnd && <span className="truncate text-[11.5px] text-torange" title={res.streamEnd}>stream {res.streamEnd}</span>}
            {id && sending[id] && <span className="animate-pulse text-accent">{t('enviando…')}</span>}
            <div className="flex-1" />
            {history.length > 1 && (
              <Select
                data-hk="history"
                className="field max-w-[180px] py-0.5 text-[11.5px]"
                value={res.id}
                onChange={(v) => useStore.setState((s) => ({ selectedResponse: { ...s.selectedResponse, [id!]: v } }))}
                title={t('Histórico')}
              >
                {history.map((h) => (
                  <option key={h.id} value={h.id}>
                    {new Date(h.at).toLocaleTimeString(locale())} · {h.error ? t('erro') : h.status}
                  </option>
                ))}
              </Select>
            )}
            {!res.error && cur && (
              <button
                className="btn btn-ghost px-1.5 py-0.5 text-[11.5px]"
                title={t('Salva esta resposta como exemplo do request (o mock do workspace responde com ela)')}
                onClick={async () => {
                  const { run, notify, updateRequest } = useStore.getState()
                  const ex = await run(api.exampleFromResponse(id!, res.id))
                  if (!ex) return
                  const list = cur.req.examples ?? []
                  updateRequest({ ...cur.req, examples: [...list, { ...ex, name: `${ex.name} (${list.length + 1})` }] })
                  notify(t('Exemplo salvo (aba Exemplos do request)'))
                }}
              >
                ★ {t('exemplo')}
              </button>
            )}
            <button
              className="btn btn-ghost px-1.5 py-0.5 text-[11.5px]"
              title={t('Limpar histórico')}
              onClick={async () => {
                await api.clearResponses(id!)
                useStore.setState((s) => ({ responses: { ...s.responses, [id!]: [] } }))
              }}
            >
              {t('limpar')}
            </button>
          </div>
          {res.error ? (
            <div className="min-h-0 flex-1 overflow-auto">
              <div className="m-3 whitespace-pre-wrap rounded-md border border-tpink/30 bg-tpink/10 p-3 font-mono text-[12px] text-tpink">{res.error}</div>
              {report && (report.tests.length > 0 || report.logs.length > 0) && <ScriptResults report={{ ...report, errors: [] }} />}
            </div>
          ) : (
            <>
              <div className="flex items-center border-b border-line px-2 pb-1.5">
                <Segmented
                  value={sec}
                  onChange={setSection}
                  options={[
                    ...(stream ? [{ id: 'events' as const, label: <>{t('Eventos')}<Count n={events.length} /></> }] : []),
                    { id: 'body', label: 'Body' },
                    { id: 'headers', label: <>Headers<Count n={res.headers.length} /></> },
                    ...(report
                      ? [{ id: 'tests' as const, label: <>{t('Testes')}{report.tests.length ? <span className={`ml-1 text-[10.5px] ${failed ? 'text-tpink' : 'text-tgreen'}`}>{report.tests.length - report.tests.filter((x) => !x.ok).length}/{report.tests.length}</span> : failed ? <span className="ml-1 text-[10.5px] text-tpink">{t('erro')}</span> : null}</> }]
                      : []),
                    { id: 'timeline', label: t('Linha do tempo') },
                    ...(history.length > 1 ? [{ id: 'compare' as const, label: t('Comparar') }] : [])
                  ]}
                />
                <div className="flex-1" />
                {sec === 'body' && res.bodyEncoding !== 'base64' && (
                  <label className="mr-2 flex items-center gap-1 text-[11.5px] text-dim">
                    <input type="checkbox" checked={pretty} onChange={(e) => setPretty(e.target.checked)} /> {t('formatar')}
                  </label>
                )}
              </div>
              <div className={`min-h-0 flex-1 ${sec === 'body' || sec === 'compare' || sec === 'events' ? 'overflow-hidden' : 'overflow-auto'}`}>
                {sec === 'events' && <SseEvents events={events} />}
                {sec === 'body' && <ResponseView res={res} requestId={id!} pretty={pretty} />}
                {sec === 'headers' && (
                  <table className="w-full font-mono text-[12px]">
                    <tbody>
                      {res.headers.map(([k, v], i) => (
                        <tr key={i} className="border-b border-line/60 align-top">
                          <td className="w-[38%] px-3 py-1 text-dim">{k}</td>
                          <td className="break-all px-3 py-1 select-text">{v}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
                {sec === 'tests' && (report ? <ScriptResults report={report} /> : <p className="p-3 text-faint">{t('Este envio não teve scripts nem asserções.')}</p>)}
                {sec === 'timeline' && <TimelineView res={res} />}
                {sec === 'compare' && <CompareView res={res} history={history} />}
              </div>
            </>
          )}
        </>
      )}
    </section>
  )
}
