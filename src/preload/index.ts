import { contextBridge, ipcRenderer, webFrame } from 'electron'
import type { PromptAsk } from '../shared/api'
import type { ZenoApi } from '../shared/api'
import type { ResponseRecord, RunStep, Workspace } from '../shared/types'

const call =
  (channel: string) =>
  (...args: unknown[]) =>
    ipcRenderer.invoke(channel, ...args)

const channels = [
  'load', 'setState', 'createWorkspace', 'saveWorkspace', 'deleteWorkspace',
  'createRequest', 'createFolder', 'saveRequest', 'saveFolder', 'deleteNode', 'moveNode', 'duplicate',
  'saveEnvironment', 'deleteEnvironment', 'send', 'cancel', 'responses', 'clearResponses',
  'importPreview', 'importRun', 'pickFile', 'openDataDir',
  'vaultStatus', 'vaultEncrypt', 'vaultReveal', 'vaultScan', 'vaultProtect',
  'linkWorkspace', 'moveWorkspace',
  'gitStatus', 'gitDiff', 'gitCommit', 'gitPull', 'gitPush', 'gitSwitch', 'gitAbort', 'gitInit',
  'codeSnippet', 'copyText', 'tagPreview', 'windowAction', 'insomniaHotkeys', 'cookiesList', 'cookiesSave', 'promptReply', 'promptForget',
  'runCollection', 'runCancel', 'runPickData', 'runSaveJUnit'
] as const

const api = Object.fromEntries(channels.map((c) => [c, call(c)])) as unknown as ZenoApi
api.onChanged = (cb) => {
  const listener = (_e: unknown, ws: Workspace[]): void => cb(ws)
  ipcRenderer.on('store:changed', listener)
  return () => ipcRenderer.removeListener('store:changed', listener)
}

api.onResponse = (cb) => {
  const listener = (_e: unknown, id: string, h: ResponseRecord[]): void => cb(id, h)
  ipcRenderer.on('response:added', listener)
  return () => ipcRenderer.removeListener('response:added', listener)
}

api.onRunStep = (cb) => {
  const listener = (_e: unknown, step: RunStep, i: number, total: number): void => cb(step, i, total)
  ipcRenderer.on('run:step', listener)
  return () => ipcRenderer.removeListener('run:step', listener)
}

api.onPrompt = (cb) => {
  const listener = (_e: unknown, id: number, p: PromptAsk): void => cb(id, p)
  ipcRenderer.on('prompt:ask', listener)
  return () => ipcRenderer.removeListener('prompt:ask', listener)
}

api.setZoom = (factor) => webFrame.setZoomFactor(factor)

contextBridge.exposeInMainWorld('zeno', api)
