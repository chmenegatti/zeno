import { useEffect, useMemo, useRef, useState } from 'react'
import { EditorView } from '@uiw/react-codemirror'
import { openSearchPanel } from '@codemirror/search'
import { buildTag } from '@shared/tagdef'
import { filterJson, formatPath, jsonPathAt } from '@shared/respfilter'
import type { ResponseRecord } from '@shared/types'
import { api, useStore } from '../state'
import { formatBytes, Segmented } from './ui'
import { CodeEditor, langFor } from './CodeEditor'

// linha gigante (ex.: prévia de 256 KB sem quebra): quebrar custa caro no navegador; rola na horizontal
const longLine = (s: string): boolean => s.length > 20000 && !/\n/.test(s.slice(0, 20000))

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
        <CodeEditor value={shown} readOnly wrap={!longLine(shown)} lang={result && 'value' in result && isJson ? 'json' : lang} onView={(v) => (view.current = v)} extra={clickExt} />
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

// ---------- visualizadores (#16) ----------

type Kind = 'image' | 'pdf' | 'html' | 'audio' | 'video' | 'text' | 'binary'

export function viewKind(r: ResponseRecord): Kind {
  const ct = (contentType(r) ?? '').toLowerCase()
  if (ct.startsWith('image/')) return 'image'
  if (ct.startsWith('application/pdf')) return 'pdf'
  if (ct.startsWith('audio/')) return 'audio'
  if (ct.startsWith('video/')) return 'video'
  if (ct.startsWith('text/html') || ct.startsWith('application/xhtml')) return 'html'
  return r.bodyEncoding === 'base64' ? 'binary' : 'text'
}

/** blob URL do body (revogado ao trocar/desmontar) */
function useBlobUrl(body: string | null, encoding: 'utf8' | 'base64', type: string): string | null {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    if (body === null) return setUrl(null)
    const bytes = encoding === 'base64' ? Uint8Array.from(atob(body), (c) => c.charCodeAt(0)) : new TextEncoder().encode(body)
    const u = URL.createObjectURL(new Blob([bytes], { type }))
    setUrl(u)
    return () => URL.revokeObjectURL(u)
  }, [body, encoding, type])
  return url
}

/** body da resposta conforme o tipo: visual (imagem, PDF, HTML, mídia) ou texto; grande carrega sob demanda */
export function ResponseView({ res, requestId, pretty }: { res: ResponseRecord; requestId: string; pretty: boolean }) {
  const kind = viewKind(res)
  const visualKinds: Kind[] = ['image', 'pdf', 'html', 'audio', 'video']
  const canVisual = visualKinds.includes(kind)
  const canText = res.bodyEncoding === 'utf8'
  const [mode, setMode] = useState<'visual' | 'text'>(canVisual ? 'visual' : 'text')
  const [full, setFull] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  useEffect(() => {
    setFull(null)
    setMode(canVisual ? 'visual' : 'text')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [res.id])

  const load = async (): Promise<void> => {
    setLoading(true)
    const b = await useStore.getState().run(api.responseBody(requestId, res.id))
    setLoading(false)
    if (b !== undefined) setFull(b)
  }
  const save = async (): Promise<void> => {
    const f = await useStore.getState().run(api.saveResponse(requestId, res.id))
    if (f) useStore.getState().notify(`Salvo em ${f}`)
  }
  // body disponível: o que veio no registro, ou o completo carregado sob demanda
  const body = res.bodyFile ? full : res.body
  const ct = (contentType(res) ?? '').split(';')[0] || 'application/octet-stream'
  const url = useBlobUrl(mode === 'visual' && canVisual ? body : null, res.bodyEncoding, ct)

  const bar = (
    <div className="flex items-center gap-2 border-b border-line/60 px-2 py-1 text-[11.5px]">
      {canVisual && canText ? (
        <Segmented value={mode} onChange={setMode} options={[{ id: 'visual', label: 'Visual' }, { id: 'text', label: 'Texto' }]} />
      ) : (
        <span className="px-1 text-faint">{ct}</span>
      )}
      <div className="flex-1" />
      {res.bodyFile && !full && <span className="text-torange">{formatBytes(res.size)}: {canText ? 'mostrando os primeiros 256 KB' : 'não carregado'}</span>}
      {res.bodyFile && !full && (
        <button className="btn btn-ghost px-1.5 py-0.5 text-[11.5px]" disabled={loading} onClick={load}>{loading ? 'carregando…' : 'carregar tudo'}</button>
      )}
      <button className="btn btn-ghost px-1.5 py-0.5 text-[11.5px]" title="Salvar o body num arquivo" onClick={save}>salvar em arquivo</button>
    </div>
  )

  if (mode === 'text' && canText) {
    const shown = full !== null ? { ...res, body: full, bodyFile: false } : res
    return (
      <div className="flex h-full min-h-0 flex-col">
        {bar}
        <div className="min-h-0 flex-1">
          <TextBody res={shown} requestId={requestId} pretty={pretty && !res.bodyFile} />
        </div>
      </div>
    )
  }

  let content: React.ReactNode
  if (!canVisual) content = <p className="p-4 text-faint">Binário de {formatBytes(res.size)} ({ct}). Use <b>salvar em arquivo</b>.</p>
  else if (!url) content = <p className="p-4 text-faint">{res.bodyFile ? `Resposta grande (${formatBytes(res.size)}): clique em carregar tudo pra visualizar.` : 'carregando…'}</p>
  else if (kind === 'image') content = <div className="flex h-full items-center justify-center overflow-auto bg-[repeating-conic-gradient(var(--color-line)_0_25%,transparent_0_50%)] bg-[length:16px_16px] p-3"><img src={url} alt="resposta" className="max-h-full max-w-full object-contain" /></div>
  else if (kind === 'pdf') content = <iframe title="PDF" src={url} className="h-full w-full border-0 bg-white" />
  else if (kind === 'audio') content = <div className="p-4"><audio controls src={url} className="w-full" /></div>
  else if (kind === 'video') content = <div className="flex h-full items-center justify-center p-3"><video controls src={url} className="max-h-full max-w-full" /></div>
  // HTML isolado: sem scripts, sem acesso ao app (sandbox vazio)
  else content = <iframe title="HTML" sandbox="" srcDoc={body ?? ''} className="h-full w-full border-0 bg-white" />

  return (
    <div className="flex h-full min-h-0 flex-col">
      {bar}
      <div className="min-h-0 flex-1 overflow-hidden">{content}</div>
    </div>
  )
}
