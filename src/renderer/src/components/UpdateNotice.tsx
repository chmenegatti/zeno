import { useEffect, useState } from 'react'
import { api, useStore } from '../state'
import { setUi } from '../hotkeys'
import { t } from '@shared/i18n'

// Aviso de versão nova (#176): confere ao abrir e a cada 24 h com o app aberto. Fica até fechar; "Pular
// esta versão" não avisa mais dessa. Desliga em Preferências ou com ZENO_NO_UPDATE_CHECK=1.
const DAY = 24 * 60 * 60 * 1000
const FIRST = 4000 // depois de abrir, pra não disputar com o carregamento

type Update = { version: string; url: string; install?: string }

const HINT: Record<string, string> = {
  flatpak: 'flatpak update com.cesarmenegatti.Zeno',
  scoop: 'scoop update zeno'
}

export function UpdateNotice() {
  const ready = useStore((s) => s.ready)
  const enabled = useStore((s) => s.app.ui?.updateCheck !== false)
  const skip = useStore((s) => s.app.ui?.skipVersion)
  const [found, setFound] = useState<Update | null>(null)
  const [closed, setClosed] = useState<string | null>(null)

  useEffect(() => {
    if (!ready || !enabled) return
    let alive = true
    const check = (): void => {
      api
        .checkUpdate(__ZENO_VERSION__)
        .then((u) => alive && u && setFound(u))
        .catch(() => {})
    }
    const first = setTimeout(check, FIRST)
    const every = setInterval(check, DAY)
    return () => {
      alive = false
      clearTimeout(first)
      clearInterval(every)
    }
  }, [ready, enabled])

  if (!found || !enabled || found.version === skip || found.version === closed) return null
  const hint = found.install ? HINT[found.install] : undefined
  return (
    <div role="status" className="fixed right-4 top-4 z-50 flex max-w-[360px] flex-col gap-2 rounded-lg border border-accent/40 bg-raised px-4 py-3 shadow-xl">
      <div className="flex items-start gap-2">
        <span className="flex-1 text-ink">
          {t('Zeno {v} disponível', { v: found.version })}
          <span className="block text-[12px] text-faint">{t('você está na {v}', { v: __ZENO_VERSION__ })}</span>
        </span>
        <button className="text-faint hover:text-ink" aria-label={t('Fechar')} onClick={() => setClosed(found.version)}>
          ✕
        </button>
      </div>
      {hint ? (
        <span className="text-[12px] text-dim">
          {t('Atualize pelo gerenciador de pacotes:')} <code className="font-mono text-accent">{hint}</code>
        </span>
      ) : found.install === 'appimage' ? (
        <span className="text-[12px] text-dim">{t('Baixe o AppImage novo e substitua o atual.')}</span>
      ) : null}
      <div className="flex items-center gap-2">
        <a className="btn py-0.5" href={found.url} target="_blank" rel="noreferrer">{t('Novidades')}</a>
        {!hint && (
          <a className="btn btn-accent py-0.5" href="https://github.com/chmenegatti/zeno/releases/latest" target="_blank" rel="noreferrer">{t('Baixar')}</a>
        )}
        <div className="flex-1" />
        <button className="text-[12px] text-faint hover:text-ink" onClick={() => setUi({ skipVersion: found.version })}>
          {t('Pular esta versão')}
        </button>
      </div>
    </div>
  )
}
