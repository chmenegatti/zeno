import { describe, expect, it } from 'vitest'
import { generate, isCurl, parseCurl, shellSplit, toCurl } from '../src/shared/curl'
import { prepare } from '../src/shared/prepare'
import type { RequestDoc, SendInput, Workspace } from '../src/shared/types'

const ws = (insecureTLS = false): Workspace => ({ id: 'w', name: 'W', settings: { insecureTLS, timeoutMs: 0 }, environments: [], children: [] })

/** request do Zeno a partir do curl, como a colagem na URL faz */
function fromCurl(cmd: string): { req: RequestDoc; insecure: boolean } {
  const p = parseCurl(cmd)
  return { req: { kind: 'request', id: 'r', name: p.name, method: p.method, url: p.url, params: p.params, headers: p.headers, body: p.body, auth: p.auth, sortKey: 0 }, insecure: p.insecure }
}

const send = (cmd: string): SendInput => {
  const { req, insecure } = fromCurl(cmd)
  return prepare(ws(insecure), req, [], null).input
}

describe('shellSplit', () => {
  it('aspas, $\'…\', escapes e quebras de linha', () => {
    expect(shellSplit(`curl 'a b' "c \\"d\\"" $'e\\nf\\'g' h\\ i \\\n  -k`)).toEqual(['curl', 'a b', 'c "d"', "e\nf'g", 'h i', '-k'])
    expect(shellSplit('curl ^\n -X POST')).toEqual(['curl', '-X', 'POST'])
  })
})

describe('parseCurl', () => {
  it('critério: POST com header e body JSON', () => {
    const p = parseCurl(`curl -X POST https://x -H 'A: b' -d '{"a":1}'`)
    expect(p.method).toBe('POST')
    expect(p.url).toBe('https://x')
    expect(p.headers).toEqual([{ name: 'A', value: 'b', enabled: true }])
    expect(p.body).toEqual({ mime: 'application/json', text: '{"a":1}' })
  })

  it('--data-raw, -u, -k, --compressed e query na URL', () => {
    const p = parseCurl(`curl --compressed -k -u ana:s3:nha 'https://api.test/itens?page=2&q=a%20b' --data-raw 'x y' -H 'Content-Type: text/plain'`)
    expect(p.insecure).toBe(true)
    expect(p.auth).toEqual({ type: 'basic', username: 'ana', password: 's3:nha' })
    expect(p.params).toEqual([{ name: 'page', value: '2', enabled: true }, { name: 'q', value: 'a b', enabled: true }])
    expect(p.url).toBe('https://api.test/itens')
    expect(p.body).toEqual({ mime: 'text/plain', text: 'x y' })
    expect(p.headers).toEqual([])
    expect(p.warnings).toEqual([])
  })

  it('--data-urlencode e -d sem Content-Type viram form', () => {
    const p = parseCurl(`curl https://x --data-urlencode 'msg=olá & tchau' -d a=1`)
    expect(p.method).toBe('POST')
    expect(p.body).toEqual({ mime: 'application/x-www-form-urlencoded', fields: [{ name: 'msg', value: 'olá & tchau', enabled: true }, { name: 'a', value: '1', enabled: true }] })
  })

  it('-F com campo e arquivo; -G manda dados na query', () => {
    const p = parseCurl(`curl -F nome=Ana -F 'foto=@/tmp/a b.png;type=image/png' https://x/up`)
    expect(p.body).toEqual({
      mime: 'multipart/form-data',
      fields: [{ name: 'nome', value: 'Ana', enabled: true }, { name: 'foto', value: '', enabled: true, file: '/tmp/a b.png' }]
    })
    const g = parseCurl(`curl -G https://x/busca --data-urlencode 'q=a b'`)
    expect(g.method).toBe('GET')
    expect(g.params).toEqual([{ name: 'q', value: 'a b', enabled: true }])
    expect(g.body.mime).toBeNull()
  })

  it('flags juntas, -XPATCH, Bearer, Copy as cURL do navegador', () => {
    const p = parseCurl(`curl -sSLk -XPATCH "https://x/1" -H "Authorization: Bearer abc" -H 'content-type: application/json' --data-raw $'{"a":"l\\u00e1"}'`)
    expect(p.method).toBe('PATCH')
    expect(p.insecure).toBe(true)
    expect(p.auth).toEqual({ type: 'bearer', token: 'abc' })
    expect(p.body).toEqual({ mime: 'application/json', text: '{"a":"lá"}' })
    expect(p.name).toBe('PATCH /1')
  })

  it('variáveis do Zeno sobrevivem', () => {
    const p = parseCurl(`curl '{{ base_url }}/itens' -H 'X-Tenant: {{ tenant }}'`)
    expect(p.url).toBe('{{ base_url }}/itens')
    expect(p.headers[0].value).toBe('{{ tenant }}')
    // sem ambiente (gerar código mantendo variáveis): não vira http://{{ base_url }}
    expect(toCurl(send(`curl '{{ base_url }}/itens'`))).toBe(`curl '{{ base_url }}/itens'`)
  })

  it('erros e avisos', () => {
    expect(() => parseCurl('wget x')).toThrow()
    expect(() => parseCurl('curl -k')).toThrow(/URL/)
    expect(parseCurl('curl -d @body.json https://x').warnings[0]).toMatch(/arquivo/)
    expect(isCurl('  curl https://x')).toBe(true)
    expect(isCurl('https://curl.se')).toBe(false)
  })
})

describe('ida e volta: request -> curl -> request', () => {
  const cases = [
    `curl -X POST https://x -H 'A: b' -d '{"a":1}'`,
    `curl -k -u 'ana:s 3' 'https://api.test/itens?page=2&q=a%20b'`,
    `curl https://x --data-urlencode 'msg=olá & tchau' -d a=1 -X PUT`,
    `curl -F nome=Ana -F 'foto=@/tmp/a.png' -F '@literal=<x' https://x/up`,
    `curl --head https://x -H 'Authorization: Bearer t0k'`,
    `curl -X DELETE https://x/1 -H "X-Aspas: it's \\"ok\\""`,
    `curl https://x -H 'Content-Type: application/xml' --data-binary $'<a>\\n  <b/>\\n</a>'`
  ]
  for (const cmd of cases) {
    it(cmd, () => {
      const first = send(cmd)
      const again = send(toCurl(first))
      expect(again).toEqual(first)
    })
  }
})

describe('generate', () => {
  const input = send(`curl -k -X POST 'https://x/a?b=1' -H 'A: b' -d '{"a":1}'`)
  it('Go, JavaScript e Python', () => {
    const go = generate('go', input)
    expect(go).toContain('http.NewRequest("POST", "https://x/a?b=1", body)')
    expect(go).toContain('InsecureSkipVerify: true')
    expect(go).toContain('`{"a":1}`')
    const fetch = generate('javascript', input)
    expect(fetch).toContain('await fetch("https://x/a?b=1"')
    expect(fetch).toContain('"Content-Type": "application/json"')
    const py = generate('python', input)
    expect(py).toContain('requests.request(\n    "POST",')
    expect(py).toContain('verify=False')
  })
  it('multipart em Go usa o boundary do writer', () => {
    const go = generate('go', send(`curl -F a=1 -F f=@/tmp/x.txt https://x`))
    expect(go).toContain('w.CreateFormFile("f", filepath.Base(f.Name()))')
    expect(go).toContain('w.FormDataContentType()')
  })
})
