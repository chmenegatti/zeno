// Temas embutidos: cores da interface e do realce de sintaxe. Aplicados como variáveis CSS (--color-*, --syn-*).

export interface ThemeColors {
  bg: string
  panel: string
  raised: string
  line: string
  ink: string
  dim: string
  faint: string
  accent: string
  /** texto sobre o accent (botão principal) */
  accentInk: string
  blue: string
  purple: string
  green: string
  lime: string
  orange: string
  pink: string
}

export interface Syntax {
  prop: string
  string: string
  number: string
  bool: string
  keyword: string
  attr: string
}

export interface Theme {
  id: string
  name: string
  dark: boolean
  colors: ThemeColors
  syntax: Syntax
}

/** realce padrão a partir das cores do tema (cada tema pode trocar só o que difere) */
const syn = (c: ThemeColors, over: Partial<Syntax> = {}): Syntax => ({ prop: c.blue, string: c.green, number: c.orange, bool: c.purple, keyword: c.pink, attr: c.lime, ...over })

const theme = (id: string, name: string, dark: boolean, colors: ThemeColors, over?: Partial<Syntax>): Theme => ({ id, name, dark, colors, syntax: syn(colors, over) })

export const THEMES: Theme[] = [
  // padrão: paleta TOTVS (marca.totvs.com)
  theme('totvs', 'TOTVS', true, { bg: '#00121c', panel: '#001a29', raised: '#002233', line: '#0b3347', ink: '#e4f3f8', dim: '#8eaab8', faint: '#577787', accent: '#00dbff', accentInk: '#002233', blue: '#00dbff', purple: '#a44dff', green: '#00ffd4', lime: '#d9ff65', orange: '#ff8900', pink: '#ff009e' }),

  // ---------- escuros ----------
  theme('aura-dark', 'Aura Dark', true, { bg: '#15141b', panel: '#1c1b22', raised: '#24222e', line: '#2f2d3a', ink: '#edecee', dim: '#adacae', faint: '#6d6d6d', accent: '#a277ff', accentInk: '#15141b', blue: '#82e2ff', purple: '#a277ff', green: '#61ffca', lime: '#ffca85', orange: '#ffca85', pink: '#f694ff' }, { prop: '#a277ff', string: '#61ffca', keyword: '#f694ff' }),
  theme('monokai', 'Monokai', true, { bg: '#272822', panel: '#2d2e27', raised: '#3e3d32', line: '#49483e', ink: '#f8f8f2', dim: '#cfcfc2', faint: '#75715e', accent: '#a6e22e', accentInk: '#272822', blue: '#66d9ef', purple: '#ae81ff', green: '#a6e22e', lime: '#e6db74', orange: '#fd971f', pink: '#f92672' }, { prop: '#f92672', string: '#e6db74', number: '#ae81ff' }),
  theme('synthwave', "Synthwave '84", true, { bg: '#262335', panel: '#2a2139', raised: '#34294f', line: '#463465', ink: '#ffffff', dim: '#bbbbbb', faint: '#848bbd', accent: '#ff7edb', accentInk: '#262335', blue: '#36f9f6', purple: '#b893ce', green: '#72f1b8', lime: '#fede5d', orange: '#f97e72', pink: '#ff7edb' }, { prop: '#36f9f6', string: '#ff8b39', number: '#f97e72', keyword: '#fede5d' }),
  theme('dracula', 'Dracula', true, { bg: '#282a36', panel: '#21222c', raised: '#343746', line: '#44475a', ink: '#f8f8f2', dim: '#c0c3d0', faint: '#6272a4', accent: '#bd93f9', accentInk: '#282a36', blue: '#8be9fd', purple: '#bd93f9', green: '#50fa7b', lime: '#f1fa8c', orange: '#ffb86c', pink: '#ff79c6' }, { prop: '#8be9fd', string: '#f1fa8c', number: '#bd93f9' }),
  theme('one-dark', 'One Dark', true, { bg: '#21252b', panel: '#282c34', raised: '#2c313a', line: '#3e4451', ink: '#d7dae0', dim: '#abb2bf', faint: '#5c6370', accent: '#61afef', accentInk: '#21252b', blue: '#61afef', purple: '#c678dd', green: '#98c379', lime: '#e5c07b', orange: '#d19a66', pink: '#e06c75' }, { prop: '#e06c75', keyword: '#c678dd' }),
  theme('nord', 'Nord', true, { bg: '#2e3440', panel: '#3b4252', raised: '#434c5e', line: '#4c566a', ink: '#eceff4', dim: '#d8dee9', faint: '#7b88a1', accent: '#88c0d0', accentInk: '#2e3440', blue: '#81a1c1', purple: '#b48ead', green: '#a3be8c', lime: '#ebcb8b', orange: '#d08770', pink: '#bf616a' }, { prop: '#8fbcbb', keyword: '#81a1c1' }),
  theme('tokyo-night', 'Tokyo Night', true, { bg: '#1a1b26', panel: '#16161e', raised: '#24283b', line: '#2f334d', ink: '#c0caf5', dim: '#a9b1d6', faint: '#565f89', accent: '#7aa2f7', accentInk: '#1a1b26', blue: '#7aa2f7', purple: '#bb9af7', green: '#9ece6a', lime: '#e0af68', orange: '#ff9e64', pink: '#f7768e' }, { prop: '#73daca', keyword: '#bb9af7' }),
  theme('catppuccin-mocha', 'Catppuccin Mocha', true, { bg: '#1e1e2e', panel: '#181825', raised: '#313244', line: '#45475a', ink: '#cdd6f4', dim: '#bac2de', faint: '#6c7086', accent: '#cba6f7', accentInk: '#1e1e2e', blue: '#89b4fa', purple: '#cba6f7', green: '#a6e3a1', lime: '#f9e2af', orange: '#fab387', pink: '#f38ba8' }),
  theme('gruvbox-dark', 'Gruvbox Dark', true, { bg: '#282828', panel: '#1d2021', raised: '#3c3836', line: '#504945', ink: '#ebdbb2', dim: '#d5c4a1', faint: '#928374', accent: '#fabd2f', accentInk: '#282828', blue: '#83a598', purple: '#d3869b', green: '#b8bb26', lime: '#fabd2f', orange: '#fe8019', pink: '#fb4934' }, { keyword: '#fb4934', number: '#d3869b' }),
  theme('solarized-dark', 'Solarized Dark', true, { bg: '#002b36', panel: '#073642', raised: '#0a4250', line: '#1c4f5b', ink: '#eee8d5', dim: '#93a1a1', faint: '#586e75', accent: '#268bd2', accentInk: '#fdf6e3', blue: '#268bd2', purple: '#6c71c4', green: '#859900', lime: '#b58900', orange: '#cb4b16', pink: '#d33682' }, { string: '#2aa198', number: '#d33682' }),
  theme('night-owl', 'Night Owl', true, { bg: '#011627', panel: '#0b2942', raised: '#13344f', line: '#1d3b53', ink: '#d6deeb', dim: '#a1aab8', faint: '#637777', accent: '#82aaff', accentInk: '#011627', blue: '#82aaff', purple: '#c792ea', green: '#addb67', lime: '#ecc48d', orange: '#f78c6c', pink: '#ff5874' }, { prop: '#7fdbca', string: '#ecc48d' }),
  theme('github-dark', 'GitHub Dark', true, { bg: '#0d1117', panel: '#161b22', raised: '#21262d', line: '#30363d', ink: '#e6edf3', dim: '#9da7b3', faint: '#6e7681', accent: '#2f81f7', accentInk: '#ffffff', blue: '#79c0ff', purple: '#d2a8ff', green: '#7ee787', lime: '#e3b341', orange: '#ffa657', pink: '#ff7b72' }, { string: '#a5d6ff', number: '#79c0ff', bool: '#79c0ff' }),
  theme('rose-pine', 'Rosé Pine', true, { bg: '#191724', panel: '#1f1d2e', raised: '#26233a', line: '#403d52', ink: '#e0def4', dim: '#908caa', faint: '#6e6a86', accent: '#c4a7e7', accentInk: '#191724', blue: '#9ccfd8', purple: '#c4a7e7', green: '#3e8fb0', lime: '#f6c177', orange: '#ebbcba', pink: '#eb6f92' }, { string: '#f6c177', number: '#ebbcba' }),
  theme('palenight', 'Material Palenight', true, { bg: '#292d3e', panel: '#242837', raised: '#32374d', line: '#3c435e', ink: '#d0d3e6', dim: '#a6accd', faint: '#676e95', accent: '#82aaff', accentInk: '#292d3e', blue: '#82aaff', purple: '#c792ea', green: '#c3e88d', lime: '#ffcb6b', orange: '#f78c6c', pink: '#f07178' }, { prop: '#f07178', keyword: '#c792ea' }),

  // ---------- claros ----------
  theme('github-light', 'GitHub Light', false, { bg: '#ffffff', panel: '#f6f8fa', raised: '#eaeef2', line: '#d0d7de', ink: '#1f2328', dim: '#57606a', faint: '#8c959f', accent: '#0969da', accentInk: '#ffffff', blue: '#0550ae', purple: '#8250df', green: '#116329', lime: '#9a6700', orange: '#bc4c00', pink: '#cf222e' }, { string: '#0a3069', number: '#0550ae', bool: '#0550ae' }),
  theme('solarized-light', 'Solarized Light', false, { bg: '#fdf6e3', panel: '#eee8d5', raised: '#e6dfc8', line: '#d6cfb8', ink: '#073642', dim: '#586e75', faint: '#93a1a1', accent: '#268bd2', accentInk: '#fdf6e3', blue: '#268bd2', purple: '#6c71c4', green: '#859900', lime: '#b58900', orange: '#cb4b16', pink: '#d33682' }, { string: '#2aa198', number: '#d33682' }),
  theme('catppuccin-latte', 'Catppuccin Latte', false, { bg: '#eff1f5', panel: '#e6e9ef', raised: '#dce0e8', line: '#ccd0da', ink: '#4c4f69', dim: '#5c5f77', faint: '#8c8fa1', accent: '#8839ef', accentInk: '#eff1f5', blue: '#1e66f5', purple: '#8839ef', green: '#40a02b', lime: '#df8e1d', orange: '#fe640b', pink: '#d20f39' }),
  theme('one-light', 'One Light', false, { bg: '#fafafa', panel: '#f0f0f1', raised: '#e5e5e6', line: '#d4d4d6', ink: '#383a42', dim: '#696c77', faint: '#a0a1a7', accent: '#4078f2', accentInk: '#ffffff', blue: '#4078f2', purple: '#a626a4', green: '#50a14f', lime: '#c18401', orange: '#986801', pink: '#e45649' }, { prop: '#e45649', keyword: '#a626a4' }),
  theme('rose-pine-dawn', 'Rosé Pine Dawn', false, { bg: '#faf4ed', panel: '#fffaf3', raised: '#f2e9e1', line: '#dfdad9', ink: '#464261', dim: '#6a6684', faint: '#9893a5', accent: '#907aa9', accentInk: '#faf4ed', blue: '#56949f', purple: '#907aa9', green: '#286983', lime: '#ea9d34', orange: '#d7827e', pink: '#b4637a' }, { string: '#ea9d34', number: '#d7827e' })
]

export const DEFAULT_THEME = 'totvs'

export function getTheme(id: string | undefined): Theme {
  return THEMES.find((x) => x.id === id) ?? THEMES[0]
}

/** variáveis CSS do tema (aplicadas no <html>) */
export function themeVars(th: Theme): Record<string, string> {
  const c = th.colors
  return {
    '--color-bg': c.bg,
    '--color-panel': c.panel,
    '--color-raised': c.raised,
    '--color-line': c.line,
    '--color-ink': c.ink,
    '--color-dim': c.dim,
    '--color-faint': c.faint,
    '--color-accent': c.accent,
    '--color-accent-ink': c.accentInk,
    '--color-tblue': c.blue,
    '--color-tpurple': c.purple,
    '--color-tgreen': c.green,
    '--color-tlime': c.lime,
    '--color-torange': c.orange,
    '--color-tpink': c.pink,
    // texto de badge de tag: roxo mais claro no escuro, o próprio roxo no claro
    '--color-tag': th.dark ? `color-mix(in srgb, ${c.purple} 62%, #ffffff)` : c.purple,
    '--syn-prop': th.syntax.prop,
    '--syn-string': th.syntax.string,
    '--syn-number': th.syntax.number,
    '--syn-bool': th.syntax.bool,
    '--syn-keyword': th.syntax.keyword,
    '--syn-attr': th.syntax.attr
  }
}
