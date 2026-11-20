import type { KV } from '@shared/types'
import { isEncrypted } from '@shared/secret'
import { SecretInput } from './Secret'
import { TemplateInput } from './Tags'

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
export function KeyValueTable<T extends Row>({ rows, onChange, keyPlaceholder = 'nome', valuePlaceholder = 'valor', allowFiles, onPickFile }: Props<T>) {
  const all = [...rows, { name: '', value: '', enabled: true } as T]
  const update = (i: number, patch: Partial<Row>) => {
    const next = all.map((r, j) => (j === i ? { ...r, ...patch } : r))
    onChange(next.filter((r, j) => j < rows.length || r.name || r.value || r.file) as T[])
  }
  const remove = (i: number) => onChange(rows.filter((_, j) => j !== i))
  return (
    <div className="flex flex-col">
      {all.map((r, i) => {
        const ghost = i === rows.length
        return (
          <div key={i} className={`group flex items-center gap-1.5 border-b border-line/60 py-1 ${!r.enabled && !ghost ? 'opacity-45' : ''}`}>
            <input
              type="checkbox"
              checked={r.enabled}
              disabled={ghost}
              onChange={(e) => update(i, { enabled: e.target.checked })}
              title="Ativo"
            />
            <TemplateInput className="text-[12px]" placeholder={keyPlaceholder} value={r.name} onChange={(name) => update(i, { name })} />
            {isEncrypted(r.value as unknown) && !ghost ? (
              <div className="flex min-w-0 flex-[2]">
                <SecretInput value={r.value} onChange={(value) => update(i, { value })} />
              </div>
            ) : r.file !== undefined && !ghost ? (
              <button className="field min-w-0 flex-[2] truncate text-left text-dim" onClick={async () => { const f = await onPickFile?.(); if (f) update(i, { file: f }) }}>
                📎 {r.file || 'escolher arquivo…'}
              </button>
            ) : (
              <div className="flex min-w-0 flex-[2]">
                <TemplateInput className="text-[12px]" placeholder={valuePlaceholder} value={r.value} onChange={(value) => update(i, { value })} />
              </div>
            )}
            {allowFiles && !ghost && (
              <button className="btn-ghost btn px-1.5 py-0.5 text-[11px]" title="Alternar texto/arquivo" onClick={() => update(i, { file: r.file === undefined ? '' : undefined })}>
                {r.file === undefined ? 'txt' : 'arq'}
              </button>
            )}
            <button className={`btn-ghost btn px-1.5 py-0.5 ${ghost ? 'invisible' : 'opacity-0 group-hover:opacity-100'}`} onClick={() => remove(i)} title="Remover">
              ✕
            </button>
          </div>
        )
      })}
    </div>
  )
}
