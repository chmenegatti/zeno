import { useEffect, useState } from 'react'
import { CODE_LANGS, type CodeLang } from '@shared/curl'
import { findNode } from '@shared/tree'
import type { RequestDoc } from '@shared/types'
import { activeEnvId, activeWorkspace, api, useStore } from '../state'
import { CodeEditor } from './CodeEditor'
import { Modal, Segmented } from './ui'

const LANG_KEY = 'zeno:code-lang'

function savedLang(): CodeLang {
  try {
    const v = localStorage.getItem(LANG_KEY)
    return CODE_LANGS.some((l) => l.id === v) ? (v as CodeLang) : 'curl'
  } catch {
    return 'curl'
  }
}

function current(reqId: string): { wsId: string; req: RequestDoc; envId: string | null } | null {
  const s = useStore.getState()
  const ws = activeWorkspace(s)
  const node = ws && findNode(ws, reqId)?.node
  return ws && node?.kind === 'request' ? { wsId: ws.id, req: node, envId: activeEnvId(s) } : null
}

/** Copiar como cURL, com as variáveis do ambiente ativo já resolvidas */
export async function copyAsCurl(reqId: string): Promise<void> {
  const c = current(reqId)
  if (!c) return
  const { run, notify } = useStore.getState()
  const text = await run(api.codeSnippet(c.wsId, c.req, c.envId, 'curl', true))
  if (text === undefined) return
  await api.copyText(text)
  notify('cURL copiado')
}

export function CodeModal({ reqId, onClose }: { reqId: string; onClose: () => void }) {
  const [lang, setLang] = useState<CodeLang>(savedLang)
  const [resolve, setResolve] = useState(true)
  const [code, setCode] = useState('')
  const workspaces = useStore((s) => s.workspaces)
  const c = current(reqId)
  const req = c?.req

  useEffect(() => {
    if (!c) return
    api.codeSnippet(c.wsId, c.req, c.envId, lang, resolve).then(setCode, (e) => setCode(String(e)))
    try {
      localStorage.setItem(LANG_KEY, lang)
    } catch {
      /* sem storage */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lang, resolve, req, workspaces])

  if (!c) return null
  return (
    <Modal title={`Código · ${c.req.name}`} onClose={onClose} wide>
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-3">
          <Segmented value={lang} options={CODE_LANGS} onChange={setLang} />
          <label className="flex items-center gap-1.5 text-dim">
            <input type="checkbox" checked={resolve} onChange={(e) => setResolve(e.target.checked)} />
            Resolver variáveis
          </label>
          <div className="flex-1" />
          <button
            className="btn btn-accent"
            onClick={async () => {
              await api.copyText(code)
              useStore.getState().notify('Código copiado')
            }}
          >
            Copiar
          </button>
        </div>
        <div className="h-[52vh] min-h-[260px] overflow-hidden rounded-md border border-line bg-bg">
          <CodeEditor value={code} readOnly wrap={false} />
        </div>
        <p className="text-[11.5px] text-faint">
          Senhas e tokens guardados no cofre aparecem decifrados no código. Com "Resolver variáveis" desligado, as <code>{'{{ variáveis }}'}</code> ficam como referência.
        </p>
      </div>
    </Modal>
  )
}
