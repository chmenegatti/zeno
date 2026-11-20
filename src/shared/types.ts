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
  | OAuth2Auth

export type OAuthGrant = 'authorization_code' | 'client_credentials' | 'password' | 'implicit' | 'device_code'

/** OAuth 2.0 (#9): o token não vai pro YAML; fica em cache cifrado no cofre, por request/pasta */
export interface OAuth2Auth {
  type: 'oauth2'
  grantType: OAuthGrant
  authUrl?: string
  tokenUrl?: string
  clientId?: string
  clientSecret?: string
  scope?: string
  audience?: string
  /** vazio = http://127.0.0.1:<porta livre>/callback */
  redirectUri?: string
  pkce?: boolean
  username?: string
  password?: string
  /** client_id/secret no corpo (body) ou Basic no header (padrão) */
  clientAuth?: 'header' | 'body'
  /** prefixo do header; padrão Bearer */
  prefix?: string
}

/** token em cache (sem o valor) */
export interface OAuthTokenStatus {
  type?: string
  valid: boolean
  hasRefresh: boolean
  expiresAt?: number
  scope?: string
}

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
  /** respostas de exemplo (#20): o mock do workspace responde a rota com o padrão (ou o primeiro) */
  examples?: Example[]
  /** gRPC (#5): URL grpc:// ou grpcs://; serviço/método e .proto (vazio = server reflection) */
  grpc?: { service: string; method: string; protoFile?: string }
  sortKey: number
}

export interface Example {
  id: string
  name: string
  status: number
  headers: KV[]
  body: string
  bodyEncoding?: 'base64'
  delayMs?: number
  default?: boolean
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

export interface WorkspaceSettings {
  insecureTLS: boolean
  timeoutMs: number
  /** proxy (#18): sem (padrão), do sistema (HTTP(S)_PROXY/NO_PROXY) ou personalizado */
  proxy?: { mode: 'none' | 'system' | 'custom'; url?: string; noProxy?: string }
  /** CA própria (PEM), somada às do sistema */
  caFile?: string
  /** certificados de cliente (mTLS) por host: PEM (cert + key) ou PFX com senha (no cofre) */
  clientCerts?: ClientCert[]
  /** mock server (#20): porta (padrão 4010) */
  mock?: { port: number }
}

export interface ClientCert {
  /** api.x.com, api.x.com:8443 ou *.x.com */
  host: string
  cert?: string
  key?: string
  pfx?: string
  /** senha do PFX: token do cofre ($zeno$v1$…) */
  passphrase?: string
}

export interface WorkspaceDoc {
  id: string
  name: string
  description?: string
  settings: WorkspaceSettings
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
  /** plugins desligados (id = nome da pasta) */
  disabledPlugins?: string[]
  /** filtro do body da resposta por request (JSONPath/XPath) */
  responseFilter?: Record<string, string>
  /** organização na tela de workspaces (fixar, grupo, cor, ordem, arquivar, último uso); local, fora dos YAML */
  wsMeta?: Record<string, WsMeta>
  ui?: UiPrefs
}

export interface WsMeta {
  pinned?: boolean
  /** cor escolhida (hex) */
  color?: string
  /** grupo/etiqueta, ex.: "cliente X" */
  group?: string
  /** some da lista e da lateral, sem apagar os arquivos */
  archived?: boolean
  /** posição na ordem manual */
  order?: number
  /** última vez que foi aberto (ms) */
  lastUsed?: number
}

/** preferências da interface (state.json) */
export interface UiPrefs {
  /** zoom da janela (1 = 100%) */
  zoom?: number
  /** id do tema (src/shared/themes.ts); sem = TOTVS */
  theme?: string
  /** px; padrão 13 */
  fontSize?: number
  /** px; padrão 12.5 */
  editorFontSize?: number
  sidebarHidden?: boolean
  /** atalhos trocados pelo usuário: id -> combinações */
  hotkeys?: Record<string, string[]>
  /** tela de workspaces: cartões ou lista, e a ordem */
  wsView?: 'grid' | 'list'
  wsSort?: 'manual' | 'name' | 'recent'
  /** idioma da interface (#132); sem = inglês */
  lang?: 'en' | 'pt'
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
  /** SSE (#6): por que o stream parou antes do servidor fechar (cancelado, erro: …) */
  streamEnd?: string
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
  /** proxy por onde saiu (sem senha) */
  proxy?: string
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

// ---------- plugins (formato do Insomnia) ----------

export interface PluginArg {
  displayName: string
  type: 'string' | 'number' | 'boolean' | 'enum'
  defaultValue?: unknown
  placeholder?: string
  options?: { displayName: string; value: string }[]
}

export interface PluginTagInfo {
  name: string
  displayName: string
  description?: string
  args: PluginArg[]
}

export interface PluginInfo {
  id: string
  name: string
  displayName: string
  description?: string
  version?: string
  dir: string
  enabled: boolean
  /** falhou ao carregar (fica desativado) */
  error?: string
  templateTags: PluginTagInfo[]
  requestHooks: number
  responseHooks: number
  requestActions: { label: string; icon?: string }[]
  importers: { name: string }[]
}

/** conta do GitHub conectada (salvar coleções) */
export interface GitHubAccount {
  login: string
  name?: string
  avatar?: string
  /** repositório privado onde os workspaces ficam */
  repo: string
  via: 'gh' | 'token' | 'device'
}
