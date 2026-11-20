// OAuth 2.0 (#9): campos da auth, painel do token (validade, obter/renovar, limpar) e o aviso global
// enquanto o login acontece no navegador do sistema.

import { useEffect, useState } from 'react'
import type { OAuth2Auth, OAuthGrant, OAuthTokenStatus, RequestDoc } from '@shared/types'
import { api, useStore } from '../state'
import { Select } from './Select'

const GRANTS: { id: OAuthGrant; label: string }[] = [
  { id: 'authorization_code', label: 'Authorization code' },
  { id: 'client_credentials', label: 'Client credentials' },
  { id: 'password', label: 'Senha (password)' },
  { id: 'device_code', label: 'Device code' },
  { id: 'implicit', label: 'Implicit' }
]

export const newOAuth2 = (): OAuth2Auth => ({ type: 'oauth2', grantType: 'authorization_code', pkce: true })

type Row = (label: string, value: string, set: (v: string) => void) => React.ReactNode

/** campos de cada fluxo; row = campo comum, secretRow = campo que pode ir pro cofre */
export function OAuthFields({ auth, onChange, row, secretRow }: { auth: OAuth2Auth; onChange: (a: OAuth2Auth) => void; row: Row; secretRow: Row }) {
  const g = auth.grantType
  const set = (patch: Partial<OAuth2Auth>): void => onChange({ ...auth, ...patch })
  const opt = (v: string): string | undefined => v || undefined
  return (
    <>
      <label className="flex items-center gap-3">
        <span className="w-[90px] text-dim">Fluxo</span>
        <Select className="field w-[240px] py-1" value={g} onChange={(v) => set({ grantType: v as OAuthGrant })}>
          {GRANTS.map((x) => (
            <option key={x.id} value={x.id}>{x.label}</option>
          ))}
        </Select>
      </label>
      {(g === 'authorization_code' || g === 'implicit' || g === 'device_code') &&
        row(g === 'device_code' ? 'URL device' : 'URL de autorização', auth.authUrl ?? '', (v) => set({ authUrl: opt(v) }))}
      {g !== 'implicit' && row('URL do token', auth.tokenUrl ?? '', (v) => set({ tokenUrl: opt(v) }))}
      {row('Client ID', auth.clientId ?? '', (v) => set({ clientId: opt(v) }))}
      {g !== 'implicit' && secretRow('Client secret', auth.clientSecret ?? '', (v) => set({ clientSecret: opt(v) }))}
      {g === 'password' && (
        <>
          {row('Usuário', auth.username ?? '', (v) => set({ username: opt(v) }))}
          {secretRow('Senha', auth.password ?? '', (v) => set({ password: opt(v) }))}
        </>
      )}
      {row('Escopo', auth.scope ?? '', (v) => set({ scope: opt(v) }))}
      {row('Audience', auth.audience ?? '', (v) => set({ audience: opt(v) }))}
      {(g === 'authorization_code' || g === 'implicit') && row('Redirect', auth.redirectUri ?? '', (v) => set({ redirectUri: opt(v) }))}
      {(g === 'authorization_code' || g === 'implicit') && (
        <p className="pl-[102px] text-[11.5px] text-faint">
          Vazio = <code>http://127.0.0.1:&lt;porta&gt;/callback</code>. Se o provedor exigir um retorno registrado, use <code>http://localhost:PORTA/caminho</code>.
        </p>
      )}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 pl-[102px] text-[12px] text-dim">
        {g === 'authorization_code' && (
          <label className="flex items-center gap-1.5">
            <input type="checkbox" checked={!!auth.pkce} onChange={(e) => set({ pkce: e.target.checked || undefined })} /> PKCE (S256)
          </label>
        )}
        {g !== 'implicit' && (
          <label className="flex items-center gap-1.5">
            <input type="checkbox" checked={auth.clientAuth === 'body'} onChange={(e) => set({ clientAuth: e.target.checked ? 'body' : undefined })} /> client ID/secret no corpo (não no header)
          </label>
        )}
      </div>
      {row('Prefixo', auth.prefix ?? '', (v) => set({ prefix: opt(v) }))}
    </>
  )
}

function expires(ms?: number): string {
  if (!ms) return 'sem validade informada'
  const s = Math.round((ms - Date.now()) / 1000)
  if (s <= 0) return 'venceu'
  if (s < 90) return `vence em ${s} s`
  const m = Math.round(s / 60)
  return m < 120 ? `vence em ${m} min` : `vence em ${Math.round(m / 60)} h`
}

/** token da auth efetiva do request: status, obter/renovar e limpar */
export function OAuthTokenPanel({ wsId, req, envId }: { wsId: string; req: RequestDoc; envId: string | null }) {
  const [st, setSt] = useState<OAuthTokenStatus | null | undefined>(undefined)
  const [busy, setBusy] = useState(false)
  const run = useStore((s) => s.run)
  const authKey = JSON.stringify(req.auth)
  useEffect(() => {
    let alive = true
    api.oauthStatus(wsId, req, envId).then(
      (s) => alive && setSt(s),
      () => alive && setSt(null)
    )
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wsId, req.id, envId, authKey])
  const get = async (): Promise<void> => {
    setBusy(true)
    const s = await run(api.oauthToken(wsId, req, envId))
    setBusy(false)
    if (s !== undefined) setSt(s)
  }
  return (
    <div className="ml-[102px] flex flex-wrap items-center gap-2 rounded-md border border-line/70 px-2.5 py-1.5 text-[12px]">
      <span className={st?.valid ? 'text-tgreen' : 'text-faint'}>
        {st === undefined ? '…' : st ? `🔑 token ${st.valid ? 'válido' : 'vencido'}: ${expires(st.expiresAt)}${st.hasRefresh ? ' · renova sozinho' : ''}` : 'sem token: obtido no primeiro envio'}
      </span>
      <div className="flex-1" />
      <button className="btn py-0.5 text-[12px]" disabled={busy} onClick={() => void get()}>{busy ? 'obtendo…' : st ? 'Obter de novo' : 'Obter token'}</button>
      {st && (
        <button className="btn btn-ghost py-0.5 text-[12px]" onClick={async () => { await run(api.oauthClear(wsId, req, envId)); setSt(null) }}>
          Limpar
        </button>
      )}
      <span className="w-full text-[11px] text-faint">O token fica em cache cifrado no cofre (não vai pro YAML) e entra no header de todos os requests que usam esta auth.</span>
    </div>
  )
}

/** aviso global enquanto o login acontece no navegador (aberto pelo app) */
export function OAuthWait() {
  const [w, setW] = useState<{ message: string; url: string; code: string } | null>(null)
  useEffect(() => {
    const off1 = api.onOAuthWait((x) => setW(x))
    const off2 = api.onOAuthDone(() => setW(null))
    return () => {
      off1()
      off2()
    }
  }, [])
  if (!w) return null
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50">
      <div className="flex w-[min(440px,92vw)] flex-col items-center gap-3 rounded-xl border border-line bg-panel p-5 text-center shadow-2xl">
        <span className="text-[15px] font-semibold">OAuth 2.0</span>
        <p className="text-dim">{w.message}</p>
        {w.code && <span className="rounded-lg bg-raised px-4 py-2 font-mono text-[22px] tracking-widest text-accent">{w.code}</span>}
        <p className="text-[11.5px] text-faint">Esperando a autorização… (até 5 minutos)</p>
        <div className="flex gap-2">
          {w.url && (
            <a className="btn" href={w.url}>
              Abrir de novo no navegador
            </a>
          )}
          <button className="btn" onClick={() => void api.oauthCancel()}>Cancelar</button>
        </div>
      </div>
    </div>
  )
}
