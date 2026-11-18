import { describe, expect, it } from 'vitest'
import { bindings, comboFromEvent, conflicts, findHotkey, HOTKEYS, matches, parseCombo, type KeyLike } from '../src/shared/hotkeys'

const ev = (code: string, key: string, mods: Partial<KeyLike> = {}): KeyLike => ({ code, key, ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, ...mods })
const ctrl = { ctrlKey: true }

describe('hotkeys', () => {
  it('padrão segue o Insomnia', () => {
    const b = bindings()
    expect(b.zoomIn).toEqual(['Ctrl+='])
    expect(b.sidebarToggle).toEqual(['Ctrl+\\'])
    expect(b.envEditor).toEqual(['Ctrl+E'])
    expect(b.envSwitch).toEqual(['Ctrl+Shift+E'])
    expect(b.send).toEqual(['Ctrl+Enter', 'Ctrl+R', 'F5'])
    expect(b.quickSwitch[0]).toBe('Ctrl+P')
  })

  it('ids únicos e sem conflito no padrão', () => {
    expect(new Set(HOTKEYS.map((h) => h.id)).size).toBe(HOTKEYS.length)
    expect(conflicts()).toEqual({})
  })

  it('casa pela posição e pelo caractere', () => {
    expect(matches(ev('Equal', '=', ctrl), 'Ctrl+=')).toBe(true)
    expect(matches(ev('NumpadAdd', '+', ctrl), 'Ctrl+=')).toBe(true)
    expect(matches(ev('Equal', '+', { ctrlKey: true, shiftKey: true }), 'Ctrl+Shift+=')).toBe(true)
    expect(matches(ev('Equal', '+', { ctrlKey: true, shiftKey: true }), 'Ctrl+=')).toBe(false)
    expect(matches(ev('KeyE', 'e', { metaKey: true }), 'Ctrl+E')).toBe(true)
    expect(matches(ev('KeyE', 'E', { ctrlKey: true, shiftKey: true }), 'Ctrl+E')).toBe(false)
    expect(matches(ev('F5', 'F5'), 'F5')).toBe(true)
  })

  it('ABNT2: / (IntlRo), \\ (IntlBackslash) e apóstrofo', () => {
    expect(matches(ev('IntlRo', '?', { ctrlKey: true, shiftKey: true }), 'Ctrl+Shift+/')).toBe(true)
    expect(matches(ev('IntlBackslash', '\\', ctrl), 'Ctrl+\\')).toBe(true)
    expect(matches(ev('Backquote', "'", ctrl), "Ctrl+'")).toBe(true)
  })

  it('findHotkey respeita sobrescrita', () => {
    expect(findHotkey(ev('KeyE', 'e', ctrl))?.id).toBe('envEditor')
    const o = { envEditor: ['Ctrl+Alt+E'] }
    expect(findHotkey(ev('KeyE', 'e', ctrl), o)).toBeUndefined()
    expect(findHotkey(ev('KeyE', 'e', { ctrlKey: true, altKey: true }), o)?.id).toBe('envEditor')
    expect(conflicts({ duplicate: ['Ctrl+E'] })).toEqual({ 'Ctrl+E': ['duplicate', 'envEditor'] })
  })

  it('comboFromEvent', () => {
    expect(comboFromEvent(ev('KeyK', 'k', { ctrlKey: true, shiftKey: true }))).toBe('Ctrl+Shift+K')
    expect(comboFromEvent(ev('ControlLeft', 'Control', ctrl))).toBeNull()
    expect(comboFromEvent(ev('KeyK', 'k'))).toBeNull()
    expect(comboFromEvent(ev('F7', 'F7'))).toBe('F7')
    expect(parseCombo('Ctrl++')).toEqual({ ctrl: true, shift: false, alt: false, key: '+' })
  })
})
