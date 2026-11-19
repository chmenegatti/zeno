// Fora do Electron (protótipo Go/Wails, pasta wails/): window.zeno vira chamadas a App.Call(canal, args).
// No Electron o preload já definiu window.zeno e este arquivo não faz nada.

type Bound = { main: { App: { Call(channel: string, args: string[]): Promise<unknown> } } }
type WailsRuntime = { EventsOn(name: string, cb: (...a: unknown[]) => void): () => void }
const w = window as unknown as { zeno?: unknown; go?: Bound; runtime?: WailsRuntime }

if (!w.zeno) {
  const call =
    (channel: string) =>
    (...args: unknown[]): Promise<unknown> =>
      w.go!.main.App.Call(
        channel,
        args.map((a) => JSON.stringify(a === undefined ? null : a))
      )
  const on = (name: string) => (cb: (...a: unknown[]) => void) => w.runtime?.EventsOn(name, cb) ?? (() => undefined)
  const special: Record<string, unknown> = {
    onChanged: on('store:changed'),
    onResponse: on('response:added'),
    onRunStep: on('run:step'),
    onPrompt: on('prompt:ask'),
    setZoom: (f: number) => {
      document.documentElement.style.setProperty('zoom', String(f))
    }
  }
  w.zeno = new Proxy({}, { get: (_t, k) => (typeof k !== 'string' || k === 'then' ? undefined : (special[k] ?? call(k))) })
}

export {}
