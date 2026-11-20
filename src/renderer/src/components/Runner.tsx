import { useEffect, useMemo, useRef, useState } from 'react'
import { NO_VALUE, OP_LABEL, SOURCE_LABEL } from '@shared/assert'
import { findNode, sortNodes } from '@shared/tree'
import { ASSERT_OPS, ASSERT_SOURCES, type Assertion, type RequestDoc, type RunReport, type RunStep, type TreeNode, type Workspace } from '@shared/types'
import { activeEnvId, api, useStore } from '../state'
import { MethodBadge, Modal } from './ui'
import { Select } from './Select'

// ---------- asserções ----------

const NEW: Assertion = { enabled: true, source: 'status', op: 'eq', value: '200' }
/** operadores que fazem sentido por fonte */
const OPS_FOR: Record<Assertion['source'], Assertion['op'][]> = {
  status: ['eq', 'neq', 'lt', 'gt'],
  time: ['lt', 'gt'],
  header: [...ASSERT_OPS],
  json: [...ASSERT_OPS],
  body: ['contains', 'notContains', 'matches', 'eq']
}

export function AssertionsEditor({ list, onChange }: { list: Assertion[]; onChange: (l: Assertion[]) => void }) {
  const set = (i: number, patch: Partial<Assertion>) =>
    onChange(
      list.map((a, j) => {
        if (j !== i) return a
        const next = { ...a, ...patch }
        if (!OPS_FOR[next.source].includes(next.op)) next.op = OPS_FOR[next.source][0]
        if (next.source !== 'header' && next.source !== 'json') delete next.path
        if (next.source === 'json' && !next.path) next.path = '$.'
        if (NO_VALUE.includes(next.op)) delete next.value
        return next
      })
    )
  return (
    <div className="flex flex-col gap-2 p-3 text-[12.5px]">
      <p className="text-[11.5px] text-faint">
        Checagens da resposta, sem programar. Rodam depois dos scripts e aparecem em <b>Testes</b>; o valor aceita <code>{'{{ variáveis }}'}</code>. JSONPath: <code>$.user.id</code>, <code>$.items[0]</code>, <code>$.items[*].id</code>, <code>$..id</code>.
      </p>
      {list.map((a, i) => (
        <div key={i} className={`group flex items-center gap-1.5 ${a.enabled ? '' : 'opacity-45'}`}>
          <input type="checkbox" className="accent-[var(--color-accent)]" checked={a.enabled} onChange={(e) => set(i, { enabled: e.target.checked })} title="Ativa" />
          <Select className="field w-[112px] py-1" value={a.source} onChange={(v) => set(i, { source: v as Assertion['source'] })}>
            {ASSERT_SOURCES.map((s) => <option key={s} value={s}>{SOURCE_LABEL[s]}</option>)}
          </Select>
          {(a.source === 'header' || a.source === 'json') && (
            <input className="field min-w-0 flex-1 font-mono text-[12px]" placeholder={a.source === 'json' ? '$.campo' : 'Content-Type'} value={a.path ?? ''} onChange={(e) => set(i, { path: e.target.value })} />
          )}
          <Select className="field w-[112px] py-1" value={a.op} onChange={(v) => set(i, { op: v as Assertion['op'] })}>
            {OPS_FOR[a.source].map((o) => <option key={o} value={o}>{OP_LABEL[o]}</option>)}
          </Select>
          {NO_VALUE.includes(a.op) ? (
            <span className="min-w-0 flex-1" />
          ) : (
            <input className="field min-w-0 flex-1 font-mono text-[12px]" placeholder={a.op === 'matches' ? 'regex' : 'valor'} value={a.value ?? ''} onChange={(e) => set(i, { value: e.target.value })} />
          )}
          <button className="btn btn-ghost px-1.5 py-0.5 opacity-0 group-hover:opacity-100" title="Remover" onClick={() => onChange(list.filter((_, j) => j !== i))}>✕</button>
        </div>
      ))}
      <div>
        <button className="btn btn-ghost text-[12px]" onClick={() => onChange([...list, { ...NEW, ...(list.some((a) => a.source === 'status') ? { source: 'json', path: '$.', op: 'exists', value: undefined } : {}) }])}>＋ Asserção</button>
      </div>
    </div>
  )
}

// ---------- executor de coleção ----------

function requestsOf(nodes: TreeNode[]): RequestDoc[] {
  return sortNodes([...nodes]).flatMap((n) => (n.kind === 'request' ? [n] : requestsOf(n.children)))
}

const stepOk = (s: RunStep): boolean => !s.error && s.tests.every((t) => t.ok)

/** id = pasta, ou o workspace inteiro */
export function RunModal({ ws, folderId, onClose }: { ws: Workspace; folderId: string | null; onClose: () => void }) {
  const app = useStore((s) => s.app)
  const workspaces = useStore((s) => s.workspaces)
  const folder = folderId ? findNode(ws, folderId)?.node : null
  const name = folder?.name ?? ws.name
  const reqs = useMemo(() => requestsOf(folder && folder.kind === 'folder' ? folder.children : ws.children), [folder, ws])
  const subs = ws.environments.filter((e) => e.parentId !== null)
  const [envId, setEnvId] = useState<string | null>(activeEnvId({ workspaces, app }))
  const [iterations, setIterations] = useState(1)
  const [delayMs, setDelayMs] = useState(0)
  const [bail, setBail] = useState(false)
  const [data, setData] = useState<{ name: string; rows: Record<string, unknown>[] } | null>(null)
  const [steps, setSteps] = useState<RunStep[]>([])
  const [total, setTotal] = useState(0)
  const [report, setReport] = useState<RunReport | null>(null)
  const [running, setRunning] = useState(false)
  const [onlyFail, setOnlyFail] = useState(false)
  /** linhas abertas/fechadas à mão (falhas começam abertas) */
  const [toggled, setToggled] = useState<Set<number>>(new Set())
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(
    () =>
      api.onRunStep((step, _i, t) => {
        setTotal(t)
        setSteps((s) => [...s, step])
      }),
    []
  )
  useEffect(() => {
    const el = listRef.current
    if (el && running) el.scrollTop = el.scrollHeight
  }, [steps, running])

  const start = async () => {
    await useStore.getState().flushSaves()
    setSteps([])
    setReport(null)
    setToggled(new Set())
    setTotal(reqs.length * (data && iterations <= 1 ? data.rows.length : iterations))
    setRunning(true)
    try {
      const r = await useStore.getState().run(api.runCollection({ wsId: ws.id, folderId, envId, iterations, delayMs, data: data?.rows, bail }))
      if (r) setReport(r)
    } finally {
      setRunning(false)
    }
  }
  const close = () => {
    if (running) api.runCancel()
    onClose()
  }
  const pickData = async () => {
    const d = await useStore.getState().run(api.runPickData())
    if (d) setData(d)
  }
  const saveJUnit = async () => {
    if (!report) return
    const file = await useStore.getState().run(api.runSaveJUnit(report))
    if (file) useStore.getState().notify(`relatório salvo em ${file}`)
  }

  const passed = steps.filter(stepOk).length
  const failed = steps.length - passed
  const tests = steps.flatMap((s) => s.tests)
  const shown = steps.map((s, i) => [s, i] as const).filter(([s]) => !onlyFail || !stepOk(s))
  const multiIt = steps.some((s) => s.iteration > 1)

  return (
    <Modal title={`Rodar · ${name}`} onClose={close} wide>
      <div className="flex flex-col gap-3 text-[12.5px]">
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-[11px] text-faint">Ambiente</span>
            <Select className="field py-1" value={envId ?? ''} disabled={running} onChange={(v) => setEnvId(v || null)}>
              <option value="">Só base</option>
              {subs.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
            </Select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[11px] text-faint">Iterações</span>
            <input type="number" min={1} className="field w-[80px] py-1" value={iterations} disabled={running} onChange={(e) => setIterations(Math.max(1, Number(e.target.value) || 1))} />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[11px] text-faint">Atraso (ms)</span>
            <input type="number" min={0} step={100} className="field w-[90px] py-1" value={delayMs} disabled={running} onChange={(e) => setDelayMs(Math.max(0, Number(e.target.value) || 0))} />
          </label>
          <div className="flex flex-col gap-1">
            <span className="text-[11px] text-faint">Dados (CSV/JSON)</span>
            <div className="flex items-center gap-1">
              <button className="btn py-1" disabled={running} onClick={pickData} title="Cada linha vira variáveis numa iteração">{data ? `${data.name} · ${data.rows.length} linha(s)` : 'Escolher…'}</button>
              {data && <button className="btn btn-ghost px-1.5 py-1" disabled={running} onClick={() => setData(null)} title="Tirar dados">✕</button>}
            </div>
          </div>
          <label className="mb-1.5 flex items-center gap-1.5 text-dim">
            <input type="checkbox" checked={bail} disabled={running} onChange={(e) => setBail(e.target.checked)} /> parar na 1ª falha
          </label>
          <div className="ml-auto flex gap-2">
            {running ? (
              <button className="btn" onClick={() => api.runCancel()}>Parar</button>
            ) : (
              <button autoFocus className="btn btn-accent" disabled={!reqs.length} onClick={start}>{steps.length ? 'Rodar de novo' : `Rodar ${reqs.length} request(s)`}</button>
            )}
          </div>
        </div>
        {data && iterations > 1 && iterations !== data.rows.length && (
          <p className="text-[11.5px] text-faint">{iterations} iterações com {data.rows.length} linha(s): as linhas se repetem em ciclo.</p>
        )}

        {(steps.length > 0 || running) && (
          <div className="flex items-center gap-3 border-t border-line pt-3">
            <span className="font-semibold">{running ? `Rodando ${steps.length}/${total}…` : report?.cancelled ? 'Parado' : 'Concluído'}</span>
            <span className="text-tgreen">{passed} ok</span>
            <span className={failed ? 'text-tpink' : 'text-faint'}>{failed} com falha</span>
            <span className="text-faint">{tests.filter((t) => t.ok).length}/{tests.length} testes</span>
            {report && <span className="text-faint">{report.totalMs} ms</span>}
            <div className="ml-auto flex items-center gap-3">
              {failed > 0 && (
                <label className="flex items-center gap-1 text-[11.5px] text-dim">
                  <input type="checkbox" checked={onlyFail} onChange={(e) => setOnlyFail(e.target.checked)} /> só falhas
                </label>
              )}
              {report && <button className="btn py-1" onClick={saveJUnit}>Exportar JUnit…</button>}
            </div>
          </div>
        )}
        {running && total > 0 && (
          <div className="h-1 overflow-hidden rounded bg-line">
            <div className="h-full bg-accent transition-all" style={{ width: `${(steps.length / total) * 100}%` }} />
          </div>
        )}

        <div ref={listRef} className="max-h-[50vh] overflow-auto">
          {!steps.length && !running && (
            <ul className="flex flex-col gap-0.5 text-dim">
              {reqs.map((r) => (
                <li key={r.id} className="flex items-center gap-2">
                  <MethodBadge method={r.method} className="w-9" />
                  <span className="truncate">{r.name}</span>
                  {(r.assertions?.some((a) => a.enabled) || r.scripts?.post?.trim()) && <span className="text-[10.5px] text-faint">testes</span>}
                </li>
              ))}
              {!reqs.length && <li className="text-faint">Nenhum request aqui.</li>}
            </ul>
          )}
          {shown.map(([s, i]) => {
            const ok = stepOk(s)
            const expanded = toggled.has(i) !== !ok
            return (
              <div key={i} className="border-b border-line/60 py-1">
                <button className="flex w-full items-center gap-2 text-left" onClick={() => setToggled((t) => { const n = new Set(t); if (n.has(i)) n.delete(i); else n.add(i); return n })}>
                  <span className={`w-4 shrink-0 font-semibold ${ok ? 'text-tgreen' : 'text-tpink'}`}>{ok ? '✓' : '✕'}</span>
                  <MethodBadge method={s.method} className="w-9 shrink-0" />
                  <span className="min-w-0 flex-1 truncate">
                    {s.path && <span className="text-faint">{s.path} / </span>}
                    {s.name}
                    {multiIt && <span className="ml-1 text-faint">#{s.iteration}</span>}
                  </span>
                  {s.missing && <span className="text-[11px] text-torange" title={`variável sem valor: ${s.missing.join(', ')}`}>⚠</span>}
                  {s.tests.length > 0 && <span className={`text-[11px] ${s.tests.every((t) => t.ok) ? 'text-faint' : 'text-tpink'}`}>{s.tests.filter((t) => t.ok).length}/{s.tests.length}</span>}
                  <span className={`w-10 text-right font-mono text-[11.5px] ${!s.status ? 'text-tpink' : s.status < 400 ? 'text-tgreen' : 'text-tpink'}`}>{s.status || '—'}</span>
                  <span className="w-16 text-right font-mono text-[11px] text-faint">{s.timeMs} ms</span>
                </button>
                {expanded && (
                  <div className="ml-6 mt-1 flex flex-col gap-0.5 text-[12px]">
                    {s.error && <div className="font-mono text-[11.5px] text-tpink select-text">{s.error}</div>}
                    {s.warnings?.map((w) => <div key={w} className="text-[11.5px] text-torange">{w}</div>)}
                    {s.missing && <div className="text-[11.5px] text-torange">variável sem valor: {s.missing.join(', ')}</div>}
                    {s.tests.map((t, j) => (
                      <div key={j} className="flex gap-2">
                        <span className={t.ok ? 'text-tgreen' : 'text-tpink'}>{t.ok ? '✓' : '✕'}</span>
                        <span className="min-w-0">
                          {t.name}
                          {t.error && <span className="ml-2 font-mono text-[11.5px] text-tpink select-text">{t.error}</span>}
                        </span>
                      </div>
                    ))}
                    <div className="truncate font-mono text-[11px] text-faint select-text">{s.url}</div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </Modal>
  )
}
