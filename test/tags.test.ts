import { describe, expect, it } from 'vitest'
import { extract, parseArgs, resolveTags } from '../src/main/tags'
import type { ResponseRecord } from '../src/shared/types'

const res = (body: string, at = Date.now()): ResponseRecord => ({
  id: 'r', requestId: 'req_tok', at, method: 'POST', url: 'http://x/login', status: 200, statusText: 'OK',
  headers: [['X-Session', 'abc']], body, bodyEncoding: 'utf8', size: body.length, timing: { headersMs: 1, totalMs: 1 }
})
const b64 = (s: string) => 'b64::' + Buffer.from(s).toString('base64')

describe('tags', () => {
  it('parseArgs', () => {
    expect(parseArgs("{% response 'body', 'req_tok', 'b64::JC50', 'always', 60 %}")).toEqual({ name: 'response', args: ['body', 'req_tok', 'b64::JC50', 'always', '60'] })
  })
  it('extract JSONPath, XML, header', () => {
    expect(extract(res('{"access_token":"T","a":[{"b":1}]}'), 'body', b64('$.access_token'))).toBe('T')
    expect(extract(res('{"a":[{"b":1}]}'), 'body', '$.a[0].b')).toBe('1')
    expect(extract(res('<response><result><key>K</key></result></response>'), 'body', b64('response/result/key'))).toBe('K')
    expect(extract(res(''), 'header', b64('x-session'))).toBe('abc')
  })
  it('when-expired reenvia só quando venceu', async () => {
    let sent = 0
    const ctx = (r?: ResponseRecord) => ({ latest: () => r, sendById: async () => (sent++, res('{"token":"novo"}')) })
    const tag = `{% response 'body', 'req_tok', '${b64('$.token')}', 'when-expired', 60 %}`
    expect((await resolveTags([tag], ctx(res('{"token":"velho"}')))).values.get(tag)).toBe('velho')
    expect(sent).toBe(0)
    expect((await resolveTags([tag], ctx(res('{"token":"velho"}', Date.now() - 120_000)))).values.get(tag)).toBe('novo')
    expect(sent).toBe(1)
  })
  it('never sem histórico vira erro', async () => {
    const r = await resolveTags(["{% response 'body', 'req_x', '', 'never' %}"], { latest: () => undefined, sendById: async () => res('') })
    expect(r.errors[0]).toContain('ainda não tem resposta')
  })
})
