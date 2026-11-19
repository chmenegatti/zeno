// Plugin de exemplo (formato do Insomnia). Copie esta pasta para <pasta de dados>/plugins/ e recarregue.
const crypto = require('crypto')
const { saudacao } = require('./lib/texto')

// {% minha_funcao 'Ana', true %} → "Olá, ANA!"; o segundo argumento escolhe maiúsculas
module.exports.templateTags = [
  {
    name: 'minha_funcao',
    displayName: 'Minha função',
    description: 'Saudação de exemplo (aceita {{ variáveis }} no nome)',
    args: [
      { displayName: 'Nome', type: 'string', defaultValue: 'mundo', placeholder: '{{ usuario }}' },
      { displayName: 'Maiúsculas', type: 'boolean', defaultValue: false }
    ],
    run(context, nome, maiusculas) {
      return saudacao(String(nome), maiusculas === true || maiusculas === 'true')
    }
  },
  {
    name: 'hmac_exemplo',
    displayName: 'HMAC-SHA256',
    description: 'Assinatura HMAC de um texto com uma chave',
    args: [
      { displayName: 'Chave', type: 'string', defaultValue: '' },
      { displayName: 'Texto', type: 'string', defaultValue: '' },
      { displayName: 'Saída', type: 'enum', defaultValue: 'hex', options: [{ displayName: 'hex', value: 'hex' }, { displayName: 'base64', value: 'base64' }] }
    ],
    run(context, chave, texto, saida) {
      return crypto.createHmac('sha256', String(chave)).update(String(texto)).digest(saida === 'base64' ? 'base64' : 'hex')
    }
  }
]

// todo request sai com este header (dá pra montar um tipo de auth próprio aqui)
module.exports.requestHooks = [
  (context) => {
    context.request.setHeader('X-Zeno-Plugin', 'exemplo')
  }
]

// item no menu de contexto do request
module.exports.requestActions = [
  {
    label: 'Copiar URL final',
    action(context, data) {
      context.app.clipboard.writeText(data.request.url)
      context.app.alert('URL copiada', data.request.url)
    }
  }
]

// importador: CSV "nome,metodo,url" com cabeçalho → export do Insomnia v4
module.exports.importers = [
  {
    name: 'CSV de requests',
    detect: (text) => /^nome,metodo,url\s*$/m.test(text.split('\n')[0]),
    convert(text) {
      const linhas = text.trim().split('\n').slice(1)
      const resources = [{ _id: 'wrk_csv', _type: 'workspace', name: 'Importado do CSV' }]
      linhas.forEach((l, i) => {
        const [name, method, url] = l.split(',').map((x) => x.trim())
        resources.push({ _id: `req_csv_${i}`, _type: 'request', parentId: 'wrk_csv', name, method, url, metaSortKey: i })
      })
      return { _type: 'export', __export_format: 4, resources }
    }
  }
]
