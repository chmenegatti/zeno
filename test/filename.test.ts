import { describe, expect, it } from 'vitest'
import { suggestFileName } from '../src/main/filename'

const h = (cd?: string, ct = 'application/pdf'): [string, string][] => [['content-type', ct], ...(cd ? [['content-disposition', cd] as [string, string]] : [])]

describe('nome sugerido pra salvar', () => {
  it('Content-Disposition, URL ou tipo', () => {
    expect(suggestFileName(h('attachment; filename="relatorio.pdf"'), 'http://x/a')).toBe('relatorio.pdf')
    expect(suggestFileName(h("attachment; filename*=UTF-8''relat%C3%B3rio%20final.pdf"), 'http://x/a')).toBe('relatório final.pdf')
    expect(suggestFileName(h(), 'http://x/files/nota.pdf')).toBe('nota.pdf')
    expect(suggestFileName(h(undefined, 'application/json'), 'http://x/api/users')).toBe('users.json')
    expect(suggestFileName(h(undefined, 'image/png'), 'http://x/')).toBe('resposta.png')
  })
  it('nunca leva pastas nem ..', () => {
    expect(suggestFileName(h('attachment; filename="../../../.bashrc"'), 'http://x/a')).toBe('.bashrc')
    expect(suggestFileName(h('attachment; filename="..\\\\..\\\\win.ini"'), 'http://x/a')).toBe('win.ini')
    expect(suggestFileName(h('attachment; filename=".."'), 'http://x/doc.pdf')).toBe('doc.pdf')
    expect(suggestFileName(h('attachment; filename="/etc/passwd"'), 'http://x/a')).toBe('passwd')
  })
})
