// Opções de envio (Ctrl+Shift+Enter): enviar depois de N segundos ou repetir a cada N segundos.

import { useStore } from './state'

const handles = new Map<string, ReturnType<typeof setTimeout>>()

function setTimer(id: string, t: { mode: 'delay' | 'repeat'; seconds: number } | null): void {
  useStore.setState((s) => {
    const next = { ...s.sendTimers }
    if (t) next[id] = t
    else delete next[id]
    return { sendTimers: next }
  })
}

export function stopSend(id: string): void {
  const h = handles.get(id)
  if (h) {
    clearTimeout(h)
    clearInterval(h)
  }
  handles.delete(id)
  setTimer(id, null)
}

export function scheduleSend(id: string, mode: 'delay' | 'repeat', seconds: number): void {
  stopSend(id)
  const ms = Math.max(1, seconds) * 1000
  const send = (): Promise<void> => useStore.getState().sendActive(id)
  if (mode === 'delay')
    handles.set(id, setTimeout(() => {
      handles.delete(id)
      setTimer(id, null)
      send()
    }, ms))
  else {
    send()
    handles.set(id, setInterval(send, ms))
  }
  setTimer(id, { mode, seconds })
}

/** pede os segundos e agenda */
export function askSchedule(id: string, mode: 'delay' | 'repeat'): void {
  useStore.getState().openModal({
    kind: 'prompt',
    title: mode === 'delay' ? 'Enviar depois de quantos segundos?' : 'Repetir a cada quantos segundos?',
    value: mode === 'delay' ? '5' : '10',
    onOk: (v) => {
      const n = Number(v.replace(',', '.'))
      if (Number.isFinite(n) && n > 0) scheduleSend(id, mode, n)
      else useStore.getState().showError('Informe um número de segundos maior que zero')
    }
  })
}
