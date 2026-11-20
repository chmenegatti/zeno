// Gera in*.json e js*.yaml com a biblioteca `yaml` do Electron (fonte da verdade do formato).
// Rodar da raiz do repositório: node wails/internal/doc/testdata/gen.mjs
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import YAML from 'yaml'

const dir = path.dirname(fileURLToPath(import.meta.url))
const docs = [
  { id: 'req_1', name: 'Listar: itens', description: 'linha1\nlinha2', method: 'GET', url: '{{ host }}/p?a=1&b=' + 'x'.repeat(120) + ' fim com espaço no meio ' + 'y'.repeat(60), params: [{ name: 'q', value: "it's", enabled: true }, { name: 'vazio', value: '', enabled: false }], headers: [], body: { mime: 'application/json', text: '{\n  "nome": "Ana",\n  "tags": ["a", "b"]\n}' }, auth: { type: 'bearer', token: "{% response 'body', 'req_x', '$.t' %}" }, assertions: [{ enabled: true, source: 'status', op: 'lt', value: '300' }], sortKey: 1795127002350 },
  { id: 'env_dev', name: 'Desenvolvimento', parentId: 'env_base', color: '#00ffd4', data: { base_url: 'http://127.0.0.1:4597', versao: 'v1', limite: 20, ativo: true, nada: null, lista: [1, 'dois', { tres: 3 }], obj: {}, senha: '$zeno$v1$abc==', 'X-API-Key': 'k', 'com espaço': 'sim', num_texto: '123', bool_texto: 'true', data: '2026-11-19', hash: 'a #b', ponto: 1.5, neg: -2, emoji: 'olá ✓', tab: 'a\tb', trail: 'fim ', lead: ' começo', multi_trail: 'a\nb\n', colon: 'a: b', url_q: 'http://x?a=1#f', star: '*x', amp: '&x', bang: '!x', pct: '%x', at: '@x', back: '`x', quote: '"x"', sq: "'x'", dash: '- x', q: '?x', pipe: '|x', gt: '>x', brace: '{x}', brack: '[x]', comma: 'a, b', tilde: '~', yes: 'yes', no: 'no', on: 'on', octal: '0755', hex: '0x1F', exp: '1e3', inf: '.inf', empty: '' }, sortKey: 1 },
  { id: 'fld_1', name: 'Pasta', sortKey: 0.5, headers: [{ name: 'Accept', value: '*/*', enabled: true }], auth: { type: 'basic', username: 'ana', password: '{{ senha }}' }, vars: {}, scripts: { pre: "zeno.env.set('x', 1)\n" } },
]
docs.forEach((d, i) => {
  fs.writeFileSync(path.join(dir, `in${i}.json`), JSON.stringify(d))
  fs.writeFileSync(path.join(dir, `js${i}.yaml`), YAML.stringify(d, { lineWidth: 0 }))
})
