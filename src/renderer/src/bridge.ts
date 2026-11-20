// window.zeno: a API do app em cima do Wails (wails/): cada canal vira App.Call(canal, args) no Go e os
// eventos vêm pelo runtime do Wails.

type Bound = { main: { App: { Call(channel: string, args: string[]): Promise<unknown> } } }
type WailsRuntime = { EventsOn(name: string, cb: (...a: unknown[]) => void): () => void; BrowserOpenURL(url: string): void }
const w = window as unknown as { zeno?: unknown; go?: Bound; runtime?: WailsRuntime }

/**
 * bodies grandes vêm fora da ponte (que passa tudo como texto JSON avaliado, lento pra MBs): o Go troca o
 * body por bodyUrl e aqui ele é buscado no servidor de assets, em paralelo, antes de chegar na interface
 */
// registro de resposta não muda depois de gravado: body já recebido (por id) não é buscado de novo.
// O texto é o mesmo objeto que a interface guarda; o limite só evita segurar o que ela já largou.
const seen = new Map<string, string>()
let seenSize = 0
const SEEN_MAX = 64 * 1024 * 1024
function remember(id: string, body: string): void {
  if (seen.has(id)) return
  seen.set(id, body)
  seenSize += body.length
  for (const [k, b] of seen) {
    if (seenSize <= SEEN_MAX) break
    seen.delete(k)
    seenSize -= b.length
  }
}

async function fillBodies(v: unknown): Promise<unknown> {
  const pending: Promise<void>[] = []
  const walk = (x: unknown): void => {
    if (Array.isArray(x)) x.forEach(walk)
    else if (x && typeof x === 'object') {
      const o = x as Record<string, unknown>
      if (typeof o.bodyUrl === 'string') {
        const url = o.bodyUrl
        const id = typeof o.id === 'string' ? o.id : ''
        delete o.bodyUrl
        const known = id ? seen.get(id) : undefined
        if (known !== undefined) o.body = known
        else
          pending.push(
            fetch(url)
              .then((r) => (r.ok ? r.text() : Promise.reject(new Error(`body: HTTP ${r.status}`))))
              .then((t) => {
                o.body = t
                if (id) remember(id, t)
              })
          )
      } else Object.values(o).forEach(walk)
    }
  }
  walk(v)
  if (pending.length) await Promise.all(pending)
  return v
}

if (!w.zeno) {
  const call =
    (channel: string) =>
    (...args: unknown[]): Promise<unknown> =>
      w.go!.main.App.Call(
        channel,
        args.map((a) => JSON.stringify(a === undefined ? null : a))
      ).then(fillBodies)
  // eventos na ordem em que chegaram, mesmo com body pra buscar
  const on = (name: string) => (cb: (...a: unknown[]) => void) => {
    let queue: Promise<unknown> = Promise.resolve()
    return (
      w.runtime?.EventsOn(name, (...a) => {
        queue = queue.then(() => fillBodies(a)).then(() => cb(...a), (e) => console.error(name, e))
      }) ?? (() => undefined)
    )
  }
  const special: Record<string, unknown> = {
    onChanged: on('store:changed'),
    onResponse: on('response:added'),
    onRunStep: on('run:step'),
    onPrompt: on('prompt:ask'),
    onOAuthWait: on('oauth:wait'),
    onOAuthDone: on('oauth:done'),
    onWsEvent: on('ws:event'),
    onSseEvent: on('sse:event'),
    setZoom: (f: number) => {
      document.documentElement.style.setProperty('zoom', String(f))
    }
  }
  w.zeno = new Proxy({}, { get: (_t, k) => (typeof k !== 'string' || k === 'then' ? undefined : (special[k] ?? call(k))) })

  // o WebKit só deixa copiar com gesto do usuário; o Go copia sempre
  try {
    navigator.clipboard.writeText = (text: string) => call('copyText')(text).then(() => undefined)
  } catch {
    /* sem navigator.clipboard */
  }

  // links externos vão pro navegador do sistema
  document.addEventListener(
    'click',
    (e) => {
      const a = (e.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null
      if (a && /^https?:/i.test(a.href)) {
        e.preventDefault()
        w.runtime?.BrowserOpenURL(a.href)
      }
    },
    true
  )
}

export {}
