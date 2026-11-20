// Dicionário pt → en, juntando os de cada área da interface
import app from './app'
import panes from './panes'
import modals from './modals'
import workspaces from './workspaces'
import shared from './shared'

export const EN: Record<string, string> = { ...shared, ...app, ...panes, ...modals, ...workspaces }
