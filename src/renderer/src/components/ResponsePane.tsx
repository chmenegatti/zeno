import { useState } from 'react'
import type { ResponseRecord } from '@shared/types'
import { activeRequest, api, useStore } from '../state'
import { ResponseView } from './ResponseBody'
import { Count, formatBytes, Segmented } from './ui'
import { ScriptResults } from './Scripts'

type Section = 'body' | 'headers' | 'tests' | 'info'

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
  const cur = activeRequest({ workspaces, app })
  const [section, setSection] = useState<Section>('body')
  const [pretty, setPretty] = useState(true)

  const id = cur?.req.id
  const history = (id && responses[id]) || []
  const res = history.find((r) => r.id === selected[id ?? '']) ?? history[0]
  // resultado dos scripts vale para o envio mais recente
  const report = id && res && res.id === history[0]?.id ? lastSend[id]?.scripts : undefined
  const failed = report ? report.tests.filter((t) => !t.ok).length + report.errors.length : 0

  return (
    <section data-hk="response" className="flex shrink-0 flex-col border-l border-line bg-panel" style={{ width }}>
      {!res ? (
        <div className="flex flex-1 items-center justify-center text-faint">{id && sending[id] ? 'Enviando…' : 'Sem resposta ainda'}</div>
      ) : (
        <>
          <div className="flex items-center gap-2 px-3 py-3">
            <span className={`rounded-md px-2 py-0.5 font-mono text-[12px] font-semibold ${statusColor(res)}`}>{res.error ? 'ERRO' : `${res.status} ${res.statusText}`}</span>
            <span className="text-dim">{res.timing.totalMs} ms</span>
            <span className="text-dim">{formatBytes(res.size)}</span>
            {id && sending[id] && <span className="animate-pulse text-accent">enviando…</span>}
            <div className="flex-1" />
            {history.length > 1 && (
              <select
                data-hk="history"
                className="field max-w-[180px] py-0.5 text-[11.5px]"
                value={res.id}
                onChange={(e) => useStore.setState((s) => ({ selectedResponse: { ...s.selectedResponse, [id!]: e.target.value } }))}
                title="Histórico"
              >
                {history.map((h) => (
                  <option key={h.id} value={h.id}>
                    {new Date(h.at).toLocaleTimeString('pt-BR')} · {h.error ? 'erro' : h.status}
                  </option>
                ))}
              </select>
            )}
            <button
              className="btn btn-ghost px-1.5 py-0.5 text-[11.5px]"
              title="Limpar histórico"
              onClick={async () => {
                await api.clearResponses(id!)
                useStore.setState((s) => ({ responses: { ...s.responses, [id!]: [] } }))
              }}
            >
              limpar
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
                  value={section}
                  onChange={setSection}
                  options={[
                    { id: 'body', label: 'Body' },
                    { id: 'headers', label: <>Headers<Count n={res.headers.length} /></> },
                    ...(report
                      ? [{ id: 'tests' as const, label: <>Testes{report.tests.length ? <span className={`ml-1 text-[10.5px] ${failed ? 'text-tpink' : 'text-tgreen'}`}>{report.tests.length - report.tests.filter((t) => !t.ok).length}/{report.tests.length}</span> : failed ? <span className="ml-1 text-[10.5px] text-tpink">erro</span> : null}</> }]
                      : []),
                    { id: 'info', label: 'Info' }
                  ]}
                />
                <div className="flex-1" />
                {section === 'body' && res.bodyEncoding !== 'base64' && (
                  <label className="mr-2 flex items-center gap-1 text-[11.5px] text-dim">
                    <input type="checkbox" className="accent-[var(--color-accent)]" checked={pretty} onChange={(e) => setPretty(e.target.checked)} /> formatar
                  </label>
                )}
              </div>
              <div className={`min-h-0 flex-1 ${section === 'body' ? 'overflow-hidden' : 'overflow-auto'}`}>
                {section === 'body' && <ResponseView res={res} requestId={id!} pretty={pretty} />}
                {section === 'headers' && (
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
                {section === 'tests' && (report ? <ScriptResults report={report} /> : <p className="p-3 text-faint">Este envio não teve scripts nem asserções.</p>)}
                {section === 'info' && (
                  <dl className="grid grid-cols-[120px_1fr] gap-y-1.5 p-3 text-[12px]">
                    <dt className="text-dim">Requisição</dt>
                    <dd className="break-all font-mono select-text">{res.method} {res.url}</dd>
                    <dt className="text-dim">Quando</dt>
                    <dd>{new Date(res.at).toLocaleString('pt-BR')}</dd>
                    <dt className="text-dim">Até headers</dt>
                    <dd>{res.timing.headersMs} ms</dd>
                    <dt className="text-dim">Total</dt>
                    <dd>{res.timing.totalMs} ms</dd>
                  </dl>
                )}
              </div>
            </>
          )}
        </>
      )}
    </section>
  )
}
