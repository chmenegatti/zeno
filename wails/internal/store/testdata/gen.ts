// Gera testdata/electron/: pasta de dados escrita pelo Store do Electron (fonte da verdade do formato).
// Rodar da raiz do repositório: npx jiti wails/internal/store/testdata/gen.ts
import fs from 'node:fs'
import path from 'node:path'
import { Store } from '../../../../src/main/store'
import { convert, readNedbDir } from '../../../../src/main/import-insomnia'
import { findNode } from '../../../../src/shared/tree'
import type { RequestDoc } from '../../../../src/shared/types'

const out = path.join(__dirname, 'electron')
fs.rmSync(out, { recursive: true, force: true })
const store = new Store(out)
const { workspaces } = convert(readNedbDir(path.join(__dirname, '../../../../test/fixtures')))
for (const ws of workspaces) store.writeWorkspace(ws)
const [ws] = store.createWorkspace('Criado à mão')
const { id: fid } = store.createFolder(ws.id, 'Pasta: com dois-pontos')
const { id } = store.createRequest(fid, 'Request com tudo')
const req = findNode(store.load().find((w) => w.id === ws.id)!, id)!.node as RequestDoc
store.saveRequest({
  ...req,
  description: 'várias\nlinhas',
  url: '{{ base }}/v1/itens?ativo=true',
  params: [{ name: 'q', value: "it's", enabled: true }],
  headers: [{ name: 'X-Api-Key', value: "{{ _['X-API-Key'] }}", enabled: false }],
  body: { mime: 'application/json', text: '{\n  "nome": "Ana",\n  "preco": 10.5\n}' },
  auth: { type: 'bearer', token: "{% response 'body', 'req_x', '$.token', 'when-expired', 3600 %}" },
  scripts: { pre: "zeno.env.set('t', 1)\n" },
  assertions: [{ enabled: true, source: 'status', op: 'lt', value: '300' }, { enabled: true, source: 'json', path: '$.id', op: 'exists' }],
  sendCookies: false,
})
store.saveEnvironment(ws.id, { id: 'env_criado_dev', name: 'Dev', parentId: ws.environments[0].id, color: '#00ffd4', data: { base: 'http://127.0.0.1:4597', 'X-API-Key': 'k', limite: 20, ligado: true, lista: [1, 'dois'] }, sortKey: 1 })
fs.writeFileSync(path.join(out, 'state.json'), JSON.stringify({ activeEnv: { [ws.id]: 'env_criado_dev' }, activeWorkspaceId: ws.id }, null, 2))
fs.writeFileSync(path.join(__dirname, 'electron-load.json'), JSON.stringify(new Store(out).load().map((w) => ({ ...w, location: undefined }))))
console.log('ok', out)
