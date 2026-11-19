// "Gerar código" com o httpsnippet (o mesmo gerador do Insomnia): 21 linguagens, várias bibliotecas cada.

import { availableTargets, HTTPSnippet, type HarRequest } from 'httpsnippet'
import type { SendInput } from '../shared/types'

export interface CodeTarget {
  key: string
  title: string
  clients: { key: string; title: string; link?: string }[]
}

/** nomes em português onde faz sentido; resto como o httpsnippet chama */
const TITLE: Record<string, string> = { shell: 'Shell', http: 'HTTP bruto', node: 'Node.js', javascript: 'JavaScript', csharp: 'C#', objc: 'Objective-C' }

/** mais usadas primeiro; o resto em ordem alfabética */
const ORDER = ['shell', 'javascript', 'node', 'python', 'go', 'java', 'csharp', 'php', 'ruby', 'kotlin', 'swift', 'rust', 'powershell', 'http']

export function codeTargets(): CodeTarget[] {
  const rank = (k: string): number => (ORDER.includes(k) ? ORDER.indexOf(k) : ORDER.length)
  return [...availableTargets()].sort((a, b) => rank(a.key) - rank(b.key) || a.title.localeCompare(b.title)).map((t) => ({
    key: t.key,
    title: TITLE[t.key] ?? t.title,
    clients: t.clients.map((c) => ({ key: c.key, title: c.title, link: c.link }))
  }))
}

/** SendInput (já com variáveis resolvidas) → HAR, que é o que o httpsnippet entende */
export function toHar(input: SendInput): HarRequest {
  const header = (n: string): string | undefined => input.headers.find(([k]) => k.toLowerCase() === n)?.[1]
  const har: HarRequest = {
    method: input.method,
    url: input.url,
    httpVersion: 'HTTP/1.1',
    headers: input.headers.filter(([k]) => k).map(([name, value]) => ({ name, value })),
    queryString: [],
    cookies: [],
    headersSize: -1,
    bodySize: -1,
    postData: undefined
  }
  const b = input.body
  if (b.kind === 'text') har.postData = { mimeType: header('content-type') ?? 'text/plain', text: b.text }
  // text também: alguns geradores (PowerShell) leem só o texto
  else if (b.kind === 'form')
    har.postData = { mimeType: 'application/x-www-form-urlencoded', params: b.fields.map(([name, value]) => ({ name, value })), text: new URLSearchParams(b.fields).toString() }
  // arquivo com o caminho completo: o código gerado lê o mesmo arquivo do request
  else if (b.kind === 'multipart') {
    const boundary = '---011000010111000001101001'
    const text =
      b.fields.map((f) => `--${boundary}\r\nContent-Disposition: form-data; name="${f.name}"${f.file ? `; filename="${f.file}"` : ''}\r\n\r\n${f.file ? '' : f.value}\r\n`).join('') + `--${boundary}--\r\n`
    har.postData = { mimeType: 'multipart/form-data', params: b.fields.map((f) => (f.file ? { name: f.name, fileName: f.file } : { name: f.name, value: f.value })), text }
  }
  // com body, alguns geradores (PowerShell) exigem o Content-Type
  if (har.postData && b.kind !== 'multipart' && !header('content-type')) har.headers.push({ name: 'Content-Type', value: har.postData.mimeType })
  return har
}

/** indentação de 2 espaços (Go fica com tab, padrão do gofmt; o editor mostra tab com largura 2) */
export function snippet(target: string, client: string, input: SendInput): string {
  const out = new HTTPSnippet(toHar(input)).convert(target as never, client, { indent: '  ' })
  if (typeof out !== 'string') throw new Error(`não há gerador para ${target}/${client}`)
  return out
}
