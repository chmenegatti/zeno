import { useEffect, useState } from 'react'
import { isEncrypted } from '@shared/secret'
import type { VaultStatus } from '@shared/types'
import { api, useStore } from '../state'
import { TemplateInput } from './Tags'
import { t } from '@shared/i18n'

export function LockIcon({ size = 11 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="4" y="11" width="16" height="10" rx="2" fill="currentColor" fillOpacity="0.2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </svg>
  )
}

export function useVaultStatus(): VaultStatus | null {
  const [st, setSt] = useState<VaultStatus | null>(null)
  useEffect(() => {
    api.vaultStatus().then(setSt).catch(() => setSt(null))
  }, [])
  return st
}

/** campo de segredo: texto puro com botão de cifrar, ou token cifrado com mostrar/trocar */
export function SecretInput({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  const [revealed, setRevealed] = useState<string | null>(null)
  const [show, setShow] = useState(false)
  useEffect(() => setRevealed(null), [value])
  const run = useStore.getState().run

  if (isEncrypted(value as unknown)) {
    return (
      <div className="flex min-w-0 flex-1 items-center gap-1.5">
        <span className="field flex min-w-0 flex-1 items-center gap-1.5 text-tpurple" title={t('Valor cifrado no cofre (AES-256-GCM, chave no chaveiro do sistema)')}>
          <LockIcon />
          {revealed !== null ? <code className="truncate text-ink select-text">{revealed}</code> : <span className="text-[12px]">{t('criptografado')}</span>}
        </span>
        <button type="button" className="btn btn-ghost px-2 py-1 text-[12px]" onClick={async () => setRevealed(revealed === null ? ((await run(api.vaultReveal(value))) ?? null) : null)}>
          {revealed === null ? t('mostrar') : t('esconder')}
        </button>
        <button type="button" className="btn btn-ghost px-2 py-1 text-[12px]" onClick={() => onChange('')} title={t('Apagar e digitar outro valor')}>
          {t('trocar')}
        </button>
      </div>
    )
  }
  return (
    <div className="flex min-w-0 flex-1 items-center gap-1.5">
      <TemplateInput className="text-[12px]" password={!show} value={value} placeholder={placeholder} onChange={onChange} />
      <button type="button" className="btn btn-ghost px-2 py-1 text-[12px]" onClick={() => setShow(!show)}>{show ? '◉' : '◎'}</button>
      <button
        type="button"
        className="btn btn-ghost px-2 py-1 text-tpurple"
        title={t('Criptografar no cofre')}
        disabled={!value || value.includes('{{') || value.includes('{%')}
        onClick={async () => {
          const tok = await run(api.vaultEncrypt(value))
          if (tok) onChange(tok)
        }}
      >
        <LockIcon size={13} />
      </button>
    </div>
  )
}
