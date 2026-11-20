// Gera junit.xml com o toJUnit do Electron: npx jiti wails/internal/runner/testdata/gen.ts
import fs from 'node:fs'
import path from 'node:path'
import { toJUnit } from '../../../../src/main/runner'

const dir = path.dirname(new URL(import.meta.url).pathname)
fs.writeFileSync(path.join(dir, 'junit.xml'), toJUnit(JSON.parse(fs.readFileSync(path.join(dir, 'report.json'), 'utf8'))))
