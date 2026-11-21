// Atalhos de teclado: mesmo padrão do Insomnia (Linux/Windows), sobrescrevíveis pelo usuário.
// Combinação em texto: "Ctrl+Shift+E", "Ctrl+=", "F5". Ctrl também casa com Cmd no macOS.

import { tk } from './i18n'

export type HotkeyGroup = 'Interface' | 'Request' | 'Ambientes'

/** nome do grupo pra mostrar (o grupo é id): renderize com t() */
export const HOTKEY_GROUP_LABEL: Record<HotkeyGroup, string> = { Interface: tk('Interface'), Request: tk('Request'), Ambientes: tk('Ambientes') }

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
  /** só dispara com o foco num editor de código (divide a tecla com uma ação notInEditor) */
  onlyInEditor?: boolean
}

export const HOTKEYS: HotkeyDef[] = [
  // interface
  { id: 'zoomIn', label: tk('Aumentar zoom'), group: 'Interface', keys: ['Ctrl+='], global: true },
  { id: 'zoomOut', label: tk('Diminuir zoom'), group: 'Interface', keys: ['Ctrl+-'], global: true },
  { id: 'zoomReset', label: tk('Zoom 100%'), group: 'Interface', keys: ['Ctrl+0'], global: true },
  { id: 'editorFontUp', label: tk('Aumentar fonte dos editores'), group: 'Interface', keys: ['Ctrl+Shift+='], global: true },
  { id: 'editorFontDown', label: tk('Diminuir fonte dos editores'), group: 'Interface', keys: ['Ctrl+Shift+-'], global: true },
  { id: 'sidebarToggle', label: tk('Mostrar/esconder lateral'), group: 'Interface', keys: ['Ctrl+\\'] },
  { id: 'sidebarFilter', label: tk('Filtrar a lateral'), group: 'Interface', keys: ['Ctrl+Shift+F'], notInEditor: true },
  { id: 'quickSwitch', label: tk('Paleta de comandos'), group: 'Interface', keys: ['Ctrl+P'] },
  { id: 'navBack', label: tk('Voltar ao request anterior'), group: 'Interface', keys: ['Alt+ArrowLeft'], notInText: true },
  { id: 'navForward', label: tk('Avançar pro próximo request'), group: 'Interface', keys: ['Alt+ArrowRight'], notInText: true },
  { id: 'recentSwitch', label: tk('Requests recentes'), group: 'Interface', keys: ['Ctrl+Tab'] },
  { id: 'focusUrl', label: tk('Focar a URL'), group: 'Interface', keys: ['Ctrl+L'], notInEditor: true },
  { id: 'focusResponse', label: tk('Focar a resposta'), group: 'Interface', keys: ["Ctrl+'"] },
  { id: 'showShortcuts', label: tk('Atalhos de teclado'), group: 'Interface', keys: ['Ctrl+Shift+/'], global: true },
  { id: 'showPreferences', label: tk('Preferências'), group: 'Interface', keys: ['Ctrl+,'], global: true },
  { id: 'workspaces', label: tk('Gerenciar workspaces'), group: 'Interface', keys: ['Ctrl+Shift+O'] },
  { id: 'workspaceSettings', label: tk('Configurações do workspace'), group: 'Interface', keys: ['Ctrl+Shift+,'] },
  { id: 'fullscreen', label: tk('Tela cheia'), group: 'Interface', keys: ['F11'], global: true },
  { id: 'devtools', label: tk('Ferramentas de desenvolvedor'), group: 'Interface', keys: ['Ctrl+Alt+I', 'Ctrl+Shift+I'], global: true },
  { id: 'quit', label: tk('Sair'), group: 'Interface', keys: ['Ctrl+Q'], global: true },
  // request
  { id: 'send', label: tk('Enviar request'), group: 'Request', keys: ['Ctrl+Enter', 'Ctrl+R', 'F5'] },
  { id: 'sendOptions', label: tk('Opções de envio (atrasar, repetir)'), group: 'Request', keys: ['Ctrl+Shift+Enter'] },
  { id: 'beautify', label: tk('Formatar JSON do editor'), group: 'Request', keys: ['Ctrl+Shift+F'], global: true, onlyInEditor: true },
  { id: 'cookies', label: tk('Cookies do workspace'), group: 'Request', keys: ['Ctrl+K'] },
  { id: 'togglePin', label: tk('Fixar/desafixar request'), group: 'Request', keys: ['Ctrl+Shift+P'] },
  { id: 'save', label: tk('Salvar agora'), group: 'Request', keys: ['Ctrl+S'] },
  { id: 'newRequest', label: tk('Novo request'), group: 'Request', keys: ['Ctrl+N', 'Ctrl+Alt+N'] },
  { id: 'newFolder', label: tk('Nova pasta'), group: 'Request', keys: ['Ctrl+Shift+N'] },
  { id: 'duplicate', label: tk('Duplicar request'), group: 'Request', keys: ['Ctrl+D'], notInEditor: true },
  { id: 'delete', label: tk('Excluir request'), group: 'Request', keys: ['Ctrl+Shift+Backspace'], notInText: true },
  { id: 'methodMenu', label: tk('Trocar método HTTP'), group: 'Request', keys: ['Ctrl+Shift+L'] },
  { id: 'history', label: tk('Histórico de respostas'), group: 'Request', keys: ['Ctrl+Shift+H'] },
  { id: 'generateCode', label: tk('Gerar código'), group: 'Request', keys: ['Ctrl+Shift+G'] },
  // ambientes
  { id: 'envEditor', label: tk('Editar ambientes'), group: 'Ambientes', keys: ['Ctrl+E'] },
  { id: 'envSwitch', label: tk('Trocar ambiente'), group: 'Ambientes', keys: ['Ctrl+Shift+E'] },
  { id: 'showValues', label: tk('Mostrar valor das variáveis'), group: 'Ambientes', keys: ['Alt+Shift+U'], global: true }
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

/** forma única: Ctrl, Shift, Alt, tecla ("Alt+Shift+U" = "Shift+Alt+U") */
export function canon(combo: string): string {
  const c = parseCombo(combo)
  return [c.ctrl ? 'Ctrl' : '', c.shift ? 'Shift' : '', c.alt ? 'Alt' : '', c.key].filter(Boolean).join('+')
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

/** ações cuja combinação casa com o evento (na ordem da lista; quem chama escolhe pelo contexto) */
export function findHotkeys(e: KeyLike, overrides: HotkeyOverrides = {}): HotkeyDef[] {
  const b = bindings(overrides)
  return HOTKEYS.filter((h) => b[h.id].some((c) => matches(e, c)))
}

export function findHotkey(e: KeyLike, overrides: HotkeyOverrides = {}): HotkeyDef | undefined {
  return findHotkeys(e, overrides)[0]
}

const byId = (id: string): HotkeyDef | undefined => HOTKEYS.find((h) => h.id === id)
/** uma só no editor, a outra só fora dele: dividem a tecla sem brigar */
const disjoint = (a?: HotkeyDef, b?: HotkeyDef): boolean => !!a && !!b && ((!!a.onlyInEditor && !!b.notInEditor) || (!!a.notInEditor && !!b.onlyInEditor))

/** ações que usam a mesma combinação */
export function conflicts(overrides: HotkeyOverrides = {}): Record<string, string[]> {
  const by: Record<string, string[]> = {}
  for (const [id, keys] of Object.entries(bindings(overrides))) for (const k of keys) (by[canon(k)] ??= []).push(id)
  return Object.fromEntries(
    Object.entries(by).filter(([, ids]) => ids.some((a, i) => ids.slice(i + 1).some((b) => !disjoint(byId(a), byId(b)))))
  )
}

// ---------- importar do Insomnia (insomnia.Settings.db → hotKeyRegistry) ----------

export interface InsomniaKey {
  ctrl?: boolean
  shift?: boolean
  alt?: boolean
  meta?: boolean
  keyCode: number
}

const INSOMNIA_IDS: Record<string, string> = {
  beautifyRequestBody: 'beautify',
  environment_showEditor: 'envEditor',
  environment_showSwitchMenu: 'envSwitch',
  environment_showVariableSourceAndValue: 'showValues',
  preferences_showGeneral: 'showPreferences',
  preferences_showKeyboardShortcuts: 'showShortcuts',
  request_createHTTP: 'newRequest',
  request_focusUrl: 'focusUrl',
  request_quickSwitch: 'quickSwitch',
  request_send: 'send',
  request_showCreateFolder: 'newFolder',
  request_showDelete: 'delete',
  request_showDuplicate: 'duplicate',
  request_showGenerateCodeEditor: 'generateCode',
  request_showOptions: 'sendOptions',
  request_toggleHistory: 'history',
  request_toggleHttpMethodMenu: 'methodMenu',
  request_togglePin: 'togglePin',
  showCookiesEditor: 'cookies',
  response_focus: 'focusResponse',
  sidebar_focusFilter: 'sidebarFilter',
  sidebar_toggle: 'sidebarToggle',
  workspace_showSettings: 'workspaceSettings'
}

const KEYCODE: Record<number, string> = {
  8: 'Backspace', 9: 'Tab', 13: 'Enter', 27: 'Escape', 32: 'Space', 46: 'Delete', 186: ';', 187: '=', 188: ',', 189: '-',
  190: '.', 191: '/', 192: '`', 219: '[', 220: '\\', 221: ']', 222: "'", 107: '=', 109: '-', 111: '/'
}

export function comboFromInsomnia(k: InsomniaKey): string | null {
  const c = k.keyCode
  const key =
    c >= 65 && c <= 90 ? String.fromCharCode(c) : c >= 48 && c <= 57 ? String(c - 48) : c >= 96 && c <= 105 ? String(c - 96) : c >= 112 && c <= 123 ? `F${c - 111}` : KEYCODE[c]
  if (!key) return null
  return [k.ctrl || k.meta ? 'Ctrl' : '', k.shift ? 'Shift' : '', k.alt ? 'Alt' : '', key].filter(Boolean).join('+')
}

/** atalhos do Insomnia que diferem dos nossos; se o nosso padrão já cobre os dele, não mexe */
export function fromInsomnia(registry: Record<string, { macKeys?: InsomniaKey[]; winLinuxKeys?: InsomniaKey[] }>, mac = false): HotkeyOverrides {
  const out: HotkeyOverrides = {}
  for (const [insId, def] of Object.entries(registry)) {
    const id = INSOMNIA_IDS[insId]
    const h = id && byId(id)
    const list = mac ? def.macKeys : def.winLinuxKeys
    if (!h || !list) continue
    const keys = [...new Set(list.map(comboFromInsomnia).filter((k): k is string => !!k))]
    if (keys.length && keys.every((k) => h.keys.some((d) => canon(d) === canon(k)))) continue
    out[id] = keys
  }
  return out
}


/** combinação pra mostrar: no macOS com os símbolos (⌘⇧E); Ctrl também casa com Cmd lá */
const ARROWS: Record<string, string> = { ArrowLeft: '←', ArrowRight: '→', ArrowUp: '↑', ArrowDown: '↓' }

export function keyLabel(combo: string, mac: boolean): string {
  if (!mac) return combo.replace(/Arrow(Left|Right|Up|Down)/, (a) => ARROWS[a])
  const sym: Record<string, string> = { Ctrl: '⌘', Shift: '⇧', Alt: '⌥', Enter: '↩', Backspace: '⌫', Escape: '⎋', Delete: '⌦', ...ARROWS }
  return combo
    .split('+')
    .map((p, i, all) => (p === '' && i === all.length - 1 ? '+' : (sym[p] ?? p)))
    .filter((p, i, all) => p !== '' || i === all.length - 1)
    .join('')
}
