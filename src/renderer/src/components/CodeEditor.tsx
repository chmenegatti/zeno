import CodeMirror, { Decoration, EditorView, keymap, MatchDecorator, StateEffect, ViewPlugin, WidgetType, type DecorationSet, type ViewUpdate } from '@uiw/react-codemirror'
import { json } from '@codemirror/lang-json'
import { xml } from '@codemirror/lang-xml'
import { javascript } from '@codemirror/lang-javascript'
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { tags as t } from '@lezer/highlight'
import { autocompletion, startCompletion, type Completion, type CompletionContext } from '@codemirror/autocomplete'
import { matchVars, openVarAt, rootName } from '@shared/vars'
import { TAG_CHOICES } from '@shared/tagdef'
import { useMemo, useRef } from 'react'

/** tags {% %} dentro do editor viram badge clicável (igual ao Insomnia) */
export interface TagSupport {
  label: (raw: string) => { text: string; broken?: string }
  /** abre o editor; raw vazio = tag nova. apply troca o trecho; cancel = fechou sem salvar */
  edit: (raw: string, apply: (next: string) => void, cancel?: () => void) => void
  /** {{ variáveis }} como badge + autocomplete */
  vars?: VarSupport
}

export interface VarSupport {
  list: () => { name: string; detail: string; source: string }[]
  pill: (name: string) => { cls: string; text: string; title: string; lock: boolean }
  open: (name: string, el: Element) => void
  /** avisa quando ambiente/valores mudam (redesenha os badges) */
  subscribe: (cb: () => void) => () => void
}

class VarWidget extends WidgetType {
  readonly look: { cls: string; text: string; title: string; lock: boolean }
  constructor(
    readonly raw: string,
    readonly name: string,
    readonly vars: VarSupport
  ) {
    super()
    this.look = vars.pill(name)
  }
  eq(o: VarWidget): boolean {
    return o.raw === this.raw && o.look.cls === this.look.cls && o.look.text === this.look.text && o.look.title === this.look.title
  }
  toDOM(): HTMLElement {
    const el = document.createElement('span')
    el.className = this.look.cls
    el.textContent = `${this.look.lock ? '🔒 ' : ''}${this.look.text}`
    el.title = this.look.title
    el.onmousedown = (e) => e.preventDefault()
    el.onclick = (e) => {
      e.preventDefault()
      this.vars.open(this.name, el)
    }
    return el
  }
  ignoreEvent(): boolean {
    return false
  }
}

const refresh = StateEffect.define<null>()

class TagWidget extends WidgetType {
  constructor(
    readonly raw: string,
    readonly tags: { current: TagSupport | undefined }
  ) {
    super()
  }
  eq(o: TagWidget): boolean {
    return o.raw === this.raw
  }
  toDOM(view: EditorView): HTMLElement {
    const el = document.createElement('span')
    const l = this.tags.current?.label(this.raw) ?? { text: this.raw }
    el.className = `var-pill tag${l.broken ? ' broken' : ''}`
    el.textContent = `ƒ ${l.text}`
    el.title = `${l.broken ? `${l.broken}\n` : ''}${this.raw}\nclique pra editar`
    el.onmousedown = (e) => e.preventDefault()
    el.onclick = (e) => {
      e.preventDefault()
      const from = view.posAtDOM(el)
      const raw = this.raw
      this.tags.current?.edit(raw, (next) => {
        if (view.state.sliceDoc(from, from + raw.length) === raw) view.dispatch({ changes: { from, to: from + raw.length, insert: next } })
      })
    }
    return el
  }
  ignoreEvent(): boolean {
    return false
  }
}

function tagExtension(tags: { current: TagSupport | undefined }) {
  const matcher = new MatchDecorator({
    regexp: /\{%.*?%\}|\{\{\s*([A-Za-z0-9_$.\-[\]'"]+)\s*\}\}/g,
    decoration: (m) => {
      const vars = tags.current?.vars
      if (m[0].startsWith('{{')) return vars ? Decoration.replace({ widget: new VarWidget(m[0], rootName(m[1]), vars) }) : null
      return Decoration.replace({ widget: new TagWidget(m[0], tags) })
    }
  })
  const plugin = ViewPlugin.fromClass(
    class {
      decorations: DecorationSet
      unsub: () => void
      constructor(view: EditorView) {
        this.decorations = matcher.createDeco(view)
        // ambiente trocado, valor editado, Alt+Shift+U: redesenha os badges
        this.unsub = tags.current?.vars?.subscribe(() => queueMicrotask(() => view.dispatch({ effects: refresh.of(null) }))) ?? (() => undefined)
      }
      update(u: ViewUpdate) {
        this.decorations = u.transactions.some((tr) => tr.effects.some((e) => e.is(refresh))) ? matcher.createDeco(u.view) : matcher.updateDeco(u, this.decorations)
      }
      destroy() {
        this.unsub()
      }
    },
    {
      decorations: (v) => v.decorations,
      provide: (p) => EditorView.atomicRanges.of((view) => view.plugin(p)?.decorations ?? Decoration.none)
    }
  )
  // Ctrl+Espaço (padrão do Insomnia): lista variáveis e tags
  const insert = keymap.of([{ key: 'Ctrl-Space', run: startCompletion }])
  // digitar "respon…", "uuid", "now" sugere a tag; escolher já vira badge (e a de resposta abre o editor)
  const choices = TAG_CHOICES
  const tagOption = (c: (typeof choices)[number]): Completion => ({
    label: c.label,
    detail: c.detail,
    type: 'function',
    apply: (view, _c, from, to) => {
      view.dispatch({ changes: { from, to, insert: c.raw }, selection: { anchor: from + c.raw.length } })
      if (!c.edit) return
      // tag recém-inserida: salvar troca, cancelar remove (não deixa tag sem request no texto)
      const replace = (insert: string): void => {
        if (view.state.sliceDoc(from, from + c.raw.length) === c.raw) view.dispatch({ changes: { from, to: from + c.raw.length, insert } })
      }
      tags.current?.edit(c.raw, replace, () => replace(''))
    }
  })
  const varOption = (v: { name: string; detail: string; source: string }): Completion => ({
    label: v.name,
    detail: `${v.detail}  · ${v.source}`,
    type: 'variable',
    apply: (view, _c, from, to) => {
      // fecha-chaves automático pode ter deixado "}}" depois do cursor
      const end = view.state.sliceDoc(to, to + 2) === '}}' ? to + 2 : view.state.sliceDoc(to, to + 1) === '}' ? to + 1 : to
      const text = `{{ ${v.name} }}`
      view.dispatch({ changes: { from, to: end, insert: text }, selection: { anchor: from + text.length } })
    }
  })
  const otherTag: Completion = {
    label: 'Outra tag…',
    detail: 'abre o editor',
    type: 'function',
    apply: (view, _c, from, to) => tags.current?.edit('', (next) => view.dispatch({ changes: { from, to, insert: next } }))
  }
  const source = (ctx: CompletionContext) => {
    const vars = tags.current?.vars
    // {{ aberto: só variáveis
    const line = ctx.state.doc.lineAt(ctx.pos)
    const open = openVarAt(line.text.slice(0, ctx.pos - line.from))
    if (open && vars) {
      const options = matchVars(vars.list(), open.query).map(varOption)
      return options.length ? { from: line.from + open.start, options, filter: false } : null
    }
    const word = ctx.matchBefore(/[A-Za-z_][\w.]*/)
    if (ctx.explicit) {
      // Ctrl+Espaço: variáveis e tags, filtrando pela palavra antes do cursor
      const q = word?.text ?? ''
      const from = word?.from ?? ctx.pos
      const vs = vars ? matchVars(vars.list(), q).map(varOption) : []
      const ts = choices.filter((c) => !q || c.keys.some((k) => k.startsWith(q.toLowerCase()))).map(tagOption)
      return { from, options: [...vs, ...ts, otherTag], filter: false }
    }
    if (!word || word.to - word.from < 3) return null
    const q = word.text.toLowerCase()
    const options = choices.filter((c) => c.keys.some((k) => k.startsWith(q))).map(tagOption)
    return options.length ? { from: word.from, options, filter: false } : null
  }
  return [plugin, insert, autocompletion({ override: [source], icons: false })]
}

// tema escuro com a paleta TOTVS
const theme = [
  EditorView.theme(
    {
      '&': { backgroundColor: 'transparent', color: 'var(--color-ink)' },
      '.cm-gutters': { backgroundColor: 'transparent', borderRight: '1px solid var(--color-line)', color: 'var(--color-faint)' },
      '.cm-activeLine, .cm-activeLineGutter': { backgroundColor: 'rgba(0,219,255,0.04)' },
      '.cm-content': { fontFamily: 'var(--font-mono)', caretColor: 'var(--color-tblue)' },
      '.cm-cursor': { borderLeftColor: 'var(--color-tblue)' },
      '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection': { backgroundColor: 'rgba(0,219,255,0.18) !important' },
      '.cm-matchingBracket': { backgroundColor: 'rgba(164,77,255,0.25)', outline: 'none' },
      '.cm-foldPlaceholder': { backgroundColor: 'var(--color-raised)', border: 'none', color: 'var(--color-dim)' },
      '.cm-tooltip': { backgroundColor: 'var(--color-raised)', border: '1px solid var(--color-line)' },
      '.cm-tooltip-autocomplete > ul > li': { padding: '3px 10px' },
      '.cm-tooltip-autocomplete > ul > li[aria-selected]': { backgroundColor: 'rgba(164,77,255,0.35)', color: 'var(--color-ink)' },
      '.cm-completionDetail': { color: 'var(--color-faint)', fontStyle: 'normal', marginLeft: '10px' }
    },
    { dark: true }
  ),
  syntaxHighlighting(
    HighlightStyle.define([
      { tag: t.propertyName, color: '#00dbff' },
      { tag: [t.string, t.special(t.string)], color: '#00ffd4' },
      { tag: [t.number, t.integer, t.float], color: '#ff8900' },
      { tag: [t.bool, t.null, t.atom], color: '#a44dff' },
      { tag: [t.keyword, t.tagName], color: '#ff009e' },
      { tag: [t.attributeName], color: '#d9ff65' },
      { tag: [t.comment], color: '#577787', fontStyle: 'italic' },
      { tag: [t.punctuation, t.bracket, t.separator], color: '#8eaab8' }
    ])
  )
]

export function langFor(mime: string | null | undefined): 'json' | 'xml' | 'text' {
  if (!mime) return 'text'
  if (/json|graphql/i.test(mime)) return 'json'
  if (/xml|html/i.test(mime)) return 'xml'
  return 'text'
}

interface Props {
  value: string
  onChange?: (v: string) => void
  lang?: 'json' | 'xml' | 'text' | 'javascript'
  readOnly?: boolean
  wrap?: boolean
  placeholder?: string
  tags?: TagSupport
}

export function CodeEditor({ value, onChange, lang = 'text', readOnly, wrap = true, placeholder, tags }: Props) {
  const tagsRef = useRef(tags)
  tagsRef.current = tags
  const withTags = !!tags
  const extensions = useMemo(() => {
    const ext = [...theme]
    if (withTags) ext.push(...tagExtension(tagsRef))
    if (lang === 'json') ext.push(json())
    if (lang === 'xml') ext.push(xml())
    if (lang === 'javascript') ext.push(javascript())
    if (wrap) ext.push(EditorView.lineWrapping)
    return ext
  }, [lang, wrap, withTags])
  return (
    <CodeMirror
      value={value}
      onChange={onChange}
      readOnly={readOnly}
      editable={!readOnly}
      theme="none"
      extensions={extensions}
      placeholder={placeholder}
      height="100%"
      style={{ height: '100%' }}
      basicSetup={{ foldGutter: true, highlightActiveLine: !readOnly, autocompletion: false }}
    />
  )
}
