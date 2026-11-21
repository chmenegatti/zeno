// Monta o request final (variáveis resolvidas, auth, headers herdados). Usado no main (envio) e no renderer (prévia).

import { buildVars, render, type TagValues, type Vars } from './template'
import { effectiveAuth, effectiveHeaders } from './tree'
import { replacePathParams } from './pathparams'
import type { Folder, RequestDoc, SendInput, Workspace } from './types'

export interface Prepared {
  input: SendInput
  missing: string[]
  unsupported: string[]
}

function b64(s: string): string {
  let bin = ''
  for (const byte of new TextEncoder().encode(s)) bin += String.fromCharCode(byte)
  return btoa(bin)
}

export function prepare(
  ws: Workspace,
  req: RequestDoc,
  ancestors: Folder[],
  activeEnvId: string | null | undefined,
  tags?: TagValues
): Prepared {
  const vars: Vars = buildVars(ws, activeEnvId, ancestors)
  const missing = new Set<string>()
  const unsupported = new Set<string>()
  const r = (s: string | undefined): string => {
    const out = render(s ?? '', vars, tags)
    out.missing.forEach((m) => missing.add(m))
    out.unsupported.forEach((u) => unsupported.add(u))
    return out.value
  }

  // :id / {id} no path viram o valor (com variáveis); sem valor, o trecho fica como está
  const pathValues = new Map((req.pathParams ?? []).map((p) => [p.name, p.value]))
  let url = r(replacePathParams(req.url, (n) => pathValues.get(n) || undefined)).trim()
  // sem esquema vira http://, menos quando começa com variável não resolvida (gerar código mantendo {{ var }})
  if (url && !/^[a-z][a-z0-9+.-]*:\/\//i.test(url) && !/^\{[{%]/.test(url)) url = `http://${url}`

  const query: [string, string][] = req.params.filter((p) => p.enabled && p.name).map((p) => [r(p.name), r(p.value)])
  const headers: [string, string][] = effectiveHeaders(req, ancestors).map((h) => [r(h.name), r(h.value)])
  const hasHeader = (name: string): boolean => headers.some(([k]) => k.toLowerCase() === name.toLowerCase())

  const auth = effectiveAuth(req, ancestors)
  if (auth.type === 'basic') {
    if (!hasHeader('authorization')) headers.push(['Authorization', `Basic ${b64(`${r(auth.username)}:${r(auth.password)}`)}`])
  } else if (auth.type === 'bearer') {
    if (!hasHeader('authorization')) headers.push(['Authorization', `${r(auth.prefix) || 'Bearer'} ${r(auth.token)}`.trim()])
  } else if (auth.type === 'apikey' && auth.key) {
    if (auth.addTo === 'query') query.push([r(auth.key), r(auth.value)])
    else headers.push([r(auth.key), r(auth.value)])
  }

  if (query.length) {
    const qs = query.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&')
    url += (url.includes('?') ? '&' : '?') + qs
  }

  let body: SendInput['body'] = { kind: 'none' }
  const mime = req.body.mime
  if (mime === 'application/x-www-form-urlencoded') {
    body = { kind: 'form', fields: (req.body.fields ?? []).filter((f) => f.enabled && f.name).map((f) => [r(f.name), r(f.value)]) }
    if (!hasHeader('content-type')) headers.push(['Content-Type', mime])
  } else if (mime === 'multipart/form-data') {
    body = {
      kind: 'multipart',
      fields: (req.body.fields ?? []).filter((f) => f.enabled && f.name).map((f) => ({ name: r(f.name), value: r(f.value), file: f.file || undefined }))
    }
  } else if (mime) {
    body = { kind: 'text', text: r(req.body.text) }
    if (!hasHeader('content-type')) headers.push(['Content-Type', mime === 'application/graphql' ? 'application/json' : mime])
  }

  return {
    input: {
      requestId: req.id,
      method: req.method,
      url,
      headers,
      body,
      insecureTLS: ws.settings.insecureTLS,
      timeoutMs: ws.settings.timeoutMs
    },
    missing: [...missing],
    unsupported: [...unsupported]
  }
}
