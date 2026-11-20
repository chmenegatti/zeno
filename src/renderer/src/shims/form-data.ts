// O httpsnippet monta o corpo multipart com o pacote form-data do Node; o FormData nativo do navegador
// perde o filename e o Content-Type dos arquivos e põe um \r\n a mais. Esta é a parte do form-data
// 4.0.4, a versão que o httpsnippet traz, com a mesma saída: _boundary, append(nome, texto, { filename,
// contentType }) e pipe() síncrono. Ver hide-formdata.ts.
/// <reference path="./mime-db.d.ts" />
import db from 'mime-db'

const LINE_BREAK = '\r\n'

// extensão → tipo, com a mesma preferência de fontes do mime-types 2.1
const types: Record<string, string> = {}
const preference = ['nginx', 'apache', undefined, 'iana']
for (const [type, mime] of Object.entries(db)) {
  for (const ext of mime.extensions ?? []) {
    const cur = types[ext]
    if (cur) {
      const from = preference.indexOf(db[cur].source)
      const to = preference.indexOf(mime.source)
      if (cur !== 'application/octet-stream' && (from > to || (from === to && cur.startsWith('application/')))) continue
    }
    types[ext] = type
  }
}

/** path.posix.basename / extname (o Electron roda no Linux) */
const basename = (p: string): string => p.replace(/\/+$/, '').split('/').pop() ?? ''
function lookup(p: string): string | false {
  const base = basename('x.' + p)
  const i = base.lastIndexOf('.')
  const ext = i > 0 ? base.slice(i + 1).toLowerCase() : ''
  return (ext && types[ext]) || false
}

interface Options {
  filename?: string | null
  contentType?: string | null
}

export default class FormData {
  _boundary = ''
  private parts: string[] = []

  append(field: string, value: unknown, options: Options = {}): void {
    const filename = options.filename ? basename(options.filename) : ''
    const contentType = options.contentType || (options.filename ? lookup(options.filename) : false)
    let head = `--${this._boundary}${LINE_BREAK}Content-Disposition: form-data; name="${field}"`
    if (filename) head += `; filename="${filename}"`
    head += LINE_BREAK
    if (contentType) head += `Content-Type: ${contentType}${LINE_BREAK}`
    this.parts.push(head + LINE_BREAK + String(value ?? '') + LINE_BREAK)
  }

  /** o httpsnippet passa map() do event-stream: recebe o corpo inteiro de uma vez */
  pipe(dest: { write(data: string): void }): void {
    if (!this.parts.length) return
    dest.write(this.parts.join('') + `--${this._boundary}--${LINE_BREAK}`)
  }
}
