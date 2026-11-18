export interface KV {
  name: string
  value: string
  enabled: boolean
}

export interface BodyField extends KV {
  /** caminho de arquivo local (multipart) */
  file?: string
}

export type Auth =
  | { type: 'inherit' }
  | { type: 'none' }
  | { type: 'basic'; username: string; password: string }
  | { type: 'bearer'; token: string; prefix?: string }
  | { type: 'apikey'; key: string; value: string; addTo: 'header' | 'query' }

export type AuthType = Auth['type']

export interface Body {
  /** null = sem body */
  mime: string | null
  text?: string
  fields?: BodyField[]
}

/** JavaScript rodado antes do envio (pre) e depois da resposta (post) */
export interface Scripts {
  pre?: string
  post?: string
}

export const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'] as const

export interface RequestDoc {
  kind: 'request'
  id: string
  name: string
  description?: string
  method: string
  url: string
  params: KV[]
  headers: KV[]
  body: Body
  auth: Auth
  scripts?: Scripts
  sortKey: number
}

export interface FolderDoc {
  kind: 'folder'
  id: string
  name: string
  description?: string
  sortKey: number
  headers: KV[]
  auth: Auth
  /** variáveis da pasta (sobrepõem o ambiente) */
  vars: Record<string, unknown>
  /** herdados por todos os requests da pasta (rodam antes dos do request) */
  scripts?: Scripts
}

export interface Folder extends FolderDoc {
  children: TreeNode[]
}

export type TreeNode = Folder | RequestDoc

export interface Environment {
  id: string
  name: string
  /** null = ambiente base do workspace */
  parentId: string | null
  color?: string
  data: Record<string, unknown>
  sortKey: number
}

export interface WorkspaceDoc {
  id: string
  name: string
  description?: string
  settings: { insecureTLS: boolean; timeoutMs: number }
}

export interface Workspace extends WorkspaceDoc {
  /** onde mora (preenchido ao carregar; não vai pro YAML). linked = fora da pasta de dados, ex.: num repo git */
  location?: { dir: string; linked: boolean }
  environments: Environment[]
  children: TreeNode[]
}

export interface AppState {
  activeWorkspaceId?: string
  activeRequestId?: string
  /** wsId -> id do sub-ambiente ativo */
  activeEnv: Record<string, string | null>
}

/** request já com variáveis resolvidas, pronto pra enviar */
export interface SendInput {
  requestId: string
  method: string
  url: string
  headers: [string, string][]
  body: { kind: 'none' } | { kind: 'text'; text: string } | { kind: 'form'; fields: [string, string][] } | { kind: 'multipart'; fields: { name: string; value: string; file?: string }[] }
  insecureTLS: boolean
  timeoutMs: number
}

export interface ResponseRecord {
  id: string
  requestId: string
  at: number
  method: string
  url: string
  status: number
  statusText: string
  headers: [string, string][]
  /** texto (utf-8) ou base64 quando binário */
  body: string
  bodyEncoding: 'utf8' | 'base64'
  size: number
  timing: { headersMs: number; totalMs: number }
  error?: string
}

export interface ImportPreview {
  source: string
  workspaces: { id: string; name: string; folders: number; requests: number; environments: number; exists: boolean }[]
  warnings: string[]
}

export interface VaultStatus {
  available: boolean
  backend: string
  /** backend sem chaveiro de verdade (senha fixa) */
  weak: boolean
  hasKey: boolean
  /** id curto da chave atual */
  keyId?: string
  error?: string
}

export interface GitFile {
  /** caminho relativo à pasta do workspace */
  path: string
  /** M modificado, A novo, D apagado, R renomeado, U conflito */
  status: 'M' | 'A' | 'D' | 'R' | 'U'
  /** nome do request/pasta/ambiente, quando dá pra saber */
  label: string
}

export interface GitStatus {
  /** a pasta do workspace está dentro de um repositório git */
  repo: boolean
  root?: string
  branch?: string
  upstream?: string
  ahead: number
  behind: number
  branches: string[]
  hasRemote: boolean
  /** rebase parado no meio por conflito */
  conflict: boolean
  files: GitFile[]
}

export interface ScriptTest {
  name: string
  ok: boolean
  error?: string
  /** pre ou post, e de quem (request ou pasta) */
  where: string
}

export interface ScriptReport {
  logs: string[]
  tests: ScriptTest[]
  /** erros de script (o envio para se o pré-request falhar) */
  errors: string[]
}
