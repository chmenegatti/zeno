// cURL <-> request, e geração de código (Go, JavaScript, Python). Puro: roda no main e no renderer.

import type { Auth, Body, BodyField, KV, SendInput } from './types'

// ---------- tokenizador estilo shell ----------

/** separa argumentos como o shell: aspas simples, duplas, $'…', barra invertida e quebra de linha com \ ou ^ */
export function shellSplit(cmd: string): string[] {
  const out: string[] = []
  let cur = ''
  let has = false
  let i = 0
  const s = cmd.replace(/\\\r?\n/g, ' ').replace(/\^\r?\n/g, ' ')
  while (i < s.length) {
    const c = s[i]
    if (/\s/.test(c)) {
      if (has) out.push(cur)
      cur = ''
      has = false
      i++
    } else if (c === "'") {
      const end = s.indexOf("'", i + 1)
      cur += s.slice(i + 1, end < 0 ? s.length : end)
      has = true
      i = end < 0 ? s.length : end + 1
    } else if (c === '$' && s[i + 1] === "'") {
      // ANSI-C ($'…'), usado pelo "Copy as cURL" dos navegadores
      i += 2
      while (i < s.length && s[i] !== "'") {
        if (s[i] === '\\' && i + 1 < s.length) {
          const n = s[i + 1]
          const map: Record<string, string> = { n: '\n', t: '\t', r: '\r', '\\': '\\', "'": "'", '"': '"', '0': '\0' }
          if (n === 'x') {
            cur += String.fromCharCode(parseInt(s.slice(i + 2, i + 4), 16))
            i += 4
          } else if (n === 'u') {
            cur += String.fromCharCode(parseInt(s.slice(i + 2, i + 6), 16))
            i += 6
          } else {
            cur += map[n] ?? n
            i += 2
          }
        } else cur += s[i++]
      }
      has = true
      i++
    } else if (c === '"') {
      i++
      while (i < s.length && s[i] !== '"') {
        if (s[i] === '\\' && /["\\$`]/.test(s[i + 1] ?? '')) i++
        cur += s[i++]
      }
      has = true
      i++
    } else if (c === '\\' && i + 1 < s.length) {
      cur += s[i + 1]
      has = true
      i += 2
    } else {
      cur += c
      has = true
      i++
    }
  }
  if (has) out.push(cur)
  return out
}

// ---------- cURL -> request ----------

export interface ParsedCurl {
  method: string
  url: string
  params: KV[]
  headers: KV[]
  body: Body
  auth: Auth
  /** -k / --insecure */
  insecure: boolean
  /** nome sugerido: "POST /users" */
  name: string
  /** o que não deu pra converter */
  warnings: string[]
}

export function isCurl(text: string): boolean {
  return /^\s*curl(\.exe)?\s/i.test(text)
}

/** flags que levam valor mas não mudam o request */
const IGNORED_WITH_VALUE = new Set([
  '-o', '--output', '-m', '--max-time', '--connect-timeout', '-w', '--write-out', '--retry', '--retry-delay', '--retry-max-time',
  '-x', '--proxy', '--cacert', '--capath', '-E', '--cert', '--key', '--cert-type', '--key-type', '-c', '--cookie-jar',
  '--max-redirs', '-r', '--range', '--resolve', '--interface', '-y', '--speed-time', '-Y', '--speed-limit', '--limit-rate',
  '--tls-max', '--ciphers', '--pass', '--trace', '--trace-ascii', '--stderr', '-K', '--config', '--unix-socket', '--dns-servers'
])

const kv = (name: string, value: string): KV => ({ name, value, enabled: true })

function formDecode(s: string): string {
  try {
    return decodeURIComponent(s.replace(/\+/g, ' '))
  } catch {
    return s
  }
}

function splitPairs(s: string): KV[] {
  return s
    .split('&')
    .filter(Boolean)
    .map((p) => {
      const i = p.indexOf('=')
      return i < 0 ? kv(formDecode(p), '') : kv(formDecode(p.slice(0, i)), formDecode(p.slice(i + 1)))
    })
}

export function parseCurl(cmd: string): ParsedCurl {
  const args = shellSplit(cmd.trim())
  if (!args.length || !/^curl(\.exe)?$/i.test(args[0])) throw new Error('não é um comando curl')
  let method = ''
  let url = ''
  const headers: KV[] = []
  const data: string[] = []
  const form: BodyField[] = []
  const warnings: string[] = []
  let auth: Auth = { type: 'inherit' }
  let insecure = false
  let get = false
  let head = false

  for (let i = 1; i < args.length; i++) {
    let a = args[i]
    let val: string | undefined
    // --flag=valor
    const eq = /^(--[a-z-]+)=(.*)$/s.exec(a)
    if (eq) {
      a = eq[1]
      val = eq[2]
    } else if (/^-[A-Za-z]./.test(a) && !a.startsWith('--')) {
      // -XPOST, -HFoo:bar, ou flags juntas (-sSLk)
      const f = a.slice(0, 2)
      if ('XHdFuAebo'.includes(a[1])) {
        a = f
        val = args[i].slice(2)
      } else {
        for (const ch of a.slice(1)) {
          if (ch === 'k') insecure = true
          if (ch === 'G') get = true
          if (ch === 'I') head = true
        }
        continue
      }
    }
    const next = (): string => val ?? args[++i] ?? ''
    switch (a) {
      case '-X':
      case '--request':
        method = next().toUpperCase()
        break
      case '--url':
        url = next()
        break
      case '-H':
      case '--header': {
        const h = next()
        const c = h.indexOf(':')
        if (c > 0) headers.push(kv(h.slice(0, c).trim(), h.slice(c + 1).trim()))
        break
      }
      case '-A':
      case '--user-agent':
        headers.push(kv('User-Agent', next()))
        break
      case '-e':
      case '--referer':
        headers.push(kv('Referer', next()))
        break
      case '-b':
      case '--cookie': {
        const c = next()
        if (c.includes('=')) headers.push(kv('Cookie', c))
        else warnings.push(`arquivo de cookies ignorado: ${c}`)
        break
      }
      case '-d':
      case '--data':
      case '--data-ascii':
      case '--data-binary': {
        const d = next()
        if (d.startsWith('@')) warnings.push(`body lido de arquivo não foi importado: ${d}`)
        // -d remove quebras de linha, como o curl faz; --data-binary não
        else data.push(a === '--data-binary' ? d : d.replace(/\r?\n/g, ''))
        break
      }
      case '--data-raw':
        data.push(next())
        break
      case '--json':
        data.push(next())
        if (!headers.some((h) => /^content-type$/i.test(h.name))) headers.push(kv('Content-Type', 'application/json'))
        if (!headers.some((h) => /^accept$/i.test(h.name))) headers.push(kv('Accept', 'application/json'))
        break
      case '--data-urlencode': {
        const d = next()
        const m = /^([^=@]*)([=@])(.*)$/s.exec(d)
        if (!m) data.push(encodeURIComponent(d))
        else if (m[2] === '@') warnings.push(`--data-urlencode com arquivo não foi importado: ${d}`)
        else data.push(m[1] ? `${m[1]}=${encodeURIComponent(m[3])}` : encodeURIComponent(m[3]))
        break
      }
      case '-F':
      case '--form':
      case '--form-string': {
        const f = next()
        const c = f.indexOf('=')
        if (c < 0) break
        const name = f.slice(0, c)
        const value = f.slice(c + 1)
        if (a !== '--form-string' && (value.startsWith('@') || value.startsWith('<'))) {
          form.push({ name, value: '', enabled: true, file: value.slice(1).replace(/;(type|filename|headers)=.*$/, '') })
        } else form.push({ name, value: a === '--form-string' ? value : value.replace(/;type=[^;]*$/, ''), enabled: true })
        break
      }
      case '-u':
      case '--user': {
        const u = next()
        const c = u.indexOf(':')
        auth = { type: 'basic', username: c < 0 ? u : u.slice(0, c), password: c < 0 ? '' : u.slice(c + 1) }
        break
      }
      case '-k':
      case '--insecure':
        insecure = true
        break
      case '-G':
      case '--get':
        get = true
        break
      case '-I':
      case '--head':
        head = true
        break
      case '--compressed':
      case '-L':
      case '--location':
      case '-s':
      case '--silent':
      case '-S':
      case '--show-error':
      case '-v':
      case '--verbose':
      case '-i':
      case '--include':
      case '-f':
      case '--fail':
      case '--http1.1':
      case '--http2':
      case '--globoff':
      case '-g':
      case '--no-buffer':
      case '-N':
        break // o Zeno já descomprime, segue redirect e mostra tudo
      default:
        if (IGNORED_WITH_VALUE.has(a)) {
          next()
          warnings.push(`opção ignorada: ${a}`)
        } else if (a.startsWith('-')) warnings.push(`opção desconhecida: ${a}`)
        else if (!url) url = a
    }
  }
  if (!url) throw new Error('o comando curl não tem URL')

  // query da URL vira params
  const params: KV[] = []
  const q = url.indexOf('?')
  if (q >= 0) {
    params.push(...splitPairs(url.slice(q + 1).replace(/#.*$/, '')))
    url = url.slice(0, q)
  }

  let body: Body = { mime: null }
  const joined = data.join('&')
  if (get && data.length) params.push(...splitPairs(joined))
  else if (form.length) body = { mime: 'multipart/form-data', fields: form }
  else if (data.length) {
    const ct = headers.find((h) => /^content-type$/i.test(h.name))?.value.split(';')[0].trim().toLowerCase()
    const looksJson = /^\s*[[{]/.test(joined)
    const mime = ct || (looksJson ? 'application/json' : 'application/x-www-form-urlencoded')
    body = mime === 'application/x-www-form-urlencoded' ? { mime, fields: splitPairs(joined) } : { mime, text: joined }
  }

  // Content-Type igual ao tipo do body é redundante (o Zeno põe sozinho); no multipart, atrapalha o boundary
  const finalHeaders = headers.filter((h) => {
    if (!/^content-type$/i.test(h.name) || !body.mime) return true
    const v = h.value.trim().toLowerCase()
    return !(v === body.mime || body.mime === 'multipart/form-data')
  })
  // Authorization: Bearer vira auth bearer
  const bearer = finalHeaders.findIndex((h) => /^authorization$/i.test(h.name) && /^bearer\s+/i.test(h.value))
  if (bearer >= 0 && auth.type === 'inherit') {
    auth = { type: 'bearer', token: finalHeaders[bearer].value.replace(/^bearer\s+/i, '') }
    finalHeaders.splice(bearer, 1)
  }

  const finalMethod = method || (head ? 'HEAD' : body.mime ? 'POST' : 'GET')
  let path = url
  try {
    path = new URL(/^[a-z]+:\/\//i.test(url) ? url : `http://${url}`).pathname
  } catch {
    /* URL com variáveis */
  }
  return { method: finalMethod, url, params, headers: finalHeaders, body, auth, insecure, name: `${finalMethod} ${path}`, warnings }
}

// ---------- request pronto -> código ----------

export type CodeLang = 'curl' | 'go' | 'javascript' | 'python'

export const CODE_LANGS: { id: CodeLang; label: string }[] = [
  { id: 'curl', label: 'cURL' },
  { id: 'go', label: 'Go' },
  { id: 'javascript', label: 'JavaScript' },
  { id: 'python', label: 'Python' }
]

export function generate(lang: CodeLang, input: SendInput): string {
  switch (lang) {
    case 'curl':
      return toCurl(input)
    case 'go':
      return toGo(input)
    case 'javascript':
      return toFetch(input)
    case 'python':
      return toPython(input)
  }
}

/** aspas simples de shell */
export function shq(s: string): string {
  return /^[\w@%+=:,./-]+$/.test(s) ? s : `'${s.replace(/'/g, `'\\''`)}'`
}

function basicUser(value: string): string | null {
  const m = /^basic\s+(\S+)$/i.exec(value)
  if (!m) return null
  try {
    const bin = atob(m[1])
    const text = new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)))
    return text.includes(':') ? text : null
  } catch {
    return null
  }
}

export function toCurl(input: SendInput): string {
  const parts: string[] = [`curl ${shq(input.url)}`]
  const b = input.body
  const hasBody = b.kind !== 'none'
  if (input.method === 'HEAD') parts.push('--head')
  else if (!(input.method === 'GET' && !hasBody) && !(input.method === 'POST' && hasBody)) parts.push(`-X ${input.method}`)
  for (const [k, v] of input.headers) {
    const user = /^authorization$/i.test(k) ? basicUser(v) : null
    if (user) parts.push(`-u ${shq(user)}`)
    else parts.push(`-H ${shq(`${k}: ${v}`)}`)
  }
  if (b.kind === 'text') parts.push(`--data-raw ${shq(b.text)}`)
  if (b.kind === 'form') for (const [k, v] of b.fields) parts.push(`--data-urlencode ${shq(`${k}=${v}`)}`)
  if (b.kind === 'multipart')
    for (const f of b.fields) {
      if (f.file) parts.push(`-F ${shq(`${f.name}=@${f.file}`)}`)
      else parts.push(`${/^[@<]/.test(f.value) ? '--form-string' : '-F'} ${shq(`${f.name}=${f.value}`)}`)
    }
  if (input.insecureTLS) parts.push('-k')
  return parts.join(' \\\n  ')
}

const js = (s: string): string => JSON.stringify(s)

function toFetch(input: SendInput): string {
  const b = input.body
  const lines: string[] = []
  const headers = input.headers.filter(([k]) => !(b.kind === 'multipart' && /^content-type$/i.test(k)))
  if (b.kind === 'multipart') {
    if (b.fields.some((f) => f.file)) lines.push(`import { openAsBlob } from 'node:fs'`, '')
    lines.push('const body = new FormData()')
    for (const f of b.fields) {
      if (f.file) lines.push(`body.append(${js(f.name)}, await openAsBlob(${js(f.file)}), ${js(f.file.split(/[\\/]/).pop() ?? f.file)})`)
      else lines.push(`body.append(${js(f.name)}, ${js(f.value)})`)
    }
    lines.push('')
  } else if (b.kind === 'form') {
    lines.push(`const body = new URLSearchParams(${JSON.stringify(b.fields, null, 2)})`, '')
  } else if (b.kind === 'text') {
    lines.push(`const body = ${js(b.text)}`, '')
  }
  if (input.insecureTLS) lines.push('// certificado inválido: rode com NODE_TLS_REJECT_UNAUTHORIZED=0', '')
  lines.push(`const res = await fetch(${js(input.url)}, {`, `  method: ${js(input.method)},`)
  if (headers.length) {
    lines.push('  headers: {')
    headers.forEach(([k, v], i) => lines.push(`    ${js(k)}: ${js(v)}${i < headers.length - 1 ? ',' : ''}`))
    lines.push('  },')
  }
  if (b.kind !== 'none') lines.push('  body,')
  lines[lines.length - 1] = lines[lines.length - 1].replace(/,$/, '')
  lines.push('})', '', 'console.log(res.status, res.statusText)', 'console.log(await res.text())')
  return lines.join('\n')
}

/** literal de string Python (JSON é compatível) */
const py = (s: string): string => JSON.stringify(s)

function pyDict(pairs: [string, string][], indent = '    '): string {
  if (!pairs.length) return '{}'
  return `{\n${pairs.map(([k, v]) => `${indent}${py(k)}: ${py(v)},`).join('\n')}\n}`
}

function toPython(input: SendInput): string {
  const b = input.body
  const headers = input.headers.filter(([k]) => !(b.kind === 'multipart' && /^content-type$/i.test(k)))
  const lines = ['import requests', '']
  const args = [py(input.method), py(input.url)]
  if (headers.length) {
    lines.push(`headers = ${pyDict(headers)}`)
    args.push('headers=headers')
  }
  if (b.kind === 'text') {
    lines.push(`data = ${py(b.text)}.encode()`)
    args.push('data=data')
  } else if (b.kind === 'form') {
    lines.push(`data = ${pyDict(b.fields)}`)
    args.push('data=data')
  } else if (b.kind === 'multipart') {
    const plain = b.fields.filter((f) => !f.file).map((f): [string, string] => [f.name, f.value])
    const files = b.fields.filter((f) => f.file)
    if (plain.length) {
      lines.push(`data = ${pyDict(plain)}`)
      args.push('data=data')
    }
    if (files.length) {
      lines.push(`files = {\n${files.map((f) => `    ${py(f.name)}: open(${py(f.file!)}, "rb"),`).join('\n')}\n}`)
      args.push('files=files')
    }
  }
  if (input.insecureTLS) args.push('verify=False')
  if (input.timeoutMs) args.push(`timeout=${input.timeoutMs / 1000}`)
  lines.push('', `res = requests.request(\n    ${args.join(',\n    ')},\n)`, 'print(res.status_code)', 'print(res.text)')
  return lines.join('\n')
}

/** literal de string Go: crase quando dá, senão aspas com escape */
function goStr(s: string): string {
  return !s.includes('`') && (s.includes('"') || s.includes('\n')) ? `\`${s}\`` : JSON.stringify(s)
}

function toGo(input: SendInput): string {
  const b = input.body
  const imports = new Set(['fmt', 'io', 'net/http'])
  const pre: string[] = []
  let bodyVar = 'nil'
  if (b.kind === 'text') {
    imports.add('strings')
    pre.push(`\tbody := strings.NewReader(${goStr(b.text)})`)
    bodyVar = 'body'
  } else if (b.kind === 'form') {
    imports.add('net/url').add('strings')
    pre.push('\tform := url.Values{}')
    for (const [k, v] of b.fields) pre.push(`\tform.Add(${goStr(k)}, ${goStr(v)})`)
    pre.push('\tbody := strings.NewReader(form.Encode())')
    bodyVar = 'body'
  } else if (b.kind === 'multipart') {
    imports.add('bytes').add('mime/multipart')
    pre.push('\tbody := &bytes.Buffer{}', '\tw := multipart.NewWriter(body)')
    for (const f of b.fields) {
      if (f.file) {
        imports.add('os').add('path/filepath')
        pre.push(
          `\tif f, err := os.Open(${goStr(f.file)}); err != nil {`,
          '\t\tpanic(err)',
          '\t} else {',
          `\t\tpart, _ := w.CreateFormFile(${goStr(f.name)}, filepath.Base(f.Name()))`,
          '\t\tio.Copy(part, f)',
          '\t\tf.Close()',
          '\t}'
        )
      } else pre.push(`\tw.WriteField(${goStr(f.name)}, ${goStr(f.value)})`)
    }
    pre.push('\tw.Close()')
    bodyVar = 'body'
  }
  const client: string[] = []
  if (input.insecureTLS) {
    imports.add('crypto/tls')
    client.push('\tclient := &http.Client{Transport: &http.Transport{TLSClientConfig: &tls.Config{InsecureSkipVerify: true}}}')
  } else client.push('\tclient := &http.Client{}')
  if (input.timeoutMs) {
    imports.add('time')
    client.push(`\tclient.Timeout = ${input.timeoutMs} * time.Millisecond`)
  }
  const headers = input.headers.filter(([k]) => !(b.kind === 'multipart' && /^content-type$/i.test(k)))
  const lines = [
    'package main',
    '',
    'import (',
    ...[...imports].sort().map((i) => `\t"${i}"`),
    ')',
    '',
    'func main() {',
    ...pre,
    `\treq, err := http.NewRequest(${goStr(input.method)}, ${goStr(input.url)}, ${bodyVar})`,
    '\tif err != nil {',
    '\t\tpanic(err)',
    '\t}',
    ...headers.map(([k, v]) => `\treq.Header.Add(${goStr(k)}, ${goStr(v)})`),
    ...(b.kind === 'multipart' ? ['\treq.Header.Set("Content-Type", w.FormDataContentType())'] : []),
    '',
    ...client,
    '\tres, err := client.Do(req)',
    '\tif err != nil {',
    '\t\tpanic(err)',
    '\t}',
    '\tdefer res.Body.Close()',
    '',
    '\tdata, _ := io.ReadAll(res.Body)',
    '\tfmt.Println(res.Status)',
    '\tfmt.Println(string(data))',
    '}'
  ]
  return lines.join('\n')
}
