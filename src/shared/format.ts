// Formatar (beautify) JSON que pode ter {{ var }} e {% tag %} fora de string, como o Insomnia aceita.

const TAG = /\{\{[\s\S]*?\}\}|\{%[\s\S]*?%\}/y

/** troca as tags por marcadores (com aspas se estiverem fora de string), formata e devolve as tags */
export function beautifyJson(text: string, indent = 2): string {
  const saved: { raw: string; bare: boolean }[] = []
  // prefixo que não aparece no texto: o marcador nunca colide com conteúdo do usuário
  let pre = '__ZENO_TAG_'
  while (text.includes(pre)) pre += 'X'
  let out = ''
  let inStr = false
  for (let i = 0; i < text.length; ) {
    TAG.lastIndex = i
    const m = text[i] === '{' ? TAG.exec(text) : null
    if (m) {
      const mark = `${pre}${saved.length}__`
      saved.push({ raw: m[0], bare: !inStr })
      out += inStr ? mark : `"${mark}"`
      i += m[0].length
      continue
    }
    const c = text[i]
    if (inStr && c === '\\') {
      out += c + (text[i + 1] ?? '')
      i += 2
      continue
    }
    if (c === '"') inStr = !inStr
    out += c
    i++
  }
  const pretty = JSON.stringify(JSON.parse(out), null, indent)
  return pretty.replace(new RegExp(`"?${pre}(\\d+)__"?`, 'g'), (all, n) => {
    const t = saved[Number(n)]
    // só tira as aspas que nós mesmos pusemos
    return t.bare ? t.raw : all.replace(`${pre}${n}__`, () => t.raw)
  })
}
