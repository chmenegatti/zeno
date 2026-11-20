// Rede do workspace (#18): proxy, CA própria e certificados de cliente (mTLS). Caminhos de arquivo e
// endereços aceitam {{ variáveis }}; a senha do PFX vai pro cofre ao salvar (encryptPassphrases).

import { useState } from 'react'
import type { ClientCert, WorkspaceSettings } from '@shared/types'
import { api, useStore } from '../state'
import { Select } from './Select'
import { t } from '@shared/i18n'

const isToken = (v?: string): boolean => !!v && v.startsWith('$zeno$')

/** cifra no cofre as senhas de PFX digitadas (as que já são token ficam como estão) */
export async function encryptPassphrases(s: WorkspaceSettings): Promise<WorkspaceSettings> {
  if (!s.clientCerts?.length) return s
  const clientCerts = await Promise.all(
    s.clientCerts.map(async (c) => (c.passphrase && !isToken(c.passphrase) ? { ...c, passphrase: await api.vaultEncrypt(c.passphrase) } : c))
  )
  return { ...s, clientCerts }
}

function FileField({ value, placeholder, onChange }: { value?: string; placeholder: string; onChange: (v: string) => void }) {
  return (
    <div className="flex min-w-0 flex-1 gap-1">
      <input className="field min-w-0 flex-1 py-1 font-mono text-[12px]" placeholder={placeholder} value={value ?? ''} onChange={(e) => onChange(e.target.value)} spellCheck={false} />
      <button
        type="button"
        className="btn px-2 py-1 text-[12px]"
        title={t('Escolher arquivo')}
        onClick={async () => {
          const f = await useStore.getState().run(api.pickFile())
          if (f) onChange(f)
        }}
      >
        …
      </button>
    </div>
  )
}

export function NetSection({ settings, onChange }: { settings: WorkspaceSettings; onChange: (s: WorkspaceSettings) => void }) {
  const proxy = settings.proxy ?? { mode: 'none' as const }
  const certs = settings.clientCerts ?? []
  const [open, setOpen] = useState(proxy.mode !== 'none' || !!settings.caFile || certs.length > 0)
  const setProxy = (p: Partial<NonNullable<WorkspaceSettings['proxy']>>): void => {
    const next = { ...proxy, ...p }
    onChange({ ...settings, proxy: next.mode === 'none' && !next.url && !next.noProxy ? undefined : next })
  }
  const setCerts = (list: ClientCert[]): void => onChange({ ...settings, clientCerts: list.length ? list : undefined })
  const setCert = (i: number, patch: Partial<ClientCert>): void => setCerts(certs.map((c, j) => (j === i ? { ...c, ...patch } : c)))

  return (
    <div className="rounded-lg border border-line p-3">
      <button type="button" className="flex w-full items-center justify-between text-left font-semibold" onClick={() => setOpen(!open)}>
        <span>{t('Rede e certificados')}</span>
        <span className="text-[11.5px] font-normal text-faint">
          {[proxy.mode === 'system' ? t('proxy do sistema') : proxy.mode === 'custom' ? 'proxy' : '', settings.caFile ? t('CA própria') : '', certs.length ? t('{n} certificado(s)', { n: certs.length }) : ''].filter(Boolean).join(' · ') || t('sem proxy')} {open ? '▴' : '▾'}
        </span>
      </button>
      {open && (
        <div className="mt-3 flex flex-col gap-3 text-[12.5px]">
          <div className="flex flex-col gap-1.5">
            <span className="text-dim">Proxy</span>
            <Select className="py-1" value={proxy.mode} onChange={(v) => setProxy({ mode: v as 'none' | 'system' | 'custom' })} aria-label="Proxy">
              <option value="none">{t('Sem proxy')}</option>
              <option value="system">{t('Do sistema (HTTP_PROXY, HTTPS_PROXY, NO_PROXY)')}</option>
              <option value="custom">{t('Personalizado')}</option>
            </Select>
            {proxy.mode === 'custom' && (
              <>
                <input className="field py-1 font-mono text-[12px]" placeholder={t('http://usuario:senha@proxy:3128  ou  socks5://host:1080')} value={proxy.url ?? ''} onChange={(e) => setProxy({ url: e.target.value })} spellCheck={false} />
                <input className="field py-1 font-mono text-[12px]" placeholder={t('sem proxy pra: localhost, .interno, 10.0.0.0/8')} value={proxy.noProxy ?? ''} onChange={(e) => setProxy({ noProxy: e.target.value })} spellCheck={false} />
              </>
            )}
            <span className="text-[11.5px] text-faint">{t('Endereços aceitam')} {t('{{ variáveis }}')} {t('(a senha do proxy pode ficar no cofre como variável). Requests pra localhost não usam proxy.')}</span>
          </div>

          <div className="flex flex-col gap-1.5">
            <span className="text-dim">{t('CA própria (PEM)')}</span>
            <FileField value={settings.caFile} placeholder={t('/caminho/ca-interna.pem: somada às CAs do sistema')} onChange={(v) => onChange({ ...settings, caFile: v || undefined })} />
            <span className="text-[11.5px] text-faint">{t('Pra servidores internos com certificado da empresa, sem precisar aceitar certificado inválido.')}</span>
          </div>

          <div className="flex flex-col gap-1.5">
            <span className="text-dim">{t('Certificados de cliente (mTLS)')}</span>
            {certs.map((c, i) => {
              const kind = c.pfx !== undefined ? 'pfx' : 'pem'
              return (
                <div key={i} className="flex flex-col gap-1.5 rounded-md border border-line/70 p-2">
                  <div className="flex items-center gap-1.5">
                    <input className="field min-w-0 flex-1 py-1 font-mono text-[12px]" placeholder={t('host: api.x.com, api.x.com:8443 ou *.x.com')} value={c.host} onChange={(e) => setCert(i, { host: e.target.value })} spellCheck={false} />
                    <Select className="w-[96px] py-1" value={kind} onChange={(v) => setCert(i, v === 'pfx' ? { pfx: c.pfx ?? '', cert: undefined, key: undefined } : { pfx: undefined, passphrase: undefined, cert: c.cert ?? '' })} aria-label={t('Formato')}>
                      <option value="pem">PEM</option>
                      <option value="pfx">PFX/P12</option>
                    </Select>
                    <button type="button" className="btn btn-ghost px-1.5 py-0.5" title={t('Remover')} onClick={() => setCerts(certs.filter((_, j) => j !== i))}>✕</button>
                  </div>
                  {kind === 'pem' ? (
                    <>
                      <FileField value={c.cert} placeholder={t('certificado (.pem / .crt)')} onChange={(v) => setCert(i, { cert: v })} />
                      <FileField value={c.key} placeholder={t('chave privada (.key; vazio = no mesmo arquivo)')} onChange={(v) => setCert(i, { key: v || undefined })} />
                    </>
                  ) : (
                    <>
                      <FileField value={c.pfx} placeholder={t('arquivo .pfx / .p12')} onChange={(v) => setCert(i, { pfx: v })} />
                      {isToken(c.passphrase) ? (
                        <div className="flex items-center gap-2 text-[12px]">
                          <span className="text-tag">{t('🔒 senha no cofre')}</span>
                          <button type="button" className="btn btn-ghost px-1.5 py-0" onClick={() => setCert(i, { passphrase: '' })}>{t('trocar')}</button>
                        </div>
                      ) : (
                        <input type="password" className="field py-1 text-[12px]" placeholder={t('senha do PFX (vai pro cofre ao salvar)')} value={c.passphrase ?? ''} onChange={(e) => setCert(i, { passphrase: e.target.value })} autoComplete="off" />
                      )}
                    </>
                  )}
                </div>
              )
            })}
            <button type="button" className="btn self-start py-1 text-[12px]" onClick={() => setCerts([...certs, { host: '', cert: '' }])}>{t('＋ Certificado')}</button>
          </div>
        </div>
      )}
    </div>
  )
}
