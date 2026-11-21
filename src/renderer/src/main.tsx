// precisa vir antes de tudo: define window.zeno (ponte com o Go)
import './bridge'
import './splash'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles.css'
import { App } from './App'
import { applyTheme, THEME_CACHE } from './hotkeys'

// último tema usado antes do primeiro render (state.json chega depois e confirma)
try {
  applyTheme(localStorage.getItem(THEME_CACHE) ?? undefined)
} catch {
  /* sem storage */
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
