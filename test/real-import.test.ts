// Roda só com ZENO_REAL=1: importa ~/.config/Insomnia pra pasta temporária e confere contagens.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { expect, it } from 'vitest'
import { convert, readNedbDir } from '../src/main/import-insomnia'
import { Store } from '../src/main/store'
import { countTree } from '../src/shared/tree'

it.runIf(process.env.ZENO_REAL === '1')('importa Insomnia real', () => {
  const { workspaces, warnings } = convert(readNedbDir())
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zeno-real-'))
  const store = new Store(dir)
  for (const ws of workspaces) store.writeWorkspace(ws)
  const loaded = store.load()
  const sum = (list: typeof workspaces) => list.reduce((a, w) => { const c = countTree(w.children); return { ws: a.ws + 1, f: a.f + c.folders, r: a.r + c.requests, e: a.e + w.environments.length } }, { ws: 0, f: 0, r: 0, e: 0 })
  fs.writeFileSync(path.join(os.tmpdir(), 'zeno-real-report.txt'), JSON.stringify({ convertido: sum(workspaces), relido: sum(loaded), avisos: warnings.length }) + '\n' + warnings.join('\n'))
  expect(sum(loaded)).toEqual(sum(workspaces))
  fs.rmSync(dir, { recursive: true, force: true })
})
