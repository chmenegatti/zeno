// Voltar/avançar entre requests (#152): Alt+←/→, botões laterais do mouse e Ctrl+Tab (recentes).

import { NavHistory, type NavEntry } from '@shared/navhistory'
import { findNode } from '@shared/tree'
import { activeWorkspace, useStore, type Store } from './state'

export const nav = new NavHistory()

export function navExists(e: NavEntry): boolean {
  const ws = useStore.getState().workspaces.find((w) => w.id === e.ws)
  return !!ws && findNode(ws, e.id)?.node.kind === 'request'
}

export function navigate(dir: -1 | 1): void {
  const e = nav.go(dir, navExists)
  if (!e) return
  const s = useStore.getState()
  if (e.ws !== activeWorkspace(s)?.id) s.setApp({ activeWorkspaceId: e.ws })
  s.selectRequest(e.id)
}

export function installNav(): () => void {
  const sync = (s: Store): void => {
    const ws = activeWorkspace(s)?.id
    const id = s.app.activeRequestId
    // troca de workspace chega antes do request novo: só conta o par que existe
    if (ws && id && navExists({ ws, id })) nav.visit({ ws, id })
  }
  sync(useStore.getState())
  const unsub = useStore.subscribe((s, p) => {
    if (s.app.activeRequestId !== p.app.activeRequestId || s.app.activeWorkspaceId !== p.app.activeWorkspaceId) sync(s)
    if (s.workspaces !== p.workspaces) nav.forget(navExists)
  })
  // botões voltar/avançar do mouse; sem preventDefault o WebKit tentaria navegar a página
  const onMouse = (e: MouseEvent): void => {
    if (e.button !== 3 && e.button !== 4) return
    e.preventDefault()
    if (e.type === 'mouseup') navigate(e.button === 3 ? -1 : 1)
  }
  window.addEventListener('mousedown', onMouse)
  window.addEventListener('mouseup', onMouse)
  return () => {
    unsub()
    window.removeEventListener('mousedown', onMouse)
    window.removeEventListener('mouseup', onMouse)
  }
}
