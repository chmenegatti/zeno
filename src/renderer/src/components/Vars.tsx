import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { isCurl } from '@shared/curl'
import { envSource, formatValue, isSecret, requestVarRefs, tokenize, varSources, type VarInfo, type VarSource } from '@shared/vars'
import type { Folder, RequestDoc, Workspace } from '@shared/types'
import { isEncrypted, looksSecret, MASK } from '@shared/secret'
import { LockIcon } from './Secret'
import { TemplateInput } from './Tags'
import type { VarSupport } from './CodeEditor'
import { api, activeEnvId, activeRequest, activeWorkspace, saveEnvironment, saveFolder, useStore } from '../state'
import { Select } from './Select'
import { t } from '@shared/i18n'

/** abre o popover de edição ancorado no elemento */
export function openVar(name: string, el: Element, swap?: (name: string) => void): void {
  const r = el.getBoundingClientRect()
  useStore.setState({ varEdit: { name, x: r.left, y: r.bottom + 4, swap } })
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

/** aparência do badge de variável (usado no campo e no editor de código) */
export function pillInfo(name: string, info: VarInfo | undefined, showValues: boolean): { cls: string; text: string; title: string; lock: boolean } {
  const value = info ? formatValue(info.value) : undefined
  const enc = info ? isEncrypted(info.value) : false
  const masked = enc || isSecret(name)
  const title = info
    ? `${name} = ${enc ? `🔒 ${t('criptografado')}` : isSecret(name) ? MASK : value}\n(${info.source.label}) — ${t('clique pra editar')}`
    : t('{name} não definida — clique pra criar', { name })
  // Alt+Shift+U: mostra o valor no lugar do nome (secreto continua mascarado)
  let text = name
  if (showValues && info) text = masked ? `${name}: ${MASK}` : value === undefined || value === '' ? `${name}: ∅` : value.length > 48 ? `${value.slice(0, 48)}…` : value
  return { cls: `var-pill ${info ? (enc ? 'secret' : 'ok') : 'missing'}`, text, title, lock: enc }
}

/** fontes de variável do contexto atual, fora de componente (editor de código) */
export function currentVarSources(): Map<string, VarInfo> {
  const s = useStore.getState()
  const ws = activeWorkspace(s)
  if (!ws) return new Map()
  return varSources(ws, activeEnvId(s), activeRequest(s)?.ancestors ?? [])
}

/** opções do autocomplete: nome, valor (mascarado se secreto) e origem */
export function varOptions(sources: Map<string, VarInfo>): { name: string; detail: string; source: string }[] {
  return [...sources.values()].map((v) => {
    const masked = isEncrypted(v.value) || isSecret(v.name)
    const val = formatValue(v.value)
    return { name: v.name, detail: masked ? MASK : val.length > 40 ? `${val.slice(0, 40)}…` : val, source: v.source.label }
  })
}

/** variáveis nos editores de código: badge, popover e autocomplete */
export const editorVars: VarSupport = {
  list: () => varOptions(currentVarSources()),
  pill: (name) => pillInfo(name, currentVarSources().get(name), useStore.getState().showValues),
  open: (name, el, swap) => openVar(name, el, swap),
  subscribe: (cb) =>
    useStore.subscribe((s, p) => {
      if (s.workspaces !== p.workspaces || s.app !== p.app || s.showValues !== p.showValues) cb()
    })
}

export function useVarSources(): Map<string, VarInfo> {
  return useVarContext().sources
}

/** arraste de variável em curso: chip da lateral (copia) ou badge de um campo (move dentro dele) */
export const varDrag: { cur: { raw: string; from?: { owner: object; start: number } } | null; pressAt: number; cleanup?: () => void } = { cur: null, pressAt: 0 }

/**
 * badge arrastado pra fora do campo e solto em qualquer lugar da janela sai do campo (igual ao
 * Insomnia). Outro campo de texto ou editor recebe a cópia; Esc ou soltar fora da janela não muda nada.
 */
function dropOutsideRemoves(remove: () => void): void {
  const over = (e: DragEvent) => {
    e.preventDefault()
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'
  }
  const drop = (e: DragEvent) => {
    // varDrag.cur zerado = um campo com badges já tratou o drop
    const target = e.target as Element | null
    const editor = target?.closest?.('input, textarea, [contenteditable=true], .cm-editor')
    if (varDrag.cur && !editor) {
      e.preventDefault()
      remove()
    }
    varDrag.cleanup?.()
  }
  varDrag.cleanup?.()
  document.addEventListener('dragover', over)
  document.addEventListener('drop', drop)
  varDrag.cleanup = () => {
    document.removeEventListener('dragover', over)
    document.removeEventListener('drop', drop)
    varDrag.cleanup = undefined
  }
}

export function VarBadge({ name, label, dragFrom, onSwap }: { name: string; label?: string; dragFrom?: { owner: object; start: number; raw: string; remove: () => void }; onSwap?: (name: string) => void }) {
  const { sources } = useVarContext()
  const showValues = useStore((s) => s.showValues)
  const p = pillInfo(name, sources.get(name), showValues)
  return (
    <span
      role="button"
      className={p.cls}
      title={p.title}
      draggable
      // sem preventDefault aqui: ele impede o arraste; o campo usa pressAt pra não entrar em edição
      onMouseDown={() => (varDrag.pressAt = Date.now())}
      onDragStart={(e) => {
        e.stopPropagation()
        const raw = dragFrom?.raw ?? `{{ ${name} }}`
        e.dataTransfer.effectAllowed = dragFrom ? 'copyMove' : 'copy'
        // text/plain também serve pra soltar em inputs e no editor do body
        e.dataTransfer.setData('text/plain', raw)
        varDrag.cur = { raw, from: dragFrom && { owner: dragFrom.owner, start: dragFrom.start } }
        if (dragFrom) dropOutsideRemoves(dragFrom.remove)
      }}
      onDragEnd={() => {
        varDrag.cur = null
        varDrag.cleanup?.()
      }}
      onClick={(e) => {
        e.stopPropagation()
        openVar(name, e.currentTarget, onSwap)
      }}
    >
      {p.lock && <LockIcon size={10} />}
      {label ?? p.text}
    </span>
  )
}

/** URL com variáveis e tags como badges; vira input ao clicar fora delas */
/** onCurl: colar (ou digitar e dar Enter) um comando `curl …` converte o request inteiro */
export function UrlField({ value, onChange, onEnter, onCurl }: { value: string; onChange: (v: string) => void; onEnter: () => void; onCurl?: (cmd: string) => void }) {
  return (
    <TemplateInput
      className="text-[12.5px]"
      placeholder={t('https://api.exemplo.com/recurso, {{ base_url }}/recurso ou cole um curl')}
      value={value}
      onChange={onChange}
      onPaste={(e) => {
        const text = e.clipboardData.getData('text')
        if (onCurl && isCurl(text)) {
          e.preventDefault()
          onCurl(text)
        }
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault()
          if (onCurl && isCurl(value)) onCurl(value)
          else onEnter()
        }
      }}
    />
  )
}

/** barra de variáveis usadas no request */
export function RequestVars({ req }: { req: RequestDoc }) {
  const refs = useMemo(() => requestVarRefs(req), [req])
  if (!refs.length) return null
  return (
    <div className="flex flex-wrap items-center gap-1.5 px-3 pb-2">
      <span className="text-[11px] text-faint">{t('variáveis')}</span>
      {refs.map((n) => (
        <VarBadge key={n} name={n} />
      ))}
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
          <span className="text-[9px]">{open ? '▾' : '▸'}</span> {t('Variáveis')} <span className="text-faint">{vars.length}</span>
        </button>
        <button className="btn btn-ghost px-1.5 py-0 text-[12px]" title={t('Nova variável')} onClick={(e) => openVar('', e.currentTarget)}>
          ＋
        </button>
      </div>
      {open && (
        <div className="flex max-h-[132px] flex-wrap gap-1 overflow-y-auto px-2 pb-2">
          {vars.length ? vars.map((v) => <VarBadge key={v.name} name={v.name} />) : <span className="text-[11.5px] text-faint">{t('nenhuma')}</span>}
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
  /** variável escolhida pra trocar o badge; igual a edit.name = editar o valor */
  const [pick, setPick] = useState('')

  const info = edit?.name ? sources.get(edit.name) : undefined

  const targets: Target[] = useMemo(() => {
    if (!ws) return []
    const list: Target[] = []
    const sub = ws.environments.find((e) => e.id === envId && e.parentId !== null)
    if (sub) list.push({ id: sub.id, label: t('Ambiente {name}', { name: sub.name }), source: envSource(sub) })
    const base = ws.environments.find((e) => e.parentId === null)
    if (base) list.push({ id: base.id, label: t('Base (todos os ambientes)'), source: envSource(base) })
    for (const f of [...ancestors].reverse()) list.push({ id: f.id, label: t('Pasta {name}', { name: f.name }), source: { kind: 'folder', folderId: f.id, label: f.name } })
    return list
  }, [ws, envId, ancestors])

  useEffect(() => {
    if (!edit) return
    const enc = !!info && isEncrypted(info.value)
    setName(edit.name)
    setPick(edit.name)
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
    // a lista do Select abre num portal fora do popover: clicar nela não fecha
    const onDown = (e: MouseEvent) => box.current && !box.current.contains(e.target as Node) && !(e.target as Element).closest?.('[role=listbox]') && useStore.setState({ varEdit: null })
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
  const swapping = !!edit.swap && !isNew && pick !== edit.name
  const picked = swapping ? sources.get(pick) : undefined
  const preview = !picked ? '' : isEncrypted(picked.value) || (isSecret(pick) && !show) ? MASK : formatValue(picked.value)
  const close = () => useStore.setState({ varEdit: null })

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
    if (!/^[A-Za-z_$][\w$-]*$/.test(key)) return setErr(t('Nome inválido (letras, números, _ e -)'))
    const target = targets.find((x) => x.id === targetId)
    if (!target) return setErr(t('Escolha onde salvar'))
    // mantém tipo original (número, objeto…) quando o valor era JSON
    let parsed: unknown = value
    if (locked && info) {
      // não revelado nem alterado: mantém o token, ou decifra se for deixar de ser secreto
      parsed = secret ? info.value : await useStore.getState().run(api.vaultReveal(info.value as string))
      if (parsed === undefined) return
    } else if (secret) {
      if (!value) return setErr(t('Valor vazio'))
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
          if (!swapping) return save()
          edit.swap?.(pick)
          close()
        }}
      >
        {isNew ? (
          <input autoFocus className="field font-mono text-[12px]" placeholder={t('nome_da_variavel')} value={name} onChange={(e) => setName(e.target.value)} />
        ) : edit.swap ? (
          // trocar o badge por outra variável do contexto (igual ao "Edit Variable" do Insomnia)
          <div className="flex items-center gap-2">
            <Select className="field min-w-0 flex-1 py-0.5 font-mono" aria-label={t('Trocar por outra variável')} value={pick} onChange={setPick}>
              {!sources.has(edit.name) && <option value={edit.name}>{edit.name}</option>}
              {[...sources.entries()]
                .sort(([a], [b]) => a.localeCompare(b))
                .map(([n, v]) => (
                  <option key={n} value={n}>
                    {n} · {v.source.label}
                  </option>
                ))}
            </Select>
            {(swapping ? picked : info) ? null : <span className="text-[11px] text-faint">{t('não definida')}</span>}
          </div>
        ) : (
          <div className="flex items-baseline gap-2">
            <span className="font-mono font-semibold text-tblue">{edit.name}</span>
            <span className="text-[11px] text-faint">{info ? t('de {source}', { source: info.source.label }) : t('não definida')}</span>
          </div>
        )}
        {swapping && <SwapPreview value={preview} onCancel={close} />}
        {!swapping && (
          <>
            {info && info.shadowed.length > 0 && <p className="text-[11px] text-faint">{t('sobrescreve:')} {info.shadowed.map((s) => s.label).join(', ')}</p>}
            <div className="flex items-start gap-1">
              {locked ? (
                <input
                  className="field min-w-0 flex-1 font-mono text-[12px]"
                  type="password"
                  placeholder={t('criptografado — digite pra trocar')}
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
                  placeholder={t('valor')}
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                  autoFocus={!isNew}
                  spellCheck={false}
                />
              )}
              <button type="button" className="btn btn-ghost px-2" title={show ? t('Esconder') : t('Mostrar')} onClick={() => (locked ? reveal() : setShow(!show))}>
                {show && !locked ? '◉' : '◎'}
              </button>
            </div>
            <label className="flex items-center gap-2 text-[11.5px]" title={t('Cifra com AES-256-GCM; a chave fica no chaveiro do sistema. No YAML vai só o valor cifrado.')}>
              <input
                type="checkbox"
                className="[--cb:var(--color-tpurple)]"
                checked={secret}
                onChange={(e) => {
                  setSecret(e.target.checked)
                  setSecretTouched(true)
                }}
              />
              <span className={`inline-flex items-center gap-1 ${secret ? 'text-tpurple' : 'text-dim'}`}>
                <LockIcon /> {t('secreta (guardar criptografada no cofre)')}
              </span>
            </label>
            <label className="flex items-center gap-2 text-[11.5px]">
              <span className="text-dim">{t('Salvar em')}</span>
              <Select className="field min-w-0 flex-1 py-0.5" value={targetId} onChange={(v) => setTargetId(v)}>
                {targets.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.label}
                  </option>
                ))}
              </Select>
            </label>
            {err && <p className="text-[11.5px] text-tpink">{err}</p>}
            <div className="flex items-center gap-2 pt-1">
              {info && (
                <button type="button" className="btn btn-ghost px-2 text-[12px] text-tpink" onClick={remove} title={t('Remover de {source}', { source: info.source.label })}>
                  {t('remover')}
                </button>
              )}
              <div className="flex-1" />
              <button type="button" className="btn" onClick={() => useStore.setState({ varEdit: null })}>
                {t('Cancelar')}
              </button>
              <button className="btn btn-accent">{t('Salvar')}</button>
            </div>
          </>
        )}
      </form>
    </div>
  )
}

/** prévia ao vivo do valor da variável escolhida pra trocar o badge */
function SwapPreview({ value, onCancel }: { value: string; onCancel: () => void }) {
  return (
    <>
      <pre className="field max-h-24 min-w-0 overflow-auto whitespace-pre-wrap break-all font-mono text-[12px]">{value || ' '}</pre>
      <div className="flex items-center gap-2 pt-1">
        <div className="flex-1" />
        <button type="button" className="btn" onClick={onCancel}>
          {t('Cancelar')}
        </button>
        <button className="btn btn-accent">{t('Trocar')}</button>
      </div>
    </>
  )
}
