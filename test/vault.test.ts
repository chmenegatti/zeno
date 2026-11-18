import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { Vault, type KeyProtector } from '../src/main/vault'
import { getAt, scanSecrets, setAt } from '../src/shared/protect'
import { isEncrypted, maskSecrets } from '../src/shared/secret'
import type { Workspace } from '../src/shared/types'

const fake = (opts: { weak?: boolean; ok?: boolean } = {}): KeyProtector => ({
  available: async () => ({ ok: opts.ok ?? true, backend: opts.weak ? 'basic_text' : 'test', weak: !!opts.weak }),
  protect: async (t) => Buffer.from(`P:${t}`),
  unprotect: async (b) => {
    const s = b.toString()
    if (!s.startsWith('P:')) throw new Error('nope')
    return s.slice(2)
  }
})
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'zeno-vault-'))

describe('Vault', () => {
  it('cifra e decifra, sem texto puro no token', async () => {
    const v = new Vault(tmp(), fake())
    const tok = await v.encrypt('s3nh@-forte')
    expect(isEncrypted(tok)).toBe(true)
    expect(tok).not.toContain('s3nh')
    expect(await v.decrypt(tok)).toBe('s3nh@-forte')
    expect(await v.encrypt(tok)).toBe(tok)
  })
  it('chave persiste entre instâncias e fica protegida em disco', async () => {
    const dir = tmp()
    const tok = await new Vault(dir, fake()).encrypt('abc')
    expect(await new Vault(dir, fake()).decrypt(tok)).toBe('abc')
    expect(fs.readFileSync(path.join(dir, '.vault', 'key'), 'utf8').startsWith('P:')).toBe(true)
  })
  it('chave de outro computador é detectada', async () => {
    const tok = await new Vault(tmp(), fake()).encrypt('abc')
    const other = new Vault(tmp(), fake())
    await other.encrypt('x')
    await expect(other.decrypt(tok)).rejects.toThrow(/outra chave/)
  })
  it('adulteração é detectada', async () => {
    const v = new Vault(tmp(), fake())
    const tok = await v.encrypt('abc')
    const bad = tok.slice(0, -6) + (tok.endsWith('AAAA==') ? 'BBBB==' : 'AAAA==')
    await expect(v.decrypt(bad)).rejects.toThrow()
  })
  it('recusa chaveiro fraco', async () => {
    await expect(new Vault(tmp(), fake({ weak: true })).encrypt('x')).rejects.toThrow(/não protege/)
  })
  it('decryptDeep e maskSecrets', async () => {
    const v = new Vault(tmp(), fake())
    const tok = await v.encrypt('t0k')
    expect(await v.decryptDeep({ a: [tok, 1], b: { c: tok } })).toEqual({ a: ['t0k', 1], b: { c: 't0k' } })
    expect(maskSecrets(`Bearer ${tok}`)).toBe('Bearer ••••••')
  })
})

describe('scanSecrets', () => {
  const req = (id: string, extra: object) => ({ kind: 'request' as const, id, name: id.toUpperCase(), method: 'GET', url: '', params: [], headers: [], body: { mime: null }, sortKey: 0, auth: { type: 'none' as const }, ...extra })
  const ws: Workspace = {
    id: 'w', name: 'w', settings: { insecureTLS: false, timeoutMs: 0 },
    environments: [
      { id: 'b', name: 'Base', parentId: null, sortKey: 0, data: { password: 'pw-123456', token: '{{ a }}', host: 'h', api_key: '$zeno$v1$x', creds: { secret: 'nested-s3cret' } } },
      { id: 'd', name: 'Dev', parentId: 'b', sortKey: 0, data: { 'p-poc': 'pw-123456', user: 'admin' } }
    ],
    children: [
      req('r1', { auth: { type: 'basic', username: 'u', password: 'p' } }),
      req('r2', { auth: { type: 'bearer', token: '{{ t }}' }, headers: [{ name: 'Authorization', value: 'Bearer abc', enabled: true }, { name: 'Accept', value: 'x', enabled: true }] }),
      req('r3', { url: 'http://h/login?pw=pw-123456' })
    ]
  }
  it('acha segredos por nome, auth, header sensível, aninhados e valor repetido', () => {
    const r = scanSecrets(ws)
    expect(r.spots.map((s) => s.label)).toEqual([
      'Base · password',
      'Base · creds.secret',
      'R1 · auth basic',
      'R2 · header Authorization',
      'Dev · p-poc (mesmo valor de um segredo)'
    ])
    expect(r.spots[3].path).toEqual(['headers', 0, 'value'])
    expect(r.warnings).toEqual(['R3 · URL'])
  })
  it('setAt/getAt por caminho', () => {
    const o = { data: { a: { b: 1 } }, headers: [{ value: 'x' }] }
    setAt(o, ['headers', 0, 'value'], 'y')
    expect(getAt(o, ['headers', 0, 'value'])).toBe('y')
  })
})
