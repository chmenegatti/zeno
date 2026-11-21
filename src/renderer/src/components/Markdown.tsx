// Docs em Markdown (#154): request, pasta e workspace. Carregado só quando alguém abre uma aba de docs.
// HTML limpo pelo DOMPurify, sem imagens remotas (viram link) e com realce nos blocos de código.

import { useState } from 'react'
import { marked } from 'marked'
import DOMPurify from 'dompurify'
import { highlightCode, classHighlighter } from '@lezer/highlight'
import { StreamLanguage, type Language } from '@codemirror/language'
import { jsonLanguage } from '@codemirror/lang-json'
import { javascriptLanguage, typescriptLanguage } from '@codemirror/lang-javascript'
import { xmlLanguage } from '@codemirror/lang-xml'
import { yaml } from '@codemirror/legacy-modes/mode/yaml'
import { shell } from '@codemirror/legacy-modes/mode/shell'
import { go } from '@codemirror/legacy-modes/mode/go'
import { python } from '@codemirror/legacy-modes/mode/python'
import { http } from '@codemirror/legacy-modes/mode/http'
import { t } from '@shared/i18n'

const yamlLang = StreamLanguage.define(yaml)
const shellLang = StreamLanguage.define(shell)
const LANGS: Record<string, Language> = {
  json: jsonLanguage,
  js: javascriptLanguage,
  javascript: javascriptLanguage,
  ts: typescriptLanguage,
  typescript: typescriptLanguage,
  xml: xmlLanguage,
  html: xmlLanguage,
  yaml: yamlLang,
  yml: yamlLang,
  sh: shellLang,
  bash: shellLang,
  shell: shellLang,
  go: StreamLanguage.define(go),
  python: StreamLanguage.define(python),
  http: StreamLanguage.define(http)
}

function highlight(code: HTMLElement): void {
  const lang = LANGS[(/language-(\w+)/.exec(code.className) ?? [])[1]?.toLowerCase() ?? '']
  if (!lang) return
  const text = code.textContent ?? ''
  const out = document.createDocumentFragment()
  highlightCode(
    text,
    lang.parser.parse(text),
    classHighlighter,
    (s, cls) => {
      if (!cls) return void out.append(s)
      const span = document.createElement('span')
      span.className = cls
      span.textContent = s
      out.append(span)
    },
    () => out.append('\n')
  )
  code.replaceChildren(out)
}

/** Markdown → HTML seguro */
export function renderMarkdown(src: string): string {
  const raw = marked.parse(src, { gfm: true, async: false }) as string
  const clean = DOMPurify.sanitize(raw, { FORBID_TAGS: ['style', 'iframe', 'form', 'input', 'button', 'textarea', 'select'], FORBID_ATTR: ['style'] })
  const doc = new DOMParser().parseFromString(`<div>${clean}</div>`, 'text/html')
  const root = doc.body.firstElementChild as HTMLElement
  // imagem remota não carrega sozinha (rastreio, rede): vira link
  for (const img of root.querySelectorAll('img')) {
    const src = img.getAttribute('src') ?? ''
    if (/^(https?:)?\/\//i.test(src)) {
      const a = doc.createElement('a')
      a.href = src
      a.textContent = `🖼 ${img.getAttribute('alt') || src}`
      img.replaceWith(a)
    }
  }
  for (const code of root.querySelectorAll<HTMLElement>('pre > code')) highlight(code)
  return root.innerHTML
}

export function MarkdownView({ text, className = '' }: { text: string; className?: string }) {
  return <div className={`md ${className}`} dangerouslySetInnerHTML={{ __html: renderMarkdown(text) }} />
}

/** editar/pré-visualizar; abre na prévia quando já tem texto */
export default function DocsEditor({ value, onChange, placeholder, className = '' }: { value: string; onChange: (v: string) => void; placeholder?: string; className?: string }) {
  const [edit, setEdit] = useState(!value.trim())
  return (
    <div className={`flex min-h-0 flex-col ${className}`}>
      <div className="flex items-center gap-1 px-3 pt-2 text-[11.5px]">
        <button className={`btn btn-ghost px-2 py-0 ${edit ? 'text-ink' : 'text-faint'}`} onClick={() => setEdit(true)}>
          {t('Editar')}
        </button>
        <button className={`btn btn-ghost px-2 py-0 ${!edit ? 'text-ink' : 'text-faint'}`} onClick={() => setEdit(false)}>
          {t('Visualizar')}
        </button>
        <span className="ml-auto text-faint">Markdown</span>
      </div>
      {edit ? (
        <textarea
          autoFocus={!!value}
          className="min-h-0 w-full flex-1 resize-none bg-transparent p-3 font-mono text-[12.5px] outline-none"
          placeholder={placeholder}
          value={value}
          spellCheck={false}
          onChange={(e) => onChange(e.target.value)}
        />
      ) : (
        <div className="min-h-0 flex-1 overflow-auto p-3" onDoubleClick={() => setEdit(true)}>
          {value.trim() ? <MarkdownView text={value} /> : <p className="text-faint">{t('Sem documentação. Clique em Editar.')}</p>}
        </div>
      )}
    </div>
  )
}
