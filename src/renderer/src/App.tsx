import { useEffect, useRef, useState } from 'react'
import { activeWorkspace, createRequestIn, useStore } from './state'
import { Sidebar } from './components/Sidebar'
import { RequestPane } from './components/RequestPane'
import { ResponsePane } from './components/ResponsePane'
import { Modals } from './components/Modals'
import { TagEditHost } from './components/Tags'
import { VarPopover } from './components/Vars'
import { findNode } from '@shared/tree'

const WIDTH_KEY = 'zeno:response-width'

function initialWidth(): number {
  try {
    return Number(localStorage.getItem(WIDTH_KEY)) || 560
  } catch {
    return 560
  }
}

export function App() {
  const ready = useStore((s) => s.ready)
  const error = useStore((s) => s.error)
  const notice = useStore((s) => s.notice)
  const [width, setWidth] = useState(initialWidth)
  const dragging = useRef(false)

  useEffect(() => {
    useStore.getState().init()
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey
      if (!mod) return
      const s = useStore.getState()
      if (e.key === 'Enter') {
        e.preventDefault()
        s.sendActive()
      } else if (e.key.toLowerCase() === 'n' && !s.modal) {
        e.preventDefault()
        const ws = activeWorkspace(s)
        if (!ws) return
        // cria na pasta do request atual
        const cur = s.app.activeRequestId ? findNode(ws, s.app.activeRequestId) : null
        createRequestIn(cur?.ancestors.at(-1)?.id ?? ws.id)
      } else if (e.key === 's') {
        e.preventDefault()
        s.flushSaves()
      }
    }
    const onMove = (e: MouseEvent) => {
      if (!dragging.current) return
      setWidth(Math.min(Math.max(window.innerWidth - e.clientX, 320), window.innerWidth - 640))
    }
    const onUp = () => {
      if (!dragging.current) return
      dragging.current = false
      document.body.style.cursor = ''
      setWidth((w) => {
        try {
          localStorage.setItem(WIDTH_KEY, String(w))
        } catch {
          /* sem storage */
        }
        return w
      })
    }
    const onUnload = () => {
      useStore.getState().flushSaves()
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    window.addEventListener('beforeunload', onUnload)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      window.removeEventListener('beforeunload', onUnload)
    }
  }, [])

  if (!ready) return <div className="flex h-full items-center justify-center text-faint">carregando…</div>

  return (
    <div className="flex h-full">
      <Sidebar />
      <RequestPane />
      <div
        className="w-1 shrink-0 cursor-col-resize hover:bg-accent/40"
        onMouseDown={() => {
          dragging.current = true
          document.body.style.cursor = 'col-resize'
        }}
      />
      <ResponsePane width={width} />
      <Modals />
      <TagEditHost />
      <VarPopover />
      {notice && !error && (
        <div className="fixed bottom-4 left-1/2 z-50 max-w-[70vw] -translate-x-1/2 rounded-lg border border-accent/40 bg-raised px-4 py-2 text-accent shadow-xl" onClick={() => useStore.setState({ notice: null })}>
          {notice}
        </div>
      )}
      {error && (
        <div className="fixed bottom-4 left-1/2 z-50 max-w-[70vw] -translate-x-1/2 rounded-lg border border-tpink/40 bg-[#2a0a20] px-4 py-2 text-tpink shadow-xl" onClick={() => useStore.setState({ error: null })}>
          {error}
        </div>
      )}
    </div>
  )
}
