// Cookie jar por workspace: guarda o Set-Cookie das respostas e manda nos requests seguintes.
// Persistência em <dataDir>/.cookies/<wsId>.json (fora dos YAML; sem dir = só memória, como na CLI).

import fs from 'node:fs'
import path from 'node:path'
import { Cookie, CookieJar } from 'tough-cookie'
import type { CookieInfo } from '../shared/types'

export class Cookies {
  private jars = new Map<string, CookieJar>()

  constructor(private dir: string | null) {}

  private file(wsId: string): string {
    return path.join(this.dir!, '.cookies', `${wsId.replace(/[^\w-]/g, '_')}.json`)
  }

  jar(wsId: string): CookieJar {
    let j = this.jars.get(wsId)
    if (j) return j
    j = new CookieJar(undefined, { looseMode: true, rejectPublicSuffixes: false, allowSpecialUseDomain: true })
    if (this.dir) {
      try {
        j = CookieJar.deserializeSync(fs.readFileSync(this.file(wsId), 'utf8'))
      } catch {
        /* sem arquivo ou corrompido: começa vazio */
      }
    }
    this.jars.set(wsId, j)
    return j
  }

  private persist(wsId: string): void {
    if (!this.dir) return
    const j = this.jar(wsId)
    const data = j.serializeSync()
    if (data) data.cookies = data.cookies.filter((c) => !isExpired(c.expires))
    fs.mkdirSync(path.dirname(this.file(wsId)), { recursive: true })
    fs.writeFileSync(this.file(wsId), JSON.stringify(data, null, 2))
  }

  /** valor do header Cookie pra essa URL (já sem os expirados) */
  header(wsId: string, url: string): string {
    try {
      return this.jar(wsId).getCookieStringSync(url)
    } catch {
      return ''
    }
  }

  /** guarda os Set-Cookie de uma resposta; devolve quantos entraram */
  store(wsId: string, url: string, setCookies: string[]): number {
    if (!setCookies.length) return 0
    const j = this.jar(wsId)
    let n = 0
    for (const sc of setCookies) {
      try {
        if (j.setCookieSync(sc, url, { ignoreError: true })) n++
      } catch {
        /* cookie inválido pra essa URL */
      }
    }
    this.persist(wsId)
    return n
  }

  list(wsId: string): CookieInfo[] {
    const all = this.jar(wsId).serializeSync()?.cookies ?? []
    return all
      .filter((c) => !isExpired(c.expires))
      .map((c) => ({
        key: String(c.key ?? ''),
        value: String(c.value ?? ''),
        domain: String(c.domain ?? ''),
        path: String(c.path ?? '/'),
        expires: c.expires && c.expires !== 'Infinity' ? new Date(c.expires as string).toISOString() : undefined,
        secure: !!c.secure,
        httpOnly: !!c.httpOnly,
        hostOnly: !!c.hostOnly
      }))
      .sort((a, b) => a.domain.localeCompare(b.domain) || a.key.localeCompare(b.key))
  }

  /** troca o jar inteiro pela lista editada na tela */
  replace(wsId: string, list: CookieInfo[]): CookieInfo[] {
    const j = new CookieJar(undefined, { looseMode: true, rejectPublicSuffixes: false, allowSpecialUseDomain: true })
    for (const c of list) {
      if (!c.key || !c.domain) continue
      const domain = c.domain.replace(/^\./, '')
      const cookie = new Cookie({
        key: c.key,
        value: c.value,
        domain,
        path: c.path || '/',
        expires: c.expires ? new Date(c.expires) : 'Infinity',
        secure: c.secure,
        httpOnly: c.httpOnly,
        hostOnly: !!c.hostOnly
      })
      try {
        j.setCookieSync(cookie, `${c.secure ? 'https' : 'http'}://${domain}${cookie.path}`, { ignoreError: true })
      } catch {
        /* ignora inválido */
      }
    }
    this.jars.set(wsId, j)
    this.persist(wsId)
    return this.list(wsId)
  }

  clear(wsId: string): void {
    this.replace(wsId, [])
  }
}

function isExpired(expires: unknown): boolean {
  if (!expires || expires === 'Infinity') return false
  const t = new Date(expires as string).getTime()
  return Number.isFinite(t) && t <= Date.now()
}
