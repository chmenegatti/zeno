# Plugins

O Zeno carrega plugins no **formato do Insomnia**: `templateTags`, `requestHooks`, `responseHooks` e `requestActions`. Além disso, aceita `importers` para trazer formatos que o Zeno não conhece. Plugins do Insomnia que só usam esses pontos e os módulos liberados (lista abaixo) funcionam sem mudança.

## Onde ficam

Cada plugin é uma pasta dentro de `plugins/`, na pasta de dados (`~/.local/share/zeno/plugins/` por padrão):

```
plugins/
  meu-plugin/
    package.json
    index.js
    lib/…        (opcional: arquivos do próprio plugin)
```

Em **Preferências › Plugins…** (ou `Ctrl+P` › *Plugins*) você abre a pasta, recarrega, liga e desliga cada plugin. O que fica desligado vale também para o `zeno run`.

`package.json`:

```json
{
  "name": "meu-plugin",
  "version": "1.0.0",
  "main": "index.js",
  "insomnia": { "displayName": "Meu plugin", "description": "O que ele faz" }
}
```

O bloco `insomnia` (ou `zeno`) é opcional; sem ele, o nome vem de `name`.

## Exemplo completo

Há um plugin de exemplo em [`examples/plugins/zeno-plugin-exemplo`](../examples/plugins/zeno-plugin-exemplo). Para testar, copie a pasta para `plugins/` e clique em **Recarregar**. Ele adiciona:

- `{% minha_funcao 'Ana', true %}` → `OLÁ, ANA!`
- `{% hmac_exemplo 'chave', '{{ corpo }}', 'hex' %}`
- o header `X-Zeno-Plugin: exemplo` em todo envio
- a ação **Copiar URL final** no menu do request
- um importador de CSV (`nome,metodo,url`)

## Funções de template (`templateTags`)

```js
module.exports.templateTags = [
  {
    name: 'minha_funcao',            // vira {% minha_funcao … %}
    displayName: 'Minha função',     // rótulo do badge e do autocomplete
    description: 'Saudação',
    args: [
      { displayName: 'Nome', type: 'string', defaultValue: 'mundo', placeholder: '{{ usuario }}' },
      { displayName: 'Maiúsculas', type: 'boolean', defaultValue: false },
      { displayName: 'Formato', type: 'enum', defaultValue: 'a', options: [{ displayName: 'A', value: 'a' }, { displayName: 'B', value: 'b' }] }
    ],
    async run(context, nome, maiusculas, formato) {
      // context.util.render('{{ outra }}') resolve variáveis; context.context tem as variáveis do ambiente
      return `Olá, ${nome}!`
    }
  }
]
```

- Os argumentos chegam já com as `{{ variáveis }}` resolvidas.
- A tag aparece como badge, entra no autocomplete (`Ctrl+Espaço`) e ganha um formulário com os `args` declarados, com prévia do valor.
- O retorno vira texto (objetos viram JSON).

## Antes do envio (`requestHooks`)

Servem para auth própria, assinatura e headers automáticos:

```js
module.exports.requestHooks = [
  async (context) => {
    const r = context.request
    const token = r.getEnvironmentVariable('token')
    r.setHeader('Authorization', `Bearer ${token}`)
  }
]
```

API de `context.request`: `getMethod`/`setMethod`, `getUrl`/`setUrl`, `getHeader`, `hasHeader`, `getHeaders`, `setHeader`, `addHeader`, `removeHeader`, `getBody`/`setBody` (body em texto), `getEnvironmentVariable`, `getEnvironment`.

O resultado aparece na **Linha do tempo** da resposta, que mostra o request exatamente como saiu.

## Depois da resposta (`responseHooks`)

```js
module.exports.responseHooks = [
  (context) => {
    if (context.response.getStatusCode() >= 500) console.log('erro no servidor')
  }
]
```

`context.response`: `getStatusCode`, `getHeader`, `getHeaders`, `getBody` (Buffer).

## Ações no menu do request (`requestActions`)

```js
module.exports.requestActions = [
  {
    label: 'Copiar URL final',
    action(context, data) {
      // data.request: { name, method, url, headers, body } com variáveis resolvidas
      context.app.clipboard.writeText(data.request.url)
      context.app.alert('URL copiada', data.request.url)
    }
  }
]
```

## Importadores (`importers`)

Extensão do Zeno: reconhece um texto e devolve um **export do Insomnia v4**, que passa pelo mesmo import de sempre (com prévia).

```js
module.exports.importers = [
  {
    name: 'CSV de requests',
    detect: (text) => text.startsWith('nome,metodo,url'),
    convert(text) {
      return { _type: 'export', __export_format: 4, resources: [/* workspace, request_group, request, environment */] }
    }
  }
]
```

## Isolamento e limites

- **Contexto próprio:** cada plugin roda num contexto `vm` separado do app.
- **`require` limitado:** liberado só para `crypto`, `url`, `buffer`, `util`, `querystring`, `string_decoder`, `punycode`, `events`, `assert`, `zlib` e arquivos dentro da própria pasta do plugin (`require('./lib/x')`).
- **Versão Go (em migração, #53):** os plugins rodam num interpretador JavaScript próprio (goja), não no Node. Funcionam `crypto` (`createHash`, `createHmac`, `randomBytes`, `randomUUID`, `timingSafeEqual`), `url`, `buffer`, `util`, `querystring`, `events` e `assert`, além de `setTimeout`, promises, `Buffer`, `URL`, `TextEncoder`/`TextDecoder`, `atob`/`btoa` e `structuredClone`. Ainda não há `string_decoder`, `punycode` e `zlib`: o plugin que pedir um deles mostra a mensagem na tela de plugins.
- **Sem acesso direto:** `fs`, rede, processos e `node_modules` de fora não estão disponíveis.
- **Tempo:**
  - carregar: até 2 s;
  - cada chamada: até 5 s;
  - laço infinito estoura o tempo e vira erro.
- **Plugin com erro:** sintaxe inválida, módulo proibido, nada exportado ou tempo esgotado. O plugin fica **desativado**, o motivo aparece na tela de plugins e o resto do app segue normal.
- **Limite do tempo máximo:** ele vale para a parte síncrona de cada chamada. Se um plugin `async` entrar num laço infinito *depois* de um `await`, o app trava até ser fechado. É um bug do plugin e não dá para interromper de fora sem rodar plugins num processo separado (fica para uma próxima versão).
- **Erro durante o envio:** um erro num hook vira aviso no envio, sem impedir o request.

> Isso evita acidentes, mas **não é uma sandbox de segurança**. Um plugin é código rodando no seu computador: instale só plugins em que você confia.
