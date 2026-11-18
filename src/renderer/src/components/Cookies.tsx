import { useEffect, useMemo, useState } from 'react'
import type { CookieInfo, Workspace } from '@shared/types'
import { api, useStore } from '../state'
import { Modal } from './ui'

const empty = (): CookieInfo => ({ key: '', value: '', domain: '', path: '/', secure: false, httpOnly: false })

/** data local pro <input type="datetime-local"> */
const toLocal = (iso?: string): string => {
  if (!iso) return ''
  const d = new Date(iso)
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16)
}

/** cookies do workspace (Ctrl+K): ver, editar, apagar, limpar */
export function CookiesModal({ ws, onClose }: { ws: Workspace; onClose: () => void }) {
  const [list, setList] = useState<CookieInfo[] | null>(null)
  const [dirty, setDirty] = useState(false)
  const [query, setQuery] = useState('')
  const run = useStore((s) => s.run)

  useEffect(() => {
    run(api.cookiesList(ws.id)).then((l) => setList(l ?? []))
  }, [ws.id, run])

  const edit = (i: number, patch: Partial<CookieInfo>): void => {
    setList((l) => l!.map((c, j) => (j === i ? { ...c, ...patch } : c)))
    setDirty(true)
  }
  const save = async (next = list ?? []): Promise<void> => {
    const saved = await run(api.cookiesSave(ws.id, next))
    if (!saved) return
    setList(saved)
    setDirty(false)
    const dropped = next.filter((c) => c.key && c.domain).length - saved.length
    useStore.getState().notify(dropped > 0 ? `Cookies salvos (${dropped} expirado${dropped > 1 ? 's' : ''} ou inválido${dropped > 1 ? 's' : ''} descartado${dropped > 1 ? 's' : ''})` : 'Cookies salvos')
  }

  const q = query.trim().toLowerCase()
  const rows = useMemo(() => (list ?? []).map((c, i) => ({ c, i })).filter(({ c }) => !q || `${c.domain} ${c.key} ${c.value}`.toLowerCase().includes(q)), [list, q])

  return (
    <Modal title={`Cookies · ${ws.name}`} onClose={onClose} wide>
      <div className="flex flex-col gap-3">
        <p className="text-[11.5px] text-faint">Guardados das respostas (Set-Cookie) e enviados nos requests seguintes pelo domínio e caminho. Cookies expirados somem sozinhos. Cada request pode desligar o envio ou a gravação na aba Headers.</p>
        <div className="flex items-center gap-2">
          <input className="field flex-1" placeholder="Filtrar por domínio, nome ou valor…" value={query} onChange={(e) => setQuery(e.target.value)} />
          <button className="btn" onClick={() => { setList((l) => [...(l ?? []), empty()]); setDirty(true) }}>＋ Cookie</button>
          <button className="btn text-tpink" disabled={!list?.length} onClick={() => save([])}>Limpar tudo</button>
        </div>
        {list === null ? (
          <p className="text-faint">carregando…</p>
        ) : !list.length ? (
          <p className="py-6 text-center text-faint">Nenhum cookie ainda. Eles aparecem aqui quando uma resposta manda Set-Cookie.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-separate border-spacing-y-1 text-[12px]">
              <thead className="text-left text-[11px] text-faint">
                <tr>
                  <th className="font-normal">Domínio</th>
                  <th className="font-normal">Nome</th>
                  <th className="font-normal">Valor</th>
                  <th className="font-normal">Caminho</th>
                  <th className="font-normal">Expira</th>
                  <th className="font-normal" title="Só HTTPS">Secure</th>
                  <th className="font-normal" title="Inacessível a scripts no navegador">HttpOnly</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map(({ c, i }) => (
                  <tr key={i}>
                    <td className="pr-1"><input className="field w-full font-mono" value={c.domain} placeholder="api.exemplo.com" onChange={(e) => edit(i, { domain: e.target.value })} /></td>
                    <td className="pr-1"><input className="field w-full font-mono" value={c.key} placeholder="nome" onChange={(e) => edit(i, { key: e.target.value })} /></td>
                    <td className="pr-1"><input className="field w-full min-w-[160px] font-mono" value={c.value} onChange={(e) => edit(i, { value: e.target.value })} /></td>
                    <td className="pr-1"><input className="field w-[80px] font-mono" value={c.path} onChange={(e) => edit(i, { path: e.target.value })} /></td>
                    <td className="pr-1">
                      <input
                        type="datetime-local"
                        className="field w-[170px]"
                        title="Vazio = cookie de sessão (não expira)"
                        value={toLocal(c.expires)}
                        onChange={(e) => edit(i, { expires: e.target.value ? new Date(e.target.value).toISOString() : undefined })}
                      />
                    </td>
                    <td className="text-center"><input type="checkbox" checked={c.secure} onChange={(e) => edit(i, { secure: e.target.checked })} /></td>
                    <td className="text-center"><input type="checkbox" checked={c.httpOnly} onChange={(e) => edit(i, { httpOnly: e.target.checked })} /></td>
                    <td>
                      <button className="btn btn-ghost px-1.5 text-faint hover:text-tpink" title="Apagar" onClick={() => { setList((l) => l!.filter((_, j) => j !== i)); setDirty(true) }}>✕</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="flex items-center justify-end gap-2">
          {dirty && <span className="mr-auto text-[11.5px] text-torange">alterações não salvas</span>}
          <button className="btn" onClick={onClose}>Fechar</button>
          <button className="btn btn-accent" disabled={!dirty} onClick={() => save()}>Salvar</button>
        </div>
      </div>
    </Modal>
  )
}
