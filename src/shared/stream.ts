// WebSocket e SSE (#6): tipos dos eventos que chegam do Go e o parser do text/event-stream (pra mostrar
// como eventos o body guardado no histórico).

export interface SSEEvent {
  event: string
  data: string
  id?: string
  /** ms desde o início do envio */
  atMs: number
}

export interface WsEvent {
  reqId: string
  kind: 'open' | 'in' | 'out' | 'close' | 'error'
  data?: string
  binary?: boolean
  at: number
  code?: number
  reason?: string
  status?: number
  headers?: [string, string][]
}

export const isWsUrl = (url: string | undefined): boolean => /^wss?:\/\//i.test((url ?? '').trim())

export const isEventStream = (headers: [string, string][]): boolean =>
  headers.some(([k, v]) => k.toLowerCase() === 'content-type' && /^\s*text\/event-stream/i.test(v))

/** eventos completos de um text/event-stream (mesmas regras do Go/EventSource) */
export function parseSSE(text: string): Omit<SSEEvent, 'atMs'>[] {
  const out: Omit<SSEEvent, 'atMs'>[] = []
  let ev = '', id = '', data: string[] = [], has = false
  const dispatch = (): void => {
    if (has) out.push({ event: ev || 'message', data: data.join('\n'), ...(id ? { id } : {}) })
    ev = ''
    data = []
    has = false
  }
  for (const raw of text.split('\n')) {
    const l = raw.replace(/\r$/, '')
    if (l === '') {
      dispatch()
      continue
    }
    if (l.startsWith(':')) continue
    const i = l.indexOf(':')
    const field = i < 0 ? l : l.slice(0, i)
    const value = i < 0 ? '' : l.slice(i + 1).replace(/^ /, '')
    if (field === 'event') (ev = value), (has = true)
    else if (field === 'data') data.push(value), (has = true)
    else if (field === 'id') (id = value), (has = true)
  }
  dispatch()
  return out
}
