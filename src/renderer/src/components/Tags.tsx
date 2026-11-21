import { useEffect, useMemo, useRef, useState, type ClipboardEvent, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { buildTag, FIELDS, findRequestRef, FN_NAMES, FN_SPECS, parseArgs, parseTag, TAG_CHOICES, TRIGGERS, type FnName, type ResponseTag, type TagDef } from '@shared/tagdef'
import { findNode, sortNodes } from '@shared/tree'
import { dropToken, matchVars, openVarAt, tokenize } from '@shared/vars'
import type { PluginArg, PluginInfo, PluginTagInfo, TreeNode, Workspace } from '@shared/types'
import type { PromptAsk } from '@shared/api'
import { activeWorkspace, api, useStore } from '../state'
import { MethodBadge, Modal } from './ui'
import { FAKER } from '@shared/faker'
import { editorVars, useVarSources, VarBadge, varDrag, varOptions } from './Vars'
import type { TagSupport } from './CodeEditor'
import { Select } from './Select'
import { locale, t, tk } from '@shared/i18n'

// ---------- rótulo ----------

/** texto do badge, como no Insomnia: "Resposta ⇒ Login · $.token" */
export function tagLabel(raw: string, workspaces: Workspace[]): { text: string; broken?: string } {
  const tg = parseTag(raw)
  if (tg.name === 'uuid') return { text: 'UUID' }
  if (tg.name === 'now') return { text: t('Agora') }
  if (tg.name === 'other') {
    const pt = pluginTag(tg.tag)
    if (pt) {
      const args = parseArgs(raw).args.filter((a) => a !== '')
      return { text: `${pt.tag.displayName}${args.length ? ` · ${args.join(', ').slice(0, 24)}` : ''}` }
    }
    return { text: tg.tag, broken: t('tag "{tag}" não suportada (nenhum plugin ativo tem)', { tag: tg.tag }) }
  }
  if (tg.name === 'fn') return { text: FN_SPECS[tg.tag].badge(tg.args) }
  // id ou nome ("Pasta / Nome"): workspace ativo primeiro
  const cur = activeWorkspace(useStore.getState())
  const req = [cur, ...workspaces.filter((w) => w !== cur)].map((w) => (w ? findRequestRef(w.children, tg.requestId) : null)).find(Boolean) ?? undefined
  const name = req?.name ?? '?'
  const what = tg.field === 'header' ? `header ${tg.filter}` : tg.field === 'url' ? 'URL' : tg.field === 'raw' ? 'body' : tg.filter || 'body'
  return { text: t('Resposta ⇒ {name} · {what}', { name, what }), broken: req ? undefined : t('request {id} não encontrado', { id: tg.requestId || t('(vazio)') }) }
}

export function TagBadge({ raw, onChange }: { raw: string; onChange?: (next: string) => void }) {
  const workspaces = useStore((s) => s.workspaces)
  const { text, broken } = tagLabel(raw, workspaces)
  return (
    <span
      role="button"
      className={`var-pill tag ${broken ? 'broken' : ''}`}
      title={`${broken ? `${broken}\n` : ''}${raw}${onChange ? `\n${t('clique pra editar')}` : ''}`}
      onMouseDown={(e) => e.preventDefault()}
      onClick={(e) => {
        e.stopPropagation()
        if (onChange) openTagEditor(raw, onChange)
      }}
    >
      ƒ {text}
    </span>
  )
}

/** abre o editor; raw vazio = tag nova */
export function openTagEditor(raw: string, onOk: (next: string) => void, onCancel?: () => void): void {
  useStore.setState({ tagEdit: { value: raw, onOk, onCancel } })
}

// ---------- tags de plugin ----------

/** tag de algum plugin ativo */
export function pluginTag(name: string): { plugin: PluginInfo; tag: PluginTagInfo } | null {
  for (const p of useStore.getState().plugins) {
    if (!p.enabled) continue
    const tag = p.templateTags.find((x) => x.name === name)
    if (tag) return { plugin: p, tag }
  }
  return null
}

const argDefault = (a: PluginArg): string => (a.defaultValue === undefined ? (a.type === 'enum' ? (a.options?.[0]?.value ?? '') : a.type === 'boolean' ? 'false' : '') : String(a.defaultValue))

/** {% nome 'texto', 12, true %}: texto entre aspas; número e booleano sem, como no Insomnia */
export function buildPluginTag(name: string, spec: PluginArg[], args: string[]): string {
  const q = (s: string): string => `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`
  const out = spec.map((a, i) => {
    const v = args[i] ?? argDefault(a)
    if (a.type === 'boolean') return v === 'true' ? 'true' : 'false'
    if (a.type === 'number' && /^-?\d+(\.\d+)?$/.test(v)) return v
    return q(v)
  })
  return `{% ${name}${out.length ? ` ${out.join(', ')}` : ''} %}`
}

/** sugestões de tag: as padrão + as dos plugins ativos */
export function allTagChoices(): typeof TAG_CHOICES {
  const extra = useStore
    .getState()
    .plugins.filter((p) => p.enabled)
    .flatMap((p) =>
      p.templateTags.map((x) => ({
        label: x.displayName,
        detail: `plugin ${p.displayName}`,
        keys: [x.name.toLowerCase(), ...x.displayName.toLowerCase().split(/\s+/), 'plugin'],
        raw: buildPluginTag(x.name, x.args, []),
        edit: x.args.length > 0
      }))
    )
  return [...TAG_CHOICES, ...extra]
}

/** badges + autocomplete de tags nos editores de código (body, ambientes, variáveis da pasta) */
export const editorTags: TagSupport = {
  label: (raw) => tagLabel(raw, useStore.getState().workspaces),
  edit: (raw, apply, cancel) => openTagEditor(raw, apply, cancel),
  choices: () => allTagChoices(),
  // getter: Vars importa este arquivo (ciclo); só lê na hora do uso
  get vars() {
    return editorVars
  }
}

/** editor de tag por cima de qualquer modal */
export function TagEditHost() {
  const edit = useStore((s) => s.tagEdit)
  if (!edit) return null
  const close = (): void => useStore.setState({ tagEdit: null })
  return <TagModal key={edit.value} initial={edit.value} onOk={(raw) => { close(); edit.onOk(raw) }} onClose={() => { close(); edit.onCancel?.() }} />
}

// ---------- autocomplete nos campos de uma linha ----------

type AcItem = { kind: 'var'; name: string; detail: string; source: string } | { kind: 'tag'; label: string; detail: string; raw: string; edit?: boolean } | { kind: 'other' }

/** {{ abre a lista de variáveis; Ctrl+Espaço lista variáveis e tags */
function useVarAutocomplete(value: string, onChange: (v: string) => void, ref: React.RefObject<HTMLInputElement | null>) {
  const sources = useVarSources()
  const [st, setSt] = useState<{ start: number; end: number; query: string; explicit: boolean; x: number; y: number; w: number } | null>(null)
  const [sel, setSel] = useState(0)
  const selRef = useRef(0)
  selRef.current = sel

  const items: AcItem[] = useMemo(() => {
    if (!st) return []
    const vars: AcItem[] = matchVars(varOptions(sources), st.query).map((v) => ({ kind: 'var', ...v }))
    if (!st.explicit) return vars
    const q = st.query.toLowerCase()
    const tags: AcItem[] = allTagChoices().filter((c) => !q || c.keys.some((k) => k.startsWith(q))).map((c) => ({ kind: 'tag', ...c }))
    return [...vars, ...tags, { kind: 'other' }]
  }, [st, sources])

  const close = (): void => setSt(null)
  const check = (el: HTMLInputElement, explicit: boolean): void => {
    const caret = el.selectionStart ?? el.value.length
    const selEnd = el.selectionEnd ?? caret
    const before = el.value.slice(0, caret)
    const open = openVarAt(before)
    const word = /[A-Za-z_][\w.]*$/.exec(before)
    if (!open && !explicit) return close()
    const r = el.getBoundingClientRect()
    setSel(0)
    // Ctrl+Espaço com texto selecionado: a escolha substitui a seleção
    if (explicit && selEnd > caret) return setSt({ start: caret, end: selEnd, query: '', explicit, x: r.left, y: r.bottom + 2, w: r.width })
    setSt(
      open
        ? { start: open.start, end: caret, query: open.query, explicit, x: r.left, y: r.bottom + 2, w: r.width }
        : { start: word ? caret - word[0].length : caret, end: caret, query: word?.[0] ?? '', explicit, x: r.left, y: r.bottom + 2, w: r.width }
    )
  }

  const apply = (it: AcItem): void => {
    if (!st) return
    const el = ref.current
    // fecha-chaves já digitado depois do cursor entra na troca
    const after = value.slice(st.end)
    const end = st.end + (after.startsWith('}}') ? 2 : after.startsWith('}') ? 1 : 0)
    const put = (text: string): void => {
      onChange(value.slice(0, st.start) + text + value.slice(end))
      const pos = st.start + text.length
      requestAnimationFrame(() => el?.setSelectionRange(pos, pos))
    }
    close()
    if (it.kind === 'var') return put(`{{ ${it.name} }}`)
    const head = value.slice(0, st.start)
    const tail = value.slice(end)
    if (it.kind === 'other') return openTagEditor('', (tag) => onChange(head + tag + tail))
    put(it.raw)
    // tag de resposta abre o editor; cancelar tira a tag recém-posta
    if (it.edit) openTagEditor(it.raw, (tag) => onChange(head + tag + tail), () => onChange(head + tail))
  }

  const onKey = (e: ReactKeyboardEvent<HTMLInputElement>): boolean => {
    if (!st || !items.length) return false
    const n = items.length
    if (e.key === 'ArrowDown') setSel((selRef.current + 1) % n)
    else if (e.key === 'ArrowUp') setSel((selRef.current - 1 + n) % n)
    else if (e.key === 'Enter' || e.key === 'Tab') apply(items[selRef.current])
    else if (e.key === 'Escape') close()
    else return false
    e.preventDefault()
    e.stopPropagation()
    return true
  }

  const menu =
    st && items.length ? (
      <div className="fixed z-[60] max-h-[260px] min-w-[260px] overflow-y-auto rounded-lg border border-line bg-raised py-1 shadow-xl" style={{ left: st.x, top: st.y, width: Math.max(260, Math.min(st.w, 460)) }}>
        {items.map((it, i) => (
          <div
            key={it.kind === 'var' ? `v:${it.name}` : it.kind === 'tag' ? `t:${it.label}` : 'other'}
            className={`flex cursor-pointer items-baseline gap-2 px-3 py-1 text-[12px] ${i === sel ? 'bg-tpurple/35 text-ink' : 'text-dim'}`}
            onMouseDown={(e) => {
              e.preventDefault()
              apply(it)
            }}
            onMouseEnter={() => setSel(i)}
          >
            {it.kind === 'var' ? (
              <>
                <span className="font-mono text-tblue">{it.name}</span>
                <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-faint">{it.detail}</span>
                <span className="shrink-0 text-[10.5px] text-faint">{it.source}</span>
              </>
            ) : it.kind === 'tag' ? (
              <>
                <span className="text-tag">ƒ {t(it.label)}</span>
                <span className="text-[11px] text-faint">{t(it.detail)}</span>
              </>
            ) : (
              <span className="text-tag">ƒ {t('Outra tag…')} <span className="text-[11px] text-faint">{t('abre o editor')}</span></span>
            )}
          </div>
        ))}
      </div>
    ) : null

  return { check, close, onKey, menu }
}

// ---------- campo com badges ----------

interface FieldProps {
  value: string
  onChange: (v: string) => void
  placeholder?: string
  className?: string
  password?: boolean
  onEnter?: () => void
  onPaste?: (e: ClipboardEvent<HTMLInputElement>) => void
  onKeyDown?: (e: ReactKeyboardEvent<HTMLInputElement>) => void
  title?: string
}

/**
 * input de uma linha que mostra {{ variáveis }} e {% tags %} como badges (igual ao Insomnia).
 * Clique no texto edita; clique no badge abre o editor da variável/tag. Ctrl+Espaço insere uma tag.
 */
export function TemplateInput({ value, onChange, placeholder, className = '', password, onEnter, onPaste, onKeyDown, title }: FieldProps) {
  const [editing, setEditing] = useState(false)
  const ref = useRef<HTMLInputElement>(null)
  const tokens = useMemo(() => tokenize(value), [value])
  const hasTokens = tokens.some((x) => x.t !== 'text')
  const ac = useVarAutocomplete(value, onChange, ref)
  const owner = useRef({}).current
  const [over, setOver] = useState(false)
  useEffect(() => {
    if (editing) ref.current?.focus()
  }, [editing])

  if (editing || !hasTokens) {
    return (
      <>
        <input
          ref={ref}
          className={`field min-w-0 flex-1 font-mono ${className}`}
          type={password ? 'password' : 'text'}
          placeholder={placeholder}
          value={value}
          title={title}
          onChange={(e) => {
            onChange(e.target.value)
            ac.check(e.target, false)
          }}
          onPaste={onPaste}
          onFocus={() => setEditing(true)}
          onBlur={() => {
            ac.close()
            setEditing(false)
          }}
          onKeyDown={(e) => {
            if (ac.onKey(e)) return
            onKeyDown?.(e)
            if (e.defaultPrevented) return
            if (e.key === 'Enter') onEnter?.()
            if (e.key === 'Escape') e.currentTarget.blur()
            if (e.key === ' ' && e.ctrlKey) {
              // Ctrl+Espaço (padrão do Insomnia): variáveis e tags
              e.preventDefault()
              ac.check(e.currentTarget, true)
            }
          }}
          spellCheck={false}
        />
        {ac.menu}
      </>
    )
  }
  const lens = tokens.map((tok) => (tok.t === 'text' ? tok.v.length : tok.raw.length))
  const starts = lens.map((_, i) => lens.slice(0, i).reduce((a, b) => a + b, 0))
  // troca o token na posição i pelo texto novo
  const replaceAt = (i: number, next: string) => {
    const raw = (tokens[i] as { raw: string }).raw
    onChange(value.slice(0, starts[i]) + next + value.slice(starts[i] + raw.length))
  }
  // posição no texto sob o ponteiro: dentro de um trecho de texto, o caractere; num badge, antes ou depois dele
  const dropPos = (e: React.DragEvent): number => {
    const d = document as Document & { caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null }
    const r = d.caretRangeFromPoint?.(e.clientX, e.clientY)
    const c = r ? { node: r.startContainer, offset: r.startOffset } : (() => { const p = d.caretPositionFromPoint?.(e.clientX, e.clientY); return p && { node: p.offsetNode, offset: p.offset } })()
    const el = (e.target as Element).closest?.('[data-tok]') as HTMLElement | null
    if (!el || !e.currentTarget.contains(el)) return value.length
    const i = Number(el.dataset.tok)
    if (tokens[i].t === 'text' && !password && c && c.node.nodeType === Node.TEXT_NODE && el.contains(c.node)) return starts[i] + Math.min(c.offset, lens[i])
    const rect = el.getBoundingClientRect()
    return starts[i] + (e.clientX > rect.left + rect.width / 2 ? lens[i] : 0)
  }
  return (
    <div
      tabIndex={0}
      className={`field flex min-w-0 flex-1 cursor-text items-center gap-0.5 overflow-hidden whitespace-nowrap font-mono ${over ? 'ring-1 ring-tblue/60' : ''} ${className}`}
      onClick={() => setEditing(true)}
      // clicar num badge também foca o campo; aí o clique é do badge, não edição
      onFocus={(e) => e.target === e.currentTarget && Date.now() - varDrag.pressAt > 300 && setEditing(true)}
      onDragOver={(e) => {
        if (!varDrag.cur) return
        e.preventDefault()
        e.dataTransfer.dropEffect = varDrag.cur.from?.owner === owner ? 'move' : 'copy'
        setOver(true)
      }}
      onDragLeave={(e) => !e.currentTarget.contains(e.relatedTarget as Node) && setOver(false)}
      onDrop={(e) => {
        const d = varDrag.cur
        setOver(false)
        if (!d) return
        e.preventDefault()
        varDrag.cur = null
        onChange(dropToken(value, dropPos(e), d.raw, d.from?.owner === owner ? d.from.start : undefined))
      }}
      title={title ?? t('Clique pra editar · clique num badge pra mudar · {{ ou Ctrl+Espaço sugere variáveis e tags')}
    >
      {tokens.map((tok, i) =>
        tok.t === 'text' ? (
          <span key={i} data-tok={i} className="whitespace-pre">{password ? '•'.repeat(Math.min(tok.v.length, 12)) : tok.v}</span>
        ) : tok.t === 'var' ? (
          <span key={i} data-tok={i} className="inline-flex">
            <VarBadge name={tok.name} dragFrom={{ owner, start: starts[i], raw: tok.raw, remove: () => onChange(value.slice(0, starts[i]) + value.slice(starts[i] + tok.raw.length)) }} onSwap={(next) => replaceAt(i, `{{ ${next} }}`)} />
          </span>
        ) : (
          <span key={i} data-tok={i} className="inline-flex">
            <TagBadge raw={tok.raw} onChange={(next) => replaceAt(i, next)} />
          </span>
        )
      )}
    </div>
  )
}

// ---------- modal ----------

interface ReqOption {
  id: string
  wsName: string
  path: string
  name: string
  method: string
}

function requestOptions(workspaces: Workspace[], current?: Workspace): ReqOption[] {
  const out: ReqOption[] = []
  const walk = (ws: Workspace, nodes: TreeNode[], trail: string[]) => {
    for (const n of sortNodes([...nodes])) {
      if (n.kind === 'request') out.push({ id: n.id, wsName: ws.name, path: trail.join(' / '), name: n.name, method: n.method })
      else walk(ws, n.children, [...trail, n.name])
    }
  }
  // workspace atual primeiro
  for (const ws of [...workspaces].sort((a, b) => Number(b.id === current?.id) - Number(a.id === current?.id))) walk(ws, ws.children, [])
  return out
}

const KINDS: { id: string; label: string }[] = [
  { id: 'response', label: tk('Resposta (valor de outro request)') },
  { id: 'uuid', label: 'UUID v4' },
  { id: 'now', label: tk('Data e hora atual (ISO)') },
  ...FN_NAMES.map((n) => ({ id: `fn:${n}`, label: FN_SPECS[n].label }))
]

const kindOf = (d: TagDef): string => (d.name === 'fn' ? `fn:${d.tag}` : d.name)

/** formulário dos argumentos que o plugin declarou (string, número, booleano, lista) */
function PluginTagForm({ info, args, onChange }: { info: PluginTagInfo; args: string[]; onChange: (a: string[]) => void }) {
  const get = (i: number): string => args[i] ?? argDefault(info.args[i])
  const set = (i: number, v: string): void => onChange(info.args.map((_, j) => (j === i ? v : get(j))))
  return (
    <>
      {info.description && <span className="text-[11.5px] text-dim">{info.description}</span>}
      {info.args.map((a, i) => (
        <label key={i} className={a.type === 'boolean' ? 'flex items-center gap-2' : 'flex flex-col gap-1'}>
          {a.type === 'boolean' ? (
            <>
              <input type="checkbox" checked={get(i) === 'true'} onChange={(e) => set(i, e.target.checked ? 'true' : 'false')} />
              <span>{a.displayName}</span>
            </>
          ) : (
            <>
              <span className="text-[11px] text-faint">{a.displayName}</span>
              {a.type === 'enum' ? (
                <Select className="field py-1" value={get(i)} onChange={(v) => set(i, v)}>
                  {(a.options ?? []).map((o) => <option key={o.value} value={o.value}>{o.displayName}</option>)}
                </Select>
              ) : (
                <input className="field py-1 font-mono text-[12px]" type={a.type === 'number' ? 'number' : 'text'} placeholder={a.placeholder} value={get(i)} onChange={(e) => set(i, e.target.value)} spellCheck={false} />
              )}
            </>
          )}
        </label>
      ))}
      {!info.args.length && <span className="text-[11.5px] text-faint">{t('Sem argumentos.')}</span>}
    </>
  )
}

/** argumentos de uma função ({% hash %}, {% faker %}…) */
function FnForm({ tag, onChange }: { tag: Extract<TagDef, { name: 'fn' }>; onChange: (args: string[]) => void }) {
  const spec = FN_SPECS[tag.tag]
  const set = (i: number, v: string): void => onChange(tag.args.map((a, j) => (j === i ? v : a)))
  return (
    <>
      {spec.args.map((a, i) => (
        <label key={a.label} className="flex flex-col gap-1">
          <span className="text-[11px] text-faint">{t(a.label)}</span>
          {a.kind === 'select' ? (
            <Select className="field py-1" value={tag.args[i]} onChange={(v) => set(i, v)}>
              {(tag.tag === 'faker' ? Object.entries(FAKER).map(([id, f]) => ({ id, label: `${t(f.label)} (${id})` })) : a.options ?? []).map((o) => (
                <option key={o.id} value={o.id}>{t(o.label)}</option>
              ))}
              {/* valor importado que não está na lista */}
              {tag.tag === 'faker' && !FAKER[tag.args[i]] && <option value={tag.args[i]}>{t('{value} (desconhecido)', { value: tag.args[i] })}</option>}
            </Select>
          ) : a.kind === 'textarea' ? (
            <textarea className="field h-20 resize-y font-mono text-[12px]" placeholder={a.placeholder && t(a.placeholder)} value={tag.args[i]} onChange={(e) => set(i, e.target.value)} spellCheck={false} />
          ) : (
            <input className="field py-1 font-mono text-[12px]" placeholder={a.placeholder && t(a.placeholder)} value={tag.args[i]} onChange={(e) => set(i, e.target.value)} spellCheck={false} />
          )}
        </label>
      ))}
      {['hash', 'base64', 'jsonpath', 'file'].includes(tag.tag) && <span className="text-[11px] text-faint">{t('Aceita')} <code>{'{{ variavel }}'}</code> {t('nos campos de texto.')}</span>}
      {tag.tag === 'prompt' && <span className="text-[11px] text-faint">{t('Pergunta uma vez por envio; na janela dá pra marcar "lembrar nesta sessão".')}</span>}
    </>
  )
}

export function TagModal({ initial, onOk, onClose }: { initial: string; onOk: (raw: string) => void; onClose: () => void }) {
  const workspaces = useStore((s) => s.workspaces)
  const app = useStore((s) => s.app)
  const ws = activeWorkspace({ workspaces, app })
  const start = useMemo<TagDef>(() => (initial ? parseTag(initial) : { name: 'response', field: 'body', requestId: '', filter: '', trigger: 'never' }), [initial])
  const [tag, setTag] = useState<TagDef>(start)
  const plugins = useStore((s) => s.plugins)
  // tag de plugin: nome + argumentos (o formulário vem do que o plugin declara)
  const [ptag, setPtag] = useState<{ name: string; args: string[] } | null>(() => {
    if (start.name !== 'other' || !pluginTag(start.tag)) return null
    return { name: start.tag, args: parseArgs(initial).args }
  })
  const pinfo = ptag ? pluginTag(ptag.name) : null
  const [search, setSearch] = useState('')
  const [preview, setPreview] = useState<{ value?: string; error?: string; at?: number; loading?: boolean }>({})
  const options = useMemo(() => requestOptions(workspaces, ws), [workspaces, ws])
  const r = tag.name === 'response' && !ptag ? tag : null
  const set = (patch: Partial<ResponseTag>) => r && setTag({ ...r, ...patch })
  const raw = ptag && pinfo ? buildPluginTag(ptag.name, pinfo.tag.args, ptag.args) : buildTag(tag)

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return q ? options.filter((o) => `${o.wsName} ${o.path} ${o.name} ${o.method}`.toLowerCase().includes(q)) : options
  }, [options, search])

  // prévia com a última resposta (sem reenviar)
  useEffect(() => {
    if (tag.name === 'other' && !ptag) return setPreview({})
    if (r && !r.requestId) return setPreview({ error: t('escolha o request') })
    let alive = true
    const timer = setTimeout(() => api.tagPreview(raw, false).then((p) => alive && setPreview(p)), 200)
    return () => {
      alive = false
      clearTimeout(timer)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [raw])

  const sendNow = async () => {
    setPreview({ loading: true })
    setPreview((await useStore.getState().run(api.tagPreview(raw, true))) ?? {})
  }
  const selectedNode = r && ws ? workspaces.map((w) => findRequestRef(w.children, r.requestId)).find(Boolean) : undefined
  const selected = r ? options.find((o) => o.id === (selectedNode?.id ?? r.requestId)) : undefined
  const multiWs = new Set(options.map((o) => o.wsName)).size > 1

  return (
    <Modal title={initial ? t('Editar tag') : t('Inserir tag')} onClose={onClose}>
      <form
        className="flex flex-col gap-3 text-[12.5px]"
        onSubmit={(e) => {
          e.preventDefault()
          if (r && !r.requestId) return
          onOk(raw)
        }}
      >
        <label className="flex flex-col gap-1">
          <span className="text-[11px] text-faint">{t('Função')}</span>
          <Select
            className="field py-1"
            value={ptag ? `plugin:${ptag.name}` : kindOf(tag)}
            disabled={tag.name === 'other' && !ptag}
            onChange={(v) => {
              const n = v
              if (n.startsWith('plugin:')) {
                const info = pluginTag(n.slice(7))
                return setPtag({ name: n.slice(7), args: (info?.tag.args ?? []).map(argDefault) })
              }
              setPtag(null)
              if (n.startsWith('fn:')) {
                const f = n.slice(3) as FnName
                return setTag({ name: 'fn', tag: f, args: FN_SPECS[f].args.map((a) => a.def) })
              }
              setTag(n === 'response' ? { name: 'response', field: 'body', requestId: '', filter: '', trigger: 'never' } : ({ name: n } as TagDef))
            }}
          >
            {KINDS.map((k) => <option key={k.id} value={k.id}>{t(k.label)}</option>)}
            {plugins.filter((p) => p.enabled).flatMap((p) => p.templateTags.map((x) => <option key={`${p.id}:${x.name}`} value={`plugin:${x.name}`}>{t('{name} (plugin {plugin})', { name: x.displayName, plugin: p.displayName })}</option>))}
            {tag.name === 'other' && !ptag && <option value="other">{t('{tag} (não suportada)', { tag: tag.tag })}</option>}
          </Select>
        </label>

        {!ptag && tag.name === 'fn' && <FnForm tag={tag} onChange={(args) => setTag({ ...tag, args })} />}
        {ptag && pinfo && <PluginTagForm info={pinfo.tag} args={ptag.args} onChange={(args) => setPtag({ ...ptag, args })} />}

        {r && (
          <>
            <label className="flex flex-col gap-1">
              <span className="text-[11px] text-faint">{t('Atributo')}</span>
              <Select className="field py-1" value={r.field} onChange={(v) => set({ field: v as ResponseTag['field'] })}>
                {FIELDS.map((f) => <option key={f.id} value={f.id}>{t(f.label)}</option>)}
              </Select>
            </label>

            <div className="flex flex-col gap-1">
              <span className="text-[11px] text-faint">Request</span>
              <input className="field py-1" placeholder={t('buscar request…')} value={search} onChange={(e) => setSearch(e.target.value)} />
              <div className="max-h-[180px] overflow-auto rounded-md border border-line">
                {filtered.map((o) => (
                  <button
                    type="button"
                    key={o.id}
                    className={`flex w-full items-center gap-2 px-2 py-1 text-left hover:bg-line ${o.id === selected?.id ? 'bg-raised text-accent' : ''}`}
                    onClick={() => set({ requestId: o.id })}
                  >
                    <MethodBadge method={o.method} className="w-9 shrink-0" />
                    <span className="min-w-0 flex-1 truncate">
                      {(multiWs || o.path) && <span className="text-faint">{[multiWs ? o.wsName : '', o.path].filter(Boolean).join(' / ')} / </span>}
                      {o.name}
                    </span>
                  </button>
                ))}
                {!filtered.length && <div className="px-2 py-1 text-faint">{t('nenhum request')}</div>}
              </div>
              {r.requestId && !selected && <span className="text-[11.5px] text-tpink">{t('request {id} não encontrado', { id: r.requestId })}</span>}
            </div>

            {(r.field === 'body' || r.field === 'header') && (
              <label className="flex flex-col gap-1">
                <span className="text-[11px] text-faint">{r.field === 'header' ? t('Nome do header') : t('Filtro (JSONPath ou caminho XML)')}</span>
                <input
                  className="field py-1 font-mono text-[12px]"
                  placeholder={r.field === 'header' ? 'X-Session' : '$.access_token'}
                  value={r.filter}
                  onChange={(e) => set({ filter: e.target.value })}
                  spellCheck={false}
                />
                {r.field === 'body' && <span className="text-[11px] text-faint">JSON: <code>$.a.b</code>, <code>$.list[0].id</code>, <code>$..id</code> · XML: <code>{t('resposta/resultado/chave')}</code></span>}
              </label>
            )}

            <div className="flex items-start gap-3">
              <label className="flex min-w-0 flex-1 flex-col gap-1">
                <span className="text-[11px] text-faint">{t('Reenviar o request')}</span>
                <Select className="field py-1" value={r.trigger} onChange={(v) => set({ trigger: v as ResponseTag['trigger'] })}>
                  {TRIGGERS.map((x) => <option key={x.id} value={x.id}>{t(x.label)}</option>)}
                </Select>
                <span className="text-[11px] text-faint">{t(TRIGGERS.find((x) => x.id === r.trigger)?.hint ?? '')}</span>
              </label>
              {r.trigger === 'when-expired' && (
                <label className="flex flex-col gap-1">
                  <span className="text-[11px] text-faint">{t('Idade máx. (s)')}</span>
                  <input type="number" min={1} className="field w-[90px] py-1" value={r.maxAge ?? 60} onChange={(e) => set({ maxAge: Math.max(1, Number(e.target.value) || 60) })} />
                </label>
              )}
            </div>
          </>
        )}

        {tag.name !== 'other' && (
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-2">
              <span className="text-[11px] text-faint">{t('Prévia')}{preview.at ? ` · ${t('resposta de {time}', { time: new Date(preview.at).toLocaleTimeString(locale()) })}` : ''}</span>
              {r && r.requestId && (
                <button type="button" className="btn btn-ghost ml-auto px-2 py-0 text-[11.5px]" disabled={preview.loading} onClick={sendNow}>
                  {preview.loading ? t('enviando…') : t('enviar request e atualizar')}
                </button>
              )}
            </div>
            <div className={`max-h-[90px] overflow-auto whitespace-pre-wrap break-all rounded-md border border-line bg-bg p-2 font-mono text-[11.5px] select-text ${preview.error ? 'text-tpink' : 'text-ink'}`}>
              {preview.loading ? '…' : (preview.error ?? preview.value ?? '')}
            </div>
          </div>
        )}

        <code className="truncate text-[11px] text-faint select-text" title={raw}>{raw}</code>
        <div className="flex justify-end gap-2">
          <button type="button" className="btn" onClick={onClose}>{t('Cancelar')}</button>
          <button className="btn btn-accent" disabled={!!r && !r.requestId}>{initial ? t('Salvar') : t('Inserir')}</button>
        </div>
      </form>
    </Modal>
  )
}

// ---------- {% prompt %}: pergunta na hora do envio ----------

/** fila de perguntas vindas do main; fica por cima de tudo */
export function PromptHost() {
  const [queue, setQueue] = useState<{ id: number; p: PromptAsk }[]>([])
  useEffect(() => api.onPrompt((id, p) => setQueue((q) => [...q, { id, p }])), [])
  const cur = queue[0]
  if (!cur) return null
  const reply = (answer: { value: string; remember: boolean } | null): void => {
    api.promptReply(cur.id, answer)
    setQueue((q) => q.slice(1))
  }
  return <PromptModal key={cur.id} ask={cur.p} onReply={reply} />
}

function PromptModal({ ask, onReply }: { ask: PromptAsk; onReply: (a: { value: string; remember: boolean } | null) => void }) {
  const [value, setValue] = useState(ask.defaultValue)
  const [remember, setRemember] = useState(false)
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/55">
      <form
        className="flex w-[min(420px,92vw)] flex-col gap-3 rounded-xl border border-line bg-panel p-4 shadow-2xl"
        onSubmit={(e) => {
          e.preventDefault()
          onReply({ value, remember })
        }}
        onKeyDown={(e) => e.key === 'Escape' && (e.stopPropagation(), onReply(null))}
      >
        <span className="font-semibold">{ask.title}</span>
        {ask.label && <span className="text-[12px] text-dim">{ask.label}</span>}
        <input autoFocus className="field font-mono" type={ask.mask ? 'password' : 'text'} value={value} onChange={(e) => setValue(e.target.value)} spellCheck={false} />
        <label className="flex items-center gap-2 text-[11.5px] text-dim">
          <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
          {t('Lembrar nesta sessão (até fechar o app)')}
        </label>
        <div className="flex justify-end gap-2">
          <button type="button" className="btn" onClick={() => onReply(null)}>{t('Cancelar envio')}</button>
          <button className="btn btn-accent">{t('Enviar')}</button>
        </div>
      </form>
    </div>
  )
}
