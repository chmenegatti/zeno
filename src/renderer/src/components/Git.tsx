import { useCallback, useEffect, useState } from 'react'
import type { GitFile, GitStatus, Workspace } from '@shared/types'
import { api, useStore } from '../state'
import { Modal } from './ui'
import { Select } from './Select'

const STATUS_STYLE: Record<GitFile['status'], [string, string]> = {
  M: ['M', 'text-tblue'],
  A: ['+', 'text-tgreen'],
  D: ['−', 'text-tpink'],
  R: ['R', 'text-tpurple'],
  U: ['!', 'text-torange']
}

/** status do git do workspace, atualizado quando os arquivos mudam ou a janela volta ao foco */
export function useGitStatus(ws: Workspace | undefined): [GitStatus | null, () => void] {
  const workspaces = useStore((s) => s.workspaces)
  const [status, setStatus] = useState<GitStatus | null>(null)
  const linked = !!ws?.location?.linked
  const id = ws?.id
  const refresh = useCallback(() => {
    if (!id || !linked) return setStatus(null)
    api.gitStatus(id).then(setStatus, () => setStatus(null))
  }, [id, linked])
  useEffect(refresh, [refresh, workspaces])
  useEffect(() => {
    window.addEventListener('focus', refresh)
    return () => window.removeEventListener('focus', refresh)
  }, [refresh])
  return [status, refresh]
}

/** botão na barra do workspace: branch e quantidade de mudanças */
export function GitButton({ ws }: { ws: Workspace }) {
  const [st] = useGitStatus(ws)
  if (!ws.location?.linked) return null
  const label = !st ? '…' : !st.repo ? 'git' : `${st.branch ?? 'HEAD'}`
  return (
    <button
      className={`btn btn-ghost flex items-center gap-1 px-2 ${st?.conflict ? 'text-torange' : ''}`}
      title="Git do workspace"
      onClick={() => useStore.getState().openModal({ kind: 'git', id: ws.id })}
    >
      <BranchIcon />
      <span className="max-w-[70px] truncate text-[11.5px]">{label}</span>
      {!!st?.files.length && <span className="rounded bg-raised px-1 text-[10.5px] text-accent">{st.files.length}</span>}
    </button>
  )
}

export function BranchIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="6" cy="5" r="2" />
      <circle cx="6" cy="19" r="2" />
      <circle cx="18" cy="7" r="2" />
      <path d="M6 7v10M18 9c0 5-6 4-11.5 8.5" />
    </svg>
  )
}

export function GitModal({ ws, onClose }: { ws: Workspace; onClose: () => void }) {
  const [st, refresh] = useGitStatus(ws)
  const [selected, setSelected] = useState<string | null>(null)
  const [diff, setDiff] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [plain, setPlain] = useState<string[]>([])
  const [force, setForce] = useState(false)
  const { run, flushSaves, openModal, setWorkspaces } = useStore.getState()

  const files = st?.files ?? []
  const current = files.find((f) => f.path === selected) ? selected : (files[0]?.path ?? null)

  useEffect(() => {
    if (!current) return setDiff('')
    api.gitDiff(ws.id, current).then(setDiff, (e) => setDiff(String(e)))
  }, [ws.id, current, st])

  // segredo em texto puro não deve ir pro repositório
  useEffect(() => {
    api.vaultScan(ws.id).then((r) => setPlain(r.plain))
  }, [ws.id, st])

  const op = async (name: string, fn: () => Promise<GitStatus>) => {
    setBusy(name)
    await flushSaves()
    const r = await run(fn())
    setBusy(null)
    refresh()
    return r
  }

  if (!ws.location?.linked)
    return (
      <Modal title="Git" onClose={onClose}>
        <MoveHint ws={ws} />
      </Modal>
    )

  if (st && !st.repo)
    return (
      <Modal title="Git" onClose={onClose}>
        <p className="mb-3 text-dim">
          A pasta <code className="select-text">{ws.location.dir}</code> não está num repositório git.
        </p>
        <button className="btn btn-accent" disabled={!!busy} onClick={() => op('init', () => api.gitInit(ws.id))}>Criar repositório aqui (git init)</button>
      </Modal>
    )

  const blocked = plain.length > 0 && !force
  return (
    <Modal title={`Git · ${ws.name}`} onClose={onClose} wide>
      {!st ? (
        <p className="text-faint">lendo repositório…</p>
      ) : (
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <BranchIcon />
            <Select
              className="field py-1"
              value={st.branch ?? ''}
              disabled={!!busy}
              onChange={(v) => op('switch', () => api.gitSwitch(ws.id, v, false))}
            >
              {!st.branch && <option value="">(sem branch)</option>}
              {st.branches.map((b) => <option key={b} value={b}>{b}</option>)}
              {st.branch && !st.branches.includes(st.branch) && <option value={st.branch}>{st.branch}</option>}
            </Select>
            <button
              className="btn btn-ghost"
              disabled={!!busy}
              onClick={() => openModal({ kind: 'prompt', title: 'Novo branch', value: '', onOk: (name) => {
                openModal({ kind: 'git', id: ws.id })
                if (name) op('switch', () => api.gitSwitch(ws.id, name, true))
              } })}
            >
              ＋ branch
            </button>
            <span className="text-[12px] text-faint">
              {st.upstream ? <>↔ {st.upstream} · ↓{st.behind} ↑{st.ahead}</> : st.hasRemote ? 'sem upstream (o push cria)' : 'sem remoto'}
            </span>
            <div className="flex-1" />
            <button className="btn btn-ghost" title="Atualizar" onClick={refresh}>⟳</button>
            <button className="btn" disabled={!!busy || !st.upstream} title="git pull --rebase --autostash" onClick={() => op('pull', () => api.gitPull(ws.id))}>
              {busy === 'pull' ? 'puxando…' : `↓ Pull${st.behind ? ` (${st.behind})` : ''}`}
            </button>
            <button className="btn" disabled={!!busy || !st.hasRemote} onClick={() => op('push', () => api.gitPush(ws.id))}>
              {busy === 'push' ? 'enviando…' : `↑ Push${st.ahead ? ` (${st.ahead})` : ''}`}
            </button>
          </div>

          {st.conflict && (
            <div className="flex items-center gap-3 rounded-md border border-torange/50 bg-torange/10 p-2 text-[12.5px]">
              <span className="flex-1 text-torange">
                O pull parou num conflito. Resolva os arquivos marcados com ! (no editor ou com <code>git status</code> em <code className="select-text">{st.root}</code>) ou desfaça.
              </span>
              <button className="btn" disabled={!!busy} onClick={() => op('abort', () => api.gitAbort(ws.id))}>Desfazer pull</button>
            </div>
          )}

          <div className="grid h-[44vh] min-h-[240px] grid-cols-[minmax(220px,1fr)_2fr] gap-2">
            <div className="overflow-auto rounded-md border border-line bg-bg py-1">
              {files.length === 0 ? (
                <p className="px-3 py-6 text-center text-faint">Nada para commitar.</p>
              ) : (
                files.map((f) => {
                  const [sym, color] = STATUS_STYLE[f.status]
                  return (
                    <button
                      key={f.path}
                      className={`flex w-full items-center gap-2 px-2 py-1 text-left ${f.path === current ? 'bg-raised' : 'hover:bg-raised/60'}`}
                      onClick={() => setSelected(f.path)}
                      title={f.path}
                    >
                      <span className={`w-3 shrink-0 text-center font-mono font-semibold ${color}`}>{sym}</span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate">{f.label}</span>
                        {f.label !== f.path && <span className="block truncate text-[10.5px] text-faint">{f.path}</span>}
                      </span>
                    </button>
                  )
                })
              )}
            </div>
            <DiffView text={diff} />
          </div>

          {plain.length > 0 && (
            <div className="rounded-md border border-tpink/50 bg-tpink/10 p-2 text-[12.5px]">
              <p className="text-tpink">{plain.length} segredo(s) em texto puro iriam para o repositório:</p>
              <pre className="my-1 max-h-[70px] overflow-auto text-[11px] text-dim">{plain.join('\n')}</pre>
              <div className="flex items-center gap-3">
                <button
                  className="btn text-tpurple"
                  disabled={!!busy}
                  onClick={async () => {
                    setBusy('protect')
                    const r = await run(api.vaultProtect(ws.id))
                    setBusy(null)
                    if (r) setWorkspaces(r.workspaces)
                    refresh()
                  }}
                >
                  {busy === 'protect' ? 'criptografando…' : 'Criptografar agora'}
                </button>
                <label className="flex items-center gap-1.5 text-dim">
                  <input type="checkbox" checked={force} onChange={(e) => setForce(e.target.checked)} /> commitar mesmo assim
                </label>
              </div>
            </div>
          )}

          <form
            className="flex gap-2"
            onSubmit={async (e) => {
              e.preventDefault()
              const r = await op('commit', () => api.gitCommit(ws.id, message))
              if (r) setMessage('')
            }}
          >
            <input className="field flex-1" placeholder="Mensagem do commit" value={message} onChange={(e) => setMessage(e.target.value)} />
            <button className="btn btn-accent" disabled={!!busy || !files.length || !message.trim() || blocked || st.conflict}>
              {busy === 'commit' ? 'commitando…' : `Commit (${files.length})`}
            </button>
          </form>
          <p className="text-[11.5px] text-faint">
            O commit leva só o que está na pasta do workspace (<code className="select-text">{ws.location.dir}</code>). Respostas, estado da tela e a chave do cofre ficam fora do repositório.
          </p>
        </div>
      )}
    </Modal>
  )
}

function DiffView({ text }: { text: string }) {
  if (!text) return <div className="rounded-md border border-line bg-bg" />
  return (
    <pre className="overflow-auto rounded-md border border-line bg-bg p-2 font-mono text-[11.5px] leading-[1.5]">
      {text.split('\n').map((l, i) => {
        const c = /^(diff |index |--- |\+\+\+ |new file|deleted file)/.test(l)
          ? 'text-faint'
          : l.startsWith('@@')
            ? 'text-tblue'
            : l.startsWith('+')
              ? 'bg-tgreen/10 text-tgreen'
              : l.startsWith('-')
                ? 'bg-tpink/10 text-tpink'
                : 'text-dim'
        return <div key={i} className={c}>{l || ' '}</div>
      })}
    </pre>
  )
}

/** workspace ainda na pasta de dados: explica como levar pro repo */
export function MoveHint({ ws }: { ws: Workspace }) {
  const { run, setWorkspaces } = useStore.getState()
  return (
    <div className="flex flex-col gap-2">
      <p className="text-dim">
        Este workspace está na pasta de dados do Zeno. Para versionar com git, mova-o para uma pasta do seu projeto (por exemplo <code>meu-projeto/api/</code>). Os requests continuam sendo arquivos YAML, um por request, e dá pra commitar, fazer pull e push daqui.
      </p>
      <button
        className="btn btn-accent self-start"
        onClick={async () => {
          const list = await run(api.moveWorkspace(ws.id))
          if (list) setWorkspaces(list)
        }}
      >
        Mover para pasta…
      </button>
    </div>
  )
}
