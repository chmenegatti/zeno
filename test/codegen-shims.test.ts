import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'
import ShimFormData from '../src/renderer/src/shims/form-data'
import { map } from '../src/renderer/src/shims/event-stream'

// o form-data e o event-stream que o httpsnippet usa no Node (Electron)
const req = createRequire(createRequire(import.meta.url).resolve('httpsnippet'))
const NodeFormData = req('form-data/lib/form_data')
const es = req('event-stream')

type Part = [string, string, { filename: string | null; contentType: string | null }]

function body(F: new () => { _boundary: string; append(...a: unknown[]): void; pipe(d: unknown): void }, mapper: (fn: (d: string) => void) => unknown, parts: Part[]): string {
  const f = new F()
  f._boundary = '---011000010111000001101001'
  for (const p of parts) f.append(...p)
  let text = ''
  f.pipe(mapper((d) => void (text += d)))
  return text
}

describe('gerar código no renderer: form-data do navegador', () => {
  it('monta o multipart igual ao form-data do Node', async () => {
    const none = { filename: null, contentType: null }
    const cases: Part[][] = [
      [],
      [['a', 'x', none]],
      [['a"b', 'ção', none], ['arq', '', { filename: '/tmp/foto.PNG', contentType: null }]],
      [['k', '', { filename: 'C:\\d\\f.unknownext', contentType: null }], ['z', '', { filename: 'semext', contentType: null }]],
      [['j', '', { filename: 'x/dados.json', contentType: 'text/plain' }], ['m', '', { filename: 'a.mp4', contentType: null }]]
    ]
    for (const parts of cases) {
      const want = await new Promise<string>((resolve) => {
        const text = body(NodeFormData, es.map, parts)
        setTimeout(() => resolve(text + ''), 0)
      })
      expect(body(ShimFormData as never, map as never, parts)).toBe(want)
    }
  })
})
