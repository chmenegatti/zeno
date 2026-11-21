import { describe, expect, it } from 'vitest'
import { kvToText, textToKv } from '../src/shared/bulkkv'

describe('edição em massa', () => {
  it('lê headers, params e linhas desligadas', () => {
    expect(textToKv('Authorization: Bearer {{ token }}\n// X-Debug: 1\n\nq=a:b\nReferer: http://x/?a=1\nsozinho\n{{ h }}: {{ v }}')).toEqual([
      { name: 'Authorization', value: 'Bearer {{ token }}', enabled: true },
      { name: 'X-Debug', value: '1', enabled: false },
      { name: 'q', value: 'a:b', enabled: true },
      { name: 'Referer', value: 'http://x/?a=1', enabled: true },
      { name: 'sozinho', value: '', enabled: true },
      { name: '{{ h }}', value: '{{ v }}', enabled: true }
    ])
  })
  it('ida e volta', () => {
    const rows = [
      { name: 'Accept', value: 'application/json', enabled: true },
      { name: 'X-Off', value: 'a=b', enabled: false }
    ]
    expect(kvToText(rows)).toBe('Accept: application/json\n//X-Off: a=b')
    expect(textToKv(kvToText(rows))).toEqual(rows)
  })
})
