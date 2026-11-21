import { describe, expect, it } from 'vitest'
import { dropToken } from '../src/shared/vars'

describe('dropToken', () => {
  const url = '{{ base }}/users/{{ id }}'
  it('insere na posição', () => {
    expect(dropToken('https://x/users', 9, '{{ base }}')).toBe('https://x{{ base }}/users')
    expect(dropToken('', 0, '{{ a }}')).toBe('{{ a }}')
    expect(dropToken('abc', 99, '{{ a }}')).toBe('abc{{ a }}')
  })
  it('move pra frente e pra trás', () => {
    expect(dropToken(url, url.length, '{{ base }}', 0)).toBe('/users/{{ id }}{{ base }}')
    expect(dropToken(url, 10, '{{ id }}', 17)).toBe('{{ base }}{{ id }}/users/')
  })
  it('soltar em cima de si mesmo não muda', () => {
    expect(dropToken(url, 4, '{{ base }}', 0)).toBe(url)
  })
})
