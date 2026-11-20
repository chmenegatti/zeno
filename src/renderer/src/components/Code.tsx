import { useEffect, useState } from 'react'
import { findNode } from '@shared/tree'
import { generate } from '@shared/curl'
import type { RequestDoc } from '@shared/types'
import { activeEnvId, activeWorkspace, api, useStore } from '../state'
import { EditorState } from '@codemirror/state'
import { codeLang } from '../codeLangs'
import { codeTargets, snippet } from '../codegen'
import { CodeEditor } from './CodeEditor'
import { Modal, Segmented } from './ui'

const PICK_KEY = 'zeno:code-target'

/** código do request: o backend entrega o request pronto e o código sai aqui (cURL próprio ou httpsnippet) */
async function codeSnippet(wsId: string, req: RequestDoc, envId: string | null, target: string, resolveVars: boolean, client?: string): Promise<string> {
  const input = await api.codeInput(wsId, req, envId, resolveVars)
  return client ? snippet(target, client, input) : generate('curl', input)
}

type Target = { key: string; title: string; clients: { key: string; title: string; link?: string }[] }

/** última escolha (linguagem/biblioteca); padrão Shell › cURL, como no Insomnia */
function savedPick(): { target: string; client: string } {
  try {
    const v = JSON.parse(localStorage.getItem(PICK_KEY) || 'null')
    if (v && typeof v.target === 'string' && typeof v.client === 'string') return v
  } catch {
    /* sem storage */
  }
  return { target: 'shell', client: 'curl' }
}

/** sigla colorida de cada linguagem na lista */
const BADGE: Record<string, [string, string]> = {
  shell: ['$_', 'var(--color-tgreen)'],
  http: ['H1', 'var(--color-dim)'],
  javascript: ['JS', 'var(--color-tlime)'],
  node: ['N', 'var(--color-tgreen)'],
  python: ['Py', 'var(--color-tblue)'],
  go: ['Go', 'var(--color-tblue)'],
  java: ['J', 'var(--color-torange)'],
  kotlin: ['Kt', 'var(--color-tpurple)'],
  csharp: ['C#', 'var(--color-tpurple)'],
  php: ['php', 'var(--color-tpurple)'],
  ruby: ['Rb', 'var(--color-tpink)'],
  rust: ['Rs', 'var(--color-torange)'],
  swift: ['Sw', 'var(--color-torange)'],
  objc: ['ObjC', 'var(--color-tblue)'],
  c: ['C', 'var(--color-tblue)'],
  powershell: ['PS', 'var(--color-tblue)'],
  r: ['R', 'var(--color-tblue)'],
  clojure: ['clj', 'var(--color-tgreen)'],
  crystal: ['Cr', 'var(--color-dim)'],
  ocaml: ['ML', 'var(--color-torange)']
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
  const text = await run(codeSnippet(c.wsId, c.req, c.envId, 'curl', true))
  if (text === undefined) return
  await api.copyText(text)
  notify('cURL copiado')
}

export function CodeModal({ reqId, onClose }: { reqId: string; onClose: () => void }) {
  const [pick, setPick] = useState(savedPick)
  const [targets] = useState<Target[]>(codeTargets)
  const [resolve, setResolve] = useState(true)
  const [code, setCode] = useState('')
  const [err, setErr] = useState('')
  const workspaces = useStore((s) => s.workspaces)
  const c = current(reqId)
  const req = c?.req

  const target = targets.find((t) => t.key === pick.target) ?? targets[0]
  const client = target?.clients.find((x) => x.key === pick.client) ?? target?.clients[0]

  useEffect(() => {
    if (!c || !target || !client) return
    // só vale a resposta da escolha atual (trocar rápido não deixa código velho na tela)
    let alive = true
    codeSnippet(c.wsId, c.req, c.envId, target.key, resolve, client.key).then(
      (t) => {
        if (!alive) return
        setCode(t)
        setErr('')
      },
      (e) => alive && setErr(String(e).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''))
    )
    try {
      localStorage.setItem(PICK_KEY, JSON.stringify({ target: target.key, client: client.key }))
    } catch {
      /* sem storage */
    }
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target?.key, client?.key, resolve, req, workspaces])

  if (!c) return null
  return (
    <Modal title={`Gerar código · ${c.req.name}`} onClose={onClose} wide>
      <div className="flex h-[62vh] min-h-[340px] gap-3">
        {/* linguagens */}
        <div className="flex w-[190px] shrink-0 flex-col gap-0.5 overflow-y-auto pr-1">
          {targets.map((t) => {
            const [sig, color] = BADGE[t.key] ?? [t.key.slice(0, 2), 'var(--color-dim)']
            const on = t.key === target?.key
            return (
              <button
                key={t.key}
                className={`flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-left ${on ? 'bg-raised text-ink' : 'text-dim hover:bg-raised/60 hover:text-ink'}`}
                onClick={() => setPick({ target: t.key, client: t.clients[0]?.key ?? '' })}
              >
                <span
                  className="flex h-6 w-8 shrink-0 items-center justify-center rounded-md font-mono text-[10.5px] font-bold"
                  style={{ color, background: `color-mix(in srgb, ${color} 16%, transparent)`, outline: on ? `1px solid color-mix(in srgb, ${color} 55%, transparent)` : undefined }}
                >
                  {sig}
                </span>
                <span className="truncate">{t.title}</span>
                <span className="ml-auto text-[10.5px] text-faint">{t.clients.length > 1 ? t.clients.length : ''}</span>
              </button>
            )
          })}
        </div>

        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            {target && target.clients.length > 1 ? (
              <Segmented value={client?.key ?? ''} options={target.clients.map((x) => ({ id: x.key, label: x.title }))} onChange={(k) => setPick({ target: target.key, client: k })} />
            ) : (
              <span className="px-1 text-dim">{client?.title}</span>
            )}
            <div className="flex-1" />
            <label className="flex items-center gap-1.5 text-[12px] text-dim">
              <input type="checkbox" checked={resolve} onChange={(e) => setResolve(e.target.checked)} />
              Resolver variáveis
            </label>
            <button
              className="btn btn-accent"
              disabled={!!err}
              onClick={async () => {
                await api.copyText(code)
                useStore.getState().notify('Código copiado')
              }}
            >
              Copiar
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-hidden rounded-md border border-line bg-bg">
            {err ? <p className="p-3 text-tpink">{err}</p> : <CodeEditor key={target?.key} value={code} readOnly wrap={false} extra={[...codeLang(target?.key), EditorState.tabSize.of(2)]} />}
          </div>
          <p className="text-[11px] text-faint">
            Gerado com httpsnippet (o mesmo do Insomnia). Senhas e tokens do cofre aparecem decifrados; com &quot;Resolver variáveis&quot; desligado, as <code>{'{{ variáveis }}'}</code> ficam como referência.
            {client?.link && <> · <a className="text-accent hover:underline" href={client.link} target="_blank" rel="noreferrer">sobre {client.title}</a></>}
          </p>
        </div>
      </div>
    </Modal>
  )
}
