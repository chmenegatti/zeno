// Atalhos globais (padrão do Insomnia) e preferências de interface: zoom, fontes, lateral.

import { t } from '@shared/i18n'
import { EditorView } from '@uiw/react-codemirror'
import { beautifyJson } from '@shared/format'
import { findHotkeys, type HotkeyDef } from '@shared/hotkeys'
import { getTheme, themeVars } from '@shared/themes'
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
  applyTheme(p.theme)
}

/** troca as variáveis de cor; color-scheme acompanha (selects, barras de rolagem, datas) */
export const THEME_CACHE = 'zeno:theme'

export function applyTheme(id: string | undefined): void {
  const th = getTheme(id)
  try {
    localStorage.setItem(THEME_CACHE, th.id)
  } catch {
    /* sem storage */
  }
  const root = document.documentElement
  for (const [k, v] of Object.entries(themeVars(th))) root.style.setProperty(k, v)
  root.style.colorScheme = th.dark ? 'dark' : 'light'
  root.dataset.theme = th.id
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
  useStore.getState().notify(t('Fonte dos editores {size}px', { size }))
}

/** foca um alvo marcado com data-hk (o próprio elemento ou o 1º focável dentro) */
function focusTarget(name: string, open = false): void {
  const el = document.querySelector<HTMLElement>(`[data-hk="${name}"]`)
  if (!el) return
  const sel = 'input,select,textarea,[role="combobox"],[tabindex],.cm-content'
  const target = el.matches(sel) ? el : el.querySelector<HTMLElement>(sel)
  target?.focus()
  if (target instanceof HTMLInputElement) target.select()
  if (open && target instanceof HTMLSelectElement) target.showPicker?.()
  // lista própria (Select): abre como o clique
  if (open && target?.getAttribute('role') === 'combobox' && target.getAttribute('aria-expanded') !== 'true') target.click()
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
  quickSwitch: () => useStore.getState().openModal({ kind: 'palette' }),
  focusUrl: () => focusTarget('url'),
  focusResponse: () => focusTarget('response'),
  showShortcuts: () => useStore.getState().openModal({ kind: 'shortcuts' }),
  showPreferences: () => useStore.getState().openModal({ kind: 'prefs' }),
  workspaces: () => useStore.getState().openModal({ kind: 'workspaces' }),
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
  methodMenu: () => {
    if (current().found?.node.kind === 'request') useStore.setState({ methodMenu: true })
  },
  history: () => focusTarget('history', true),
  generateCode: () => {
    const { s, found } = current()
    if (found) s.openModal({ kind: 'code', id: found.node.id })
  },
  envEditor: () => {
    const { s, ws } = current()
    if (ws) s.openModal({ kind: 'env', id: ws.id })
  },
  envSwitch: () => focusTarget('env', true),
  sendOptions: () => {
    if (current().found?.node.kind === 'request') useStore.setState({ sendMenu: true })
  },
  beautify: () => beautifyFocused(),
  cookies: () => {
    const { s, ws } = current()
    if (ws) s.openModal({ kind: 'cookies', id: ws.id })
  },
  togglePin: () => {
    const { s, found } = current()
    if (found?.node.kind !== 'request') return
    const id = found.node.id
    const pinned = s.app.pinned ?? []
    const on = !pinned.includes(id)
    s.setApp({ pinned: on ? [...pinned, id] : pinned.filter((x) => x !== id) })
    s.notify(on ? t('"{name}" fixado', { name: found.node.name }) : t('"{name}" desafixado', { name: found.node.name }))
  },
  showValues: () => {
    const on = !useStore.getState().showValues
    useStore.setState({ showValues: on })
    useStore.getState().notify(on ? t('Variáveis mostrando o valor (Alt+Shift+U volta)') : t('Variáveis mostrando o nome'))
  }
}

/** formata o JSON do editor com foco (body, ambientes, pasta) */
function beautifyFocused(): void {
  const dom = (document.activeElement as HTMLElement | null)?.closest<HTMLElement>('.cm-editor')
  const view = dom && EditorView.findFromDOM(dom)
  if (!view || view.state.readOnly) return
  const text = view.state.doc.toString()
  if (!text.trim()) return
  try {
    const out = beautifyJson(text)
    if (out !== text) view.dispatch({ changes: { from: 0, to: text.length, insert: out } })
  } catch {
    useStore.getState().notify(t('Só dá pra formatar JSON válido'))
  }
}

function showSearch(): void {
  if (ui().sidebarHidden) setUi({ sidebarHidden: false })
  setTimeout(() => focusTarget('search'), 0)
}

/** executa uma ação da lista de atalhos (usado pela paleta) */
export function runAction(id: string): void {
  ACTIONS[id]?.()
}

/** true enquanto a tela de atalhos grava uma combinação */
export const recording = { on: false }

function onKey(e: KeyboardEvent): void {
  if (recording.on) return
  const s = useStore.getState()
  const el = e.target as HTMLElement | null
  const inEditor = !!el?.closest('.cm-editor')
  const allowed = (hk: HotkeyDef): boolean =>
    !(e.repeat && !/^(zoom|editorFont)/.test(hk.id)) && // segurar a tecla repete só zoom/fonte
    (hk.global || (!s.modal && !s.tagEdit)) &&
    !(hk.notInEditor && inEditor) &&
    !(hk.onlyInEditor && !inEditor) &&
    !(hk.notInText && !!el?.matches('input,textarea,select,[role="combobox"],[contenteditable="true"]'))
  const keys = { key: e.key, code: e.code, ctrlKey: e.ctrlKey, metaKey: e.metaKey, shiftKey: e.shiftKey, altKey: e.altKey, altGraph: e.getModifierState?.('AltGraph') }
  const hk = findHotkeys(keys, ui().hotkeys).find(allowed)
  if (!hk) return
  e.preventDefault()
  ACTIONS[hk.id]?.()
}

export function installHotkeys(): () => void {
  window.addEventListener('keydown', onKey)
  return () => window.removeEventListener('keydown', onKey)
}
