import { useEffect, useMemo, useRef, useState } from 'react'
import { EditorView } from '@uiw/react-codemirror'
import { openSearchPanel } from '@codemirror/search'
import { buildTag } from '@shared/tagdef'
import { filterJson, formatPath, jsonPathAt } from '@shared/respfilter'
import type { ResponseRecord } from '@shared/types'
import { useStore } from '../state'
import { CodeEditor, langFor } from './CodeEditor'

export function contentType(r: ResponseRecord): string | undefined {
  return r.headers.find(([k]) => k.toLowerCase() === 'content-type')?.[1]
}

/** XPath 1.0 do navegador sobre o XML/HTML da resposta */
function filterXml(text: string, expr: string, html: boolean): { value: string; count: number } | { error: string } {
  const doc = new DOMParser().parseFromString(text, html ? 'text/html' : 'application/xml')
  if (!html && doc.querySelector('parsererror')) return { error: 'o body não é XML válido' }
  let r: XPathResult
  try {
    r = doc.evaluate(expr, doc, null, XPathResult.ANY_TYPE, null)
  } catch (e) {
    return { error: `XPath inválido: ${(e as Error).message.split('\n')[0]}` }
  }
  if (r.resultType === XPathResult.NUMBER_TYPE) return { value: String(r.numberValue), count: 1 }
  if (r.resultType === XPathResult.STRING_TYPE) return { value: r.stringValue, count: 1 }
  if (r.resultType === XPathResult.BOOLEAN_TYPE) return { value: String(r.booleanValue), count: 1 }
  const out: string[] = []
  const ser = new XMLSerializer()
  for (let n = r.iterateNext(); n; n = r.iterateNext()) out.push(n.nodeType === Node.ELEMENT_NODE ? ser.serializeToString(n) : (n.textContent ?? ''))
  return out.length ? { value: out.join('\n'), count: out.length } : { error: 'nada encontrado' }
}

interface PathMenu {
  x: number
  y: number
  path: string
}

/** body em texto: formatar, filtrar (JSONPath/XPath, salvo por request), buscar (Ctrl+F) e copiar caminho do JSON */
export function TextBody({ res, requestId, pretty }: { res: ResponseRecord; requestId: string; pretty: boolean }) {
  const saved = useStore((s) => s.app.responseFilter?.[requestId] ?? '')
  const [filter, setFilter] = useState(saved)
  const [menu, setMenu] = useState<PathMenu | null>(null)
  const view = useRef<EditorView | null>(null)
  const lang = langFor(contentType(res))
  const isJson = lang === 'json' || /^\s*[[{]/.test(res.body)
  const isHtml = /html/i.test(contentType(res) ?? '')

  useEffect(() => setFilter(saved), [requestId, saved])

  // salva o filtro por request (estado local, fora dos YAML)
  const save = (v: string): void => {
    setFilter(v)
    const app = useStore.getState().app
    const next = { ...(app.responseFilter ?? {}) }
    if (v.trim()) next[requestId] = v
    else delete next[requestId]
    useStore.getState().setApp({ responseFilter: Object.keys(next).length ? next : undefined })
  }

  const formatted = useMemo(() => {
    if (pretty && isJson) {
      try {
        return JSON.stringify(JSON.parse(res.body), null, 2)
      } catch {
        return res.body
      }
    }
    return res.body
  }, [res, pretty, isJson])

  const result = useMemo(() => {
    const f = filter.trim()
    if (!f) return null
    return isJson && !f.startsWith('/') ? filterJson(res.body, f) : filterXml(res.body, f, isHtml)
  }, [filter, res, isJson, isHtml])

  // filtro inválido mostra o erro e mantém o body
  const shown = result && 'value' in result ? result.value : formatted

  const isJsonRef = useRef(isJson)
  isJsonRef.current = isJson
  const filterRef = useRef(filter)
  filterRef.current = filter

  // clicar no nome de uma chave do JSON: copiar caminho / tag / filtrar
  const clickExt = useMemo(
    () => [
      EditorView.domEventHandlers({
        click: (e, v) => {
          if (!isJsonRef.current || filterRef.current.trim()) return false
          const pos = v.posAtCoords({ x: e.clientX, y: e.clientY })
          if (pos == null) return false
          const hit = jsonPathAt(v.state.doc.toString(), pos)
          if (!hit?.isKey) return false
          setMenu({ x: e.clientX, y: e.clientY + 8, path: formatPath(hit.path) })
          return false
        }
      })
    ],
    []
  )

  useEffect(() => {
    if (!menu) return
    const close = (): void => setMenu(null)
    window.addEventListener('mousedown', close)
    return () => window.removeEventListener('mousedown', close)
  }, [menu])

  const copy = (text: string, msg: string): void => {
    navigator.clipboard.writeText(text)
    useStore.getState().notify(msg)
    setMenu(null)
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1 overflow-auto">
        <CodeEditor value={shown} readOnly lang={result && 'value' in result && isJson ? 'json' : lang} onView={(v) => (view.current = v)} extra={clickExt} />
      </div>
      <div className="flex items-center gap-2 border-t border-line px-2 py-1.5">
        <input
          className={`field min-w-0 flex-1 py-0.5 font-mono text-[12px] ${result && 'error' in result ? 'border-tpink/60' : ''}`}
          placeholder={isJson ? 'Filtrar: $.items[*].id  ·  $..id' : 'Filtrar com XPath: //item/id'}
          value={filter}
          onChange={(e) => save(e.target.value)}
          onKeyDown={(e) => e.key === 'Escape' && save('')}
          spellCheck={false}
          title={isJson ? 'JSONPath (ou XPath começando com /, se o body for XML)' : 'XPath 1.0'}
        />
        {result && 'error' in result && <span className="shrink-0 text-[11.5px] text-tpink">{result.error}</span>}
        {result && 'count' in result && <span className="shrink-0 text-[11.5px] text-faint">{result.count} resultado{result.count > 1 ? 's' : ''}</span>}
        <button className="btn btn-ghost shrink-0 px-1.5 py-0.5 text-[11.5px]" title="Buscar no body (Ctrl+F com o foco na resposta)" onClick={() => view.current && openSearchPanel(view.current)}>
          buscar
        </button>
        <button className="btn btn-ghost shrink-0 px-1.5 py-0.5 text-[11.5px]" onClick={() => copy(shown, 'Body copiado')}>copiar</button>
      </div>
      {menu && (
        <div className="fixed z-40 min-w-[220px] rounded-lg border border-line bg-raised py-1 shadow-xl" style={{ left: menu.x, top: menu.y }} onMouseDown={(e) => e.stopPropagation()}>
          <div className="truncate px-3 py-1 font-mono text-[11px] text-faint">{menu.path}</div>
          <button className="block w-full px-3 py-1.5 text-left hover:bg-line" onClick={() => copy(menu.path, `Caminho copiado: ${menu.path}`)}>Copiar caminho</button>
          <button
            className="block w-full px-3 py-1.5 text-left hover:bg-line"
            onClick={() => copy(buildTag({ name: 'response', field: 'body', requestId, filter: menu.path, trigger: 'never' }), 'Tag {% response %} copiada: cole num campo ou no body')}
          >
            Copiar como tag {'{% response %}'}
          </button>
          <button className="block w-full px-3 py-1.5 text-left hover:bg-line" onClick={() => { save(menu.path); setMenu(null) }}>Filtrar por este caminho</button>
        </div>
      )}
    </div>
  )
}
