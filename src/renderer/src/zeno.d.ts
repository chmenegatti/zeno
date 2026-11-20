// window.zeno: a API do app. Na versão Go a bridge.ts monta em cima do App.Call do Wails.
import type { ZenoApi } from '../../shared/api'

declare global {
  interface Window {
    zeno: ZenoApi
  }
}
