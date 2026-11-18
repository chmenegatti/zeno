import CodeMirror, { EditorView } from '@uiw/react-codemirror'
import { json } from '@codemirror/lang-json'
import { xml } from '@codemirror/lang-xml'
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { tags as t } from '@lezer/highlight'
import { useMemo } from 'react'

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
      '.cm-tooltip': { backgroundColor: 'var(--color-raised)', border: '1px solid var(--color-line)' }
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
  lang?: 'json' | 'xml' | 'text'
  readOnly?: boolean
  wrap?: boolean
  placeholder?: string
}

export function CodeEditor({ value, onChange, lang = 'text', readOnly, wrap = true, placeholder }: Props) {
  const extensions = useMemo(() => {
    const ext = [...theme]
    if (lang === 'json') ext.push(json())
    if (lang === 'xml') ext.push(xml())
    if (wrap) ext.push(EditorView.lineWrapping)
    return ext
  }, [lang, wrap])
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
