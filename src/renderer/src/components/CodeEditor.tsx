import CodeMirror, { Decoration, EditorView, keymap, MatchDecorator, ViewPlugin, WidgetType, type DecorationSet, type ViewUpdate } from '@uiw/react-codemirror'
import { json } from '@codemirror/lang-json'
import { xml } from '@codemirror/lang-xml'
import { javascript } from '@codemirror/lang-javascript'
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { tags as t } from '@lezer/highlight'
import { autocompletion, type Completion, type CompletionContext } from '@codemirror/autocomplete'
import { useMemo, useRef } from 'react'

/** tags {% %} dentro do editor viram badge clicável (igual ao Insomnia) */
export interface TagSupport {
  label: (raw: string) => { text: string; broken?: string }
  /** abre o editor; raw vazio = tag nova. apply troca o trecho */
  edit: (raw: string, apply: (next: string) => void) => void
}

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
    regexp: /\{%.*?%\}/g,
    decoration: (m) => Decoration.replace({ widget: new TagWidget(m[0], tags) })
  })
  const plugin = ViewPlugin.fromClass(
    class {
      decorations: DecorationSet
      constructor(view: EditorView) {
        this.decorations = matcher.createDeco(view)
      }
      update(u: ViewUpdate) {
        this.decorations = matcher.updateDeco(u, this.decorations)
      }
    },
    {
      decorations: (v) => v.decorations,
      provide: (p) => EditorView.atomicRanges.of((view) => view.plugin(p)?.decorations ?? Decoration.none)
    }
  )
  const insert = keymap.of([
    {
      key: 'Ctrl-Space',
      run: (view) => {
        const { from, to } = view.state.selection.main
        tags.current?.edit('', (next) => view.dispatch({ changes: { from, to, insert: next } }))
        return true
      }
    }
  ])
  // digitar "respon…", "uuid", "now" sugere a tag; escolher já vira badge (e a de resposta abre o editor)
  const choices: { label: string; detail: string; keys: string[]; raw: string; edit?: boolean }[] = [
    { label: 'Resposta ⇒ Atributo do body', detail: 'JSONPath', keys: ['response', 'resposta', 'body'], raw: "{% response 'body', '', '', 'never' %}", edit: true },
    { label: 'Resposta ⇒ Body inteiro', detail: 'raw', keys: ['response', 'resposta', 'raw'], raw: "{% response 'raw', '', '', 'never' %}", edit: true },
    { label: 'Resposta ⇒ Header', detail: 'header', keys: ['response', 'resposta', 'header'], raw: "{% response 'header', '', '', 'never' %}", edit: true },
    { label: 'Resposta ⇒ URL', detail: 'url', keys: ['response', 'resposta', 'url'], raw: "{% response 'url', '', '', 'never' %}", edit: true },
    { label: 'UUID', detail: 'v4', keys: ['uuid'], raw: "{% uuid 'v4' %}" },
    { label: 'Agora', detail: 'timestamp', keys: ['now', 'agora', 'timestamp'], raw: '{% now %}' }
  ]
  const source = (ctx: CompletionContext) => {
    const word = ctx.matchBefore(/[A-Za-z]+/)
    if (!word || (word.to - word.from < 3 && !ctx.explicit)) return null
    const q = word.text.toLowerCase()
    const options: Completion[] = choices
      .filter((c) => c.keys.some((k) => k.startsWith(q)))
      .map((c) => ({
        label: c.label,
        detail: c.detail,
        type: 'function',
        apply: (view, _c, from, to) => {
          view.dispatch({ changes: { from, to, insert: c.raw }, selection: { anchor: from + c.raw.length } })
          if (!c.edit) return
          tags.current?.edit(c.raw, (next) => {
            if (view.state.sliceDoc(from, from + c.raw.length) === c.raw) view.dispatch({ changes: { from, to: from + c.raw.length, insert: next } })
          })
        }
      }))
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
