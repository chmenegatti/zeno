import { useEffect, useState } from 'react'
import type { GitHubAccount } from '@shared/types'
import { activeWorkspace, api, useStore } from '../state'
import { Modal } from './ui'

const GH_ICON = (
  <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
    <path fill="currentColor" d="M12 .5a11.5 11.5 0 0 0-3.64 22.41c.58.1.79-.25.79-.56v-2c-3.2.7-3.88-1.37-3.88-1.37-.53-1.33-1.29-1.69-1.29-1.69-1.05-.72.08-.7.08-.7 1.16.08 1.77 1.19 1.77 1.19 1.03 1.77 2.71 1.26 3.37.96.1-.75.4-1.26.73-1.55-2.56-.29-5.25-1.28-5.25-5.69 0-1.26.45-2.29 1.19-3.1-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.17 1.18a11 11 0 0 1 5.78 0c2.2-1.49 3.17-1.18 3.17-1.18.63 1.59.23 2.76.11 3.05.74.81 1.19 1.84 1.19 3.1 0 4.42-2.7 5.39-5.27 5.68.41.36.78 1.06.78 2.14v3.17c0 .31.21.67.8.56A11.5 11.5 0 0 0 12 .5Z" />
  </svg>
)

type Remote = { dir: string; id?: string; name: string; files: number }

/** entrar no GitHub e salvar/baixar workspaces de um repositório privado */
export function GitHubModal({ onClose, ids }: { onClose: () => void; ids?: string[] }) {
  const workspaces = useStore((s) => s.workspaces)
  const app = useStore((s) => s.app)
  const { run, notify } = useStore.getState()
  const [account, setAccount] = useState<GitHubAccount | null | undefined>(undefined)
  const [device, setDevice] = useState(false)
  const [code, setCode] = useState<{ userCode: string; url: string } | null>(null)
  const [token, setToken] = useState('')
  const [repo, setRepo] = useState('')
  const [busy, setBusy] = useState('')
  const [remote, setRemote] = useState<Remote[] | null>(null)
  const [pick, setPick] = useState<Set<string>>(() => new Set(ids?.length ? ids : ([activeWorkspace({ workspaces, app })?.id].filter(Boolean) as string[])))

  useEffect(() => {
    api.githubStatus().then((s) => {
      setAccount(s.account)
      setDevice(s.deviceAvailable)
      setRepo(s.account?.repo ?? '')
    })
  }, [])
  useEffect(() => {
    if (account) refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [account?.login, account?.repo])

  const doing = async <T,>(what: string, p: Promise<T>): Promise<T | undefined> => {
    setBusy(what)
    try {
      return await run(p)
    } finally {
      setBusy('')
    }
  }
  const refresh = async (): Promise<void> => {
    const r = await doing('lendo o repositório…', api.githubList())
    if (r) setRemote(r)
  }
  const loggedIn = (a: GitHubAccount | undefined): void => {
    if (!a) return
    setAccount(a)
    setRepo(a.repo)
    setToken('')
    setCode(null)
    notify(`Conectado como @${a.login}`)
  }

  if (account === undefined) return null
  return (
    <Modal title="GitHub · salvar coleções" onClose={onClose} wide>
      {!account ? (
        <div className="flex flex-col gap-4">
          <p className="text-dim">
            Conecte sua conta pra guardar os workspaces num repositório <b>privado</b> do GitHub (padrão <code>zeno-collections</code>) e baixar em outra máquina. O token fica criptografado no cofre, com a chave no chaveiro do sistema.
          </p>
          {device && (
            <div className="flex flex-col gap-2 rounded-lg border border-accent/50 bg-accent/5 p-3">
              <span className="font-semibold">Entrar com GitHub</span>
              <span className="text-[12px] text-dim">Abre o navegador; você digita um código e autoriza o Zeno a criar e usar seus repositórios.</span>
              {code ? (
                <span className="text-dim">
                  Digite <b className="font-mono text-[15px] text-accent">{code.userCode}</b> em <a className="text-accent hover:underline" href={code.url} target="_blank" rel="noreferrer">{code.url}</a> e autorize. Esta janela atualiza sozinha.
                </span>
              ) : (
                <button
                  className="btn btn-accent flex items-center gap-2 self-start"
                  disabled={!!busy}
                  onClick={async () => {
                    const c = await doing('abrindo o navegador…', api.githubDeviceStart())
                    if (!c) return
                    setCode(c)
                    loggedIn(await run(api.githubDevicePoll()))
                  }}
                >
                  {GH_ICON} Entrar com GitHub
                </button>
              )}
            </div>
          )}
          <div className="grid gap-3 md:grid-cols-2">
            <div className="flex flex-col gap-2 rounded-lg border border-line p-3">
              <span className="font-semibold">Ou: GitHub CLI</span>
              <span className="text-[12px] text-dim">Se você já fez <code>gh auth login</code>, o Zeno usa essa sessão.</span>
              <button className="btn mt-auto flex items-center justify-center gap-2" disabled={!!busy} onClick={async () => loggedIn(await doing('entrando…', api.githubLoginGh()))}>
                {GH_ICON} Usar a sessão do GitHub CLI
              </button>
            </div>
            <form
              className="flex flex-col gap-2 rounded-lg border border-line p-3"
              onSubmit={async (e) => {
                e.preventDefault()
                if (token.trim()) loggedIn(await doing('entrando…', api.githubLoginToken(token)))
              }}
            >
              <span className="font-semibold">Ou: colar um token</span>
              <span className="text-[12px] text-dim">
                Crie em <a className="text-accent hover:underline" href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noreferrer">github.com/settings/tokens</a> com acesso a repositórios (<i>Contents</i> e <i>Administration</i> de leitura e escrita, ou o escopo <code>repo</code>).
              </span>
              <div className="mt-auto flex gap-2">
                <input className="field min-w-0 flex-1 font-mono text-[12px]" type="password" placeholder="github_pat_… ou ghp_…" value={token} onChange={(e) => setToken(e.target.value)} autoComplete="off" spellCheck={false} />
                <button className="btn" disabled={!token.trim() || !!busy}>Entrar</button>
              </div>
            </form>
          </div>
          {busy && <span className="text-accent">{busy}</span>}
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <div className="flex items-center gap-3">
            {account.avatar && <img src={account.avatar} alt="" className="h-9 w-9 rounded-full border border-line" />}
            <div className="flex flex-col">
              <span className="font-semibold">{account.name ?? account.login}</span>
              <span className="text-[12px] text-dim">@{account.login} · {account.via === 'gh' ? 'sessão do GitHub CLI' : account.via === 'device' ? 'login pelo navegador' : 'token'}</span>
            </div>
            <div className="flex-1" />
            <button className="btn btn-ghost" onClick={async () => { await api.githubLogout(); setAccount(null); setRemote(null) }}>Sair</button>
          </div>

          <form
            className="flex items-center gap-2"
            onSubmit={async (e) => {
              e.preventDefault()
              const a = await doing('trocando…', api.githubSetRepo(repo))
              if (a) setAccount(a)
            }}
          >
            <span className="text-dim">Repositório</span>
            <span className="font-mono text-[12px] text-faint">{account.login}/</span>
            <input className="field w-[220px] font-mono text-[12px]" value={repo} onChange={(e) => setRepo(e.target.value)} spellCheck={false} />
            {repo !== account.repo && <button className="btn">Usar</button>}
            <a className="ml-auto text-[12px] text-accent hover:underline" href={`https://github.com/${account.login}/${account.repo}`} target="_blank" rel="noreferrer">abrir no GitHub ↗</a>
          </form>
          <p className="-mt-2 text-[11.5px] text-faint">Criado como privado na primeira vez. Cada envio vira um commit; cada workspace, uma pasta.</p>

          <div className="grid gap-3 md:grid-cols-2">
            <div className="flex flex-col gap-2 rounded-lg border border-line p-3">
              <span className="font-semibold">Enviar pro GitHub</span>
              <div className="flex max-h-[220px] flex-col gap-1 overflow-y-auto">
                {workspaces.map((w) => (
                  <label key={w.id} className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={pick.has(w.id)}
                      onChange={(e) => setPick((s) => {
                        const n = new Set(s)
                        if (e.target.checked) n.add(w.id)
                        else n.delete(w.id)
                        return n
                      })}
                    />
                    <span className="truncate">{w.name}</span>
                    {remote?.some((r) => r.id === w.id) && <span className="text-[11px] text-tgreen">no GitHub</span>}
                  </label>
                ))}
              </div>
              <button
                className="btn btn-accent mt-auto"
                disabled={!pick.size || !!busy}
                onClick={async () => {
                  const r = await doing('enviando…', api.githubPush([...pick]))
                  if (r === undefined) return
                  notify(r ? `Enviado: ${r.files} arquivo${r.files > 1 ? 's' : ''} num commit` : 'Nada mudou desde o último envio')
                  refresh()
                }}
              >
                Enviar {pick.size > 1 ? `${pick.size} workspaces` : 'workspace'}
              </button>
              <span className="text-[11px] text-faint">Segredos do cofre vão cifrados: em outra máquina, use o mesmo chaveiro ou informe de novo.</span>
            </div>

            <div className="flex flex-col gap-2 rounded-lg border border-line p-3">
              <div className="flex items-center">
                <span className="font-semibold">No repositório</span>
                <div className="flex-1" />
                <button className="btn btn-ghost px-2 py-0.5 text-[11.5px]" disabled={!!busy} onClick={refresh}>atualizar</button>
              </div>
              {remote === null ? (
                <span className="text-faint">…</span>
              ) : !remote.length ? (
                <span className="text-faint">Nada ainda. Envie um workspace.</span>
              ) : (
                <div className="flex max-h-[220px] flex-col gap-1 overflow-y-auto">
                  {remote.map((r) => {
                    const here = workspaces.some((w) => w.id === r.id)
                    return (
                      <div key={r.dir} className="flex items-center gap-2">
                        <span className="min-w-0 flex-1 truncate">{r.name} <span className="text-[11px] text-faint">{r.files} arquivos</span></span>
                        <button
                          className="btn px-2 py-0.5 text-[11.5px]"
                          disabled={!!busy}
                          title={here ? 'Substitui a versão local pela do GitHub' : 'Cria o workspace aqui'}
                          onClick={() =>
                            useStore.getState().openModal({
                              kind: 'confirm',
                              title: here ? 'Baixar do GitHub' : 'Baixar workspace',
                              message: here ? `Trocar os arquivos locais de "${r.name}" pela versão do GitHub? Mudanças locais não enviadas se perdem.` : `Baixar "${r.name}" pra esta máquina?`,
                              value: 'Baixar',
                              onOk: async () => {
                                const res = await run(api.githubPull(r.dir, r.id))
                                if (!res) return
                                useStore.getState().setWorkspaces(res.workspaces)
                                notify(`"${r.name}" baixado (${res.files} arquivos)`)
                              }
                            })
                          }
                        >
                          {here ? 'atualizar daqui' : 'baixar'}
                        </button>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          </div>
          {busy && <span className="text-accent">{busy}</span>}
        </div>
      )}
    </Modal>
  )
}
