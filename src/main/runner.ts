// Executor de coleção: roda os requests de uma pasta (ou do workspace) em ordem, com iterações, atraso e
// linhas de dados (CSV/JSON). Variáveis gravadas por um request valem para os seguintes.

import type { Engine } from './engine'
import type { Store } from './store'
import { findNode, sortNodes } from '../shared/tree'
import type { RequestDoc, RunOptions, RunReport, RunStep, TreeNode } from '../shared/types'

/** requests em ordem de exibição, com o caminho de pastas */
export function collect(nodes: TreeNode[], trail: string[] = []): { req: RequestDoc; path: string }[] {
  const out: { req: RequestDoc; path: string }[] = []
  for (const n of sortNodes([...nodes])) {
    if (n.kind === 'request') out.push({ req: n, path: trail.join(' / ') })
    else out.push(...collect(n.children, [...trail, n.name]))
  }
  return out
}

export interface RunHandle {
  cancelled: boolean
}

export async function runCollection(
  engine: Engine,
  store: Store,
  opts: RunOptions,
  onStep?: (step: RunStep, index: number, total: number) => void,
  handle: RunHandle = { cancelled: false }
): Promise<RunReport> {
  const ws0 = store.list().find((w) => w.id === opts.wsId)
  if (!ws0) throw new Error('workspace não encontrado')
  let rootName = ws0.name
  let nodes = ws0.children
  if (opts.folderId) {
    const f = findNode(ws0, opts.folderId)
    if (f?.node.kind !== 'folder') throw new Error('pasta não encontrada')
    rootName = f.node.name
    nodes = f.node.children
  }
  const list = collect(nodes)
  const iterations = Math.max(1, opts.data?.length && opts.iterations <= 1 ? opts.data.length : opts.iterations)
  const total = list.length * iterations
  const report: RunReport = { name: rootName, startedAt: Date.now(), totalMs: 0, steps: [], passed: 0, failed: 0 }
  const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

  outer: for (let it = 0; it < iterations; it++) {
    const row = opts.data?.length ? opts.data[it % opts.data.length] : undefined
    for (const { req: listed, path } of list) {
      if (handle.cancelled) break outer
      if (report.steps.length && opts.delayMs > 0) await wait(opts.delayMs)
      if (handle.cancelled) break outer
      // relê do disco a cada request: scripts anteriores podem ter gravado variáveis
      const ws = store.list().find((w) => w.id === opts.wsId) ?? ws0
      const found = findNode(ws, listed.id)
      const req = found?.node.kind === 'request' ? found.node : listed
      let step: RunStep
      try {
        const r = await engine.execute(ws, req, opts.envId, { extraVars: { ...row, ...opts.vars } })
        const res = r.response
        step = {
          iteration: it + 1,
          requestId: req.id,
          name: req.name,
          path,
          method: res.method,
          url: res.url,
          status: res.status,
          timeMs: res.timing.totalMs,
          tests: r.scripts?.tests ?? [],
          error: res.error ?? (r.scripts?.errors.length ? r.scripts.errors.join('; ') : undefined),
          ...(r.missing.length ? { missing: r.missing } : {})
        }
      } catch (e) {
        step = { iteration: it + 1, requestId: req.id, name: req.name, path, method: req.method, url: req.url, status: 0, timeMs: 0, tests: [], error: (e as Error).message }
      }
      const ok = stepOk(step)
      if (ok) report.passed++
      else report.failed++
      report.steps.push(step)
      onStep?.(step, report.steps.length - 1, total)
      if (!ok && opts.bail) break outer
    }
  }
  report.cancelled = handle.cancelled || undefined
  report.totalMs = Date.now() - report.startedAt
  return report
}

/** passou = enviado sem erro e todos os testes ok */
export function stepOk(s: RunStep): boolean {
  return !s.error && s.tests.every((t) => t.ok)
}

const esc = (s: string): string => s.replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[c]!)

/** relatório JUnit XML: um testsuite por iteração, um testcase por request (falha lista os testes que não passaram) */
export function toJUnit(r: RunReport): string {
  const byIt = new Map<number, RunStep[]>()
  for (const s of r.steps) byIt.set(s.iteration, [...(byIt.get(s.iteration) ?? []), s])
  const suites = [...byIt.entries()].map(([it, steps]) => {
    const failures = steps.filter((s) => !stepOk(s)).length
    const time = steps.reduce((a, s) => a + s.timeMs, 0) / 1000
    const cases = steps.map((s) => {
      const cls = esc([r.name, s.path].filter(Boolean).join(' / '))
      const head = `    <testcase classname="${cls}" name="${esc(s.name)}" time="${(s.timeMs / 1000).toFixed(3)}"`
      if (stepOk(s)) return `${head}/>`
      const lines = [...(s.error ? [s.error] : []), ...s.tests.filter((t) => !t.ok).map((t) => `${t.name}${t.error ? `: ${t.error}` : ''}`)]
      return `${head}>\n      <failure message="${esc(lines[0] ?? 'falhou')}">${esc(`${s.method} ${s.url} -> ${s.status}\n${lines.join('\n')}`)}</failure>\n    </testcase>`
    })
    return `  <testsuite name="${esc(r.name)}${byIt.size > 1 ? ` #${it}` : ''}" tests="${steps.length}" failures="${failures}" time="${time.toFixed(3)}">\n${cases.join('\n')}\n  </testsuite>`
  })
  return `<?xml version="1.0" encoding="UTF-8"?>\n<testsuites name="${esc(r.name)}" tests="${r.steps.length}" failures="${r.failed}" time="${(r.totalMs / 1000).toFixed(3)}">\n${suites.join('\n')}\n</testsuites>\n`
}

/** linhas de dados: JSON (lista de objetos) ou CSV com cabeçalho */
export function parseData(text: string, name = ''): Record<string, unknown>[] {
  const t = text.replace(/^﻿/, '').trim()
  if (!t) return []
  if (/\.json$/i.test(name) || /^[[{]/.test(t)) {
    const v = JSON.parse(t)
    const list = Array.isArray(v) ? v : [v]
    if (!list.every((x) => x && typeof x === 'object' && !Array.isArray(x))) throw new Error('JSON de dados deve ser uma lista de objetos')
    return list
  }
  const rows = parseCsv(t)
  const [head, ...rest] = rows
  return rest.filter((r) => r.some((c) => c !== '')).map((r) => Object.fromEntries(head.map((h, i) => [h.trim(), r[i] ?? ''])))
}

/** CSV (RFC 4180): aspas, aspas duplicadas, quebra de linha dentro de aspas; separador , ou ; */
export function parseCsv(text: string): string[][] {
  const firstLine = text.split(/\r?\n/, 1)[0]
  const sep = (firstLine.match(/;/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0) ? ';' : ','
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let q = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (q) {
      if (c === '"' && text[i + 1] === '"') {
        cell += '"'
        i++
      } else if (c === '"') q = false
      else cell += c
    } else if (c === '"') q = true
    else if (c === sep) {
      row.push(cell)
      cell = ''
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++
      row.push(cell)
      rows.push(row)
      row = []
      cell = ''
    } else cell += c
  }
  row.push(cell)
  rows.push(row)
  return rows
}
