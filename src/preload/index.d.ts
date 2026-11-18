import type { ZenoApi } from '../shared/api'

declare global {
  interface Window {
    zeno: ZenoApi
  }
}
