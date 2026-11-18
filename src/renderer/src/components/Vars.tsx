import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { envSource, formatValue, isSecret, requestVarRefs, tokenize, varSources, type VarInfo, type VarSource } from '@shared/vars'
import type { Folder, RequestDoc, Workspace } from '@shared/types'
import { isEncrypted, looksSecret, MASK } from '@shared/secret'
import { LockIcon } from './Secret'
import { api, activeEnvId, activeRequest, activeWorkspace, saveEnvironment, saveFolder, useStore } from '../state'

/** abre o popover de edição ancorado no elemento */
export function openVar(name: string, el: Element): void {
  const r = el.getBoundingClientRect()
  useStore.setState({ varEdit: { name, x: r.left, y: r.bottom + 4 } })
}

function useVarContext() {
  const workspaces = useStore((s) => s.workspaces)
  const app = useStore((s) => s.app)
  const ws = activeWorkspace({ workspaces, app })
  const envId = activeEnvId({ workspaces, app })
  const cur = activeRequest({ workspaces, app })
  const ancestors = cur?.ancestors ?? []
  const sources = useMemo(() => (ws ? varSources(ws, envId, ancestors) : new Map<string, VarInfo>()), [ws, envId, ancestors])
  return { ws, envId, ancestors, sources, req: cur?.req }
}

export function VarBadge({ name, label }: { name: string; label?: string }) {
  const { sources } = useVarContext()
  const info = sources.get(name)
  const value = info ? formatValue(info.value) : undefined
  const enc = info ? isEncrypted(info.value) : false
  const title = info
    ? `${name} = ${enc ? '🔒 criptografado' : isSecret(name) ? MASK : value}\n(${info.source.label}) — clique pra editar`
    : `${name} não definida — clique pra criar`
  return (
    <span
      role="button"
      className={`var-pill ${info ? (enc ? 'secret' : 'ok') : 'missing'}`}
      title={title}
      onMouseDown={(e) => e.preventDefault()}
      onClick={(e) => {
        e.stopPropagation()
        openVar(name, e.currentTarget)
      }}
    >
      {enc && <LockIcon size={10} />}
      {label ?? name}
    </span>
  )
}

/** URL com variáveis como badges; vira input ao clicar fora delas */
export function UrlField({ value, onChange, onEnter }: { value: string; onChange: (v: string) => void; onEnter: () => void }) {
  const [editing, setEditing] = useState(false)
  const ref = useRef<HTMLInputElement>(null)
  const tokens = useMemo(() => tokenize(value), [value])
  useEffect(() => {
    if (editing) ref.current?.focus()
  }, [editing])
  if (editing || !value) {
    return (
      <input
        ref={ref}
        className="field min-w-0 flex-1 font-mono text-[12.5px]"
        placeholder="https://api.exemplo.com/recurso  ou  {{ base_url }}/recurso"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => setEditing(true)}
        onBlur={() => setEditing(false)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') onEnter()
          if (e.key === 'Escape') e.currentTarget.blur()
        }}
        spellCheck={false}
      />
    )
  }
  return (
    <div
      tabIndex={0}
      className="field flex min-w-0 flex-1 cursor-text items-center overflow-hidden whitespace-nowrap font-mono text-[12.5px]"
      onClick={() => setEditing(true)}
      onFocus={() => setEditing(true)}
      title="Clique pra editar · clique numa variável pra mudar o valor"
    >
      {tokens.map((tk, i) =>
        tk.t === 'text' ? (
          <span key={i}>{tk.v}</span>
        ) : tk.t === 'var' ? (
          <VarBadge key={i} name={tk.name} />
        ) : (
          <span key={i} className="var-pill tag" title={tk.raw}>
            {tk.name}
          </span>
        )
      )}
    </div>
  )
}

/** barra de variáveis usadas no request */
export function RequestVars({ req, tags }: { req: RequestDoc; tags: string[] }) {
  const refs = useMemo(() => requestVarRefs(req), [req])
  if (!refs.length && !tags.length) return null
  return (
    <div className="flex flex-wrap items-center gap-1.5 px-3 pb-2">
      <span className="text-[11px] text-faint">variáveis</span>
      {refs.map((n) => (
        <VarBadge key={n} name={n} />
      ))}
      {tags.length > 0 && (
        <span className="var-pill tag" title={tags.join('\n')}>
          {tags.length} tag{tags.length > 1 ? 's' : ''} {'{% %}'} no envio
        </span>
      )}
    </div>
  )
}

/** lista das variáveis do ambiente ativo na lateral */
export function EnvVarList({ ws }: { ws: Workspace }) {
  const app = useStore((s) => s.app)
  const workspaces = useStore((s) => s.workspaces)
  const envId = activeEnvId({ workspaces, app })
  const vars = useMemo(() => [...varSources(ws, envId).values()].sort((a, b) => a.name.localeCompare(b.name)), [ws, envId])
  const [open, setOpen] = useState(() => {
    try {
      return localStorage.getItem('zeno:vars-open') !== '0'
    } catch {
      return true
    }
  })
  const toggle = () => {
    setOpen(!open)
    try {
      localStorage.setItem('zeno:vars-open', open ? '0' : '1')
    } catch {
      /* sem storage */
    }
  }
  return (
    <div className="mx-2 mb-2 rounded-md border border-line/70">
      <div className="flex items-center gap-1 px-2 py-1">
        <button className="flex flex-1 items-center gap-1 text-left text-[11.5px] text-dim hover:text-ink" onClick={toggle}>
          <span className="text-[9px]">{open ? '▾' : '▸'}</span> Variáveis <span className="text-faint">{vars.length}</span>
        </button>
        <button className="btn btn-ghost px-1.5 py-0 text-[12px]" title="Nova variável" onClick={(e) => openVar('', e.currentTarget)}>
          ＋
        </button>
      </div>
      {open && (
        <div className="flex max-h-[132px] flex-wrap gap-1 overflow-y-auto px-2 pb-2">
          {vars.length ? vars.map((v) => <VarBadge key={v.name} name={v.name} />) : <span className="text-[11.5px] text-faint">nenhuma</span>}
        </div>
      )}
    </div>
  )
}

interface Target {
  id: string
  label: string
  source: VarSource
}

/** popover flutuante: ver/editar valor e escolher onde salvar */
export function VarPopover() {
  const edit = useStore((s) => s.varEdit)
  const { ws, envId, ancestors, sources } = useVarContext()
  const box = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ x: 0, y: 0 })
  const [name, setName] = useState('')
  const [value, setValue] = useState('')
  const [targetId, setTargetId] = useState('')
  const [show, setShow] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [secret, setSecret] = useState(false)
  const [secretTouched, setSecretTouched] = useState(false)
  /** valor atual é token cifrado ainda não revelado/alterado */
  const [locked, setLocked] = useState(false)

  const info = edit?.name ? sources.get(edit.name) : undefined

  const targets: Target[] = useMemo(() => {
    if (!ws) return []
    const list: Target[] = []
    const sub = ws.environments.find((e) => e.id === envId && e.parentId !== null)
    if (sub) list.push({ id: sub.id, label: `Ambiente ${sub.name}`, source: envSource(sub) })
    const base = ws.environments.find((e) => e.parentId === null)
    if (base) list.push({ id: base.id, label: 'Base (todos os ambientes)', source: envSource(base) })
    for (const f of [...ancestors].reverse()) list.push({ id: f.id, label: `Pasta ${f.name}`, source: { kind: 'folder', folderId: f.id, label: f.name } })
    return list
  }, [ws, envId, ancestors])

  useEffect(() => {
    if (!edit) return
    const enc = !!info && isEncrypted(info.value)
    setName(edit.name)
    setValue(info && !enc ? formatValue(info.value) : '')
    setLocked(enc)
    setSecret(enc)
    setSecretTouched(false)
    setShow(!isSecret(edit.name))
    setErr(null)
    const src = info?.source
    setTargetId(src ? (src.kind === 'env' ? src.envId : src.folderId) : (targets[0]?.id ?? ''))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [edit])

  useLayoutEffect(() => {
    if (!edit || !box.current) return
    const w = box.current.offsetWidth
    const h = box.current.offsetHeight
    setPos({ x: Math.max(8, Math.min(edit.x, window.innerWidth - w - 8)), y: edit.y + h > window.innerHeight - 8 ? Math.max(8, edit.y - h - 30) : edit.y })
  }, [edit])

  useEffect(() => {
    if (!edit) return
    const onDown = (e: MouseEvent) => box.current && !box.current.contains(e.target as Node) && useStore.setState({ varEdit: null })
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && useStore.setState({ varEdit: null })
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [edit])

  // variável nova com nome de senha/token já sugere cifrar
  useEffect(() => {
    if (edit && !edit.name && !secretTouched) setSecret(looksSecret(name))
  }, [name, edit, secretTouched])

  if (!edit || !ws) return null
  const isNew = !edit.name

  const reveal = async () => {
    if (!info || !isEncrypted(info.value)) return
    const plain = await useStore.getState().run(api.vaultReveal(info.value))
    if (plain === undefined) return
    setValue(plain)
    setLocked(false)
    setShow(true)
  }

  const save = async () => {
    const key = name.trim()
    if (!/^[A-Za-z_$][\w$-]*$/.test(key)) return setErr('Nome inválido (letras, números, _ e -)')
    const target = targets.find((t) => t.id === targetId)
    if (!target) return setErr('Escolha onde salvar')
    // mantém tipo original (número, objeto…) quando o valor era JSON
    let parsed: unknown = value
    if (locked && info) {
      // não revelado nem alterado: mantém o token, ou decifra se for deixar de ser secreto
      parsed = secret ? info.value : await useStore.getState().run(api.vaultReveal(info.value as string))
      if (parsed === undefined) return
    } else if (secret) {
      if (!value) return setErr('Valor vazio')
      const tok = await useStore.getState().run(api.vaultEncrypt(value))
      if (!tok) return
      parsed = tok
    } else if (info && typeof info.value !== 'string' && !isEncrypted(info.value)) {
      try {
        parsed = JSON.parse(value)
      } catch {
        parsed = value
      }
    }
    if (target.source.kind === 'env') {
      const env = ws.environments.find((e) => e.id === target.id)!
      await saveEnvironment(ws.id, { ...env, data: { ...env.data, [key]: parsed } })
    } else {
      const folder = ancestors.find((f) => f.id === target.id) as Folder
      await saveFolder({ ...folder, vars: { ...folder.vars, [key]: parsed } })
    }
    useStore.setState({ varEdit: null })
  }

  const remove = async () => {
    if (!info) return
    const src = info.source
    if (src.kind === 'env') {
      const env = ws.environments.find((e) => e.id === src.envId)!
      const { [edit.name]: _gone, ...data } = env.data
      await saveEnvironment(ws.id, { ...env, data })
    } else {
      const folder = ancestors.find((f) => f.id === src.folderId)!
      const { [edit.name]: _gone, ...vars } = folder.vars
      await saveFolder({ ...folder, vars })
    }
    useStore.setState({ varEdit: null })
  }

  const multiline = value.length > 60 || value.includes('\n')

  return (
    <div ref={box} className="fixed z-50 w-[360px] rounded-lg border border-line bg-raised p-3 shadow-2xl shadow-black/50" style={{ left: pos.x, top: pos.y }}>
      <form
        className="flex flex-col gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          save()
        }}
      >
        {isNew ? (
          <input autoFocus className="field font-mono text-[12px]" placeholder="nome_da_variavel" value={name} onChange={(e) => setName(e.target.value)} />
        ) : (
          <div className="flex items-baseline gap-2">
            <span className="font-mono font-semibold text-tblue">{edit.name}</span>
            <span className="text-[11px] text-faint">{info ? `de ${info.source.label}` : 'não definida'}</span>
          </div>
        )}
        {info && info.shadowed.length > 0 && <p className="text-[11px] text-faint">sobrescreve: {info.shadowed.map((s) => s.label).join(', ')}</p>}
        <div className="flex items-start gap-1">
          {locked ? (
            <input
              className="field min-w-0 flex-1 font-mono text-[12px]"
              type="password"
              placeholder="criptografado — digite pra trocar"
              value={value}
              onChange={(e) => {
                setValue(e.target.value)
                setLocked(false)
              }}
              autoFocus={!isNew}
            />
          ) : multiline && show ? (
            <textarea className="field h-24 min-w-0 flex-1 resize-y font-mono text-[12px]" value={value} onChange={(e) => setValue(e.target.value)} autoFocus={!isNew} spellCheck={false} />
          ) : (
            <input
              className="field min-w-0 flex-1 font-mono text-[12px]"
              type={show ? 'text' : 'password'}
              placeholder="valor"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              autoFocus={!isNew}
              spellCheck={false}
            />
          )}
          <button type="button" className="btn btn-ghost px-2" title={show ? 'Esconder' : 'Mostrar'} onClick={() => (locked ? reveal() : setShow(!show))}>
            {show && !locked ? '◉' : '◎'}
          </button>
        </div>
        <label className="flex items-center gap-2 text-[11.5px]" title="Cifra com AES-256-GCM; a chave fica no chaveiro do sistema. No YAML vai só o valor cifrado.">
          <input
            type="checkbox"
            className="accent-[var(--color-tpurple)]"
            checked={secret}
            onChange={(e) => {
              setSecret(e.target.checked)
              setSecretTouched(true)
            }}
          />
          <span className={`inline-flex items-center gap-1 ${secret ? 'text-tpurple' : 'text-dim'}`}>
            <LockIcon /> secreta (guardar criptografada no cofre)
          </span>
        </label>
        <label className="flex items-center gap-2 text-[11.5px]">
          <span className="text-dim">Salvar em</span>
          <select className="field min-w-0 flex-1 py-0.5" value={targetId} onChange={(e) => setTargetId(e.target.value)}>
            {targets.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </select>
        </label>
        {err && <p className="text-[11.5px] text-tpink">{err}</p>}
        <div className="flex items-center gap-2 pt-1">
          {info && (
            <button type="button" className="btn btn-ghost px-2 text-[12px] text-tpink" onClick={remove} title={`Remover de ${info.source.label}`}>
              remover
            </button>
          )}
          <div className="flex-1" />
          <button type="button" className="btn" onClick={() => useStore.setState({ varEdit: null })}>
            Cancelar
          </button>
          <button className="btn btn-accent">Salvar</button>
        </div>
      </form>
    </div>
  )
}
