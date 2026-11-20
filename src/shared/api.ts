import type { InsomniaKey } from './hotkeys'
import type { CookieInfo, GitHubAccount, PluginInfo, RunOptions, RunReport, RunStep, AppState, GitStatus, ScriptReport, VaultStatus, Environment, FolderDoc, ImportPreview, RequestDoc, ResponseRecord, SendInput, OAuthTokenStatus, Workspace, WorkspaceDoc } from './types'

export interface Created {
  workspaces: Workspace[]
  id: string
}

export interface SendResult {
  response: ResponseRecord
  history: ResponseRecord[]
  /** variáveis {{ }} não encontradas */
  missing: string[]
  /** tags {% %} não resolvidas e erros de dependência */
  warnings: string[]
  /** saída dos scripts pré/pós (só quando há script) */
  scripts?: ScriptReport
}

export interface ZenoApi {
  load(): Promise<{ workspaces: Workspace[]; state: AppState; dataDir: string }>
  setState(state: AppState): Promise<void>
  /** zoom da janela (1 = 100%) */
  setZoom(factor: number): void
  windowAction(action: 'fullscreen' | 'devtools' | 'quit'): Promise<void>
  cookiesList(wsId: string): Promise<CookieInfo[]>
  /** troca o jar inteiro; devolve a lista válida */
  cookiesSave(wsId: string, list: CookieInfo[]): Promise<CookieInfo[]>
  /** hotKeyRegistry do Insomnia (null = não instalado) */
  insomniaHotkeys(): Promise<Record<string, { macKeys?: InsomniaKey[]; winLinuxKeys?: InsomniaKey[] }> | null>

  createWorkspace(name: string): Promise<Workspace[]>
  saveWorkspace(doc: WorkspaceDoc): Promise<void>
  /** apaga os arquivos; se o workspace for vinculado, só tira da lista */
  deleteWorkspace(id: string): Promise<Workspace[]>
  /** cópia com ids novos na pasta de dados (sem histórico nem cookies) */
  duplicateWorkspace(id: string): Promise<Created>
  /** abre a pasta do workspace no gerenciador de arquivos */
  openWorkspaceDir(id: string): Promise<void>
  /** abre um workspace que já existe numa pasta (diálogo); null = cancelado */
  linkWorkspace(): Promise<Created | null>
  /** move o workspace pra uma pasta escolhida (diálogo), ex.: dentro de um repo */
  moveWorkspace(id: string): Promise<Workspace[] | null>

  createRequest(parentId: string, name: string): Promise<Created>
  createFolder(parentId: string, name: string): Promise<Created>
  saveRequest(req: RequestDoc): Promise<void>
  saveFolder(doc: FolderDoc): Promise<Workspace[]>
  deleteNode(id: string): Promise<Workspace[]>
  moveNode(id: string, newParentId: string, sortKey: number): Promise<Workspace[]>
  duplicate(id: string): Promise<Created>

  saveEnvironment(wsId: string, env: Environment): Promise<Workspace[]>
  deleteEnvironment(id: string): Promise<Workspace[]>

  send(wsId: string, req: RequestDoc, envId: string | null): Promise<SendResult>
  cancel(requestId: string): Promise<void>
  /** código pronto do request; resolveVars=false mantém as {{ variáveis }} */
  /** request pronto pra gerar código: variáveis/tags/segredos resolvidos ou {{ variáveis }} como referência */
  codeInput(wsId: string, req: RequestDoc, envId: string | null, resolveVars: boolean): Promise<SendInput>
  copyText(text: string): Promise<void>
  /** valor que a tag {% %} daria agora (send=true envia o request de origem antes) */
  /** OAuth 2.0 (#9): token da auth efetiva do request (própria ou herdada) */
  oauthStatus(wsId: string, req: RequestDoc, envId: string | null): Promise<OAuthTokenStatus | null>
  /** obtém/renova agora (pode abrir o navegador) */
  oauthToken(wsId: string, req: RequestDoc, envId: string | null): Promise<OAuthTokenStatus | null>
  oauthClear(wsId: string, req: RequestDoc, envId: string | null): Promise<void>
  /** cancela a espera pela autorização no navegador */
  oauthCancel(): Promise<void>
  onOAuthWait(cb: (w: { message: string; url: string; code: string }) => void): () => void
  onOAuthDone(cb: () => void): () => void
  tagPreview(raw: string, send: boolean): Promise<{ value?: string; error?: string; at?: number }>
  responses(requestId: string): Promise<ResponseRecord[]>
  clearResponses(requestId: string): Promise<void>

  /**
   * 'insomnia' = ~/.config/Insomnia; 'file' = diálogo (um ou mais arquivos: Insomnia v4/v5, OpenAPI/Swagger, Postman);
   * { url } = baixa o spec/coleção
   */
  importPreview(source: 'insomnia' | 'file' | { url: string }): Promise<ImportPreview | null>
  /** protect = cifrar senhas/tokens no cofre logo após importar */
  importRun(workspaceIds: string[], protect: boolean): Promise<Workspace[]>

  vaultStatus(): Promise<VaultStatus>
  /** cifra texto e devolve o token `$zeno$v1$…` */
  vaultEncrypt(plain: string): Promise<string>
  /** decifra um token (só sob pedido explícito do usuário) */
  vaultReveal(token: string): Promise<string>
  /** plain: segredos em texto puro que dá pra cifrar; warnings: segredos no meio de URL/body (mover à mão) */
  vaultScan(wsId: string): Promise<{ plain: string[]; warnings: string[] }>
  vaultProtect(wsId: string): Promise<{ count: number; workspaces: Workspace[] }>

  gitStatus(wsId: string): Promise<GitStatus>
  /** diff do arquivo (caminho relativo à pasta do workspace) */
  gitDiff(wsId: string, file: string): Promise<string>
  /** adiciona e commita tudo que mudou na pasta do workspace */
  gitCommit(wsId: string, message: string): Promise<GitStatus>
  gitPull(wsId: string): Promise<GitStatus>
  gitPush(wsId: string): Promise<GitStatus>
  gitSwitch(wsId: string, branch: string, create: boolean): Promise<GitStatus>
  /** desfaz um pull que parou em conflito */
  gitAbort(wsId: string): Promise<GitStatus>
  gitInit(wsId: string): Promise<GitStatus>

  /** roda os requests da pasta (ou do workspace) em ordem; progresso chega por onRunStep */
  runCollection(opts: RunOptions): Promise<RunReport>
  runCancel(): Promise<void>
  /** escolhe CSV/JSON de dados (diálogo) */
  runPickData(): Promise<{ name: string; rows: Record<string, unknown>[] } | null>
  /** salva o relatório como JUnit XML (diálogo); devolve o caminho */
  runSaveJUnit(report: RunReport): Promise<string | null>
  onRunStep(cb: (step: RunStep, index: number, total: number) => void): () => void

  pickFile(): Promise<string | null>
  openDataDir(): Promise<void>
  onChanged(cb: (workspaces: Workspace[]) => void): () => void
  /** resposta gravada por envio indireto (dependência de {% response %}) */
  onResponse(cb: (requestId: string, history: ResponseRecord[]) => void): () => void
  /** {% prompt %} pedindo valor; responda com promptReply(id, …) */
  onPrompt(cb: (id: number, p: PromptAsk) => void): () => void
  promptReply(id: number, answer: { value: string; remember: boolean } | null): Promise<void>
  /** body completo de resposta grande (bodyFile) */
  responseBody(requestId: string, resId: string): Promise<string>
  /** salva o body num arquivo; devolve o caminho (null = cancelou) */
  saveResponse(requestId: string, resId: string): Promise<string | null>
  pluginsList(): Promise<PluginInfo[]>
  /** relê a pasta de plugins */
  pluginsReload(): Promise<PluginInfo[]>
  pluginsSetEnabled(id: string, on: boolean): Promise<PluginInfo[]>
  /** abre (e cria) a pasta de plugins; devolve o caminho */
  pluginsOpenDir(): Promise<string>
  /** roda uma ação de plugin no request; devolve as mensagens (app.alert) */
  pluginAction(pluginId: string, index: number, wsId: string, reqId: string, envId: string | null): Promise<string[]>
  githubStatus(): Promise<{ account: GitHubAccount | null; deviceAvailable: boolean }>
  /** usa a sessão do GitHub CLI (gh auth token) */
  githubLoginGh(): Promise<GitHubAccount>
  githubLoginToken(token: string): Promise<GitHubAccount>
  /** device flow: abre o navegador e devolve o código pra digitar */
  githubDeviceStart(): Promise<{ userCode: string; url: string }>
  githubDevicePoll(): Promise<GitHubAccount>
  githubLogout(): Promise<void>
  githubSetRepo(repo: string): Promise<GitHubAccount>
  githubList(): Promise<{ dir: string; id?: string; name: string; files: number }[]>
  /** envia num commit só; null = nada mudou */
  githubPush(wsIds: string[]): Promise<{ commit: string; files: number; url: string } | null>
  githubPull(dir: string, remoteId?: string): Promise<{ files: number; workspaces: Workspace[] }>
  /** esquece os valores lembrados dos prompts */
  promptForget(): Promise<void>
}

/** pergunta de {% prompt %} (mesmo formato do main/tags) */
export interface PromptAsk {
  title: string
  label: string
  defaultValue: string
  key: string
  mask: boolean
}
