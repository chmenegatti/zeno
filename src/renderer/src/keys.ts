// Combinações como o usuário vê: ⌘⇧E no macOS, Ctrl+Shift+E nos outros
import { keyLabel } from '@shared/hotkeys'

export const isMac = typeof navigator !== 'undefined' && /^Mac/.test(navigator.platform)

export const kl = (combo: string): string => keyLabel(combo, isMac)
