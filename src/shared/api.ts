import type { CodeLang } from './curl'
import type { RunOptions, RunReport, RunStep, AppState, GitStatus, ScriptReport, VaultStatus, Environment, FolderDoc, ImportPreview, RequestDoc, ResponseRecord, Workspace, WorkspaceDoc } from './types'

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

  createWorkspace(name: string): Promise<Workspace[]>
  saveWorkspace(doc: WorkspaceDoc): Promise<void>
  /** apaga os arquivos; se o workspace for vinculado, só tira da lista */
  deleteWorkspace(id: string): Promise<Workspace[]>
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
  codeSnippet(wsId: string, req: RequestDoc, envId: string | null, lang: CodeLang, resolveVars: boolean): Promise<string>
  copyText(text: string): Promise<void>
  /** valor que a tag {% %} daria agora (send=true envia o request de origem antes) */
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
}
