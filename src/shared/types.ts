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
  /** checagens da resposta sem programar (rodam depois dos scripts pós-resposta) */
  assertions?: Assertion[]
  /** false = não manda os cookies do workspace */
  sendCookies?: boolean
  /** false = não guarda os Set-Cookie da resposta */
  storeCookies?: boolean
  sortKey: number
}

export const ASSERT_SOURCES = ['status', 'header', 'json', 'body', 'time'] as const
export const ASSERT_OPS = ['eq', 'neq', 'contains', 'notContains', 'lt', 'gt', 'exists', 'notExists', 'matches'] as const

/** ex.: { source: 'json', path: '$.user.id', op: 'exists' }; { source: 'time', op: 'lt', value: '500' } */
export interface Assertion {
  enabled: boolean
  source: (typeof ASSERT_SOURCES)[number]
  /** nome do header ou JSONPath ($.a.b[0], $.items[*].id) */
  path?: string
  op: (typeof ASSERT_OPS)[number]
  value?: string
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
  /** requests fixados no topo da lateral (Ctrl+Shift+P) */
  pinned?: string[]
  /** filtro do body da resposta por request (JSONPath/XPath) */
  responseFilter?: Record<string, string>
  ui?: UiPrefs
}

/** preferências da interface (state.json) */
export interface UiPrefs {
  /** zoom da janela (1 = 100%) */
  zoom?: number
  /** px; padrão 13 */
  fontSize?: number
  /** px; padrão 12.5 */
  editorFontSize?: number
  sidebarHidden?: boolean
  /** atalhos trocados pelo usuário: id -> combinações */
  hotkeys?: Record<string, string[]>
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

/** cookie do jar do workspace (tela de cookies) */
export interface CookieInfo {
  key: string
  value: string
  domain: string
  path: string
  /** ISO; sem = cookie de sessão */
  expires?: string
  secure: boolean
  httpOnly: boolean
  /** só o host exato (sem Domain=) */
  hostOnly?: boolean
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
  /** texto (utf-8) ou base64 quando binário; com bodyFile, só uma prévia (texto) ou vazio (binário) */
  body: string
  bodyEncoding: 'utf8' | 'base64'
  size: number
  /** body grande guardado à parte (.responses/bodies/<id>); pegar com responseBody */
  bodyFile?: boolean
  /** o que foi enviado de fato, saltos de redirect, tempos detalhados e TLS */
  timeline?: Timeline
  timing: { headersMs: number; totalMs: number }
  error?: string
}

export interface TimelineHop {
  method: string
  url: string
  /** cabeçalho bruto enviado (linha do request + headers, como saiu no socket) */
  requestHead?: string
  status: number
  statusText: string
  headers: [string, string][]
  /** ms desde o início do envio até os headers deste salto */
  atMs: number
}

export interface Timeline {
  /** body enviado (texto; truncado em 64 KB; multipart resumido) */
  requestBody?: string
  hops: TimelineHop[]
  timing: { dnsMs?: number; connectMs?: number; tlsMs?: number; ttfbMs: number; downloadMs: number; totalMs: number }
  remote?: { address: string; port: number }
  tls?: { protocol?: string; cipher?: string; authorized: boolean; error?: string; subject?: string; issuer?: string; validFrom?: string; validTo?: string; altNames?: string; fingerprint?: string }
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

/** um request rodado pelo executor de coleção */
export interface RunStep {
  iteration: number
  requestId: string
  name: string
  /** pastas até o request, ex.: "Usuários / Admin" */
  path: string
  method: string
  url: string
  status: number
  timeMs: number
  tests: ScriptTest[]
  /** erro de envio ou de script */
  error?: string
  /** variáveis {{ }} sem valor */
  missing?: string[]
  /** tags não resolvidas, segredos que não abriram… */
  warnings?: string[]
}

export interface RunOptions {
  wsId: string
  /** null = workspace inteiro */
  folderId: string | null
  envId: string | null
  iterations: number
  delayMs: number
  /** uma linha por iteração (CSV/JSON); vira variável */
  data?: Record<string, unknown>[]
  /** variáveis fixas (CLI --var); valem sobre ambiente e dados */
  vars?: Record<string, unknown>
  /** para no primeiro request com falha */
  bail?: boolean
}

export interface RunReport {
  name: string
  startedAt: number
  totalMs: number
  steps: RunStep[]
  passed: number
  failed: number
  cancelled?: boolean
}
