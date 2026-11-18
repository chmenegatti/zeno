import { useMemo, useState } from 'react'
import { prepare } from '@shared/prepare'
import { effectiveAuth } from '@shared/tree'
import { METHODS, type Auth, type AuthType, type Body, type RequestDoc } from '@shared/types'
import { activeEnvId, activeRequest, api, useStore } from '../state'
import { CodeEditor, langFor } from './CodeEditor'
import { KeyValueTable } from './KeyValueTable'
import { Count, METHOD_COLOR, Segmented } from './ui'
import { RequestVars, UrlField } from './Vars'
import { SecretInput } from './Secret'
import { hasScripts, ScriptsEditor } from './Scripts'
import { AssertionsEditor } from './Runner'
import { maskSecrets } from '@shared/secret'
import { parseCurl } from '@shared/curl'

type Section = 'params' | 'headers' | 'body' | 'auth' | 'scripts' | 'assertions' | 'notes'

const BODY_TYPES: { mime: string | null; label: string }[] = [
  { mime: null, label: 'Sem body' },
  { mime: 'application/json', label: 'JSON' },
  { mime: 'application/xml', label: 'XML' },
  { mime: 'text/plain', label: 'Texto' },
  { mime: 'application/x-www-form-urlencoded', label: 'Form URL-encoded' },
  { mime: 'multipart/form-data', label: 'Multipart' },
  { mime: 'application/graphql', label: 'GraphQL (texto)' }
]

const AUTH_LABEL: Record<AuthType, string> = {
  inherit: 'Herdar da pasta',
  none: 'Sem auth',
  basic: 'Basic',
  bearer: 'Bearer token',
  apikey: 'API key'
}

export function RequestPane() {
  const workspaces = useStore((s) => s.workspaces)
  const app = useStore((s) => s.app)
  const sending = useStore((s) => s.sending)
  const lastSend = useStore((s) => s.lastSend)
  const cur = activeRequest({ workspaces, app })
  const envId = activeEnvId({ workspaces, app })
  const [section, setSection] = useState<Section>('params')

  const preview = useMemo(() => (cur ? prepare(cur.ws, cur.req, cur.ancestors, envId) : null), [cur, envId])

  if (!cur) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 text-faint">
        <div className="text-3xl text-line">◇</div>
        <p>Escolha um request na lateral</p>
        <p className="text-[12px]">Ctrl+N novo · Ctrl+K buscar · Ctrl+E ambiente · Ctrl+Enter enviar</p>
      </div>
    )
  }

  const { req, ancestors } = cur
  const update = (patch: Partial<RequestDoc>) => useStore.getState().updateRequest({ ...req, ...patch })
  const isSending = !!sending[req.id]
  /** substitui o request pelo que o curl descreve (nome só muda se ainda for o padrão) */
  const applyCurl = (cmd: string) => {
    const { showError, notify } = useStore.getState()
    try {
      const p = parseCurl(cmd)
      update({
        name: req.name === 'Novo request' ? p.name : req.name,
        method: p.method,
        url: p.url,
        params: p.params,
        headers: p.headers,
        body: p.body,
        auth: p.auth
      })
      const notes = [...p.warnings]
      if (p.insecure && !cur.ws.settings.insecureTLS) notes.push('o curl usa -k: ative "Aceitar certificado TLS inválido" nas configurações do workspace')
      notify(notes.length ? `curl importado. ${notes.join('; ')}` : 'curl importado')
    } catch (e) {
      showError(e)
    }
  }
  const warn = lastSend[req.id]

  return (
    <section className="flex min-w-0 flex-1 flex-col">
      <div className="flex items-center gap-2 px-3 pt-3">
        <input
          id="request-name"
          className="min-w-0 flex-1 bg-transparent text-[15px] font-semibold outline-none focus:text-accent"
          value={req.name}
          onChange={(e) => update({ name: e.target.value })}
          onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
        />
        {ancestors.length > 0 && <span className="truncate text-[11.5px] text-faint">{ancestors.map((a) => a.name).join(' / ')}</span>}
        <button className="btn btn-ghost px-2 py-0.5 font-mono text-[11.5px]" title="Gerar código (cURL, Go, JavaScript, Python)" onClick={() => useStore.getState().openModal({ kind: 'code', id: req.id })}>{'</>'}</button>
      </div>

      <div className="flex items-center gap-1.5 p-3">
        <select className={`field w-[96px] font-mono font-semibold ${METHOD_COLOR[req.method] ?? ''}`} value={req.method} onChange={(e) => update({ method: e.target.value })}>
          {METHODS.map((m) => (
            <option key={m} value={m}>{m}</option>
          ))}
        </select>
        <UrlField value={req.url} onChange={(url) => update({ url })} onEnter={() => useStore.getState().sendActive()} onCurl={applyCurl} />
        {isSending ? (
          <button className="btn w-[88px]" onClick={() => api.cancel(req.id)}>Cancelar</button>
        ) : (
          <button className="btn btn-accent w-[88px]" onClick={() => useStore.getState().sendActive()} title="Ctrl+Enter">Enviar</button>
        )}
      </div>

      <div className="-mt-1.5 truncate px-3 pb-1.5 font-mono text-[11px] text-faint select-text" title={maskSecrets(preview?.input.url ?? '')}>
        → {maskSecrets(preview?.input.url ?? '') || '…'}
      </div>
      <RequestVars req={req} tags={preview?.unsupported ?? []} />
      {warn && warn.warnings.length > 0 && (
        <div className="mx-3 mb-2 rounded-md border border-torange/30 bg-torange/10 px-2 py-1 text-[11.5px] text-torange">
          {warn.warnings.map((w) => <div key={w} className="truncate" title={w}>{w}</div>)}
        </div>
      )}

      <div className="border-b border-line px-2 pb-1.5">
        <Segmented
          value={section}
          onChange={setSection}
          options={[
            { id: 'params', label: <>Params<Count n={req.params.length} /></> },
            { id: 'headers', label: <>Headers<Count n={req.headers.length} /></> },
            { id: 'body', label: <>Body{req.body.mime && <span className="ml-1 text-[10.5px] text-faint">{BODY_TYPES.find((b) => b.mime === req.body.mime)?.label ?? req.body.mime}</span>}</> },
            { id: 'auth', label: <>Auth<span className="ml-1 text-[10.5px] text-faint">{req.auth.type === 'inherit' ? '↑' : req.auth.type === 'none' ? '' : AUTH_LABEL[req.auth.type]}</span></> },
            { id: 'scripts', label: <>Scripts{hasScripts(req.scripts) ? <span className="ml-1 text-[10.5px] text-tpurple">●</span> : ancestors.some((a) => hasScripts(a.scripts)) ? <span className="ml-1 text-[10.5px] text-faint">↑</span> : null}</> },
            { id: 'assertions', label: <>Asserções<Count n={req.assertions?.filter((a) => a.enabled).length ?? 0} /></> },
            { id: 'notes', label: 'Notas' }
          ]}
        />
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        {section === 'params' && (
          <div className="p-3">
            <KeyValueTable rows={req.params} onChange={(params) => update({ params })} />
          </div>
        )}
        {section === 'headers' && (
          <div className="p-3">
            <KeyValueTable rows={req.headers} onChange={(headers) => update({ headers })} keyPlaceholder="Header" />
            {ancestors.some((a) => a.headers.length) && (
              <div className="mt-3 text-[11.5px] text-faint">
                Herdados das pastas:{' '}
                {ancestors.flatMap((a) => a.headers.filter((h) => h.enabled).map((h) => <code key={a.id + h.name} className="mr-2">{h.name}</code>))}
              </div>
            )}
          </div>
        )}
        {section === 'body' && <BodyEditor body={req.body} onChange={(body) => update({ body })} />}
        {section === 'auth' && <AuthEditor auth={req.auth} inherited={effectiveAuth({ ...req, auth: { type: 'inherit' } }, ancestors)} onChange={(auth) => update({ auth })} />}
        {section === 'scripts' && <ScriptsEditor scripts={req.scripts} onChange={(scripts) => update({ scripts })} />}
        {section === 'assertions' && <AssertionsEditor list={req.assertions ?? []} onChange={(assertions) => update({ assertions: assertions.length ? assertions : undefined })} />}
        {section === 'notes' && (
          <textarea className="h-full w-full resize-none bg-transparent p-3 outline-none" placeholder="Anotações sobre este request…" value={req.description ?? ''} onChange={(e) => update({ description: e.target.value })} />
        )}
      </div>
    </section>
  )
}

function BodyEditor({ body, onChange }: { body: Body; onChange: (b: Body) => void }) {
  const isForm = body.mime === 'application/x-www-form-urlencoded' || body.mime === 'multipart/form-data'
  const setMime = (mime: string | null) => {
    const toForm = mime === 'application/x-www-form-urlencoded' || mime === 'multipart/form-data'
    onChange(toForm ? { mime, fields: body.fields ?? [] } : { mime, text: body.text ?? '' })
  }
  const format = () => {
    try {
      onChange({ ...body, text: JSON.stringify(JSON.parse(body.text ?? ''), null, 2) })
    } catch {
      useStore.getState().showError('JSON inválido')
    }
  }
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 px-3 py-2">
        <select className="field py-1" value={body.mime ?? ''} onChange={(e) => setMime(e.target.value || null)}>
          {BODY_TYPES.map((b) => (
            <option key={b.label} value={b.mime ?? ''}>{b.label}</option>
          ))}
          {body.mime && !BODY_TYPES.some((b) => b.mime === body.mime) && <option value={body.mime}>{body.mime}</option>}
        </select>
        {body.mime === 'application/json' && <button className="btn btn-ghost py-1" onClick={format}>Formatar</button>}
      </div>
      {body.mime === null && <p className="px-3 text-faint">Este request não envia body.</p>}
      {isForm && (
        <div className="px-3">
          <KeyValueTable
            rows={body.fields ?? []}
            onChange={(fields) => onChange({ ...body, fields })}
            allowFiles={body.mime === 'multipart/form-data'}
            onPickFile={() => api.pickFile()}
          />
        </div>
      )}
      {body.mime !== null && !isForm && (
        <div className="min-h-0 flex-1 border-t border-line">
          <CodeEditor value={body.text ?? ''} lang={langFor(body.mime)} onChange={(text) => onChange({ ...body, text })} />
        </div>
      )}
    </div>
  )
}

export function AuthEditor({ auth, inherited, onChange, allowInherit = true }: { auth: Auth; inherited?: Auth; onChange: (a: Auth) => void; allowInherit?: boolean }) {
  const setType = (type: AuthType) => {
    if (type === auth.type) return
    if (type === 'basic') onChange({ type, username: '', password: '' })
    else if (type === 'bearer') onChange({ type, token: '' })
    else if (type === 'apikey') onChange({ type, key: '', value: '', addTo: 'header' })
    else onChange({ type })
  }
  const row = (label: string, value: string, set: (v: string) => void, secret = false) => (
    <label className="flex items-center gap-3">
      <span className="w-[90px] text-dim">{label}</span>
      <input className="field min-w-0 flex-1 font-mono text-[12px]" type={secret ? 'password' : 'text'} value={value} onChange={(e) => set(e.target.value)} spellCheck={false} />
    </label>
  )
  const secretRow = (label: string, value: string, set: (v: string) => void) => (
    <div className="flex items-center gap-3">
      <span className="w-[90px] text-dim">{label}</span>
      <SecretInput value={value} onChange={set} />
    </div>
  )
  return (
    <div className="flex flex-col gap-2.5 p-3">
      <select className="field w-[200px] py-1" value={auth.type} onChange={(e) => setType(e.target.value as AuthType)}>
        {(Object.keys(AUTH_LABEL) as AuthType[]).filter((t) => allowInherit || t !== 'inherit').map((t) => (
          <option key={t} value={t}>{AUTH_LABEL[t]}</option>
        ))}
      </select>
      {auth.type === 'inherit' && <p className="text-faint">Usando da pasta: <span className="text-dim">{inherited ? AUTH_LABEL[inherited.type] : 'sem auth'}</span></p>}
      {auth.type === 'basic' && (
        <>
          {row('Usuário', auth.username, (username) => onChange({ ...auth, username }))}
          {secretRow('Senha', auth.password, (password) => onChange({ ...auth, password }))}
        </>
      )}
      {auth.type === 'bearer' && (
        <>
          {secretRow('Token', auth.token, (token) => onChange({ ...auth, token }))}
          {row('Prefixo', auth.prefix ?? '', (prefix) => onChange({ ...auth, prefix: prefix || undefined }))}
        </>
      )}
      {auth.type === 'apikey' && (
        <>
          {row('Nome', auth.key, (key) => onChange({ ...auth, key }))}
          {secretRow('Valor', auth.value, (value) => onChange({ ...auth, value }))}
          <label className="flex items-center gap-3">
            <span className="w-[90px] text-dim">Enviar em</span>
            <select className="field py-1" value={auth.addTo} onChange={(e) => onChange({ ...auth, addTo: e.target.value as 'header' | 'query' })}>
              <option value="header">Header</option>
              <option value="query">Query string</option>
            </select>
          </label>
        </>
      )}
    </div>
  )
}
