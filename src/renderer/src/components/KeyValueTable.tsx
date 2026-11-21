import { useState } from 'react'
import type { KV } from '@shared/types'
import { kvToText, textToKv } from '@shared/bulkkv'
import { isEncrypted } from '@shared/secret'
import { SecretInput } from './Secret'
import { TemplateInput } from './Tags'
import { t } from '@shared/i18n'

interface Row extends KV {
  file?: string
}

interface Props<T extends Row> {
  rows: T[]
  onChange: (rows: T[]) => void
  keyPlaceholder?: string
  valuePlaceholder?: string
  allowFiles?: boolean
  onPickFile?: () => Promise<string | null>
}

/** tabela nome/valor com linha vazia no fim pra adicionar */
export function KeyValueTable<T extends Row>({ rows, onChange, keyPlaceholder, valuePlaceholder, allowFiles, onPickFile }: Props<T>) {
  const all = [...rows, { name: '', value: '', enabled: true } as T]
  const update = (i: number, patch: Partial<Row>) => {
    const next = all.map((r, j) => (j === i ? { ...r, ...patch } : r))
    onChange(next.filter((r, j) => j < rows.length || r.name || r.value || r.file) as T[])
  }
  const remove = (i: number) => onChange(rows.filter((_, j) => j !== i))
  // edição em massa (#148): o texto fica local enquanto digita; cada mudança já vira linhas
  const [bulk, setBulk] = useState(false)
  const [text, setText] = useState('')
  const hasFiles = rows.some((r) => r.file !== undefined)
  const toggle = (
    <div className="mb-1 flex justify-end">
      <button
        className="btn-ghost btn px-1.5 py-0 text-[11px]"
        disabled={hasFiles && !bulk}
        title={hasFiles && !bulk ? t('Linhas com arquivo só na tabela') : t('nome: valor ou nome=valor, uma linha por item; // desliga a linha')}
        onClick={() => {
          if (!bulk) setText(kvToText(rows))
          setBulk(!bulk)
        }}
      >
        {bulk ? t('Tabela') : t('Editar como texto')}
      </button>
    </div>
  )
  if (bulk) {
    return (
      <div className="flex flex-col">
        {toggle}
        <textarea
          autoFocus
          className="field h-48 w-full resize-y font-mono text-[12px]"
          value={text}
          placeholder={t('nome: valor ou nome=valor, uma linha por item; // desliga a linha')}
          spellCheck={false}
          onChange={(e) => {
            setText(e.target.value)
            onChange(textToKv(e.target.value) as T[])
          }}
        />
      </div>
    )
  }
  return (
    <div className="flex flex-col">
      {toggle}
      {all.map((r, i) => {
        const ghost = i === rows.length
        return (
          <div key={i} className={`group flex items-center gap-1.5 border-b border-line/60 py-1 ${!r.enabled && !ghost ? 'opacity-45' : ''}`}>
            <input
              type="checkbox"
              checked={r.enabled}
              disabled={ghost}
              onChange={(e) => update(i, { enabled: e.target.checked })}
              title={t('Ativo')}
            />
            <TemplateInput className="text-[12px]" placeholder={keyPlaceholder ?? t('nome')} value={r.name} onChange={(name) => update(i, { name })} />
            {isEncrypted(r.value as unknown) && !ghost ? (
              <div className="flex min-w-0 flex-[2]">
                <SecretInput value={r.value} onChange={(value) => update(i, { value })} />
              </div>
            ) : r.file !== undefined && !ghost ? (
              <button className="field min-w-0 flex-[2] truncate text-left text-dim" onClick={async () => { const f = await onPickFile?.(); if (f) update(i, { file: f }) }}>
                📎 {r.file || t('escolher arquivo…')}
              </button>
            ) : (
              <div className="flex min-w-0 flex-[2]">
                <TemplateInput className="text-[12px]" placeholder={valuePlaceholder ?? t('valor')} value={r.value} onChange={(value) => update(i, { value })} />
              </div>
            )}
            {allowFiles && !ghost && (
              <button className="btn-ghost btn px-1.5 py-0.5 text-[11px]" title={t('Alternar texto/arquivo')} onClick={() => update(i, { file: r.file === undefined ? '' : undefined })}>
                {r.file === undefined ? 'txt' : t('arq')}
              </button>
            )}
            <button className={`btn-ghost btn px-1.5 py-0.5 ${ghost ? 'invisible' : 'opacity-0 group-hover:opacity-100'}`} onClick={() => remove(i)} title={t('Remover')}>
              ✕
            </button>
          </div>
        )
      })}
    </div>
  )
}
