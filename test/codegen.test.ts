import { describe, expect, it } from 'vitest'
import { codeTargets, snippet, toHar } from '../src/main/codegen'
import type { SendInput } from '../src/shared/types'

const base = (body: SendInput['body'], headers: [string, string][] = []): SendInput => ({ requestId: 'r', method: 'POST', url: 'https://api.exemplo.com/v1/itens?ativo=true', headers: [['Authorization', 'Bearer tk'], ...headers], body, insecureTLS: false, timeoutMs: 0 })

describe('gerar código (httpsnippet)', () => {
  const json = base({ kind: 'text', text: '{"nome":"Ana"}' }, [['Content-Type', 'application/json']])
  it('HAR a partir do envio', () => {
    expect(toHar(json).postData).toEqual({ mimeType: 'application/json', text: '{"nome":"Ana"}' })
    expect(toHar(base({ kind: 'form', fields: [['a', '1']] })).postData).toEqual({ mimeType: 'application/x-www-form-urlencoded', params: [{ name: 'a', value: '1' }], text: 'a=1' })
    expect(toHar(base({ kind: 'multipart', fields: [{ name: 'f', value: '', file: '/tmp/x/foto.png' }, { name: 'n', value: 'v' }] })).postData?.params).toEqual([{ name: 'f', fileName: '/tmp/x/foto.png' }, { name: 'n', value: 'v' }])
  })
  it('curl e python no formato esperado', () => {
    expect(snippet('shell', 'curl', json)).toContain("curl --request POST \\\n  --url 'https://api.exemplo.com/v1/itens?ativo=true'")
    expect(snippet('python', 'requests', json)).toMatch(/requests\.post\(url, json=payload, headers=headers(, params=querystring)?\)/)
  })
  it('indenta com 2 espaços (Go mantém tab)', () => {
    expect(snippet('python', 'requests', json)).toMatch(/\n  "Authorization": "Bearer tk"/)
    expect(snippet('java', 'okhttp', json)).toMatch(/\n  \.url\(/)
    expect(snippet('go', 'native', json)).toContain('\n\treq, _ :=')
  })
  it('todas as linguagens e bibliotecas geram código (JSON, form, multipart, GET)', () => {
    const inputs = [json, base({ kind: 'form', fields: [['a', '1']] }), base({ kind: 'multipart', fields: [{ name: 'n', value: 'v' }] }), { ...json, method: 'GET', body: { kind: 'none' as const } }]
    const targets = codeTargets()
    expect(targets.length).toBeGreaterThanOrEqual(20)
    for (const t of targets) for (const c of t.clients) for (const i of inputs) expect(snippet(t.key, c.key, i).length, `${t.key}/${c.key}`).toBeGreaterThan(10)
  })
})
