// Lixeira do workspace (#155): pastas e requests excluídos, pra restaurar ou apagar de vez.

import { useEffect, useState } from 'react'
import type { TrashItem } from '@shared/api'
import type { Workspace } from '@shared/types'
import { api, restoreTrash, useStore } from '../state'
import { Modal } from './ui'
import { locale, t } from '@shared/i18n'

export function TrashModal({ ws, onClose }: { ws: Workspace; onClose: () => void }) {
  const [items, setItems] = useState<TrashItem[] | null>(null)
  const reload = (): void => {
    useStore.getState().run(api.listTrash(ws.id)).then((l) => setItems(l ?? []))
  }
  useEffect(reload, [ws.id])
  return (
    <Modal title={t('Lixeira · {name}', { name: ws.name })} onClose={onClose}>
      <p className="mb-3 text-[11.5px] text-faint">{t('Pastas e requests excluídos ficam aqui por 30 dias. Restaurar devolve pro mesmo lugar, com os mesmos ids.')}</p>
      {items === null ? null : !items.length ? (
        <p className="py-6 text-center text-faint">{t('Lixeira vazia')}</p>
      ) : (
        <div className="flex flex-col">
          {items.map((it) => (
            <div key={it.id} className="flex items-center gap-2 border-b border-line/60 py-1.5">
              <span className="w-4 text-center text-faint">{it.kind === 'folder' ? '▸' : '·'}</span>
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-ink">{it.name}</span>
                <span className="text-[11px] text-faint">
                  {it.kind === 'folder' ? t('{n} requests', { n: it.requests }) + ' · ' : ''}
                  {new Date(it.deletedAt).toLocaleString(locale())}
                </span>
              </span>
              <button
                className="btn py-0.5"
                onClick={async () => {
                  await restoreTrash(it.id)
                  reload()
                }}
              >
                {t('Restaurar')}
              </button>
            </div>
          ))}
          <div className="mt-3 flex justify-end">
            <button
              className="btn text-tpink"
              onClick={() =>
                useStore.getState().openModal({
                  kind: 'confirm',
                  title: t('Esvaziar lixeira'),
                  message: t('Apagar de vez os {n} itens da lixeira de "{name}"? Não dá pra desfazer.', { n: items.length, name: ws.name }),
                  onOk: async () => {
                    await useStore.getState().run(api.emptyTrash(ws.id))
                  }
                })
              }
            >
              {t('Esvaziar lixeira')}
            </button>
          </div>
        </div>
      )}
    </Modal>
  )
}
