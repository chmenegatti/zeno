import { useMemo, useState } from 'react'
import { diffLines } from '@shared/diff'
import type { ResponseRecord } from '@shared/types'
import { formatBytes } from './ui'

// credenciais conhecidas e qualquer header com nome de segredo (token, key, secret, senha, sessão…)
const SECRET_HEAD = /^((?:proxy-)?authorization|cookie|set-cookie|[\w-]*(?:token|key|secret|pass|senha|session|sessao|cred|auth)[\w-]*):\s*(.*)$/i

/** cabeçalho bruto com valores sensíveis escondidos até pedir */
function Head({ raw, reveal }: { raw: string; reveal: boolean }) {
  const lines = raw.replace(/\r\n$/, '').split('\r\n')
  return (
    <pre className="whitespace-pre-wrap break-all font-mono text-[11.5px] leading-[1.55] select-text">
      {lines.map((l, i) => {
        const m = SECRET_HEAD.exec(l)
        return (
          <div key={i} className={i === 0 ? 'text-tblue' : 'text-dim'}>
            {m && !reveal ? <>{l.slice(0, l.indexOf(':') + 1)} <span className="text-faint">•••••• ({m[2].length} caracteres)</span></> : l}
          </div>
        )
      })}
    </pre>
  )
}

function Bar({ t }: { t: NonNullable<ResponseRecord['timeline']>['timing'] }) {
  const parts = [
    { k: 'DNS', v: t.dnsMs ?? 0, c: 'bg-tpurple' },
    { k: 'Conexão', v: t.connectMs ?? 0, c: 'bg-tblue' },
    { k: 'TLS', v: t.tlsMs ?? 0, c: 'bg-tgreen' },
    { k: 'Espera (TTFB)', v: t.ttfbMs, c: 'bg-torange' },
    { k: 'Download', v: t.downloadMs, c: 'bg-tpink' }
  ]
  const total = Math.max(1, parts.reduce((a, p) => a + p.v, 0))
  return (
    <div className="flex flex-col gap-2">
      <div className="flex h-2.5 overflow-hidden rounded-full bg-line">
        {parts.map((p) => p.v > 0 && <div key={p.k} className={p.c} style={{ width: `${(p.v / total) * 100}%` }} title={`${p.k}: ${p.v} ms`} />)}
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11.5px]">
        {parts.map((p) => (
          <span key={p.k} className="flex items-center gap-1.5 text-dim">
            <span className={`h-2 w-2 rounded-full ${p.c}`} />
            {p.k} <span className="font-mono text-ink">{p.k !== 'Espera (TTFB)' && p.k !== 'Download' && p.v === 0 ? '—' : `${p.v} ms`}</span>
          </span>
        ))}
        <span className="text-dim">Total <span className="font-mono text-ink">{t.totalMs} ms</span></span>
      </div>
    </div>
  )
}

/** request final enviado, saltos de redirect, tempos e TLS (#17) */
export function TimelineView({ res }: { res: ResponseRecord }) {
  const [reveal, setReveal] = useState(false)
  const t = res.timeline
  if (!t)
    return (
      <dl className="grid grid-cols-[120px_1fr] gap-y-1.5 p-3 text-[12px]">
        <dt className="text-dim">Requisição</dt>
        <dd className="break-all font-mono select-text">{res.method} {res.url}</dd>
        <dt className="text-dim">Quando</dt>
        <dd>{new Date(res.at).toLocaleString('pt-BR')}</dd>
        <dt className="text-dim">Até headers</dt>
        <dd>{res.timing.headersMs} ms</dd>
        <dt className="text-dim">Total</dt>
        <dd>{res.timing.totalMs} ms</dd>
        <dd className="col-span-2 mt-2 text-faint">Envie de novo pra ver a linha do tempo completa (respostas antigas não têm).</dd>
      </dl>
    )
  return (
    <div className="flex flex-col gap-4 p-3 text-[12px]">
      <Bar t={t.timing} />
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11.5px] text-dim">
        <span>{new Date(res.at).toLocaleString('pt-BR')}</span>
        {t.remote && <span>servidor <span className="font-mono text-ink">{t.remote.address}:{t.remote.port}</span></span>}
        <span>{formatBytes(res.size)}</span>
        <div className="flex-1" />
        <label className="flex items-center gap-1.5">
          <input type="checkbox" checked={reveal} onChange={(e) => setReveal(e.target.checked)} /> mostrar Authorization/Cookie
        </label>
      </div>

      {t.hops.map((h, i) => {
        const last = i === t.hops.length - 1
        return (
          <div key={i} className="flex flex-col gap-1.5 rounded-lg border border-line/70 p-2.5">
            <div className="flex items-center gap-2 text-[11px] text-faint">
              {t.hops.length > 1 && <span className="rounded bg-line px-1.5 py-0.5 text-dim">salto {i + 1}/{t.hops.length}</span>}
              <span>{h.atMs} ms</span>
            </div>
            <div className="text-[11px] font-semibold uppercase tracking-wide text-faint">→ enviado</div>
            {h.requestHead ? <Head raw={h.requestHead} reveal={reveal} /> : <div className="font-mono text-dim">{h.method} {h.url}</div>}
            {i === 0 && t.requestBody && (
              <pre className="max-h-[220px] overflow-auto whitespace-pre-wrap break-all rounded-md bg-bg p-2 font-mono text-[11.5px] select-text">{t.requestBody}</pre>
            )}
            <div className="mt-1 text-[11px] font-semibold uppercase tracking-wide text-faint">← recebido</div>
            <Head raw={[`HTTP/1.1 ${h.status} ${h.statusText}`, ...h.headers.map(([k, v]) => `${k}: ${v}`)].join('\r\n')} reveal={reveal} />
            {!last && <div className="text-[11px] text-tblue">↳ redirect para {t.hops[i + 1].url}</div>}
          </div>
        )
      })}

      {t.tls && (
        <div className="flex flex-col gap-1 rounded-lg border border-line/70 p-2.5">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-faint">TLS</div>
          <dl className="grid grid-cols-[110px_1fr] gap-y-1">
            <dt className="text-dim">Protocolo</dt>
            <dd className="font-mono">{t.tls.protocol} · {t.tls.cipher}</dd>
            <dt className="text-dim">Certificado</dt>
            <dd className={t.tls.authorized ? 'text-tgreen' : 'text-torange'}>{t.tls.authorized ? 'válido' : `não verificado${t.tls.error ? ` (${t.tls.error})` : ''}`}</dd>
            <dt className="text-dim">Para</dt>
            <dd className="font-mono">{t.tls.subject}</dd>
            <dt className="text-dim">Emissor</dt>
            <dd className="font-mono">{t.tls.issuer}</dd>
            <dt className="text-dim">Validade</dt>
            <dd>{t.tls.validFrom} → {t.tls.validTo}</dd>
            {t.tls.altNames && <><dt className="text-dim">Nomes</dt><dd className="break-all font-mono text-[11px]">{t.tls.altNames}</dd></>}
            {t.tls.fingerprint && <><dt className="text-dim">SHA-256</dt><dd className="break-all font-mono text-[11px]">{t.tls.fingerprint}</dd></>}
          </dl>
        </div>
      )}
    </div>
  )
}

const pretty = (r: ResponseRecord): string => {
  if (r.bodyEncoding === 'base64') return `[binário ${formatBytes(r.size)}]`
  if (r.bodyFile) return r.body
  try {
    return JSON.stringify(JSON.parse(r.body), null, 2)
  } catch {
    return r.body
  }
}
const label = (r: ResponseRecord): string => `${new Date(r.at).toLocaleTimeString('pt-BR')} · ${r.error ? 'erro' : r.status}`

/** diff entre a resposta atual e outra do histórico */
export function CompareView({ res, history }: { res: ResponseRecord; history: ResponseRecord[] }) {
  const others = history.filter((h) => h.id !== res.id)
  const [otherId, setOtherId] = useState(others[0]?.id ?? '')
  const other = others.find((h) => h.id === otherId) ?? others[0]
  const [what, setWhat] = useState<'body' | 'headers'>('body')
  const diff = useMemo(() => {
    if (!other) return null
    const text = (r: ResponseRecord): string =>
      what === 'body' ? pretty(r) : [`${r.status} ${r.statusText}`, ...[...r.headers].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}: ${v}`)].join('\n')
    return diffLines(text(other), text(res))
  }, [res, other, what])
  if (!other || !diff) return <p className="p-3 text-faint">Envie mais uma vez pra ter o que comparar.</p>
  // binário: sem diff de texto; diz se o conteúdo é igual (quando os dois estão no histórico)
  const binary = what === 'body' && (res.bodyEncoding === 'base64' || other.bodyEncoding === 'base64')
  const binSame = binary && !res.bodyFile && !other.bodyFile && res.bodyEncoding === other.bodyEncoding ? res.body === other.body : null
  const changed = binary ? (binSame === false ? 1 : 0) : diff.lines.filter((l) => l.t !== 'same').length
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-line/60 px-3 py-1.5 text-[11.5px]">
        <span className="text-dim">comparar</span>
        <select className="field py-0.5 text-[11.5px]" value={other.id} onChange={(e) => setOtherId(e.target.value)}>
          {others.map((h) => <option key={h.id} value={h.id}>{label(h)}</option>)}
        </select>
        <span className="text-dim">→ {label(res)}</span>
        <select className="field py-0.5 text-[11.5px]" value={what} onChange={(e) => setWhat(e.target.value as 'body' | 'headers')}>
          <option value="body">body</option>
          <option value="headers">status e headers</option>
        </select>
        <div className="flex-1" />
        {binary ? (
          <span className={binSame === true ? 'text-tgreen' : binSame === false ? 'text-torange' : 'text-faint'}>
            {binSame === true ? 'conteúdo binário igual' : binSame === false ? 'conteúdo binário diferente' : 'binário grande: compare salvando em arquivo'}
          </span>
        ) : (
          <span className={changed ? 'text-torange' : 'text-tgreen'}>{changed ? `${changed} linha${changed > 1 ? 's' : ''} diferente${changed > 1 ? 's' : ''}` : 'iguais'}</span>
        )}
        {(diff.cut || res.bodyFile || other.bodyFile) && <span className="text-faint">(comparando só o começo)</span>}
      </div>
      <pre className="min-h-0 flex-1 overflow-auto py-1 font-mono text-[11.5px] leading-[1.5] select-text">
        {binary && <div className="px-3 py-2 text-faint">{formatBytes(other.size)} → {formatBytes(res.size)}. Diff linha a linha só pra texto.</div>}
        {!binary && diff.lines.map((l, i) => (
          <div key={i} className={l.t === 'add' ? 'bg-tgreen/10 text-tgreen' : l.t === 'del' ? 'bg-tpink/10 text-tpink' : 'text-dim'}>
            <span className="inline-block w-5 select-none text-center opacity-70">{l.t === 'add' ? '+' : l.t === 'del' ? '−' : ' '}</span>
            {l.text}
          </div>
        ))}
      </pre>
    </div>
  )
}
