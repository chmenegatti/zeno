// Nome sugerido pra "salvar em arquivo": Content-Disposition, último trecho da URL ou "resposta" + extensão do tipo.
// O nome vem do servidor: nunca leva pastas (../) nem caracteres inválidos.

import path from 'node:path'

const EXT: Record<string, string> = {
  'application/json': '.json', 'application/xml': '.xml', 'text/xml': '.xml', 'text/html': '.html', 'text/plain': '.txt', 'text/csv': '.csv',
  'application/pdf': '.pdf', 'image/png': '.png', 'image/jpeg': '.jpg', 'image/gif': '.gif', 'image/webp': '.webp', 'image/svg+xml': '.svg',
  'application/zip': '.zip', 'audio/mpeg': '.mp3', 'video/mp4': '.mp4', 'application/octet-stream': '.bin'
}

export function mimeExt(ct: string | undefined): string {
  const t = (ct ?? '').split(';')[0].trim().toLowerCase()
  return EXT[t] ?? (t.endsWith('+json') ? '.json' : t.endsWith('+xml') ? '.xml' : '')
}

/** só o nome do arquivo, sem pastas nem caracteres de controle/inválidos */
export function cleanName(n: string | undefined): string {
  if (!n) return ''
  const base = path.basename(n.replace(/\\/g, '/')).replace(/[\u0000-\u001f<>:"|?*]/g, '_').trim()
  return /^\.*$/.test(base) ? '' : base
}

export function suggestFileName(headers: [string, string][], url: string): string {
  const header = (n: string): string | undefined => headers.find(([k]) => k.toLowerCase() === n)?.[1]
  const cd = header('content-disposition') ?? ''
  const star = /filename\*\s*=\s*(?:UTF-8|utf-8)?'[^']*'([^;]+)/.exec(cd)?.[1]
  const plain = /filename\s*=\s*"?([^";]+)"?/i.exec(cd)?.[1]
  let disp = ''
  try {
    disp = cleanName(star ? decodeURIComponent(star) : plain)
  } catch {
    disp = cleanName(plain)
  }
  let fromUrl = ''
  try {
    fromUrl = cleanName(decodeURIComponent(new URL(url).pathname.split('/').pop() ?? ''))
  } catch {
    /* URL estranha */
  }
  const ext = mimeExt(header('content-type'))
  return disp || (fromUrl && /\.\w{1,8}$/.test(fromUrl) ? fromUrl : `${fromUrl || 'resposta'}${ext}`)
}
