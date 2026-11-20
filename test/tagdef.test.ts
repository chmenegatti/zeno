// Formato das template tags do Insomnia (shared/tagdef): ler, montar e voltar igual.
import { describe, expect, it } from 'vitest'

const b64 = (s: string) => 'b64::' + Buffer.from(s).toString('base64')

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
})
