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

describe('tagdef (formato do Insomnia)', async () => {
  const { buildTag, decodeFilter, parseTag } = await import('../src/shared/tagdef')
  const insomnia = "{% response 'body', 'req_2633661cdf4d4bd08b058301d526d204', 'b64::JC5hY2Nlc3NfdG9rZW4=::46b', 'always', 60 %}"
  it('lê a tag exportada pelo Insomnia', () => {
    expect(parseTag(insomnia)).toEqual({ name: 'response', field: 'body', requestId: 'req_2633661cdf4d4bd08b058301d526d204', filter: '$.access_token', trigger: 'always', maxAge: 60 })
    expect(decodeFilter('$.x')).toBe('$.x')
    expect(decodeFilter(b64('$.ação'))).toBe('$.ação')
  })
  it('monta no mesmo formato e volta igual', () => {
    const t = parseTag(insomnia) as import('../src/shared/tagdef').ResponseTag
    expect(buildTag(t)).toBe("{% response 'body', 'req_2633661cdf4d4bd08b058301d526d204', 'b64::JC5hY2Nlc3NfdG9rZW4=::46b', 'always' %}")
    expect(parseTag(buildTag({ ...t, trigger: 'when-expired', maxAge: 30 }))).toMatchObject({ trigger: 'when-expired', maxAge: 30, filter: '$.access_token' })
    expect(parseTag(buildTag({ name: 'response', field: 'header', requestId: "r'1", filter: 'X-Sess', trigger: 'never' }))).toMatchObject({ requestId: "r'1", filter: 'X-Sess' })
    expect(buildTag(parseTag("{% uuid 'v4' %}"))).toBe("{% uuid 'v4' %}")
  })
  it('extract com JSONPath completo e body inteiro', () => {
    expect(extract(res('{"a":[{"id":1},{"id":2}]}'), 'body', '$.a[-1].id')).toBe('2')
    expect(extract(res('{"a":[{"id":1},{"id":2}]}'), 'body', '$..id')).toBe('[1,2]')
    expect(extract(res('{"a":1}'), 'raw', '')).toBe('{"a":1}')
  })
})
