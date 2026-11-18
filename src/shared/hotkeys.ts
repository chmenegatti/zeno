// Atalhos de teclado: mesmo padrão do Insomnia (Linux/Windows), sobrescrevíveis pelo usuário.
// Combinação em texto: "Ctrl+Shift+E", "Ctrl+=", "F5". Ctrl também casa com Cmd no macOS.

export type HotkeyGroup = 'Interface' | 'Request' | 'Ambientes'

export interface HotkeyDef {
  id: string
  label: string
  group: HotkeyGroup
  keys: string[]
  /** vale com modal aberto (zoom, tela cheia…) */
  global?: boolean
  /** não dispara com o foco num editor de código (o CodeMirror usa a mesma tecla) */
  notInEditor?: boolean
  /** não dispara com o foco em campo de texto */
  notInText?: boolean
}

export const HOTKEYS: HotkeyDef[] = [
  // interface
  { id: 'zoomIn', label: 'Aumentar zoom', group: 'Interface', keys: ['Ctrl+='], global: true },
  { id: 'zoomOut', label: 'Diminuir zoom', group: 'Interface', keys: ['Ctrl+-'], global: true },
  { id: 'zoomReset', label: 'Zoom 100%', group: 'Interface', keys: ['Ctrl+0'], global: true },
  { id: 'editorFontUp', label: 'Aumentar fonte dos editores', group: 'Interface', keys: ['Ctrl+Shift+='], global: true },
  { id: 'editorFontDown', label: 'Diminuir fonte dos editores', group: 'Interface', keys: ['Ctrl+Shift+-'], global: true },
  { id: 'sidebarToggle', label: 'Mostrar/esconder lateral', group: 'Interface', keys: ['Ctrl+\\'] },
  { id: 'sidebarFilter', label: 'Filtrar a lateral', group: 'Interface', keys: ['Ctrl+Shift+F'], notInEditor: true },
  { id: 'quickSwitch', label: 'Paleta de comandos', group: 'Interface', keys: ['Ctrl+P', 'Ctrl+K'] },
  { id: 'focusUrl', label: 'Focar a URL', group: 'Interface', keys: ['Ctrl+L'], notInEditor: true },
  { id: 'focusResponse', label: 'Focar a resposta', group: 'Interface', keys: ["Ctrl+'"] },
  { id: 'showShortcuts', label: 'Atalhos de teclado', group: 'Interface', keys: ['Ctrl+Shift+/'], global: true },
  { id: 'showPreferences', label: 'Preferências', group: 'Interface', keys: ['Ctrl+,'], global: true },
  { id: 'workspaceSettings', label: 'Configurações do workspace', group: 'Interface', keys: ['Ctrl+Shift+,'] },
  { id: 'fullscreen', label: 'Tela cheia', group: 'Interface', keys: ['F11'], global: true },
  { id: 'devtools', label: 'Ferramentas de desenvolvedor', group: 'Interface', keys: ['Ctrl+Alt+I', 'Ctrl+Shift+I'], global: true },
  { id: 'quit', label: 'Sair', group: 'Interface', keys: ['Ctrl+Q'], global: true },
  // request
  { id: 'send', label: 'Enviar request', group: 'Request', keys: ['Ctrl+Enter', 'Ctrl+R', 'F5'] },
  { id: 'save', label: 'Salvar agora', group: 'Request', keys: ['Ctrl+S'] },
  { id: 'newRequest', label: 'Novo request', group: 'Request', keys: ['Ctrl+N', 'Ctrl+Alt+N'] },
  { id: 'newFolder', label: 'Nova pasta', group: 'Request', keys: ['Ctrl+Shift+N'] },
  { id: 'duplicate', label: 'Duplicar request', group: 'Request', keys: ['Ctrl+D'], notInEditor: true },
  { id: 'delete', label: 'Excluir request', group: 'Request', keys: ['Ctrl+Shift+Backspace'], notInText: true },
  { id: 'methodMenu', label: 'Trocar método HTTP', group: 'Request', keys: ['Ctrl+Shift+L'] },
  { id: 'history', label: 'Histórico de respostas', group: 'Request', keys: ['Ctrl+Shift+H'] },
  { id: 'generateCode', label: 'Gerar código', group: 'Request', keys: ['Ctrl+Shift+G'] },
  // ambientes
  { id: 'envEditor', label: 'Editar ambientes', group: 'Ambientes', keys: ['Ctrl+E'] },
  { id: 'envSwitch', label: 'Trocar ambiente', group: 'Ambientes', keys: ['Ctrl+Shift+E'] }
]

export interface KeyLike {
  key: string
  code: string
  ctrlKey: boolean
  metaKey: boolean
  shiftKey: boolean
  altKey: boolean
  /** AltGr (no Windows chega como Ctrl+Alt): é digitação de caractere, nunca atalho */
  altGraph?: boolean
}

// tecla pela posição (layout US, como o keyCode do Insomnia); cobre também o ABNT2 (IntlRo = "/")
const CODE_KEY: Record<string, string> = {
  Equal: '=', NumpadAdd: '=', Minus: '-', NumpadSubtract: '-', Backslash: '\\', IntlBackslash: '\\', Quote: "'",
  Slash: '/', IntlRo: '/', NumpadDivide: '/', Comma: ',', Period: '.', Semicolon: ';', BracketLeft: '[', BracketRight: ']',
  Backquote: '`', Enter: 'Enter', NumpadEnter: 'Enter', Backspace: 'Backspace', Space: 'Space', Tab: 'Tab', Escape: 'Escape', Delete: 'Delete'
}

const keyName = (k: string): string => (k.length === 1 ? k.toUpperCase() : k === ' ' ? 'Space' : k)

/** teclas candidatas do evento: pela posição e pelo caractere */
function eventKeys(e: KeyLike): string[] {
  const out = new Set<string>()
  const m = /^(?:Key([A-Z])|Digit(\d)|Numpad(\d)|(F\d{1,2}))$/.exec(e.code)
  if (m) out.add(m[1] ?? m[2] ?? m[3] ?? m[4])
  else if (CODE_KEY[e.code]) out.add(CODE_KEY[e.code])
  if (e.key && e.key !== 'Unidentified' && e.key !== 'Dead') out.add(keyName(e.key))
  return [...out]
}



export function parseCombo(combo: string): { ctrl: boolean; shift: boolean; alt: boolean; key: string } {
  const parts = combo.split('+')
  // "Ctrl++" → tecla "+"
  const key = combo.endsWith('++') ? '+' : parts.pop()!
  const mods = new Set(parts.filter(Boolean))
  return { ctrl: mods.has('Ctrl'), shift: mods.has('Shift'), alt: mods.has('Alt'), key }
}

export function matches(e: KeyLike, combo: string): boolean {
  if (e.altGraph) return false
  const c = parseCombo(combo)
  if (c.ctrl !== (e.ctrlKey || e.metaKey) || c.shift !== e.shiftKey || c.alt !== e.altKey) return false
  return eventKeys(e).includes(c.key)
}

/** combinação gravada a partir de um evento (tela de atalhos); null = só modificador */
export function comboFromEvent(e: KeyLike): string | null {
  if (['Control', 'Shift', 'Alt', 'AltGraph', 'Meta'].includes(e.key) || e.altGraph) return null
  const key = eventKeys(e)[0]
  if (!key) return null
  const mods = [e.ctrlKey || e.metaKey ? 'Ctrl' : '', e.shiftKey ? 'Shift' : '', e.altKey ? 'Alt' : ''].filter(Boolean)
  // sem modificador só F1–F12
  if (!mods.length && !/^F\d+$/.test(key)) return null
  return [...mods, key].join('+')
}

export type HotkeyOverrides = Record<string, string[]>

export function bindings(overrides: HotkeyOverrides = {}): Record<string, string[]> {
  return Object.fromEntries(HOTKEYS.map((h) => [h.id, overrides[h.id] ?? h.keys]))
}

export function findHotkey(e: KeyLike, overrides: HotkeyOverrides = {}): HotkeyDef | undefined {
  const b = bindings(overrides)
  return HOTKEYS.find((h) => b[h.id].some((c) => matches(e, c)))
}

/** ações que usam a mesma combinação */
export function conflicts(overrides: HotkeyOverrides = {}): Record<string, string[]> {
  const by: Record<string, string[]> = {}
  for (const [id, keys] of Object.entries(bindings(overrides))) for (const k of keys) (by[k] ??= []).push(id)
  return Object.fromEntries(Object.entries(by).filter(([, ids]) => ids.length > 1))
}


