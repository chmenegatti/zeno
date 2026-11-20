import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { prepare } from '@shared/prepare'
import { effectiveAuth } from '@shared/tree'
import type { Auth, AuthType, Body, RequestDoc } from '@shared/types'
import { activeEnvId, activeRequest, api, useStore } from '../state'
import { CodeEditor, langFor } from './CodeEditor'
import { KeyValueTable } from './KeyValueTable'
import { Count, Segmented } from './ui'
import { RequestVars, UrlField } from './Vars'
import { MethodPicker } from './MethodPicker'
import { SecretInput } from './Secret'
import { hasScripts, ScriptsEditor } from './Scripts'
import { AssertionsEditor } from './Runner'
import { editorTags, TemplateInput } from './Tags'
import type { GraphQLCtx } from './GraphQLBody'
import { maskSecrets } from '@shared/secret'
import { isWsUrl } from '@shared/stream'
import { askSchedule, stopSend } from '../sendSchedule'
import { parseCurl } from '@shared/curl'
import { beautifyJson } from '@shared/format'
import { Select } from './Select'
import { kl } from '../keys'
import { newOAuth2, OAuthFields, OAuthTokenPanel } from './OAuth'
import { ExamplesEditor } from './Mock'

const GraphQLBody = lazy(() => import('./GraphQLBody'))

type Section = 'params' | 'headers' | 'body' | 'auth' | 'scripts' | 'assertions' | 'notes' | 'examples'

const BODY_TYPES: { mime: string | null; label: string }[] = [
  { mime: null, label: 'Sem body' },
  { mime: 'application/json', label: 'JSON' },
  { mime: 'application/xml', label: 'XML' },
  { mime: 'text/plain', label: 'Texto' },
  { mime: 'application/x-www-form-urlencoded', label: 'Form URL-encoded' },
  { mime: 'multipart/form-data', label: 'Multipart' },
  { mime: 'application/graphql', label: 'GraphQL' }
]

const AUTH_LABEL: Record<AuthType, string> = {
  inherit: 'Herdar da pasta',
  none: 'Sem auth',
  basic: 'Basic',
  bearer: 'Bearer token',
  apikey: 'API key',
  oauth2: 'OAuth 2.0'
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
        <p className="text-[12px]">Ctrl+N novo · Ctrl+P buscar · Ctrl+E ambiente · Ctrl+Enter enviar</p>
      </div>
    )
  }

  const { req, ancestors } = cur
  const update = (patch: Partial<RequestDoc>) => useStore.getState().updateRequest({ ...req, ...patch })
  const isSending = !!sending[req.id]
  const wsMode = isWsUrl(preview?.input.url)
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
        {wsMode ? (
          <span className="rounded-md bg-raised px-2 py-1 font-mono text-[12px] font-semibold text-tpurple" title="WebSocket (URL ws:// ou wss://)">WS</span>
        ) : (
          <MethodPicker value={req.method} onChange={(method) => update({ method })} />
        )}
        <div data-hk="url" className="contents">
          <UrlField value={req.url} onChange={(url) => update({ url })} onEnter={() => useStore.getState().sendActive()} onCurl={applyCurl} />
        </div>
        {wsMode ? (
          <WsButton reqId={req.id} />
        ) : isSending ? (
          <button className="btn w-[88px]" onClick={() => api.cancel(req.id)}>Cancelar</button>
        ) : (
          <button className="btn btn-accent w-[88px]" onClick={() => useStore.getState().sendActive()} title="Ctrl+Enter">Enviar</button>
        )}
        {!wsMode && <SendOptions reqId={req.id} />}
      </div>

      <div className="-mt-1.5 truncate px-3 pb-1.5 font-mono text-[11px] text-faint select-text" title={maskSecrets(preview?.input.url ?? '')}>
        → {maskSecrets(preview?.input.url ?? '') || '…'}
      </div>
      <RequestVars req={req} />
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
            { id: 'body', label: <>{wsMode ? 'Mensagem' : 'Body'}{req.body.mime && <span className="ml-1 text-[10.5px] text-faint">{BODY_TYPES.find((b) => b.mime === req.body.mime)?.label ?? req.body.mime}</span>}</> },
            { id: 'auth', label: <>Auth<span className="ml-1 text-[10.5px] text-faint">{req.auth.type === 'inherit' ? '↑' : req.auth.type === 'none' ? '' : req.auth.type === 'oauth2' ? 'OAuth2' : AUTH_LABEL[req.auth.type]}</span></> },
            { id: 'scripts', label: <>Scripts{hasScripts(req.scripts) ? <span className="ml-1 text-[10.5px] text-tpurple">●</span> : ancestors.some((a) => hasScripts(a.scripts)) ? <span className="ml-1 text-[10.5px] text-faint">↑</span> : null}</> },
            { id: 'assertions', label: <>Asserções<Count n={req.assertions?.filter((a) => a.enabled).length ?? 0} /></> },
            ...(wsMode ? [] : [{ id: 'examples' as const, label: <>Exemplos<Count n={req.examples?.length ?? 0} /></> }]),
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
            <div className="mt-3 flex items-center gap-4 text-[11.5px] text-dim">
              <label className="flex items-center gap-1.5" title="Manda os cookies guardados do workspace que valem pra esta URL">
                <input type="checkbox" checked={req.sendCookies !== false} onChange={(e) => update({ sendCookies: e.target.checked ? undefined : false })} />
                Enviar cookies
              </label>
              <label className="flex items-center gap-1.5" title="Guarda os Set-Cookie da resposta no jar do workspace">
                <input type="checkbox" checked={req.storeCookies !== false} onChange={(e) => update({ storeCookies: e.target.checked ? undefined : false })} />
                Guardar cookies da resposta
              </label>
              <button className="btn btn-ghost px-1.5 py-0 text-[11.5px]" onClick={() => useStore.getState().openModal({ kind: 'cookies', id: cur.ws.id })}>ver cookies ({kl('Ctrl+K')})</button>
            </div>
            {ancestors.some((a) => a.headers.length) && (
              <div className="mt-3 text-[11.5px] text-faint">
                Herdados das pastas:{' '}
                {ancestors.flatMap((a) => a.headers.filter((h) => h.enabled).map((h) => <code key={a.id + h.name} className="mr-2">{h.name}</code>))}
              </div>
            )}
          </div>
        )}
        {section === 'body' && <BodyEditor body={req.body} onChange={(body) => update({ body })} gql={{ wsId: cur.ws.id, req, envId }} ws={wsMode ? req.id : undefined} />}
        {section === 'auth' && <AuthEditor auth={req.auth} inherited={effectiveAuth({ ...req, auth: { type: 'inherit' } }, ancestors)} onChange={(auth) => update({ auth })} oauthCtx={{ wsId: cur.ws.id, req, envId }} />}
        {section === 'scripts' && <ScriptsEditor scripts={req.scripts} onChange={(scripts) => update({ scripts })} />}
        {section === 'assertions' && <AssertionsEditor list={req.assertions ?? []} onChange={(assertions) => update({ assertions: assertions.length ? assertions : undefined })} />}
        {section === 'examples' && <ExamplesEditor ws={cur.ws} req={req} onChange={(examples) => update({ examples })} />}
        {section === 'notes' && (
          <textarea className="h-full w-full resize-none bg-transparent p-3 outline-none" placeholder="Anotações sobre este request…" value={req.description ?? ''} onChange={(e) => update({ description: e.target.value })} />
        )}
      </div>
    </section>
  )
}

function WsButton({ reqId }: { reqId: string }) {
  const state = useStore((s) => s.wsState[reqId]) ?? 'closed'
  const { wsAction } = useStore.getState()
  if (state === 'open')
    return (
      <button className="btn w-[104px]" onClick={() => void wsAction(reqId, 'close')} title="Fecha a conexão">
        Desconectar
      </button>
    )
  return (
    <button className="btn btn-accent w-[104px]" disabled={state === 'connecting'} onClick={() => void wsAction(reqId, 'connect')} title="Ctrl+Enter">
      {state === 'connecting' ? 'Conectando…' : 'Conectar'}
    </button>
  )
}

function BodyEditor({ body, onChange, gql, ws }: { body: Body; onChange: (b: Body) => void; gql: GraphQLCtx; ws?: string }) {
  const wsOpen = useStore((s) => (ws ? s.wsState[ws] === 'open' : false))
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
        <Select className="field py-1" value={body.mime ?? ''} onChange={(v) => setMime(v || null)}>
          {BODY_TYPES.filter((b) => !ws || (b.mime !== 'application/x-www-form-urlencoded' && b.mime !== 'multipart/form-data')).map((b) => (
            <option key={b.label} value={b.mime ?? ''}>{b.label}</option>
          ))}
          {body.mime && !BODY_TYPES.some((b) => b.mime === body.mime) && <option value={body.mime}>{body.mime}</option>}
        </Select>
        {body.mime === 'application/json' && <button className="btn btn-ghost py-1" onClick={format}>Formatar</button>}
      </div>
      {body.mime === null && <p className="px-3 text-faint">{ws ? 'Escolha um tipo (JSON, texto…) pra escrever a mensagem.' : 'Este request não envia body.'}</p>}
      {ws && body.mime !== null && (
        <div className="flex items-center gap-2 border-t border-line px-3 py-1.5 text-[11.5px]">
          <span className="text-faint">{wsOpen ? 'Ctrl+Enter manda esta mensagem ({{ variáveis }} e tags resolvidas)' : 'Conecte pra mandar a mensagem'}</span>
          <div className="flex-1" />
          <button className="btn btn-accent py-0.5 text-[12px]" disabled={!wsOpen} onClick={() => void useStore.getState().wsAction(ws, 'send')}>
            ↑ Enviar mensagem
          </button>
        </div>
      )}
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
      {body.mime === 'application/graphql' && (
        <Suspense fallback={<p className="px-3 text-faint">carregando editor GraphQL…</p>}>
          <GraphQLBody text={body.text ?? ''} onChange={(text) => onChange({ ...body, text })} ctx={gql} tags={editorTags} />
        </Suspense>
      )}
      {body.mime !== null && body.mime !== 'application/graphql' && !isForm && (
        <div className="flex min-h-0 flex-1 flex-col border-t border-line">
          <div className="min-h-0 flex-1">
            <CodeEditor value={body.text ?? ''} lang={langFor(body.mime)} onChange={(text) => onChange({ ...body, text })} tags={editorTags} />
          </div>
          {langFor(body.mime) === 'json' && (
            <div className="flex items-center gap-2 border-t border-line px-2 py-1">
              <button
                className="btn btn-ghost px-2 py-0.5 text-[11.5px]"
                title={`Organiza o JSON com indentação (${kl('Ctrl+Shift+F')} no editor); mantém {{ variáveis }} e {% tags %}`}
                onClick={() => {
                  const text = body.text ?? ''
                  if (!text.trim()) return
                  try {
                    const out = beautifyJson(text)
                    if (out !== text) onChange({ ...body, text: out })
                  } catch {
                    useStore.getState().notify('Só dá pra formatar JSON válido')
                  }
                }}
              >
                {'{ }'} Formatar JSON
              </button>
              <div className="flex-1" />
              <span className="text-[11px] text-faint">{(body.text ?? '').length} caracteres</span>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export function AuthEditor({ auth, inherited, onChange, allowInherit = true, oauthCtx }: { auth: Auth; inherited?: Auth; onChange: (a: Auth) => void; allowInherit?: boolean; oauthCtx?: { wsId: string; req: RequestDoc; envId: string | null } }) {
  const setType = (type: AuthType) => {
    if (type === auth.type) return
    if (type === 'basic') onChange({ type, username: '', password: '' })
    else if (type === 'bearer') onChange({ type, token: '' })
    else if (type === 'apikey') onChange({ type, key: '', value: '', addTo: 'header' })
    else if (type === 'oauth2') onChange(newOAuth2())
    else onChange({ type })
  }
  const row = (label: string, value: string, set: (v: string) => void, secret = false) => (
    <div className="flex items-center gap-3">
      <span className="w-[90px] text-dim">{label}</span>
      <TemplateInput className="text-[12px]" password={secret} value={value} onChange={set} />
    </div>
  )
  const secretRow = (label: string, value: string, set: (v: string) => void) => (
    <div className="flex items-center gap-3">
      <span className="w-[90px] text-dim">{label}</span>
      <SecretInput value={value} onChange={set} />
    </div>
  )
  return (
    <div className="flex flex-col gap-2.5 p-3">
      <Select className="field w-[200px] py-1" value={auth.type} onChange={(v) => setType(v as AuthType)}>
        {(Object.keys(AUTH_LABEL) as AuthType[]).filter((t) => allowInherit || t !== 'inherit').map((t) => (
          <option key={t} value={t}>{AUTH_LABEL[t]}</option>
        ))}
      </Select>
      {auth.type === 'inherit' && <p className="text-faint">Usando da pasta: <span className="text-dim">{inherited ? AUTH_LABEL[inherited.type] : 'sem auth'}</span></p>}
      {auth.type === 'inherit' && inherited?.type === 'oauth2' && oauthCtx && <OAuthTokenPanel {...oauthCtx} />}
      {auth.type === 'oauth2' && (
        <>
          <OAuthFields auth={auth} onChange={onChange} row={row} secretRow={secretRow} />
          {oauthCtx ? <OAuthTokenPanel {...oauthCtx} /> : <p className="pl-[102px] text-[11.5px] text-faint">O token é obtido no primeiro envio de um request desta pasta (ou pelo botão na aba Auth do request).</p>}
        </>
      )}
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
            <Select className="field py-1" value={auth.addTo} onChange={(v) => onChange({ ...auth, addTo: v as 'header' | 'query' })}>
              <option value="header">Header</option>
              <option value="query">Query string</option>
            </Select>
          </label>
        </>
      )}
    </div>
  )
}

/** ▾ ao lado do Enviar: atrasar ou repetir (Ctrl+Shift+Enter) */
function SendOptions({ reqId }: { reqId: string }) {
  const open = useStore((s) => s.sendMenu)
  const timer = useStore((s) => s.sendTimers[reqId])
  const setOpen = (v: boolean): void => useStore.setState({ sendMenu: v })
  const [sel, setSel] = useState(0)
  const selRef = useRef(0)
  selRef.current = sel
  const items: [string, () => void][] = [
    ['Enviar agora', () => useStore.getState().sendActive()],
    ['Enviar depois de…', () => askSchedule(reqId, 'delay')],
    ['Repetir a cada…', () => askSchedule(reqId, 'repeat')]
  ]
  if (timer) items.push([timer.mode === 'delay' ? 'Cancelar envio agendado' : 'Parar repetição', () => stopSend(reqId)])
  useEffect(() => {
    if (!open) return
    selRef.current = 0
    setSel(0)
    const onKey = (e: KeyboardEvent): void => {
      const move = (i: number): void => {
        selRef.current = i
        setSel(i)
      }
      if (e.key === 'ArrowDown') move(Math.min(items.length - 1, selRef.current + 1))
      else if (e.key === 'ArrowUp') move(Math.max(0, selRef.current - 1))
      else if (e.key === 'Escape') setOpen(false)
      else if (e.key === 'Enter') {
        setOpen(false)
        items[selRef.current]?.[1]()
      } else return
      e.preventDefault()
      e.stopPropagation()
    }
    const close = (): void => setOpen(false)
    window.addEventListener('keydown', onKey, true)
    window.addEventListener('click', close)
    return () => {
      window.removeEventListener('keydown', onKey, true)
      window.removeEventListener('click', close)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, items.length])
  return (
    <div className="relative">
      <button
        className={`btn px-1.5 ${timer ? 'text-accent' : ''}`}
        title={`Opções de envio (${kl('Ctrl+Shift+Enter')})`}
        onClick={(e) => {
          e.stopPropagation()
          setOpen(!open)
        }}
      >
        {timer ? (timer.mode === 'delay' ? `⏱ ${timer.seconds}s` : `↻ ${timer.seconds}s`) : '▾'}
      </button>
      {open && (
        <div className="absolute right-0 top-[34px] z-40 min-w-[200px] rounded-lg border border-line bg-raised py-1 shadow-xl">
          {items.map(([label, fn], i) => (
            <button
              key={label}
              className={`block w-full px-3 py-1.5 text-left ${i === sel ? 'bg-line' : ''}`}
              onMouseEnter={() => setSel(i)}
              onClick={() => {
                setOpen(false)
                fn()
              }}
            >
              {label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
