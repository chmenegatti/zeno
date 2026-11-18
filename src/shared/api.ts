import type { AppState, VaultStatus, Environment, FolderDoc, ImportPreview, RequestDoc, ResponseRecord, Workspace, WorkspaceDoc } from './types'

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
}

export interface ZenoApi {
  load(): Promise<{ workspaces: Workspace[]; state: AppState; dataDir: string }>
  setState(state: AppState): Promise<void>

  createWorkspace(name: string): Promise<Workspace[]>
  saveWorkspace(doc: WorkspaceDoc): Promise<void>
  deleteWorkspace(id: string): Promise<Workspace[]>

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
  responses(requestId: string): Promise<ResponseRecord[]>
  clearResponses(requestId: string): Promise<void>

  /** 'insomnia' = ~/.config/Insomnia; 'file' = abre diálogo pra escolher export JSON */
  importPreview(source: 'insomnia' | 'file'): Promise<ImportPreview | null>
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

  pickFile(): Promise<string | null>
  openDataDir(): Promise<void>
  onChanged(cb: (workspaces: Workspace[]) => void): () => void
  /** resposta gravada por envio indireto (dependência de {% response %}) */
  onResponse(cb: (requestId: string, history: ResponseRecord[]) => void): () => void
}
