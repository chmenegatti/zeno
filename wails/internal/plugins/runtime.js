// Ajudantes que rodam dentro do interpretador de cada plugin (globais e APIs no formato do Insomnia).
(() => {
  const g = globalThis
  // ---------- globais que o Electron também dá aos plugins ----------
  g.atob = (s) => Buffer.from(String(s), 'base64').toString('latin1')
  g.btoa = (s) => Buffer.from(String(s), 'latin1').toString('base64')
  g.structuredClone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)))
  g.TextEncoder = class TextEncoder {
    get encoding() { return 'utf-8' }
    encode(s = '') { return new Uint8Array(Buffer.from(String(s), 'utf8')) }
  }
  g.TextDecoder = class TextDecoder {
    constructor(enc = 'utf-8') { this.encoding = enc }
    decode(b) { return b === undefined ? '' : Buffer.from(b).toString('utf8') }
  }

  // ---------- promessa: avisa o Go quando termina ----------
  g.__zenoThen = (p, ok, fail) => Promise.resolve(p).then(ok, (e) => fail(e && e.message !== undefined ? String(e.message) : String(e)))
  g.__zenoText = (v) => (v === undefined || v === null ? '' : typeof v === 'string' ? v : JSON.stringify(v))

  // ---------- request mutável (API de requestHooks do Insomnia) ----------
  g.__zenoRequest = (r0, vars) => {
    const r = { method: r0.method, url: r0.url, headers: r0.headers.map(([k, v]) => [k, v]), body: r0.body }
    const find = (n) => r.headers.findIndex(([k]) => k.toLowerCase() === String(n).toLowerCase())
    const api = {
      getMethod: () => r.method,
      setMethod: (m) => { r.method = String(m).toUpperCase() },
      getUrl: () => r.url,
      setUrl: (u) => { r.url = String(u) },
      getHeader: (n) => (find(n) >= 0 ? r.headers[find(n)][1] : null),
      hasHeader: (n) => find(n) >= 0,
      getHeaders: () => r.headers.map(([name, value]) => ({ name, value })),
      setHeader: (n, v) => { const i = find(n); if (i >= 0) r.headers[i] = [r.headers[i][0], String(v)]; else r.headers.push([String(n), String(v)]) },
      addHeader: (n, v) => { r.headers.push([String(n), String(v)]) },
      removeHeader: (n) => { r.headers = r.headers.filter(([k]) => k.toLowerCase() !== String(n).toLowerCase()) },
      getBody: () => ({ text: r.body === undefined || r.body === null ? '' : r.body }),
      setBody: (b) => { r.body = typeof b === 'string' ? b : String((b && b.text) || '') },
      getEnvironmentVariable: (n) => structuredClone(vars[n]),
      getEnvironment: () => structuredClone(vars)
    }
    return { api, get: () => JSON.stringify(r) }
  }

  // ---------- resposta (API de responseHooks) ----------
  g.__zenoResponse = (res) => {
    const header = (n) => { const h = res.headers.find(([k]) => k.toLowerCase() === String(n).toLowerCase()); return h ? h[1] : undefined }
    return { getStatusCode: () => res.status, getHeader: header, getHeaders: () => res.headers.map(([name, value]) => ({ name, value })), getBody: () => Buffer.from(res.body) }
  }

  // ---------- módulos liberados escritos em JS ----------
  g.__zenoEvents = () => {
    class EventEmitter {
      constructor() { this._ev = {} }
      on(n, f) { (this._ev[n] = this._ev[n] || []).push(f); return this }
      once(n, f) { const w = (...a) => { this.off(n, w); f(...a) }; return this.on(n, w) }
      off(n, f) { this._ev[n] = (this._ev[n] || []).filter((x) => x !== f); return this }
      emit(n, ...a) { const l = this._ev[n] || []; l.slice().forEach((f) => f(...a)); return l.length > 0 }
      listenerCount(n) { return (this._ev[n] || []).length }
    }
    EventEmitter.prototype.addListener = EventEmitter.prototype.on
    EventEmitter.prototype.removeListener = EventEmitter.prototype.off
    EventEmitter.EventEmitter = EventEmitter
    return EventEmitter
  }
  g.__zenoQuerystring = () => ({
    stringify: (o = {}) => Object.entries(o).flatMap(([k, v]) => [].concat(v).map((x) => encodeURIComponent(k) + '=' + encodeURIComponent(x === undefined || x === null ? '' : x))).join('&'),
    parse: (s = '') => { const o = {}; for (const p of String(s).split('&').filter(Boolean)) { const i = p.indexOf('='); const k = decodeURIComponent((i < 0 ? p : p.slice(0, i)).replace(/\+/g, ' ')); const v = i < 0 ? '' : decodeURIComponent(p.slice(i + 1).replace(/\+/g, ' ')); o[k] = k in o ? [].concat(o[k], v) : v } return o },
    escape: encodeURIComponent,
    unescape: decodeURIComponent
  })
  g.__zenoAssert = () => {
    const fail = (m, d) => { const e = new Error(m || d); e.name = 'AssertionError'; throw e }
    const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b)
    const assert = (v, m) => { if (!v) fail(m, 'asserção falhou') }
    assert.ok = assert
    assert.equal = (a, b, m) => { if (a != b) fail(m, `${a} == ${b}`) }
    assert.strictEqual = (a, b, m) => { if (a !== b) fail(m, `${a} === ${b}`) }
    assert.notEqual = (a, b, m) => { if (a == b) fail(m, `${a} != ${b}`) }
    assert.deepEqual = assert.deepStrictEqual = (a, b, m) => { if (!eq(a, b)) fail(m, 'valores diferentes') }
    assert.throws = (f, m) => { try { f() } catch { return } fail(m, 'esperava erro') }
    return assert
  }
})()
