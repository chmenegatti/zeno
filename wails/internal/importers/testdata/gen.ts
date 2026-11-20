// Gera golden/*.json com os importadores do Electron (fonte da verdade da conversão).
// Rodar da raiz do repositório: npx jiti wails/internal/importers/testdata/gen.ts
import fs from 'node:fs'
import path from 'node:path'
import { parseSources, type Source } from '../../../../src/main/import-sources'
import { convert, readNedbDir } from '../../../../src/main/import-insomnia'

const dir = __dirname
const src = (name: string, url?: string): Source => ({ name, text: fs.readFileSync(path.join(dir, name), 'utf8'), url })
const out = (name: string, f: () => unknown): void => {
  let v: unknown
  try {
    v = f()
  } catch (e) {
    v = { error: (e as Error).message }
  }
  fs.writeFileSync(path.join(dir, 'golden', `${name}.json`), JSON.stringify(v, null, 2) + '\n')
}
out('openapi', () => parseSources([src('loja-openapi.yaml')]))
out('swagger', () => parseSources([src('loja-swagger.json')]))
out('postman', () => parseSources([src('loja.postman_collection.json'), src('producao.postman_environment.json')]))
out('postman-env-sozinho', () => parseSources([src('producao.postman_environment.json')]))
out('insomnia-v5', () => parseSources([src('loja.insomnia-v5.yaml')]))
out('relativo', () => parseSources([{ name: 'r', text: 'openapi: 3.0.0\ninfo: { title: R }\nservers: [{ url: /api/v3 }]\npaths: {}', url: 'https://x.test/docs/openapi.yaml' }]))
out('desconhecido', () => parseSources([{ name: 'x.json', text: '{"a":1}' }]))
out('invalido', () => parseSources([{ name: 'x.yaml', text: 'a: [' }]))
out('nedb', () => convert(readNedbDir(path.join(dir, 'nedb'))))
out('nedb-tls', () => convert(readNedbDir(path.join(dir, 'nedb')), { insecureTLS: true }))
out('v4', () => parseSources([{ name: 'v4.json', text: JSON.stringify({ _type: 'export', __export_format: 4, resources: [{ _id: 'wrk_a', _type: 'workspace', name: 'A' }, { _id: 'req_a', _type: 'request', parentId: 'wrk_a', name: 'R', method: 'post', url: 'http://x', body: { mimeType: 'multipart/form-data', params: [{ name: 'f', type: 'file', fileName: '/tmp/a' }, { name: 'n', value: 'v', disabled: true }] }, authentication: { type: 'apikey', key: 'k', value: 'v', addTo: 'cookie' }, settingSendCookies: false }] }) }]))
console.log('ok')
