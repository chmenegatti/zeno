import { contextBridge, ipcRenderer } from 'electron'
import type { ZenoApi } from '../shared/api'
import type { ResponseRecord, Workspace } from '../shared/types'

const call =
  (channel: string) =>
  (...args: unknown[]) =>
    ipcRenderer.invoke(channel, ...args)

const channels = [
  'load', 'setState', 'createWorkspace', 'saveWorkspace', 'deleteWorkspace',
  'createRequest', 'createFolder', 'saveRequest', 'saveFolder', 'deleteNode', 'moveNode', 'duplicate',
  'saveEnvironment', 'deleteEnvironment', 'send', 'cancel', 'responses', 'clearResponses',
  'importPreview', 'importRun', 'pickFile', 'openDataDir'
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

contextBridge.exposeInMainWorld('zeno', api)
