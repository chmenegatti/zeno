// Parâmetros de caminho (#149): `:id` (Postman) e `{id}` (OpenAPI/Bruno) no path da URL viram linhas
// editáveis na aba Params e são trocados pelo valor no envio. Port em wails/internal/vars/pathparams.go.

export interface PathParamMatch {
  name: string
  start: number
  end: number
}

// {{ variáveis }} e {% tags %} não contam: são mascaradas antes de procurar
const TEMPLATE_RE = /\{\{.*?\}\}|\{%.*?%\}/g
const SCHEME_AUTH_RE = /^[a-z][a-z0-9+.-]*:\/\/[^/?#]*/i
const PARAM_RE = /\/:([A-Za-z_]\w*)|\{([A-Za-z_]\w*)\}/g

/** parâmetros de caminho da URL (sem a parte de esquema/host, query e fragmento), na ordem */
export function pathParamMatches(url: string): PathParamMatch[] {
  const masked = url.replace(TEMPLATE_RE, (m) => '\u0001'.repeat(m.length))
  // começo do path: depois de esquema://host[:porta] ou de uma variável inicial ({{ base_url }})
  let from = 0
  const auth = SCHEME_AUTH_RE.exec(masked)
  if (auth) from = auth[0].length
  else while (masked[from] === '\u0001') from++
  // sem esquema e sem variável: "host:porta/caminho" — o path começa na primeira barra
  if (!auth && from === 0) {
    const slash = masked.indexOf('/')
    from = slash < 0 ? masked.length : slash
  }
  let to = masked.length
  for (const c of ['?', '#']) {
    const i = masked.indexOf(c, from)
    if (i >= 0 && i < to) to = i
  }
  const path = masked.slice(from, to)
  const out: PathParamMatch[] = []
  for (const m of path.matchAll(PARAM_RE)) {
    const name = m[1] ?? m[2]
    const start = from + m.index! + (m[1] ? 1 : 0)
    out.push({ name, start, end: from + m.index! + m[0].length })
  }
  return out
}

/** nomes únicos, na ordem em que aparecem */
export function pathParamNames(url: string): string[] {
  return [...new Set(pathParamMatches(url).map((m) => m.name))]
}

/** troca cada parâmetro pelo que `value` devolver; undefined deixa o trecho como está */
export function replacePathParams(url: string, value: (name: string) => string | undefined): string {
  let out = url
  for (const m of pathParamMatches(url).reverse()) {
    const v = value(m.name)
    if (v !== undefined) out = out.slice(0, m.start) + v + out.slice(m.end)
  }
  return out
}
