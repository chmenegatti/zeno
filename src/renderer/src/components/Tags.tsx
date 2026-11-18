import { useEffect, useMemo, useRef, useState, type ClipboardEvent, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { buildTag, FIELDS, parseTag, TRIGGERS, type ResponseTag, type TagDef } from '@shared/tagdef'
import { findNode, sortNodes } from '@shared/tree'
import { tokenize } from '@shared/vars'
import type { TreeNode, Workspace } from '@shared/types'
import { activeWorkspace, api, useStore } from '../state'
import { MethodBadge, Modal } from './ui'
import { VarBadge } from './Vars'
import type { TagSupport } from './CodeEditor'

// ---------- rótulo ----------

/** texto do badge, como no Insomnia: "Resposta ⇒ Login · $.token" */
export function tagLabel(raw: string, workspaces: Workspace[]): { text: string; broken?: string } {
  const t = parseTag(raw)
  if (t.name === 'uuid') return { text: 'UUID' }
  if (t.name === 'now') return { text: 'Agora' }
  if (t.name === 'other') return { text: t.tag, broken: `tag "${t.tag}" não suportada` }
  const ws = workspaces.find((w) => findNode(w, t.requestId)?.node.kind === 'request')
  const req = ws ? findNode(ws, t.requestId)?.node : undefined
  const name = req?.name ?? '?'
  const what = t.field === 'header' ? `header ${t.filter}` : t.field === 'url' ? 'URL' : t.field === 'raw' ? 'body' : t.filter || 'body'
  return { text: `Resposta ⇒ ${name} · ${what}`, broken: req ? undefined : `request ${t.requestId || '(vazio)'} não encontrado` }
}

export function TagBadge({ raw, onChange }: { raw: string; onChange?: (next: string) => void }) {
  const workspaces = useStore((s) => s.workspaces)
  const { text, broken } = tagLabel(raw, workspaces)
  return (
    <span
      role="button"
      className={`var-pill tag ${broken ? 'broken' : ''}`}
      title={`${broken ? `${broken}\n` : ''}${raw}${onChange ? '\nclique pra editar' : ''}`}
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
export function openTagEditor(raw: string, onOk: (next: string) => void): void {
  useStore.setState({ tagEdit: { value: raw, onOk } })
}

/** badges + autocomplete de tags nos editores de código (body, ambientes, variáveis da pasta) */
export const editorTags: TagSupport = {
  label: (raw) => tagLabel(raw, useStore.getState().workspaces),
  edit: (raw, apply) => openTagEditor(raw, apply)
}

/** editor de tag por cima de qualquer modal */
export function TagEditHost() {
  const edit = useStore((s) => s.tagEdit)
  if (!edit) return null
  const close = (): void => useStore.setState({ tagEdit: null })
  return <TagModal key={edit.value} initial={edit.value} onOk={(raw) => { close(); edit.onOk(raw) }} onClose={close} />
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
  const hasTokens = tokens.some((t) => t.t !== 'text')
  useEffect(() => {
    if (editing) ref.current?.focus()
  }, [editing])

  if (editing || !hasTokens) {
    return (
      <input
        ref={ref}
        className={`field min-w-0 flex-1 font-mono ${className}`}
        type={password ? 'password' : 'text'}
        placeholder={placeholder}
        value={value}
        title={title}
        onChange={(e) => onChange(e.target.value)}
        onPaste={onPaste}
        onFocus={() => setEditing(true)}
        onBlur={() => setEditing(false)}
        onKeyDown={(e) => {
          onKeyDown?.(e)
          if (e.defaultPrevented) return
          if (e.key === 'Enter') onEnter?.()
          if (e.key === 'Escape') e.currentTarget.blur()
          if (e.key === ' ' && e.ctrlKey) {
            e.preventDefault()
            const el = e.currentTarget
            const [a, b] = [el.selectionStart ?? value.length, el.selectionEnd ?? value.length]
            openTagEditor('', (tag) => onChange(value.slice(0, a) + tag + value.slice(b)))
          }
        }}
        spellCheck={false}
      />
    )
  }
  // troca o token na posição i pelo texto novo
  const replaceAt = (i: number, next: string) => {
    let pos = 0
    for (let j = 0; j < i; j++) pos += tokens[j].t === 'text' ? (tokens[j] as { v: string }).v.length : (tokens[j] as { raw: string }).raw.length
    const raw = (tokens[i] as { raw: string }).raw
    onChange(value.slice(0, pos) + next + value.slice(pos + raw.length))
  }
  return (
    <div
      tabIndex={0}
      className={`field flex min-w-0 flex-1 cursor-text items-center gap-0.5 overflow-hidden whitespace-nowrap font-mono ${className}`}
      onClick={() => setEditing(true)}
      onFocus={(e) => e.target === e.currentTarget && setEditing(true)}
      title={title ?? 'Clique pra editar · clique num badge pra mudar · Ctrl+Espaço insere tag'}
    >
      {tokens.map((tk, i) =>
        tk.t === 'text' ? (
          <span key={i} className="whitespace-pre">{password ? '•'.repeat(Math.min(tk.v.length, 12)) : tk.v}</span>
        ) : tk.t === 'var' ? (
          <VarBadge key={i} name={tk.name} />
        ) : (
          <TagBadge key={i} raw={tk.raw} onChange={(next) => replaceAt(i, next)} />
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

const KINDS: { id: TagDef['name']; label: string }[] = [
  { id: 'response', label: 'Resposta (valor de outro request)' },
  { id: 'uuid', label: 'UUID v4' },
  { id: 'now', label: 'Data e hora atual (ISO)' }
]

export function TagModal({ initial, onOk, onClose }: { initial: string; onOk: (raw: string) => void; onClose: () => void }) {
  const workspaces = useStore((s) => s.workspaces)
  const app = useStore((s) => s.app)
  const ws = activeWorkspace({ workspaces, app })
  const start = useMemo<TagDef>(() => (initial ? parseTag(initial) : { name: 'response', field: 'body', requestId: '', filter: '', trigger: 'never' }), [initial])
  const [tag, setTag] = useState<TagDef>(start)
  const [search, setSearch] = useState('')
  const [preview, setPreview] = useState<{ value?: string; error?: string; at?: number; loading?: boolean }>({})
  const options = useMemo(() => requestOptions(workspaces, ws), [workspaces, ws])
  const r = tag.name === 'response' ? tag : null
  const set = (patch: Partial<ResponseTag>) => r && setTag({ ...r, ...patch })
  const raw = buildTag(tag)

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return q ? options.filter((o) => `${o.wsName} ${o.path} ${o.name} ${o.method}`.toLowerCase().includes(q)) : options
  }, [options, search])

  // prévia com a última resposta (sem reenviar)
  useEffect(() => {
    if (tag.name === 'other') return setPreview({})
    if (r && !r.requestId) return setPreview({ error: 'escolha o request' })
    let alive = true
    const t = setTimeout(() => api.tagPreview(raw, false).then((p) => alive && setPreview(p)), 200)
    return () => {
      alive = false
      clearTimeout(t)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [raw])

  const sendNow = async () => {
    setPreview({ loading: true })
    setPreview((await useStore.getState().run(api.tagPreview(raw, true))) ?? {})
  }
  const selected = r ? options.find((o) => o.id === r.requestId) : undefined
  const multiWs = new Set(options.map((o) => o.wsName)).size > 1

  return (
    <Modal title={initial ? 'Editar tag' : 'Inserir tag'} onClose={onClose}>
      <form
        className="flex flex-col gap-3 text-[12.5px]"
        onSubmit={(e) => {
          e.preventDefault()
          if (r && !r.requestId) return
          onOk(raw)
        }}
      >
        <label className="flex flex-col gap-1">
          <span className="text-[11px] text-faint">Função</span>
          <select
            className="field py-1"
            value={tag.name}
            disabled={tag.name === 'other'}
            onChange={(e) => {
              const n = e.target.value as TagDef['name']
              setTag(n === 'response' ? { name: 'response', field: 'body', requestId: '', filter: '', trigger: 'never' } : ({ name: n } as TagDef))
            }}
          >
            {KINDS.map((k) => <option key={k.id} value={k.id}>{k.label}</option>)}
            {tag.name === 'other' && <option value="other">{tag.tag} (não suportada)</option>}
          </select>
        </label>

        {r && (
          <>
            <label className="flex flex-col gap-1">
              <span className="text-[11px] text-faint">Atributo</span>
              <select className="field py-1" value={r.field} onChange={(e) => set({ field: e.target.value as ResponseTag['field'] })}>
                {FIELDS.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
              </select>
            </label>

            <div className="flex flex-col gap-1">
              <span className="text-[11px] text-faint">Request</span>
              <input className="field py-1" placeholder="buscar request…" value={search} onChange={(e) => setSearch(e.target.value)} />
              <div className="max-h-[180px] overflow-auto rounded-md border border-line">
                {filtered.map((o) => (
                  <button
                    type="button"
                    key={o.id}
                    className={`flex w-full items-center gap-2 px-2 py-1 text-left hover:bg-line ${o.id === r.requestId ? 'bg-raised text-accent' : ''}`}
                    onClick={() => set({ requestId: o.id })}
                  >
                    <MethodBadge method={o.method} className="w-9 shrink-0" />
                    <span className="min-w-0 flex-1 truncate">
                      {(multiWs || o.path) && <span className="text-faint">{[multiWs ? o.wsName : '', o.path].filter(Boolean).join(' / ')} / </span>}
                      {o.name}
                    </span>
                  </button>
                ))}
                {!filtered.length && <div className="px-2 py-1 text-faint">nenhum request</div>}
              </div>
              {r.requestId && !selected && <span className="text-[11.5px] text-tpink">request {r.requestId} não encontrado</span>}
            </div>

            {(r.field === 'body' || r.field === 'header') && (
              <label className="flex flex-col gap-1">
                <span className="text-[11px] text-faint">{r.field === 'header' ? 'Nome do header' : 'Filtro (JSONPath ou caminho XML)'}</span>
                <input
                  className="field py-1 font-mono text-[12px]"
                  placeholder={r.field === 'header' ? 'X-Session' : '$.access_token'}
                  value={r.filter}
                  onChange={(e) => set({ filter: e.target.value })}
                  spellCheck={false}
                />
                {r.field === 'body' && <span className="text-[11px] text-faint">JSON: <code>$.a.b</code>, <code>$.list[0].id</code>, <code>$..id</code> · XML: <code>resposta/resultado/chave</code></span>}
              </label>
            )}

            <div className="flex items-start gap-3">
              <label className="flex min-w-0 flex-1 flex-col gap-1">
                <span className="text-[11px] text-faint">Reenviar o request</span>
                <select className="field py-1" value={r.trigger} onChange={(e) => set({ trigger: e.target.value as ResponseTag['trigger'] })}>
                  {TRIGGERS.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
                </select>
                <span className="text-[11px] text-faint">{TRIGGERS.find((t) => t.id === r.trigger)?.hint}</span>
              </label>
              {r.trigger === 'when-expired' && (
                <label className="flex flex-col gap-1">
                  <span className="text-[11px] text-faint">Idade máx. (s)</span>
                  <input type="number" min={1} className="field w-[90px] py-1" value={r.maxAge ?? 60} onChange={(e) => set({ maxAge: Math.max(1, Number(e.target.value) || 60) })} />
                </label>
              )}
            </div>
          </>
        )}

        {tag.name !== 'other' && (
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-2">
              <span className="text-[11px] text-faint">Prévia{preview.at ? ` · resposta de ${new Date(preview.at).toLocaleTimeString()}` : ''}</span>
              {r && r.requestId && (
                <button type="button" className="btn btn-ghost ml-auto px-2 py-0 text-[11.5px]" disabled={preview.loading} onClick={sendNow}>
                  {preview.loading ? 'enviando…' : 'enviar request e atualizar'}
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
          <button type="button" className="btn" onClick={onClose}>Cancelar</button>
          <button className="btn btn-accent" disabled={!!r && !r.requestId}>{initial ? 'Salvar' : 'Inserir'}</button>
        </div>
      </form>
    </Modal>
  )
}
