import { describe, expect, it } from 'vitest'
import { runPhase, runScript, type PhaseState, type ScriptInput } from '../src/main/scripts'

const input = (over: Partial<ScriptInput> = {}): ScriptInput => {
  const base = { base_url: 'https://x.test' }
  return {
    phase: 'post',
    where: 'Login',
    env: { tenant: 'acme' },
    base,
    vars: {},
    request: { method: 'POST', url: '{{ base_url }}/login', headers: [], params: [], body: { mime: 'application/json', text: '{}' } },
    response: { code: 200, status: 'OK', headers: [['Content-Type', 'application/json'], ['X-Id', '7']], body: '{"token":"abc","user":{"id":1,"roles":["adm"]}}', time: 12 },
    ...over
  }
}

describe('API zeno / insomnia / pm', () => {
  it('pós-login guarda token no ambiente', async () => {
    const out = await runScript(`zeno.environment.set('token', zeno.response.json().token)`, input())
    expect(out.error).toBeUndefined()
    expect(out.env).toEqual({ tenant: 'acme', token: 'abc' })
  })

  it('testes e expect estilo chai', async () => {
    const out = await runScript(
      `
      insomnia.test('status 200', () => insomnia.expect(insomnia.response.code).to.equal(200))
      pm.test('corpo', () => {
        const b = pm.response.json()
        pm.expect(b).to.have.property('token').that.is.a('string')
        pm.expect(b.user).to.deep.equal({ id: 1, roles: ['adm'] })
        pm.expect(b.user.roles).to.include('adm').and.have.lengthOf(1)
        pm.expect(b.token).to.not.be.empty
        pm.response.to.have.status(200)
        pm.response.to.be.ok
        pm.response.to.have.header('X-Id', '7')
      })
      zeno.test('falha', () => zeno.expect(zeno.response.code, 'código').to.be.below(100))
      zeno.test('async', async () => { await null; zeno.expect(1).to.eql(1) })
      `,
      input()
    )
    expect(out.error).toBeUndefined()
    expect(out.tests.map((t) => [t.name, t.ok])).toEqual([['status 200', true], ['corpo', true], ['falha', false], ['async', true]])
    expect(out.tests[2].error).toBe('código: esperado 200 menor que 100')
  })

  it('pré-request mexe no request e em variáveis; console.log vira log', async () => {
    const out = await runScript(
      `
      zeno.request.headers.add({ key: 'X-Trace', value: 't1' })
      zeno.request.addHeader('X-B: 2')
      zeno.request.url = zeno.request.url + '?v=1'
      zeno.request.body.raw = JSON.stringify({ a: zeno.variables.get('tenant') })
      zeno.variables.set('local', 42)
      console.log('url', zeno.request.url, { ok: true })
      `,
      input({ phase: 'pre', response: undefined })
    )
    expect(out.error).toBeUndefined()
    expect(out.request.headers.map((h) => [h.name, h.value])).toEqual([['X-Trace', 't1'], ['X-B', '2']])
    expect(out.request.url).toBe('{{ base_url }}/login?v=1')
    expect(out.request.body.text).toBe('{"a":"acme"}')
    expect(out.vars).toEqual({ local: 42 })
    expect(out.logs).toEqual(['url {{ base_url }}/login?v=1 {"ok":true}'])
  })

  it('padrões da documentação do Insomnia: url como objeto, query, btoa', async () => {
    const out = await runScript(
      `
      insomnia.request.url.addQueryParams('page=2&q=a')
      insomnia.request.addHeader({ key: 'Authorization', value: 'Basic ' + btoa('ana:s3nha') })
      const host = insomnia.request.url.getHost()
      insomnia.environment.set('url', insomnia.request.url.toString() + '#' + host)
      insomnia.environment.set('volta', atob(btoa('olá')))
      `,
      input({ phase: 'pre', response: undefined, request: { ...input().request, url: 'https://api.test/login' } })
    )
    expect(out.error).toBeUndefined()
    expect(out.request.params.map((p) => [p.name, p.value])).toEqual([['page', '2'], ['q', 'a']])
    expect(out.request.headers[0].value).toBe(`Basic ${Buffer.from('ana:s3nha').toString('base64')}`)
    expect(out.env.url).toBe('https://api.test/login#api.test')
    expect(out.env.volta).toBe('olá')
  })

  it('ambiente ativo = Base quando não há sub-ambiente', async () => {
    const i = input()
    i.env = i.base
    const out = await runScript(`zeno.environment.set('a', 1); zeno.baseEnvironment.set('b', 2)`, i)
    expect(out.base).toEqual({ base_url: 'https://x.test', a: 1, b: 2 })
    expect(out.env).toEqual(out.base)
  })
})

describe('erros e isolamento', () => {
  it('erro de script volta como mensagem, sem lançar', async () => {
    expect((await runScript(`zeno.response.json().nao.existe`, input())).error).toMatch(/TypeError: Cannot read properties of undefined/)
    expect((await runScript(`const x = {`, input())).error).toMatch(/sintaxe/)
    expect((await runScript(`throw new Error('falhou aqui')`, input())).error).toBe('falhou aqui')
  })

  it('laço infinito para no timeout (inclusive depois de await)', async () => {
    expect((await runScript(`while (true) {}`, input(), 200)).error).toMatch(/passou de 0.2 s/)
    expect((await runScript(`await null; while (true) {}`, input(), 200)).error).toMatch(/passou de 0.2 s/)
  })

  it('sem require, process, fs, timers, eval nem fuga pelo construtor', async () => {
    const probe = async (code: string) => (await runScript(code, input())).error
    expect(await probe(`require('fs')`)).toMatch(/require is not defined/)
    expect(await probe(`zeno.require('fs')`)).toMatch(/require não é suportado/)
    expect(await probe(`process.exit(1)`)).toMatch(/process is not defined/)
    expect(await probe(`setTimeout(() => {}, 1)`)).toMatch(/setTimeout is not defined/)
    expect(await probe(`eval('1+1')`)).toMatch(/Code generation from strings disallowed/)
    expect(await probe(`this.constructor.constructor('return process')()`)).toMatch(/Cannot read properties of undefined|disallowed/)
    expect(await probe(`({}).constructor.constructor('return process')()`)).toMatch(/disallowed/)
    expect(await probe(`zeno.environment.get.constructor('return process')()`)).toMatch(/disallowed/)
    expect(await probe(`await import('fs')`)).toBeTruthy()
  })

  it('await em algo que nunca resolve', async () => {
    expect((await runScript(`await new Promise(() => {})`, input())).error).toMatch(/não terminou/)
  })
})

describe('runPhase', () => {
  const state = (): PhaseState => {
    const base = { base_url: 'https://x.test' }
    return { base, env: base, envIsBase: true, vars: {}, request: input().request, response: input().response }
  }

  it('encadeia pasta -> request e para no primeiro erro', async () => {
    const report = { logs: [] as string[], tests: [], errors: [] as string[] }
    const r = await runPhase(
      'post',
      [
        { where: 'pasta API', code: `zeno.environment.set('n', 1); console.log('pasta')` },
        { where: 'Login', code: `zeno.environment.set('n', zeno.environment.get('n') + 1); throw new Error('x')` },
        { where: 'nunca', code: `zeno.environment.set('n', 99)` }
      ],
      state(),
      report
    )
    expect(r.failed).toBe(true)
    expect(r.state.base.n).toBe(2)
    expect(r.state.env).toEqual(r.state.base)
    expect(report.errors).toEqual(['pós-resposta (Login): x'])
    expect(report.logs).toEqual(['[pasta API] pasta'])
  })
})
