// Filtro e navegação no body da resposta: JSONPath sobre o texto e caminho do JSON na posição do cursor.

import { queryJson } from './assert'

/** resultado do filtro JSONPath, já formatado; erro não apaga o body (quem chama decide) */
export function filterJson(text: string, path: string): { value: string; count: number } | { error: string } {
  let doc: unknown
  try {
    doc = JSON.parse(text)
  } catch {
    return { error: 'o body não é JSON válido' }
  }
  try {
    const { values, many } = queryJson(doc, path.startsWith('$') ? path : `$.${path}`)
    if (!values.length) return { error: 'nada encontrado' }
    const out = many ? values : values[0]
    return { value: typeof out === 'string' ? out : JSON.stringify(out, null, 2), count: values.length }
  } catch (e) {
    return { error: (e as Error).message }
  }
}

/** ["data", 0, "user id"] → $.data[0]['user id'] */
export function formatPath(keys: (string | number)[]): string {
  return keys.reduce<string>((acc, k) => (typeof k === 'number' ? `${acc}[${k}]` : /^[A-Za-z_$][\w$]*$/.test(k) ? `${acc}.${k}` : `${acc}['${k.replace(/'/g, "\\'")}']`), '$')
}

/** caminho até o que está na posição `pos` do texto JSON; isKey = o cursor está no nome da chave */
export function jsonPathAt(text: string, pos: number): { path: (string | number)[]; isKey: boolean } | null {
  type Frame = { t: 'o'; key?: string; wantKey: boolean } | { t: 'a'; i: number }
  const st: Frame[] = []
  const cur = (): (string | number)[] => st.map((f) => (f.t === 'o' ? (f.key ?? '') : f.i))
  for (let i = 0; i < text.length; ) {
    const c = text[i]
    const top = st[st.length - 1]
    if (c === '"') {
      let j = i + 1
      while (j < text.length && text[j] !== '"') j += text[j] === '\\' ? 2 : 1
      const isKey = top?.t === 'o' && top.wantKey
      if (isKey) {
        try {
          top.key = JSON.parse(text.slice(i, j + 1))
        } catch {
          top.key = text.slice(i + 1, j)
        }
        top.wantKey = false
      }
      if (pos >= i && pos <= j) return { path: cur(), isKey }
      i = j + 1
      continue
    }
    if (c === '{') st.push({ t: 'o', wantKey: true })
    else if (c === '[') st.push({ t: 'a', i: 0 })
    else if (c === '}' || c === ']') st.pop()
    else if (c === ',') {
      if (top?.t === 'o') top.wantKey = true
      else if (top?.t === 'a') top.i++
    } else if (!/[\s:]/.test(c)) {
      // número, true, false, null
      const m = /^[^,\]}\s]+/.exec(text.slice(i))
      const end = i + (m ? m[0].length : 1)
      if (pos >= i && pos < end) return { path: cur(), isKey: false }
      i = end
      continue
    }
    i++
  }
  return null
}
