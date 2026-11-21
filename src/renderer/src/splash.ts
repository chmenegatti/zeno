// Splash (#181): o HTML está em index.html (aparece antes do JavaScript); aqui entram idioma e versão, e a
// saída quando os workspaces carregam. Fica pelo menos o tempo da animação do logo, pra não piscar.
const LANG_CACHE = 'zeno.lang'
const MIN_MS = 1300
const start = performance.now()

export function rememberLang(lang: string): void {
  try {
    localStorage.setItem(LANG_CACHE, lang)
  } catch {
    /* sem storage */
  }
}

function cachedLang(): string {
  try {
    return localStorage.getItem(LANG_CACHE) ?? 'en'
  } catch {
    return 'en'
  }
}

const el = document.getElementById('splash')
if (el) {
  const lang = cachedLang() === 'pt' ? 'pt' : 'en'
  el.querySelectorAll<HTMLElement>('[data-en]').forEach((n) => (n.textContent = n.dataset[lang] ?? n.textContent))
  const v = el.querySelector('.version')
  if (v) v.textContent = 'v' + __ZENO_VERSION__
}

let hiding = false
export function hideSplash(): void {
  if (!el || hiding) return
  hiding = true
  const wait = Math.max(0, MIN_MS - (performance.now() - start))
  setTimeout(() => {
    el.classList.add('out')
    setTimeout(() => el.remove(), 500)
  }, wait)
}

// se o carregamento falhar, o erro aparece na interface: o splash não pode ficar por cima pra sempre
setTimeout(hideSplash, 15000)
