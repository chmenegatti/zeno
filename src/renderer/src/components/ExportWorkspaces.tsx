// Exportar workspaces (#116): zip com os YAML do Zeno, Insomnia (v4) ou Postman (v2.1). Mostra antes
// o arquivo que vai sair e o que não dá pra levar pro outro app.

import { useEffect, useState } from 'react'
import type { ExportFormat } from '@shared/api'
import { api, useStore } from '../state'
import { t, tk } from '@shared/i18n'

const FORMATS: { id: ExportFormat; label: string; hint: string }[] = [
  { id: 'zeno', label: tk('Zeno (zip dos YAML)'), hint: tk('Cópia fiel das pastas. Segredos continuam cifrados: só abrem com o mesmo chaveiro.') },
  { id: 'insomnia', label: tk('Insomnia (JSON v4)'), hint: tk('Abre no Insomnia (Import › arquivo). Também é lido pelo próprio Zeno.') },
  { id: 'postman', label: tk('Postman (coleção v2.1)'), hint: tk('Uma coleção por workspace; sub-ambientes viram arquivos de ambiente (zip quando há mais de um arquivo).') }
]

type Preview = { name: string; size: number; warnings: string[]; blanked: number }

function size(n: number): string {
  return n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`
}

export function ExportDialog({ ids, onClose }: { ids: string[]; onClose: () => void }) {
  const workspaces = useStore((s) => s.workspaces)
  const { run, notify } = useStore.getState()
  const [format, setFormat] = useState<ExportFormat>('insomnia')
  const [secrets, setSecrets] = useState(false)
  const [prev, setPrev] = useState<Preview | null | undefined>(undefined)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const names = ids.map((id) => workspaces.find((w) => w.id === id)?.name ?? id)
  const plain = format !== 'zeno'

  useEffect(() => {
    let alive = true
    setPrev(undefined)
    setError('')
    api.exportPreview(ids, format, plain && secrets).then(
      (p) => alive && setPrev(p),
      (e: unknown) => alive && (setPrev(null), setError(e instanceof Error ? e.message : String(e)))
    )
    return () => {
      alive = false
    }
  }, [ids, format, secrets, plain])

  const save = async (): Promise<void> => {
    setBusy(true)
    const dest = await run(api.exportSave(ids, format, plain && secrets))
    setBusy(false)
    if (dest) {
      notify(t('Exportado: {dest}', { dest }))
      onClose()
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40" onMouseDown={onClose} onKeyDown={(e) => e.key === 'Escape' && (e.stopPropagation(), onClose())}>
      <div className="flex w-[min(540px,94vw)] flex-col gap-3 rounded-xl border border-line bg-panel p-4 shadow-2xl" role="dialog" aria-label={t('Exportar')} onMouseDown={(e) => e.stopPropagation()}>
        <span className="font-semibold">{names.length === 1 ? t('Exportar "{name}"', { name: names[0] }) : t('Exportar {n} workspaces', { n: names.length })}</span>
        <div className="flex flex-col gap-1.5">
          {FORMATS.map((f) => (
            <label key={f.id} className={`flex cursor-pointer gap-2 rounded-md border px-2.5 py-1.5 ${format === f.id ? 'border-accent bg-accent/5' : 'border-line'}`}>
              <input type="radio" name="fmt" checked={format === f.id} onChange={() => setFormat(f.id)} autoFocus={format === f.id} />
              <span className="flex flex-col">
                <span>{t(f.label)}</span>
                <span className="text-[11.5px] text-faint">{t(f.hint)}</span>
              </span>
            </label>
          ))}
        </div>
        {plain && (
          <label className="flex items-start gap-2 text-[12.5px]">
            <input type="checkbox" className="mt-0.5" checked={secrets} onChange={(e) => setSecrets(e.target.checked)} />
            <span>
              {t('Levar os segredos do cofre abertos (senhas e tokens em texto puro no arquivo)')}
              <span className="block text-[11.5px] text-faint">{t('Desligado, eles saem vazios: fora do Zeno não dá pra abrir.')}</span>
            </span>
          </label>
        )}
        <div className="min-h-[60px] rounded-md bg-raised px-2.5 py-2 text-[12px]">
          {prev === undefined && <span className="text-faint">{t('preparando…')}</span>}
          {error && <span className="text-tred">{error}</span>}
          {prev && (
            <>
              <div>
                <span className="font-mono">{prev.name}</span> <span className="text-faint">· {size(prev.size)}</span>
              </div>
              {prev.blanked > 0 && <div className="mt-1 text-torange">{t('🔒 {n} valor(es) do cofre vão vazios', { n: prev.blanked })}</div>}
              {prev.warnings.length > 0 && (
                <details className="mt-1 text-dim">
                  <summary className="cursor-pointer text-torange">{t('{n} aviso(s): o que não dá pra levar', { n: prev.warnings.length })}</summary>
                  <ul className="mt-1 max-h-[160px] list-disc overflow-auto pl-5 text-[11.5px]">
                    {prev.warnings.map((w) => (
                      <li key={w}>{w}</li>
                    ))}
                  </ul>
                </details>
              )}
              {prev.warnings.length === 0 && prev.blanked === 0 && <div className="mt-1 text-tgreen">{t('Tudo cabe nesse formato.')}</div>}
            </>
          )}
        </div>
        <div className="flex justify-end gap-2">
          <button className="btn" onClick={onClose}>{t('Cancelar')}</button>
          <button className="btn btn-accent" disabled={!prev || busy} onClick={() => void save()}>{busy ? t('salvando…') : t('Salvar…')}</button>
        </div>
      </div>
    </div>
  )
}
