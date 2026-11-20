import { describe, expect, it } from 'vitest'
import { isEventStream, isWsUrl, parseSSE } from '../src/shared/stream'

describe('stream', () => {
  it('parseSSE igual ao Go', () => {
    expect(parseSSE(': ping\n\nevent: oi\ndata: a\ndata: b\nid: 1\n\ndata: fim\n\n')).toEqual([
      { event: 'oi', data: 'a\nb', id: '1' },
      { event: 'message', data: 'fim', id: '1' }
    ])
    expect(parseSSE('data: sem fim')).toEqual([{ event: 'message', data: 'sem fim' }])
  })
  it('detecta ws e event-stream', () => {
    expect(isWsUrl(' wss://x/y')).toBe(true)
    expect(isWsUrl('https://x')).toBe(false)
    expect(isEventStream([['Content-Type', 'text/event-stream; charset=utf-8']])).toBe(true)
  })
})
