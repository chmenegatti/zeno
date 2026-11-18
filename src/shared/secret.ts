// Valores secretos ficam no YAML como `$zeno$v1$<kid>$<iv>$<dados+tag>` (AES-256-GCM).
// Só o processo principal decifra; o renderer vê o token e mostra como mascarado.

export const SECRET_PREFIX = '$zeno$v1$'
export const SECRET_RE = /\$zeno\$v1\$[0-9a-f]{8}\$[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+/g
export const MASK = '••••••'

export function isEncrypted(v: unknown): v is string {
  return typeof v === 'string' && v.startsWith(SECRET_PREFIX)
}

/** troca tokens cifrados por máscara (preview no renderer) */
export function maskSecrets(s: string): string {
  return s.includes(SECRET_PREFIX) ? s.replace(SECRET_RE, MASK) : s
}

/** nome parece guardar segredo? */
export function looksSecret(name: string): boolean {
  return /pass|senha|secret|token|api[-_]?key|apikey|client[-_]?secret|credential|private/i.test(name)
}

/** valor vale a pena cifrar: texto literal não vazio (sem template) */
export function isLiteral(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0 && !v.startsWith(SECRET_PREFIX) && !v.includes('{{') && !v.includes('{%')
}
