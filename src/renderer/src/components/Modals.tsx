import { useEffect, useState } from 'react'
import { newId } from '@shared/tree'
import type { Environment, Folder, ImportPreview, Workspace } from '@shared/types'
import { findNode } from '@shared/tree'
import { activeWorkspace, api, deleteEnvironment, saveEnvironment, saveFolder, useStore } from '../state'
import { CodeEditor } from './CodeEditor'
import { KeyValueTable } from './KeyValueTable'
import { AuthEditor } from './RequestPane'
import { GitModal, MoveHint } from './Git'
import { CodeModal } from './Code'
import { LockIcon, useVaultStatus } from './Secret'
import { Modal } from './ui'

export function Modals() {
  const modal = useStore((s) => s.modal)
  const workspaces = useStore((s) => s.workspaces)
  const close = useStore((s) => s.closeModal)
  if (!modal) return null
  const ws = workspaces.find((w) => w.id === modal.id)
  switch (modal.kind) {
    case 'prompt':
      return <PromptModal title={modal.title ?? ''} initial={modal.value ?? ''} onOk={(v) => { close(); modal.onOk?.(v) }} onClose={close} />
    case 'confirm':
      return (
        <Modal title={modal.title ?? 'Confirmar'} onClose={close}>
          <p className="mb-4">{modal.message}</p>
          <div className="flex justify-end gap-2">
            <button className="btn" onClick={close}>Cancelar</button>
            <button autoFocus className="btn bg-tpink text-white" onClick={() => { close(); modal.onOk?.('') }}>{modal.value || 'Excluir'}</button>
          </div>
        </Modal>
      )
    case 'env':
      return ws ? <EnvModal ws={ws} onClose={close} /> : null
    case 'workspace':
      return ws ? <WorkspaceModal ws={ws} onClose={close} /> : null
    case 'folder': {
      const w = activeWorkspace({ workspaces, app: useStore.getState().app })
      const f = w && modal.id ? findNode(w, modal.id) : null
      return f && f.node.kind === 'folder' ? <FolderModal folder={f.node} onClose={close} /> : null
    }
    case 'import':
      return <ImportModal onClose={close} />
    case 'code':
      return modal.id ? <CodeModal reqId={modal.id} onClose={close} /> : null
    case 'git':
      return ws ? <GitModal ws={ws} onClose={close} /> : null
  }
}

function PromptModal({ title, initial, onOk, onClose }: { title: string; initial: string; onOk: (v: string) => void; onClose: () => void }) {
  const [v, setV] = useState(initial)
  return (
    <Modal title={title} onClose={onClose}>
      <form onSubmit={(e) => { e.preventDefault(); onOk(v.trim()) }} className="flex gap-2">
        <input autoFocus className="field flex-1" value={v} onChange={(e) => setV(e.target.value)} placeholder="Nome" />
        <button className="btn btn-accent">OK</button>
      </form>
    </Modal>
  )
}

// ---------- ambientes ----------

function EnvModal({ ws, onClose }: { ws: Workspace; onClose: () => void }) {
  const base = ws.environments.find((e) => e.parentId === null)
  const subs = ws.environments.filter((e) => e.parentId !== null)
  const [selId, setSelId] = useState<string | undefined>(base?.id ?? subs[0]?.id)
  const env = ws.environments.find((e) => e.id === selId)

  const addSub = async () => {
    let baseId = base?.id
    if (!baseId) {
      baseId = newId('env')
      await saveEnvironment(ws.id, { id: baseId, name: 'Base', parentId: null, data: {}, sortKey: 0 })
    }
    const id = newId('env')
    await saveEnvironment(ws.id, { id, name: `Ambiente ${subs.length + 1}`, parentId: baseId, data: {}, sortKey: Date.now() })
    setSelId(id)
  }

  return (
    <Modal title={`Ambientes · ${ws.name}`} onClose={onClose} wide>
      <div className="flex h-[60vh] gap-4">
        <div className="flex w-[200px] shrink-0 flex-col gap-0.5">
          {base && <EnvItem env={base} active={selId === base.id} onClick={() => setSelId(base.id)} label="Base (todos)" />}
          <div className="mt-2 mb-1 px-2 text-[11px] uppercase tracking-wide text-faint">Sub-ambientes</div>
          {subs.map((e) => <EnvItem key={e.id} env={e} active={selId === e.id} onClick={() => setSelId(e.id)} />)}
          <button className="btn btn-ghost mt-1 text-left" onClick={addSub}>＋ Novo ambiente</button>
        </div>
        {env ? <EnvForm key={env.id} ws={ws} env={env} onDeleted={() => setSelId(base?.id)} /> : <p className="text-faint">Sem ambientes.</p>}
      </div>
    </Modal>
  )
}

function EnvItem({ env, active, onClick, label }: { env: Environment; active: boolean; onClick: () => void; label?: string }) {
  return (
    <button onClick={onClick} className={`flex items-center gap-2 rounded-md px-2 py-1.5 text-left ${active ? 'bg-raised text-ink' : 'text-dim hover:text-ink'}`}>
      <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: env.color ?? 'var(--color-faint)' }} />
      <span className="truncate">{label ?? env.name}</span>
    </button>
  )
}

function EnvForm({ ws, env, onDeleted }: { ws: Workspace; env: Environment; onDeleted: () => void }) {
  const [name, setName] = useState(env.name)
  const [color, setColor] = useState(env.color ?? '#00dbff')
  const [text, setText] = useState(JSON.stringify(env.data, null, 2))
  const [err, setErr] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  const save = async () => {
    let data: Record<string, unknown>
    try {
      data = JSON.parse(text || '{}')
      if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('precisa ser um objeto { }')
    } catch (e) {
      setErr(`JSON inválido: ${(e as Error).message}`)
      return
    }
    setErr(null)
    await saveEnvironment(ws.id, { ...env, name: name.trim() || env.name, color: env.parentId ? color : undefined, data })
    setSaved(true)
    setTimeout(() => setSaved(false), 1500)
  }

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-2">
      <div className="flex items-center gap-2">
        <input className="field flex-1" value={name} onChange={(e) => setName(e.target.value)} disabled={env.parentId === null} />
        {env.parentId !== null && <input type="color" className="h-8 w-10 cursor-pointer rounded border border-line bg-transparent" value={color} onChange={(e) => setColor(e.target.value)} />}
      </div>
      <p className="text-[11.5px] text-faint">
        {env.parentId === null ? 'Valores valem pra todos os sub-ambientes.' : 'Sobrescreve as chaves do Base.'} Use como <code>{'{{ nome }}'}</code> ou <code>{'{{ _.nome }}'}</code>. Valores <code>$zeno$v1$…</code> são segredos do cofre: edite pela badge da variável.
      </p>
      <div className="min-h-0 flex-1 rounded-md border border-line" onKeyDown={(e) => (e.ctrlKey || e.metaKey) && e.key === 's' && (e.preventDefault(), save())}>
        <CodeEditor value={text} onChange={setText} lang="json" />
      </div>
      {err && <p className="text-tpink">{err}</p>}
      <div className="flex items-center gap-2">
        {env.parentId !== null && (
          <button className="btn text-tpink" onClick={async () => { await deleteEnvironment(env.id); onDeleted() }}>Excluir ambiente</button>
        )}
        <div className="flex-1" />
        {saved && <span className="text-accent">Salvo</span>}
        <button className="btn btn-accent" onClick={save}>Salvar (Ctrl+S)</button>
      </div>
    </div>
  )
}

// ---------- pasta ----------

function FolderModal({ folder, onClose }: { folder: Folder; onClose: () => void }) {
  const [draft, setDraft] = useState(folder)
  const [vars, setVars] = useState(JSON.stringify(folder.vars, null, 2))
  const [err, setErr] = useState<string | null>(null)
  const save = async () => {
    let parsed: Record<string, unknown>
    try {
      parsed = JSON.parse(vars || '{}')
    } catch (e) {
      setErr(`Variáveis: JSON inválido (${(e as Error).message})`)
      return
    }
    await saveFolder({ ...draft, vars: parsed })
    onClose()
  }
  return (
    <Modal title={`Pasta · ${folder.name}`} onClose={onClose} wide>
      <div className="flex flex-col gap-4">
        <label className="flex items-center gap-3">
          <span className="w-[90px] text-dim">Nome</span>
          <input className="field flex-1" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
        </label>
        <div>
          <h3 className="mb-1 font-semibold">Headers herdados pelos requests</h3>
          <KeyValueTable rows={draft.headers} onChange={(headers) => setDraft({ ...draft, headers })} keyPlaceholder="Header" />
        </div>
        <div>
          <h3 className="font-semibold">Auth padrão da pasta</h3>
          <AuthEditor auth={draft.auth} onChange={(auth) => setDraft({ ...draft, auth })} />
        </div>
        <div>
          <h3 className="mb-1 font-semibold">Variáveis da pasta <span className="font-normal text-faint">(sobrescrevem o ambiente)</span></h3>
          <div className="h-[160px] rounded-md border border-line">
            <CodeEditor value={vars} onChange={setVars} lang="json" />
          </div>
        </div>
        {err && <p className="text-tpink">{err}</p>}
        <div className="flex justify-end gap-2">
          <button className="btn" onClick={onClose}>Cancelar</button>
          <button className="btn btn-accent" onClick={save}>Salvar</button>
        </div>
      </div>
    </Modal>
  )
}

// ---------- workspace ----------

function WorkspaceModal({ ws, onClose }: { ws: Workspace; onClose: () => void }) {
  const [name, setName] = useState(ws.name)
  const [description, setDescription] = useState(ws.description ?? '')
  const [settings, setSettings] = useState(ws.settings)
  const { run, setWorkspaces, openModal, setApp, dataDir } = useStore.getState()
  const linked = !!ws.location?.linked
  const save = async () => {
    await run(api.saveWorkspace({ id: ws.id, name: name.trim() || ws.name, description: description || undefined, settings }))
    const { workspaces } = await api.load()
    setWorkspaces(workspaces)
    onClose()
  }
  return (
    <Modal title="Workspace" onClose={onClose}>
      <div className="flex flex-col gap-3">
        <label className="flex flex-col gap-1">
          <span className="text-dim">Nome</span>
          <input className="field" value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-dim">Descrição</span>
          <textarea className="field h-16 resize-none" value={description} onChange={(e) => setDescription(e.target.value)} />
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" className="accent-[var(--color-accent)]" checked={settings.insecureTLS} onChange={(e) => setSettings({ ...settings, insecureTLS: e.target.checked })} />
          Aceitar certificado TLS inválido / autoassinado
        </label>
        <label className="flex items-center gap-2">
          <span className="text-dim">Timeout</span>
          <input type="number" min={0} className="field w-[110px]" value={settings.timeoutMs} onChange={(e) => setSettings({ ...settings, timeoutMs: Number(e.target.value) })} />
          <span className="text-faint">ms (0 = sem limite)</span>
        </label>
        <VaultSection ws={ws} />
        <LocationSection ws={ws} dataDir={dataDir} />
        <div className="flex items-center gap-2 pt-2">
          <button
            className="btn text-tpink"
            onClick={() =>
              openModal({
                kind: 'confirm',
                title: linked ? 'Remover workspace' : 'Excluir workspace',
                value: linked ? 'Remover' : 'Excluir',
                message: linked
                  ? `Tirar "${ws.name}" do Zeno? Os arquivos continuam em ${ws.location?.dir}.`
                  : `Excluir "${ws.name}" e todos os requests dele? Os arquivos serão apagados.`,
                onOk: async () => {
                  const list = await run(api.deleteWorkspace(ws.id))
                  if (list) {
                    setWorkspaces(list)
                    setApp({ activeWorkspaceId: list[0]?.id, activeRequestId: undefined })
                  }
                }
              })
            }
          >
            {linked ? 'Remover do Zeno' : 'Excluir workspace'}
          </button>
          <div className="flex-1" />
          <button className="btn" onClick={onClose}>Cancelar</button>
          <button className="btn btn-accent" onClick={save}>Salvar</button>
        </div>
      </div>
    </Modal>
  )
}

function LocationSection({ ws, dataDir }: { ws: Workspace; dataDir: string }) {
  const { run, setWorkspaces, openModal } = useStore.getState()
  if (!ws.location?.linked) return (
    <div className="rounded-md border border-line p-3">
      <div className="mb-1 font-semibold">Local e git</div>
      <MoveHint ws={ws} />
      <p className="mt-2 text-[11.5px] text-faint">Hoje em <code className="select-text">{ws.location?.dir ?? dataDir}</code></p>
    </div>
  )
  return (
    <div className="rounded-md border border-line p-3">
      <div className="mb-1 font-semibold">Local e git</div>
      <p className="text-[12px] text-dim">Pasta: <code className="select-text">{ws.location.dir}</code></p>
      <div className="mt-2 flex gap-2">
        <button className="btn" onClick={() => openModal({ kind: 'git', id: ws.id })}>Abrir painel Git</button>
        <button className="btn btn-ghost" onClick={async () => {
          const list = await run(api.moveWorkspace(ws.id))
          if (list) setWorkspaces(list)
        }}>Mover para outra pasta…</button>
      </div>
    </div>
  )
}

// ---------- cofre ----------

function VaultSection({ ws }: { ws: Workspace }) {
  const status = useVaultStatus()
  const [plain, setPlain] = useState<string[] | null>(null)
  const [warnings, setWarnings] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState<number | null>(null)
  const { run, setWorkspaces } = useStore.getState()
  useEffect(() => {
    api.vaultScan(ws.id).then((r) => {
      setPlain(r.plain)
      setWarnings(r.warnings)
    })
  }, [ws.id, done])
  const ok = !!status?.available && !status.weak && !status.error
  return (
    <div className="rounded-md border border-line p-3">
      <div className="mb-1 flex items-center gap-2 font-semibold">
        <span className="text-tpurple"><LockIcon size={13} /></span> Cofre de segredos
      </div>
      {!status ? (
        <p className="text-faint">verificando…</p>
      ) : (
        <p className="text-[12px] text-dim">
          Chaveiro: <code>{status.backend}</code>
          {status.keyId && <> · chave <code>{status.keyId}</code></>}
          {!status.available && <span className="text-torange"> · indisponível</span>}
          {status.weak && <span className="text-torange"> · sem proteção real (abra o gnome-keyring/kwallet)</span>}
          {status.error && <span className="text-tpink"> · {status.error}</span>}
        </p>
      )}
      {plain && plain.length > 0 ? (
        <div className="mt-2 flex flex-col gap-2">
          <p className="text-[12px] text-torange">{plain.length} segredo(s) em texto puro neste workspace</p>
          <pre className="max-h-[100px] overflow-auto rounded bg-bg p-2 text-[11px] text-dim">{plain.join('\n')}</pre>
          <button
            className="btn self-start text-tpurple"
            disabled={!ok || busy}
            onClick={async () => {
              setBusy(true)
              const r = await run(api.vaultProtect(ws.id))
              setBusy(false)
              if (!r) return
              setWorkspaces(r.workspaces)
              setDone(r.count)
            }}
          >
            {busy ? 'criptografando…' : `Criptografar ${plain.length} segredo(s)`}
          </button>
        </div>
      ) : (
        <p className="mt-1 text-[12px] text-tgreen">{done ? `${done} segredo(s) criptografado(s). ` : ''}Nenhum segredo em texto puro encontrado.</p>
      )}
      {warnings.length > 0 && (
        <details className="mt-2 text-[12px]">
          <summary className="cursor-pointer text-torange">{warnings.length} lugar(es) com senha escrita direto na URL/body — troque por variável secreta</summary>
          <pre className="mt-1 max-h-[100px] overflow-auto rounded bg-bg p-2 text-[11px] text-dim">{warnings.join('\n')}</pre>
        </details>
      )}
    </div>
  )
}

// ---------- import ----------

function ImportModal({ onClose }: { onClose: () => void }) {
  const [preview, setPreview] = useState<ImportPreview | null>(null)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const [showWarn, setShowWarn] = useState(false)
  const vault = useVaultStatus()
  const vaultOk = !!vault?.available && !vault.weak
  const [protect, setProtect] = useState(true)
  const { run, setWorkspaces, setApp } = useStore.getState()

  const [url, setUrl] = useState('')
  /** quiet: na abertura, sem Insomnia instalado não é erro */
  const load = async (source: 'insomnia' | 'file' | { url: string }, quiet = false) => {
    setBusy(true)
    const p = quiet ? await api.importPreview(source).catch(() => null) : await run(api.importPreview(source))
    setBusy(false)
    if (!p) return
    setPreview(p)
    setPicked(new Set(p.workspaces.map((w) => w.id)))
    setShowWarn(false)
  }

  useEffect(() => {
    load('insomnia', true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const doImport = async () => {
    setBusy(true)
    const list = await run(api.importRun([...picked], protect && vaultOk))
    setBusy(false)
    if (!list) return
    setWorkspaces(list)
    const first = list.find((w) => picked.has(w.id))
    if (first) setApp({ activeWorkspaceId: first.id, activeRequestId: undefined })
    onClose()
  }

  const total = preview?.workspaces.filter((w) => picked.has(w.id)).reduce((a, w) => a + w.requests, 0) ?? 0

  return (
    <Modal title="Importar" onClose={onClose} wide>
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <button className="btn" onClick={() => load('insomnia')} disabled={busy}>Ler ~/.config/Insomnia</button>
          <button className="btn" onClick={() => load('file')} disabled={busy}>Escolher arquivos…</button>
          <form className="flex min-w-[260px] flex-1 gap-2" onSubmit={(e) => { e.preventDefault(); if (url.trim()) load({ url: url.trim() }) }}>
            <input className="field min-w-0 flex-1" placeholder="URL de um OpenAPI/Swagger ou coleção" value={url} onChange={(e) => setUrl(e.target.value)} />
            <button className="btn" disabled={busy || !url.trim()}>Ler URL</button>
          </form>
          {busy && <span className="animate-pulse text-dim">lendo…</span>}
        </div>
        <p className="text-[11.5px] text-faint">
          Aceita Insomnia (pasta, export v4 JSON ou v5 YAML), OpenAPI 3 e Swagger 2 (JSON ou YAML) e Postman v2.1. Para o Postman, escolha a coleção junto com os arquivos de ambiente.
        </p>
        {!preview && !busy && <p className="py-4 text-center text-dim">Nenhum Insomnia encontrado em ~/.config/Insomnia. Escolha um arquivo ou informe uma URL.</p>}
        {preview && (
          <>
            <p className="text-[11.5px] text-faint">Origem: <code className="select-text">{preview.source}</code>. Nada é alterado na origem.</p>
            <div className="max-h-[42vh] overflow-auto rounded-md border border-line">
              <table className="w-full text-[12.5px]">
                <thead className="sticky top-0 bg-raised text-left text-dim">
                  <tr>
                    <th className="w-8 px-2 py-1.5">
                      <input type="checkbox" className="accent-[var(--color-accent)]" checked={picked.size === preview.workspaces.length} onChange={(e) => setPicked(e.target.checked ? new Set(preview.workspaces.map((w) => w.id)) : new Set())} />
                    </th>
                    <th className="px-2">Workspace</th>
                    <th className="px-2 text-right">Pastas</th>
                    <th className="px-2 text-right">Requests</th>
                    <th className="px-2 text-right">Ambientes</th>
                    <th className="px-2" />
                  </tr>
                </thead>
                <tbody>
                  {preview.workspaces.map((w) => (
                    <tr key={w.id} className="border-t border-line/60">
                      <td className="px-2 py-1">
                        <input type="checkbox" className="accent-[var(--color-accent)]" checked={picked.has(w.id)} onChange={(e) => { const n = new Set(picked); if (e.target.checked) n.add(w.id); else n.delete(w.id); setPicked(n) }} />
                      </td>
                      <td className="px-2">{w.name}</td>
                      <td className="px-2 text-right text-dim">{w.folders}</td>
                      <td className="px-2 text-right text-dim">{w.requests}</td>
                      <td className="px-2 text-right text-dim">{w.environments}</td>
                      <td className="px-2 text-[11px] text-torange">{w.exists && 'substitui o atual'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {preview.warnings.length > 0 && (
              <div className="text-[12px]">
                <button className="text-torange hover:underline" onClick={() => setShowWarn(!showWarn)}>
                  {preview.warnings.length} aviso(s) de conversão {showWarn ? '▾' : '▸'}
                </button>
                {showWarn && <pre className="mt-1 max-h-[160px] overflow-auto whitespace-pre-wrap rounded-md bg-bg p-2 text-[11px] text-dim select-text">{preview.warnings.join('\n')}</pre>}
              </div>
            )}
            <label className={`flex items-center gap-2 text-[12.5px] ${vaultOk ? '' : 'opacity-50'}`} title="Senhas, tokens e chaves vão para o cofre: no YAML fica só o valor cifrado">
              <input type="checkbox" className="accent-[var(--color-tpurple)]" disabled={!vaultOk} checked={protect && vaultOk} onChange={(e) => setProtect(e.target.checked)} />
              <span className="text-tpurple"><LockIcon /></span> Criptografar senhas, tokens e chaves no cofre
              {!vaultOk && <span className="text-torange">(chaveiro do sistema indisponível)</span>}
            </label>
            <div className="flex items-center justify-end gap-2">
              <span className="text-dim">{picked.size} workspace(s), {total} requests</span>
              <button className="btn" onClick={onClose}>Cancelar</button>
              <button className="btn btn-accent" disabled={!picked.size || busy} onClick={doImport}>Importar</button>
            </div>
          </>
        )}
      </div>
    </Modal>
  )
}
