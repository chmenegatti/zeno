import { describe, expect, it } from 'vitest'
import { buildGql, operationNames, parseGql } from '../src/shared/graphql'

describe('body GraphQL', () => {
  it('lê o JSON do Insomnia', () => {
    const g = parseGql('{"query":"query A { a }","variables":{"id":1},"operationName":"A"}')
    expect(g).toEqual({ query: 'query A { a }', variables: '{\n  "id": 1\n}', operationName: 'A' })
  })
  it('ida e volta com variáveis incompletas ou com {{ }}', () => {
    for (const variables of ['{ "id": {{ id }} }', '{ "a":', '']) {
      const g = { query: 'query Q($id: ID) {\n  a(id: $id) { "x" }\n}', variables, operationName: 'Q' }
      expect(parseGql(buildGql(g))).toEqual(g)
    }
  })
  it('texto solto vira a consulta', () => {
    expect(parseGql('{ viewer { login } }')).toEqual({ query: '{ viewer { login } }', variables: '', operationName: '' })
  })
  it('JSON válido sai sem chaves vazias', () => {
    expect(JSON.parse(buildGql({ query: '{ a }', variables: '', operationName: '' }))).toEqual({ query: '{ a }' })
  })
  it('nomes das operações', () => {
    expect(operationNames('# query Nope\nquery A { a }\nmutation B($x: String = "query C") { b }\n{ c }')).toEqual(['A', 'B'])
  })
})
