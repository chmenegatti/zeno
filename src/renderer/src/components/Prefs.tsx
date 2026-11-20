import { useEffect, useMemo, useState } from 'react'
import { bindings, canon, comboFromEvent, conflicts, fromInsomnia, HOTKEYS, type HotkeyGroup } from '@shared/hotkeys'
import { api, useStore } from '../state'
import { EDITOR_FONT, recording, setUi, UI_FONT, ZOOM_STEPS } from '../hotkeys'
import { Modal } from './ui'
import { DEFAULT_THEME, THEMES, type Theme } from '@shared/themes'
import { Select } from './Select'
import { kl } from '../keys'
import { LANGS, type Lang } from '@shared/i18n'

const GROUPS: HotkeyGroup[] = ['Interface', 'Request', 'Ambientes']

export function Kbd({ combo }: { combo: string }) {
  return <kbd className="rounded border border-line bg-raised px-1.5 py-0.5 font-mono text-[11px] text-ink">{kl(combo)}</kbd>
}

// ---------- preferências ----------

export function PrefsModal({ onClose }: { onClose: () => void }) {
  const p = useStore((s) => s.app.ui) ?? {}
  const zoom = p.zoom ?? 1
  const num = (v: string, lim: { min: number; max: number; def: number }): number => {
    const n = Number(v)
    return Number.isFinite(n) && n > 0 ? Math.min(lim.max, Math.max(lim.min, n)) : lim.def
  }
  return (
    <Modal title="Preferências" onClose={onClose} wide>
      <div className="flex flex-col gap-4">
        {/* rótulo nas duas línguas: quem não lê a atual acha mesmo assim */}
        <label className="flex items-center gap-3">
          <span className="w-[170px] text-dim">Language / Idioma</span>
          <Select className="field flex-1" value={p.lang ?? 'en'} onChange={(v) => setUi({ lang: v as Lang })}>
            {LANGS.map((l) => (
              <option key={l.id} value={l.id}>{l.label}</option>
            ))}
          </Select>
        </label>
        <ThemePicker current={p.theme} />
        <label className="flex items-center gap-3">
          <span className="w-[170px] text-dim">Zoom</span>
          <Select className="field flex-1" value={String(zoom)} onChange={(v) => setUi({ zoom: Number(v) })}>
            {[...new Set([...ZOOM_STEPS, zoom])].sort((a, b) => a - b).map((z) => (
              <option key={z} value={String(z)}>{Math.round(z * 100)}%</option>
            ))}
          </Select>
          <span className="w-[130px] text-faint">Ctrl+= / - / 0</span>
        </label>
        <label className="flex items-center gap-3">
          <span className="w-[170px] text-dim">Fonte da interface (px)</span>
          <input type="number" className="field flex-1" min={UI_FONT.min} max={UI_FONT.max} step={0.5} value={p.fontSize ?? UI_FONT.def} onChange={(e) => setUi({ fontSize: num(e.target.value, UI_FONT) })} />
          <span className="w-[130px] text-faint">padrão {UI_FONT.def}</span>
        </label>
        <label className="flex items-center gap-3">
          <span className="w-[170px] text-dim">Fonte dos editores (px)</span>
          <input type="number" className="field flex-1" min={EDITOR_FONT.min} max={EDITOR_FONT.max} step={0.5} value={p.editorFontSize ?? EDITOR_FONT.def} onChange={(e) => setUi({ editorFontSize: num(e.target.value, EDITOR_FONT) })} />
          <span className="w-[130px] text-faint">Ctrl+Shift+= / -</span>
        </label>
        <div className="flex items-center gap-2">
          <button className="btn" onClick={() => useStore.getState().openModal({ kind: 'shortcuts' })}>Atalhos de teclado…</button>
          <button className="btn" onClick={() => useStore.getState().openModal({ kind: 'plugins' })}>Plugins…</button>
          <div className="flex-1" />
          <button className="btn" onClick={() => setUi({ zoom: 1, fontSize: undefined, editorFontSize: undefined })}>Restaurar padrão</button>
          <button className="btn btn-accent" onClick={onClose}>Fechar</button>
        </div>
      </div>
    </Modal>
  )
}

// ---------- atalhos ----------

export function ShortcutsModal({ onClose }: { onClose: () => void }) {
  const overrides = useStore((s) => s.app.ui?.hotkeys) ?? {}
  const [query, setQuery] = useState('')
  /** id gravando; add = acrescenta em vez de trocar */
  const [rec, setRec] = useState<{ id: string; add: boolean } | null>(null)
  const b = useMemo(() => bindings(overrides), [overrides])
  const clash = useMemo(() => conflicts(overrides), [overrides])

  const save = (id: string, keys: string[] | undefined): void => {
    const next = { ...overrides }
    const def = HOTKEYS.find((h) => h.id === id)!.keys
    if (!keys || JSON.stringify(keys) === JSON.stringify(def)) delete next[id]
    else next[id] = keys
    setUi({ hotkeys: Object.keys(next).length ? next : undefined })
  }

  // gravação: a próxima combinação vira o atalho; Esc cancela
  useEffect(() => {
    if (!rec) return
    recording.on = true
    const onKey = (e: KeyboardEvent): void => {
      e.preventDefault()
      e.stopPropagation()
      if (e.key === 'Escape') return setRec(null)
      const combo = comboFromEvent({ key: e.key, code: e.code, ctrlKey: e.ctrlKey, metaKey: e.metaKey, shiftKey: e.shiftKey, altKey: e.altKey, altGraph: e.getModifierState?.('AltGraph') })
      if (!combo) return
      save(rec.id, rec.add ? [...new Set([...b[rec.id], combo])] : [combo])
      setRec(null)
    }
    window.addEventListener('keydown', onKey, true)
    return () => {
      recording.on = false
      window.removeEventListener('keydown', onKey, true)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rec])

  const importInsomnia = async (): Promise<void> => {
    const { notify, run } = useStore.getState()
    const reg = await run(api.insomniaHotkeys())
    if (reg === undefined) return
    if (!reg) return notify('Insomnia não encontrado neste computador')
    const got = fromInsomnia(reg, navigator.platform.startsWith('Mac'))
    const n = Object.keys(got).length
    if (!n) return notify('Nenhum atalho personalizado no Insomnia: o padrão já é o mesmo')
    setUi({ hotkeys: { ...overrides, ...got } })
    notify(`${n} atalho${n > 1 ? 's' : ''} importado${n > 1 ? 's' : ''} do Insomnia`)
  }

  const q = query.trim().toLowerCase()
  const rows = HOTKEYS.filter((h) => !q || `${h.label} ${b[h.id].join(' ')}`.toLowerCase().includes(q))

  return (
    <Modal title="Atalhos de teclado" onClose={() => !rec && onClose()} wide>
      <div className="flex flex-col gap-3">
        <input autoFocus className="field" placeholder="Buscar ação ou tecla…" value={query} onChange={(e) => setQuery(e.target.value)} />
        {GROUPS.map((g) => {
          const list = rows.filter((h) => h.group === g)
          if (!list.length) return null
          return (
            <div key={g}>
              <h3 className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-faint">{g}</h3>
              <div className="flex flex-col">
                {list.map((h) => {
                  const custom = !!overrides[h.id]
                  return (
                    <div key={h.id} className="group flex items-center gap-2 rounded px-2 py-1 hover:bg-raised/60">
                      <span className="flex-1">{h.label}{custom && <span className="ml-2 text-[11px] text-tpurple">alterado</span>}</span>
                      {rec?.id === h.id ? (
                        <span className="animate-pulse text-accent">pressione a combinação… (Esc cancela)</span>
                      ) : (
                        <span className="flex flex-wrap items-center gap-1">
                          {b[h.id].length ? (
                            b[h.id].map((c) => (
                              <span key={c} className={`flex items-center gap-0.5 ${clash[canon(c)] ? 'text-tpink' : ''}`} title={clash[canon(c)] ? `também usado em: ${clash[canon(c)].filter((x) => x !== h.id).map((x) => HOTKEYS.find((y) => y.id === x)?.label).join(', ')}` : undefined}>
                                <Kbd combo={c} />
                                <button className="invisible px-0.5 text-faint hover:text-tpink group-hover:visible" title="remover" onClick={() => save(h.id, b[h.id].filter((x) => x !== c))}>×</button>
                              </span>
                            ))
                          ) : (
                            <span className="text-faint">sem atalho</span>
                          )}
                        </span>
                      )}
                      <span className="invisible flex gap-1 group-hover:visible">
                        <button className="btn btn-ghost px-1.5 py-0 text-[11.5px]" onClick={() => setRec({ id: h.id, add: false })}>trocar</button>
                        <button className="btn btn-ghost px-1.5 py-0 text-[11.5px]" onClick={() => setRec({ id: h.id, add: true })}>+</button>
                        {custom && <button className="btn btn-ghost px-1.5 py-0 text-[11.5px]" onClick={() => save(h.id, undefined)}>padrão</button>}
                      </span>
                    </div>
                  )
                })}
              </div>
            </div>
          )
        })}
        <div className="flex items-center gap-2">
          <p className="flex-1 text-[11.5px] text-faint">Padrão igual ao do Insomnia. Em vermelho: combinação usada por mais de uma ação.</p>
          <button className="btn" title="Lê os atalhos que você mudou no Insomnia (~/.config/Insomnia)" onClick={importInsomnia}>Importar do Insomnia</button>
          {Object.keys(overrides).length > 0 && <button className="btn" onClick={() => setUi({ hotkeys: undefined })}>Restaurar todos</button>}
        </div>
      </div>
    </Modal>
  )
}

// ---------- plugins ----------

export function PluginsModal({ onClose }: { onClose: () => void }) {
  const plugins = useStore((s) => s.plugins)
  const { run, loadPlugins, notify } = useStore.getState()
  const toggle = async (id: string, on: boolean): Promise<void> => {
    const list = await run(api.pluginsSetEnabled(id, on))
    if (list) useStore.setState({ plugins: list })
  }
  return (
    <Modal title="Plugins" onClose={onClose} wide>
      <div className="flex flex-col gap-3">
        <p className="text-[12px] text-dim">
          Plugins no formato do Insomnia (<code>templateTags</code>, <code>requestHooks</code>, <code>responseHooks</code>, <code>requestActions</code>) e importadores. Cada um fica numa pasta dentro de <b>plugins</b>, na pasta de dados. Plugins rodam código no seu computador: instale só os que você confia.
        </p>
        <div className="flex items-center gap-2">
          <button className="btn" onClick={async () => notify(`Pasta de plugins: ${await api.pluginsOpenDir()}`)}>Abrir pasta de plugins</button>
          <button className="btn" onClick={async () => { await loadPlugins(true); notify('Plugins recarregados') }}>Recarregar</button>
          <div className="flex-1" />
          <a className="text-[12px] text-accent hover:underline" href="https://github.com/chmenegatti/zeno/blob/main/docs/plugins.md" target="_blank" rel="noreferrer">Como criar um plugin</a>
        </div>
        {!plugins.length ? (
          <p className="py-6 text-center text-faint">Nenhum plugin instalado. Copie a pasta do plugin para a pasta de plugins e clique em Recarregar.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {plugins.map((p) => (
              <div key={p.id} className={`flex items-start gap-3 rounded-lg border p-3 ${p.error ? 'border-tpink/40 bg-tpink/5' : 'border-line'}`}>
                <input type="checkbox" className="mt-1" disabled={!!p.error} checked={p.enabled} onChange={(e) => toggle(p.id, e.target.checked)} title={p.error ? 'com erro: corrija e recarregue' : 'ligar/desligar'} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-2">
                    <span className="font-semibold">{p.displayName}</span>
                    {p.version && <span className="text-[11px] text-faint">v{p.version}</span>}
                    <span className="truncate font-mono text-[11px] text-faint">{p.id}</span>
                  </div>
                  {p.description && <div className="text-[12px] text-dim">{p.description}</div>}
                  {p.error ? (
                    <div className="mt-1 whitespace-pre-wrap font-mono text-[11.5px] text-tpink">desativado: {p.error}</div>
                  ) : (
                    <div className="mt-1 flex flex-wrap gap-1.5 text-[11px]">
                      {p.templateTags.map((t) => <span key={t.name} className="rounded bg-tpurple/15 px-1.5 py-0.5 font-mono text-tag">{`{% ${t.name} %}`}</span>)}
                      {p.requestHooks > 0 && <span className="rounded bg-line px-1.5 py-0.5 text-dim">{p.requestHooks} request hook{p.requestHooks > 1 ? 's' : ''}</span>}
                      {p.responseHooks > 0 && <span className="rounded bg-line px-1.5 py-0.5 text-dim">{p.responseHooks} response hook{p.responseHooks > 1 ? 's' : ''}</span>}
                      {p.requestActions.map((a) => <span key={a.label} className="rounded bg-line px-1.5 py-0.5 text-dim">ação: {a.label}</span>)}
                      {p.importers.map((im) => <span key={im.name} className="rounded bg-line px-1.5 py-0.5 text-dim">importador: {im.name}</span>)}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
        <div className="flex justify-end">
          <button className="btn btn-accent" onClick={onClose}>Fechar</button>
        </div>
      </div>
    </Modal>
  )
}

// ---------- temas ----------

function Swatch({ th, active, onPick }: { th: Theme; active: boolean; onPick: () => void }) {
  const c = th.colors
  return (
    <button
      type="button"
      onClick={onPick}
      className={`flex flex-col overflow-hidden rounded-lg border text-left transition ${active ? 'border-accent ring-2 ring-accent/50' : 'border-line hover:border-dim'}`}
      title={th.name}
    >
      {/* miniatura: lateral, painel, botão e trecho de JSON nas cores do tema */}
      <div className="flex h-[58px]" style={{ background: c.bg }}>
        <div className="w-[26%]" style={{ background: c.panel, borderRight: `1px solid ${c.line}` }}>
          <div className="mx-1.5 mt-2 h-1.5 rounded" style={{ background: c.raised }} />
          <div className="mx-1.5 mt-1 h-1 w-2/3 rounded" style={{ background: c.green }} />
          <div className="mx-1.5 mt-1 h-1 w-1/2 rounded" style={{ background: c.orange }} />
        </div>
        <div className="flex flex-1 flex-col gap-1 p-1.5 font-mono text-[8px] leading-none">
          <div className="flex gap-1">
            <span className="h-2.5 flex-1 rounded-sm" style={{ background: c.raised, border: `1px solid ${c.line}` }} />
            <span className="h-2.5 w-5 rounded-sm" style={{ background: c.accent }} />
          </div>
          <span style={{ color: th.syntax.prop }}>"id"<span style={{ color: c.dim }}>: </span><span style={{ color: th.syntax.number }}>7</span></span>
          <span style={{ color: th.syntax.prop }}>"ok"<span style={{ color: c.dim }}>: </span><span style={{ color: th.syntax.bool }}>true</span></span>
          <span style={{ color: th.syntax.string }}>"Olá"</span>
        </div>
      </div>
      <div className="flex items-center justify-between px-2 py-1 text-[11.5px]" style={{ background: c.panel, color: c.ink, borderTop: `1px solid ${c.line}` }}>
        <span className="truncate">{th.name}</span>
        {active && <span style={{ color: c.accent }}>●</span>}
      </div>
    </button>
  )
}

/** grade de temas: clicar aplica na hora e salva */
export function ThemePicker({ current }: { current?: string }) {
  const id = current ?? DEFAULT_THEME
  const group = (dark: boolean) => THEMES.filter((t) => t.dark === dark)
  return (
    <div className="flex flex-col gap-2">
      <span className="text-dim">Tema</span>
      {[true, false].map((dark) => (
        <div key={String(dark)} className="flex flex-col gap-1.5">
          <span className="text-[11px] uppercase tracking-wide text-faint">{dark ? 'Escuros' : 'Claros'}</span>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-2">
            {group(dark).map((th) => (
              <Swatch key={th.id} th={th} active={th.id === id} onPick={() => setUi({ theme: th.id === DEFAULT_THEME ? undefined : th.id })} />
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
