import { useEffect, useRef, useState } from 'react'
import { useStore } from './state'
import { Sidebar } from './components/Sidebar'
import { RequestPane } from './components/RequestPane'
import { ResponsePane } from './components/ResponsePane'
import { Modals } from './components/Modals'
import { PromptHost, TagEditHost } from './components/Tags'
import { VarPopover } from './components/Vars'
import { applyUi, installHotkeys } from './hotkeys'

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
  const prefs = useStore((s) => s.app.ui)
  const error = useStore((s) => s.error)
  const notice = useStore((s) => s.notice)
  const [width, setWidth] = useState(initialWidth)
  const [winWidth, setWinWidth] = useState(() => window.innerWidth)
  const dragging = useRef(false)

  useEffect(() => {
    useStore.getState().init()
    return installHotkeys()
  }, [])

  useEffect(() => {
    if (ready) applyUi(prefs)
  }, [ready, prefs])

  useEffect(() => {
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
    const onResize = () => setWinWidth(window.innerWidth)
    window.addEventListener('resize', onResize)
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    window.addEventListener('beforeunload', onUnload)
    return () => {
      window.removeEventListener('resize', onResize)
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      window.removeEventListener('beforeunload', onUnload)
    }
  }, [])

  if (!ready) return <div className="flex h-full items-center justify-center text-faint">carregando…</div>

  return (
    <div className="flex h-full">
      {!prefs?.sidebarHidden && <Sidebar />}
      <RequestPane />
      <div
        className="w-1 shrink-0 cursor-col-resize hover:bg-accent/40"
        onMouseDown={() => {
          dragging.current = true
          document.body.style.cursor = 'col-resize'
        }}
      />
      <ResponsePane width={Math.max(320, Math.min(width, winWidth - 640))} />
      <Modals />
      <TagEditHost />
      <PromptHost />
      <VarPopover />
      {notice && !error && (
        <div className="fixed bottom-4 left-1/2 z-50 max-w-[70vw] -translate-x-1/2 rounded-lg border border-accent/40 bg-raised px-4 py-2 text-accent shadow-xl" onClick={() => useStore.setState({ notice: null })}>
          {notice}
        </div>
      )}
      {error && (
        <div className="fixed bottom-4 left-1/2 z-50 max-w-[70vw] -translate-x-1/2 rounded-lg border border-tpink/40 bg-panel px-4 py-2 text-tpink shadow-xl" onClick={() => useStore.setState({ error: null })}>
          {error}
        </div>
      )}
    </div>
  )
}
