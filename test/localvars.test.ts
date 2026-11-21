import { describe, expect, it } from 'vitest'
import { buildVars } from '../src/shared/template'
import { varSources } from '../src/shared/vars'
import type { Folder, Workspace } from '../src/shared/types'

// valores locais (#153): vencem pasta, sub-ambiente e Base; os do sub-ambiente só com ele ativo
const ws = {
  id: 'w', name: 'W', settings: { insecureTLS: false, timeoutMs: 0 }, children: [],
  environments: [
    { kind: 'environment', id: 'base', name: 'Base', parentId: null, data: { url: 'https://shared', user: 'equipe', port: '80' }, sortKey: 0 },
    { kind: 'environment', id: 'dev', name: 'Dev', parentId: 'base', data: { user: 'dev' }, sortKey: 1 }
  ],
  localVars: { base: { port: '3000' }, dev: { user: 'eu' } }
} as unknown as Workspace
const folder = { kind: 'folder', id: 'f', name: 'F', vars: { user: 'pasta' } } as unknown as Folder

describe('valores locais', () => {
  it('vencem tudo e respeitam o ambiente ativo', () => {
    expect(buildVars(ws, 'dev', [folder])).toMatchObject({ url: 'https://shared', user: 'eu', port: '3000' })
    expect(buildVars(ws, null, [folder])).toMatchObject({ user: 'pasta', port: '3000' })
  })
  it('aparecem como origem local e listam o que sobrescrevem', () => {
    const s = varSources(ws, 'dev', [folder])
    expect(s.get('user')?.source).toMatchObject({ kind: 'local', envId: 'dev' })
    expect(s.get('user')?.shadowed.map((x) => x.kind)).toEqual(['env', 'env', 'folder'])
    expect(s.get('port')?.source).toMatchObject({ kind: 'local', envId: 'base' })
    expect(varSources(ws, null).get('user')?.source.kind).toBe('env')
  })
})
