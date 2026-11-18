// Cofre: chave mestra aleatória (AES-256-GCM) protegida pelo chaveiro do sistema.
// A chave fica em <dataDir>/.vault/key cifrada pelo safeStorage (libsecret/kwallet/Keychain/DPAPI).

import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { isEncrypted, SECRET_PREFIX } from '../shared/secret'
import type { VaultStatus } from '../shared/types'

export type { VaultStatus }

/** quem protege a chave mestra (safeStorage em produção; identidade nos testes) */
export interface KeyProtector {
  available(): Promise<{ ok: boolean; backend: string; weak: boolean }>
  protect(text: string): Promise<Buffer>
  unprotect(data: Buffer): Promise<string>
}


export class VaultError extends Error {}

export class Vault {
  private key: Buffer | null = null
  private keyFile: string

  constructor(
    dataDir: string,
    private protector: KeyProtector
  ) {
    this.keyFile = path.join(dataDir, '.vault', 'key')
  }

  static keyId(key: Buffer): string {
    return createHash('sha256').update(key).digest('hex').slice(0, 8)
  }

  async status(): Promise<VaultStatus> {
    const a = await this.protector.available()
    const base: VaultStatus = { available: a.ok, backend: a.backend, weak: a.weak, hasKey: fs.existsSync(this.keyFile) }
    if (!base.hasKey || !a.ok) return base
    try {
      return { ...base, keyId: Vault.keyId(await this.loadKey()) }
    } catch (e) {
      return { ...base, error: (e as Error).message }
    }
  }

  private async loadKey(): Promise<Buffer> {
    if (this.key) return this.key
    if (!fs.existsSync(this.keyFile)) throw new VaultError('cofre ainda não tem chave')
    try {
      this.key = Buffer.from(await this.protector.unprotect(fs.readFileSync(this.keyFile)), 'base64')
    } catch {
      throw new VaultError('não deu pra abrir a chave do cofre com o chaveiro deste computador')
    }
    if (this.key.length !== 32) throw new VaultError('chave do cofre corrompida')
    return this.key
  }

  /** cria a chave se não existir */
  private async ensureKey(): Promise<Buffer> {
    if (fs.existsSync(this.keyFile)) return this.loadKey()
    const a = await this.protector.available()
    if (!a.ok) throw new VaultError('chaveiro do sistema indisponível; não dá pra criar o cofre')
    if (a.weak) throw new VaultError(`chaveiro "${a.backend}" não protege de verdade; instale/abra o gnome-keyring ou kwallet`)
    const key = randomBytes(32)
    fs.mkdirSync(path.dirname(this.keyFile), { recursive: true, mode: 0o700 })
    fs.writeFileSync(this.keyFile, await this.protector.protect(key.toString('base64')), { mode: 0o600 })
    this.key = key
    return key
  }

  async encrypt(plain: string): Promise<string> {
    if (isEncrypted(plain)) return plain
    const key = await this.ensureKey()
    const iv = randomBytes(12)
    const c = createCipheriv('aes-256-gcm', key, iv)
    const data = Buffer.concat([c.update(plain, 'utf8'), c.final(), c.getAuthTag()])
    return `${SECRET_PREFIX}${Vault.keyId(key)}$${iv.toString('base64')}$${data.toString('base64')}`
  }

  async decrypt(token: string): Promise<string> {
    if (!isEncrypted(token)) return token
    const [kid, ivB64, dataB64] = token.slice(SECRET_PREFIX.length).split('$')
    const key = await this.loadKey()
    if (Vault.keyId(key) !== kid) throw new VaultError(`segredo cifrado com outra chave (${kid}); redefina o valor neste computador`)
    const data = Buffer.from(dataB64, 'base64')
    try {
      const d = createDecipheriv('aes-256-gcm', key, Buffer.from(ivB64, 'base64'))
      d.setAuthTag(data.subarray(data.length - 16))
      return Buffer.concat([d.update(data.subarray(0, data.length - 16)), d.final()]).toString('utf8')
    } catch {
      throw new VaultError('segredo adulterado ou corrompido')
    }
  }

  /** decifra toda string cifrada dentro do objeto (cópia) */
  async decryptDeep<T>(value: T): Promise<T> {
    if (isEncrypted(value)) return (await this.decrypt(value)) as T
    if (Array.isArray(value)) return (await Promise.all(value.map((v) => this.decryptDeep(v)))) as T
    if (value && typeof value === 'object') {
      const out: Record<string, unknown> = {}
      for (const [k, v] of Object.entries(value)) out[k] = await this.decryptDeep(v)
      return out as T
    }
    return value
  }
}

/** protector baseado no safeStorage do Electron */
export function electronProtector(): KeyProtector {
  // import tardio: o módulo também roda nos testes, fora do Electron
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { safeStorage } = require('electron') as typeof import('electron')
  return {
    async available() {
      const ok = await safeStorage.isAsyncEncryptionAvailable()
      const backend = process.platform === 'linux' ? safeStorage.getSelectedStorageBackend() : process.platform
      return { ok, backend, weak: backend === 'basic_text' || backend === 'unknown' }
    },
    protect: (text) => safeStorage.encryptStringAsync(text),
    unprotect: async (data) => (await safeStorage.decryptStringAsync(data)).result
  }
}
