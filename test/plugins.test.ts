import { createHmac } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { Plugins } from '../src/main/plugins'
import { parseSources } from '../src/main/import-sources'
import { resolveTags } from '../src/main/tags'

const EXAMPLE = path.join(__dirname, '..', 'examples', 'plugins', 'zeno-plugin-exemplo')

/** pasta de plugins temporária com o exemplo e os plugins dados (nome → index.js) */
function setup(extra: Record<string, string> = {}, off: string[] = []): Plugins {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zeno-plugins-'))
  fs.cpSync(EXAMPLE, path.join(dir, 'exemplo'), { recursive: true })
  for (const [name, code] of Object.entries(extra)) {
    fs.mkdirSync(path.join(dir, name))
    fs.writeFileSync(path.join(dir, name, 'package.json'), JSON.stringify({ name, main: 'index.js' }))
    fs.writeFileSync(path.join(dir, name, 'index.js'), code)
  }
  const p = new Plugins(dir, (id) => off.includes(id))
  p.load()
  return p
}
const vars = { usuario: 'ana' }
const render = (s: string): string => s.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, n) => String((vars as Record<string, unknown>)[n] ?? ''))

describe('plugins', () => {
  it('exemplo: {% minha_funcao %} com variável, require relativo e crypto', async () => {
    const p = setup()
    const [ex] = p.list()
    expect(ex).toMatchObject({ id: 'exemplo', displayName: 'Exemplo do Zeno', enabled: true, requestHooks: 1, requestActions: [{ label: 'Copiar URL final' }], importers: [{ name: 'CSV de requests' }] })
    expect(ex.templateTags.map((t) => t.name)).toEqual(['minha_funcao', 'hmac_exemplo'])
    expect(ex.templateTags[0].args[1]).toMatchObject({ displayName: 'Maiúsculas', type: 'boolean' })
    expect(await p.runTag('minha_funcao', ['{{ usuario }}', 'true'], { render, vars })).toBe('OLÁ, ANA!')
    expect(await p.runTag('hmac_exemplo', ['k', 'x', 'hex'], { render, vars })).toBe(createHmac('sha256', 'k').update('x').digest('hex'))
    // pelo resolvedor de tags (como no envio)
    const tag = "{% minha_funcao 'Bia', false %}"
    const r = await resolveTags([tag], { latest: () => undefined, sendById: async () => { throw new Error() }, plugin: (n, a) => (p.hasTag(n) ? p.runTag(n, a, { render, vars }) : undefined) })
    expect(r.values.get(tag)).toBe('Olá, Bia!')
  })

  it('requestHook, ação e importador', async () => {
    const p = setup()
    const { req } = await p.beforeSend({ method: 'GET', url: 'http://x', headers: [['Accept', '*/*']] }, vars)
    expect(req.headers).toContainEqual(['X-Zeno-Plugin', 'exemplo'])
    expect(await p.runAction('exemplo', 0, { name: 'r', method: 'GET', url: 'http://x/final', headers: [] })).toEqual({ messages: ['URL copiada: http://x/final'], clipboard: 'http://x/final' })
    const out = parseSources([{ name: 'r.csv', text: 'nome,metodo,url\nListar,GET,http://api/itens\nCriar,POST,http://api/itens' }], p.importers())
    expect(out.workspaces[0].name).toBe('Importado do CSV')
    expect(out.workspaces[0].children.map((c) => c.name)).toEqual(['Listar', 'Criar'])
  })

  it('plugin com erro não derruba e aparece desativado com o motivo', async () => {
    const p = setup({
      quebrado: 'module.exports = {',
      fs: "const fs = require('fs'); module.exports.templateTags = [{ name: 'x', run: () => 1 }]",
      laco: 'while (true) {}',
      vazio: 'module.exports = {}',
      lento: "module.exports.templateTags = [{ name: 'lento', run: () => { while (true) {} } }]"
    })
    const by = Object.fromEntries(p.list().map((x) => [x.id, x]))
    expect(by.quebrado).toMatchObject({ enabled: false, error: expect.any(String) })
    expect(by.fs.error).toContain('não é permitido')
    expect(by.laco.error).toMatch(/timed out|tempo/i)
    expect(by.vazio.error).toContain('não exporta nada')
    expect(by.exemplo.enabled).toBe(true)
    // função travada: estoura o tempo e vira erro, sem travar o resto
    await expect(p.runTag('lento', [], { render, vars })).rejects.toThrow(/plugin lento/)
  }, 20000)

  it('argumentos number/boolean chegam com o tipo declarado', async () => {
    const p = setup({
      tipos: "module.exports.templateTags = [{ name: 'soma', args: [{ type: 'number' }, { type: 'number' }, { type: 'boolean' }], run: (c, a, b, neg) => (neg ? -(a + b) : a + b) + ':' + typeof a + ':' + typeof neg }]"
    })
    expect(await p.runTag('soma', ['2', '3', 'false'], { render, vars })).toBe('5:number:boolean')
    expect(await p.runTag('soma', ['2', '3', 'true'], { render, vars })).toBe('-5:number:boolean')
  })

  it('desligado não roda', async () => {
    const p = setup({}, ['exemplo'])
    expect(p.list()[0].enabled).toBe(false)
    expect(p.hasTag('minha_funcao')).toBe(false)
    expect((await p.beforeSend({ method: 'GET', url: 'http://x', headers: [] }, {})).req.headers).toEqual([])
  })
})
