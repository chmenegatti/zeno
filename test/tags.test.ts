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

describe('funções de template', async () => {
  const { evalFn, resolveTags, PromptCancelled } = await import('../src/main/tags')
  const { buildTag, fnArgs, findRequestRef, parseTag } = await import('../src/shared/tagdef')
  const { fake, FAKER } = await import('../src/shared/faker')
  const fs = await import('node:fs')
  const os = await import('node:os')
  const path = await import('node:path')
  const vars: Record<string, string> = { user: 'ana', pass: 's3nha', perfil: '{"id":7,"tags":["a","b"]}' }
  const render = (t: string): string => t.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, n) => vars[n] ?? '')

  it('timestamp', async () => {
    expect(Number(await evalFn('timestamp', ['millis']))).toBeGreaterThan(1.7e12)
    expect(String(await evalFn('timestamp', ['unix']))).toMatch(/^\d{10}$/)
    expect(await evalFn('timestamp', ['iso'])).toMatch(/^\d{4}-\d\d-\d\dT/)
  })
  it('hash: formas longa e curta, com variável', async () => {
    expect(await evalFn('hash', ['sha256', 'hex', 'abc'])).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
    expect(await evalFn('hash', ['md5', 'abc'])).toBe('900150983cd24fb0d6963f7d28e17f72')
    expect(await evalFn('hash', ['sha1', 'base64', '{{ user }}'], { render })).toBe(Buffer.from(require('node:crypto').createHash('sha1').update('ana').digest()).toString('base64'))
    await expect(evalFn('hash', ['crc32', 'hex', 'x'])).rejects.toThrow('não suportado')
  })
  it('base64 encode/decode, normal e url', async () => {
    expect(await evalFn('base64', ['encode', 'normal', '{{ user }}:{{ pass }}'], { render })).toBe('YW5hOnMzbmhh')
    expect(await evalFn('base64', ['decode', 'YW5hOnMzbmhh'])).toBe('ana:s3nha')
    expect(await evalFn('base64', ['encode', 'url', '??>>'])).toBe('Pz8-Pg')
    expect(await evalFn('base64', ['decode', 'url', 'Pz8-Pg'])).toBe('??>>')
  })
  it('file e jsonpath', async () => {
    const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'zeno-tag-')), 'k.txt')
    fs.writeFileSync(f, 'conteúdo')
    expect(await evalFn('file', [f])).toBe('conteúdo')
    await expect(evalFn('file', [''])).rejects.toThrow('caminho')
    expect(await evalFn('jsonpath', ['{{ perfil }}', '$.id'], { render })).toBe('7')
    expect(await evalFn('jsonpath', ['{{ perfil }}', '$.tags'], { render })).toBe('["a","b"]')
    await expect(evalFn('jsonpath', ['não é json', '$.a'])).rejects.toThrow('JSON')
  })
  it('faker: nomes do Insomnia, CPF válido, nome desconhecido', async () => {
    expect(await evalFn('faker', ['randomEmail'])).toMatch(/^[\w.]+@[\w.]+$/)
    expect(fake('$randomUUID')).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
    const cpf = fake('randomCPF').replace(/\D/g, '').split('').map(Number)
    const dv = (n: number): number => { const s = cpf.slice(0, n).reduce((a, d, i) => a + d * (n + 1 - i), 0) % 11; return s < 2 ? 0 : 11 - s }
    expect([cpf[9], cpf[10]]).toEqual([dv(9), dv(10)])
    for (const k of Object.keys(FAKER)) expect(fake(k).length).toBeGreaterThan(0)
    await expect(evalFn('faker', ['naoExiste'])).rejects.toThrow('não existe')
  })
  it('prompt: pergunta uma vez por tag; cancelar para o envio', async () => {
    let n = 0
    const tag = "{% prompt 'Código', 'do app', '', 'otp', true %}"
    const r = await resolveTags([tag, tag], { latest: () => undefined, sendById: async () => res(''), prompt: async (p) => (n++, expect(p).toMatchObject({ title: 'Código', label: 'do app', key: 'otp', mask: true }), '123456') })
    expect(r.values.get(tag)).toBe('123456')
    expect(n).toBe(1)
    await expect(resolveTags([tag], { latest: () => undefined, sendById: async () => res(''), prompt: async () => null })).rejects.toBeInstanceOf(PromptCancelled)
    const sem = await resolveTags([tag], { latest: () => undefined, sendById: async () => res('') })
    expect(sem.errors[0]).toContain('pergunta na hora de enviar')
  })
  it('parse/build ida e volta', () => {
    for (const raw of ["{% hash 'sha256', 'hex', 'a\\'b' %}", "{% base64 'decode', 'url', 'x' %}", "{% faker 'randomEmail' %}", "{% timestamp 'unix' %}", "{% file '~/k.pem' %}", "{% jsonpath '{{ x }}', '$.a' %}", "{% prompt 'T', 'L', 'd', 'k', true %}"])
      expect(buildTag(parseTag(raw))).toBe(raw)
    expect(parseTag("{% hash 'md5', 'x' %}")).toEqual({ name: 'fn', tag: 'hash', args: ['md5', 'hex', 'x'] })
    expect(fnArgs('timestamp', [])).toEqual(['millis'])
  })
  it('response por nome ou caminho', async () => {
    type N = { kind: string; id: string; name: string; children?: N[] }
    const tree: N[] = [
      { kind: 'folder', id: 'f1', name: 'Auth', children: [{ kind: 'request', id: 'req_1', name: 'Login' }] },
      { kind: 'folder', id: 'f2', name: 'Admin', children: [{ kind: 'request', id: 'req_2', name: 'Login' }, { kind: 'request', id: 'req_3', name: 'Usuários' }] }
    ]
    expect(findRequestRef(tree, 'req_3')?.id).toBe('req_3')
    expect(findRequestRef(tree, 'Usuários')?.id).toBe('req_3')
    expect(findRequestRef(tree, 'auth/login')?.id).toBe('req_1')
    expect(findRequestRef(tree, 'Admin / Login')?.id).toBe('req_2')
    expect(findRequestRef(tree, 'Login')).toBeNull() // ambíguo
    let asked = ''
    const tag = "{% response 'body', 'Auth / Login', '$.t', 'never' %}"
    const r = await resolveTags([tag], { latest: (id) => ((asked = id), res('{"t":"ok"}')), sendById: async () => res(''), resolveRequest: (ref) => findRequestRef(tree, ref)?.id })
    expect([asked, r.values.get(tag)]).toEqual(['req_1', 'ok'])
  })
})
