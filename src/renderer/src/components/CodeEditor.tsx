import CodeMirror, { Decoration, EditorState, EditorView, keymap, MatchDecorator, StateEffect, ViewPlugin, WidgetType, type DecorationSet, type Extension, type ViewUpdate } from '@uiw/react-codemirror'
import { json } from '@codemirror/lang-json'
import { xml } from '@codemirror/lang-xml'
import { javascript } from '@codemirror/lang-javascript'
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { tags as hl } from '@lezer/highlight'
import { search } from '@codemirror/search'
import { autocompletion, startCompletion, type Completion, type CompletionContext, type CompletionResult, type CompletionSource } from '@codemirror/autocomplete'
import { matchVars, openVarAt, rootName } from '@shared/vars'
import { TAG_CHOICES } from '@shared/tagdef'
import { useMemo, useRef } from 'react'
import { getLang, t } from '@shared/i18n'

/** tags {% %} dentro do editor viram badge clicável (igual ao Insomnia) */
export interface TagSupport {
  label: (raw: string) => { text: string; broken?: string }
  /** abre o editor; raw vazio = tag nova. apply troca o trecho; cancel = fechou sem salvar */
  edit: (raw: string, apply: (next: string) => void, cancel?: () => void) => void
  /** {{ variáveis }} como badge + autocomplete */
  vars?: VarSupport
  /** sugestões de tag (padrão + plugins); sem = só as padrão */
  choices?: () => TagChoice[]
}

export type TagChoice = (typeof TAG_CHOICES)[number]

export interface VarSupport {
  list: () => { name: string; detail: string; source: string }[]
  pill: (name: string) => { cls: string; text: string; title: string; lock: boolean }
  open: (name: string, el: Element, swap?: (name: string) => void) => void
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
  toDOM(view: EditorView): HTMLElement {
    const el = document.createElement('span')
    el.className = this.look.cls
    el.textContent = `${this.look.lock ? '🔒 ' : ''}${this.look.text}`
    el.title = this.look.title
    el.onmousedown = (e) => e.preventDefault()
    el.onclick = (e) => {
      e.preventDefault()
      // trocar a variável: reescreve o {{ }} no lugar, se o texto ainda for o mesmo
      this.vars.open(this.name, el, (next) => {
        const from = view.posAtDOM(el)
        if (view.state.sliceDoc(from, from + this.raw.length) !== this.raw) return
        view.dispatch({ changes: { from, to: from + this.raw.length, insert: `{{ ${next} }}` } })
      })
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
    el.title = `${l.broken ? `${l.broken}\n` : ''}${this.raw}\n${t('clique pra editar')}`
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
  const choicesNow = (): TagChoice[] => tags.current?.choices?.() ?? TAG_CHOICES
  const tagOption = (c: TagChoice): Completion => ({
    label: t(c.label),
    detail: t(c.detail),
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
    label: t('Outra tag…'),
    detail: t('abre o editor'),
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
      const ts = choicesNow().filter((c) => !q || c.keys.some((k) => k.startsWith(q.toLowerCase()))).map(tagOption)
      return { from, options: [...vs, ...ts, otherTag], filter: false }
    }
    if (!word || word.to - word.from < 3) return null
    const q = word.text.toLowerCase()
    const options = choicesNow().filter((c) => c.keys.some((k) => k.startsWith(q))).map(tagOption)
    return options.length ? { from: word.from, options, filter: false } : null
  }
  // override tira as sugestões da linguagem (ex.: campos do schema GraphQL): repassa elas também
  const langSource = async (ctx: CompletionContext): Promise<CompletionResult | null> => {
    for (const f of ctx.state.languageDataAt<CompletionSource>('autocomplete', ctx.pos)) {
      if (typeof f !== 'function') continue
      const r = await f(ctx)
      if (r) return r
    }
    return null
  }
  return [plugin, insert, autocompletion({ override: [source, langSource], icons: false })]
}

// textos do CodeMirror em pt-BR (busca, dobra, autocomplete); em inglês valem os padrões do CodeMirror
const ptPhrases = EditorState.phrases.of({
  Find: 'Buscar',
  Replace: 'Substituir',
  next: 'próximo',
  previous: 'anterior',
  all: 'todos',
  'match case': 'maiúsc./minúsc.',
  regexp: 'regex',
  'by word': 'palavra inteira',
  replace: 'substituir',
  'replace all': 'substituir todos',
  close: 'fechar',
  'current match': 'resultado atual',
  'on line': 'na linha',
  'Go to line': 'Ir para a linha',
  go: 'ir',
  'Folded lines': 'Linhas dobradas',
  'Unfolded lines': 'Linhas desdobradas',
  'Fold line': 'Dobrar linha',
  'Unfold line': 'Desdobrar linha'
})

// cores vêm das variáveis do tema ativo (src/shared/themes.ts)
const theme = [
  search({ top: true }),
  EditorView.theme(
    {
      '&': { backgroundColor: 'transparent', color: 'var(--color-ink)' },
      '.cm-gutters': { backgroundColor: 'transparent', borderRight: '1px solid var(--color-line)', color: 'var(--color-faint)' },
      '.cm-activeLine, .cm-activeLineGutter': { backgroundColor: 'color-mix(in srgb, var(--color-accent) 5%, transparent)' },
      '.cm-content': { fontFamily: 'var(--font-mono)', caretColor: 'var(--color-tblue)' },
      '.cm-cursor': { borderLeftColor: 'var(--color-tblue)' },
      '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection': { backgroundColor: 'color-mix(in srgb, var(--color-accent) 22%, transparent) !important' },
      '.cm-matchingBracket': { backgroundColor: 'color-mix(in srgb, var(--color-tpurple) 28%, transparent)', outline: 'none' },
      '.cm-foldPlaceholder': { backgroundColor: 'var(--color-raised)', border: 'none', color: 'var(--color-dim)' },
      '.cm-tooltip': { backgroundColor: 'var(--color-raised)', border: '1px solid var(--color-line)' },
      '.cm-tooltip-autocomplete > ul > li': { padding: '3px 10px' },
      '.cm-tooltip-autocomplete > ul > li[aria-selected]': { backgroundColor: 'color-mix(in srgb, var(--color-tpurple) 35%, transparent)', color: 'var(--color-ink)' },
      '.cm-completionDetail': { color: 'var(--color-faint)', fontStyle: 'normal', marginLeft: '10px' },
      // busca (Ctrl+F)
      '.cm-panels': { backgroundColor: 'var(--color-raised)', color: 'var(--color-ink)', borderColor: 'var(--color-line)' },
      '.cm-panels.cm-panels-top': { borderBottom: '1px solid var(--color-line)' },
      '.cm-search': { fontSize: '12px', display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '4px' },
      '.cm-search input, .cm-search button, .cm-search label': { fontSize: '12px' },
      '.cm-textfield': { backgroundColor: 'var(--color-bg)', border: '1px solid var(--color-line)', borderRadius: '4px', color: 'var(--color-ink)', padding: '2px 6px' },
      '.cm-button': { backgroundImage: 'none', backgroundColor: 'var(--color-panel)', border: '1px solid var(--color-line)', borderRadius: '4px', color: 'var(--color-ink)' },
      '.cm-searchMatch': { backgroundColor: 'color-mix(in srgb, var(--color-torange) 28%, transparent)', outline: '1px solid color-mix(in srgb, var(--color-torange) 50%, transparent)' },
      '.cm-searchMatch.cm-searchMatch-selected': { backgroundColor: 'color-mix(in srgb, var(--color-torange) 60%, transparent)' }
    },
    { dark: true }
  ),
  syntaxHighlighting(
    HighlightStyle.define([
      { tag: hl.propertyName, color: 'var(--syn-prop, var(--color-tblue))' },
      { tag: [hl.string, hl.special(hl.string)], color: 'var(--syn-string, var(--color-tgreen))' },
      { tag: [hl.number, hl.integer, hl.float], color: 'var(--syn-number, var(--color-torange))' },
      { tag: [hl.bool, hl.null, hl.atom], color: 'var(--syn-bool, var(--color-tpurple))' },
      { tag: [hl.keyword, hl.tagName], color: 'var(--syn-keyword, var(--color-tpink))' },
      { tag: [hl.attributeName], color: 'var(--syn-attr, var(--color-tlime))' },
      { tag: [hl.comment], color: 'var(--color-faint)', fontStyle: 'italic' },
      { tag: [hl.punctuation, hl.bracket, hl.separator], color: 'var(--color-dim)' },
      // código gerado (Python, Go, shell…): funções, tipos, built-ins e operadores, como numa IDE
      { tag: [hl.function(hl.variableName), hl.function(hl.propertyName), hl.definition(hl.variableName)], color: 'var(--syn-prop, var(--color-tblue))' },
      { tag: [hl.typeName, hl.className, hl.namespace], color: 'var(--syn-attr, var(--color-tlime))' },
      { tag: [hl.standard(hl.variableName), hl.special(hl.variableName), hl.self, hl.meta, hl.processingInstruction], color: 'var(--syn-bool, var(--color-tpurple))' },
      { tag: [hl.operator, hl.operatorKeyword], color: 'var(--syn-keyword, var(--color-tpink))' },
      { tag: [hl.escape, hl.regexp], color: 'var(--syn-number, var(--color-torange))' }
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
  /** recebe a view (busca, posição do clique…) */
  onView?: (view: EditorView) => void
  /** extensões extras (fixas: criadas uma vez pelo componente) */
  extra?: Extension[]
}

export function CodeEditor({ value, onChange, lang = 'text', readOnly, wrap = true, placeholder, tags, onView, extra }: Props) {
  const tagsRef = useRef(tags)
  tagsRef.current = tags
  const withTags = !!tags
  // idioma lido ao criar o editor: troca de idioma recria as extensões
  const uiLang = getLang()
  const extensions = useMemo(() => {
    const ext = [...theme]
    if (uiLang === 'pt') ext.push(ptPhrases)
    if (withTags) ext.push(...tagExtension(tagsRef))
    if (lang === 'json') ext.push(json())
    if (lang === 'xml') ext.push(xml())
    if (lang === 'javascript') ext.push(javascript())
    if (wrap) ext.push(EditorView.lineWrapping)
    if (extra) ext.push(...extra)
    return ext
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lang, wrap, withTags, uiLang])
  return (
    <CodeMirror
      value={value}
      onChange={onChange}
      readOnly={readOnly}
      // só leitura mas focável: cursor, seleção e Ctrl+F funcionam
      editable
      theme="none"
      extensions={extensions}
      placeholder={placeholder}
      onCreateEditor={onView}
      height="100%"
      style={{ height: '100%' }}
      basicSetup={{ foldGutter: true, highlightActiveLine: !readOnly, autocompletion: false }}
    />
  )
}
