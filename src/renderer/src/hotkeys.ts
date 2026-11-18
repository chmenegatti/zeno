// Atalhos globais (padrão do Insomnia) e preferências de interface: zoom, fontes, lateral.

import { findHotkey } from '@shared/hotkeys'
import { findNode } from '@shared/tree'
import type { UiPrefs } from '@shared/types'
import { activeWorkspace, api, createFolderIn, createRequestIn, deleteNode, duplicateNode, useStore } from './state'

export const ZOOM_STEPS = [0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2]
export const UI_FONT = { min: 10, max: 20, def: 13 }
export const EDITOR_FONT = { min: 9, max: 28, def: 12.5 }

const clamp = (v: number, { min, max }: { min: number; max: number }): number => Math.min(max, Math.max(min, v))

export function ui(): UiPrefs {
  return useStore.getState().app.ui ?? {}
}

/** aplica zoom e fontes na janela */
export function applyUi(p: UiPrefs = ui()): void {
  api.setZoom(p.zoom ?? 1)
  const root = document.documentElement.style
  root.setProperty('--ui-font', `${p.fontSize ?? UI_FONT.def}px`)
  root.setProperty('--editor-font', `${p.editorFontSize ?? EDITOR_FONT.def}px`)
}

export function setUi(patch: Partial<UiPrefs>): void {
  const next = { ...ui(), ...patch }
  useStore.getState().setApp({ ui: next })
  applyUi(next)
}

function zoomStep(dir: 1 | -1): void {
  const cur = ui().zoom ?? 1
  const next = dir > 0 ? ZOOM_STEPS.find((z) => z > cur + 0.001) : [...ZOOM_STEPS].reverse().find((z) => z < cur - 0.001)
  if (next) setUi({ zoom: next })
  useStore.getState().notify(`Zoom ${Math.round((next ?? cur) * 100)}%`)
}

function editorFont(delta: number): void {
  const size = clamp((ui().editorFontSize ?? EDITOR_FONT.def) + delta, EDITOR_FONT)
  setUi({ editorFontSize: size })
  useStore.getState().notify(`Fonte dos editores ${size}px`)
}

/** foca um alvo marcado com data-hk (o próprio elemento ou o 1º focável dentro) */
function focusTarget(name: string, open = false): void {
  const el = document.querySelector<HTMLElement>(`[data-hk="${name}"]`)
  if (!el) return
  const target = el.matches('input,select,textarea,[tabindex],.cm-content') ? el : el.querySelector<HTMLElement>('input,select,textarea,.cm-content,[tabindex]')
  target?.focus()
  if (target instanceof HTMLInputElement) target.select()
  if (open && target instanceof HTMLSelectElement) target.showPicker?.()
}

function current() {
  const s = useStore.getState()
  const ws = activeWorkspace(s)
  const found = ws && s.app.activeRequestId ? findNode(ws, s.app.activeRequestId) : null
  return { s, ws, found }
}

const ACTIONS: Record<string, () => void> = {
  zoomIn: () => zoomStep(1),
  zoomOut: () => zoomStep(-1),
  zoomReset: () => {
    setUi({ zoom: 1 })
    useStore.getState().notify('Zoom 100%')
  },
  editorFontUp: () => editorFont(1),
  editorFontDown: () => editorFont(-1),
  sidebarToggle: () => setUi({ sidebarHidden: !ui().sidebarHidden }),
  sidebarFilter: () => showSearch(),
  quickSwitch: () => showSearch(),
  focusUrl: () => focusTarget('url'),
  focusResponse: () => focusTarget('response'),
  showShortcuts: () => useStore.getState().openModal({ kind: 'shortcuts' }),
  showPreferences: () => useStore.getState().openModal({ kind: 'prefs' }),
  workspaceSettings: () => {
    const { s, ws } = current()
    if (ws) s.openModal({ kind: 'workspace', id: ws.id })
  },
  fullscreen: () => api.windowAction('fullscreen'),
  devtools: () => api.windowAction('devtools'),
  quit: () => api.windowAction('quit'),
  send: () => useStore.getState().sendActive(),
  save: () => useStore.getState().flushSaves(),
  newRequest: () => {
    const { ws, found } = current()
    // cria na pasta do request atual
    if (ws) createRequestIn(found?.ancestors.at(-1)?.id ?? ws.id)
  },
  newFolder: () => {
    const { ws, found } = current()
    if (ws) createFolderIn(found?.ancestors.at(-1)?.id ?? ws.id)
  },
  duplicate: () => {
    const { found } = current()
    if (found) duplicateNode(found.node.id)
  },
  delete: () => {
    const { found } = current()
    if (found) deleteNode(found.node)
  },
  methodMenu: () => focusTarget('method', true),
  history: () => focusTarget('history', true),
  generateCode: () => {
    const { s, found } = current()
    if (found) s.openModal({ kind: 'code', id: found.node.id })
  },
  envEditor: () => {
    const { s, ws } = current()
    if (ws) s.openModal({ kind: 'env', id: ws.id })
  },
  envSwitch: () => focusTarget('env', true)
}

function showSearch(): void {
  if (ui().sidebarHidden) setUi({ sidebarHidden: false })
  setTimeout(() => focusTarget('search'), 0)
}

/** true enquanto a tela de atalhos grava uma combinação */
export const recording = { on: false }

function onKey(e: KeyboardEvent): void {
  if (recording.on) return
  const hk = findHotkey({ key: e.key, code: e.code, ctrlKey: e.ctrlKey, metaKey: e.metaKey, shiftKey: e.shiftKey, altKey: e.altKey, altGraph: e.getModifierState?.('AltGraph') }, ui().hotkeys)
  if (!hk) return
  // segurar a tecla repete só zoom/fonte
  if (e.repeat && !/^(zoom|editorFont)/.test(hk.id)) return
  const s = useStore.getState()
  if (!hk.global && (s.modal || s.tagEdit)) return
  const t = e.target as HTMLElement | null
  if (hk.notInEditor && t?.closest('.cm-editor')) return
  if (hk.notInText && t?.matches('input,textarea,select,[contenteditable="true"]')) return
  e.preventDefault()
  ACTIONS[hk.id]?.()
}

export function installHotkeys(): () => void {
  window.addEventListener('keydown', onKey)
  return () => window.removeEventListener('keydown', onKey)
}
