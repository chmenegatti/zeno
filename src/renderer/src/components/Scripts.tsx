import { useState } from 'react'
import type { ScriptReport, Scripts } from '@shared/types'
import { CodeEditor } from './CodeEditor'
import { t, tk } from '@shared/i18n'

const EXAMPLES: { label: string; phase: 'pre' | 'post'; code: string }[] = [
  {
    label: tk('Salvar token da resposta'),
    phase: 'post',
    code: `const body = zeno.response.json()\nzeno.environment.set('token', body.access_token ?? body.token)`
  },
  {
    label: tk('Testar status e corpo'),
    phase: 'post',
    code: `zeno.test('status 200', () => {\n  zeno.expect(zeno.response.code).to.equal(200)\n})\nzeno.test('tem id', () => {\n  zeno.expect(zeno.response.json()).to.have.property('id')\n})`
  },
  {
    label: tk('Header com data/hora'),
    phase: 'pre',
    code: `zeno.request.headers.upsert({ key: 'X-Request-Time', value: new Date().toISOString() })`
  },
  {
    label: tk('Variável só deste envio'),
    phase: 'pre',
    code: `zeno.variables.set('pedido', 'ped-' + Date.now())\n// use {{ pedido }} na URL, headers ou body`
  }
]

/** editores de script antes do envio e depois da resposta */
export function ScriptsEditor({ scripts, onChange, folder }: { scripts: Scripts | undefined; onChange: (s: Scripts) => void; folder?: boolean }) {
  const s = scripts ?? {}
  const set = (phase: 'pre' | 'post', code: string) => onChange({ ...s, [phase]: code })
  const add = (phase: 'pre' | 'post', code: string) => set(phase, s[phase]?.trim() ? `${s[phase]!.replace(/\s+$/, '')}\n\n${code}` : code)
  return (
    <div className="flex h-full min-h-[380px] flex-col gap-2 p-3">
      <div className="flex flex-wrap items-center gap-1.5 text-[11.5px]">
        <span className="text-faint">{t('exemplos:')}</span>
        {EXAMPLES.map((e) => (
          <button key={e.label} className="btn btn-ghost px-1.5 py-0.5 text-[11.5px]" onClick={() => add(e.phase, e.code)}>
            {t(e.label)}
          </button>
        ))}
      </div>
      <Pane title={t('Antes do envio')} hint={folder ? t('roda antes de cada request da pasta') : t('pode mudar o request e as variáveis')} value={s.pre ?? ''} onChange={(v) => set('pre', v)} />
      <Pane title={t('Depois da resposta')} hint={t('testes, extrair valores pro ambiente')} value={s.post ?? ''} onChange={(v) => set('post', v)} />
      <p className="text-[11px] text-faint">
        API: <code>zeno.environment</code>, <code>zeno.variables</code>, <code>zeno.request</code>, <code>zeno.response</code>, <code>zeno.test</code>, <code>zeno.expect</code>. {t('Scripts do Insomnia')} (<code>insomnia.*</code>) {t('e do Postman')} (<code>pm.*</code>) {t('funcionam igual. Sem rede, arquivos ou')} <code>require</code>; {t('limite de 5 s.')}
      </p>
    </div>
  )
}

function Pane({ title, hint, value, onChange }: { title: string; hint: string; value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="mb-1 flex items-baseline gap-2">
        <span className="font-semibold">{title}</span>
        <span className="text-[11px] text-faint">{hint}</span>
      </div>
      <div className="min-h-[140px] flex-1 overflow-hidden rounded-md border border-line bg-bg">
        <CodeEditor value={value} onChange={onChange} lang="javascript" wrap={false} placeholder="// JavaScript" />
      </div>
    </div>
  )
}

export function hasScripts(s: Scripts | undefined): boolean {
  return !!(s?.pre?.trim() || s?.post?.trim())
}

/** resultado dos scripts do último envio */
export function ScriptResults({ report }: { report: ScriptReport }) {
  const [onlyFail, setOnlyFail] = useState(false)
  const failed = report.tests.filter((x) => !x.ok).length
  const tests = onlyFail ? report.tests.filter((x) => !x.ok) : report.tests
  return (
    <div className="flex flex-col gap-3 p-3 text-[12.5px]">
      {report.errors.map((e, i) => (
        <div key={i} className="whitespace-pre-wrap rounded-md border border-tpink/30 bg-tpink/10 p-2 font-mono text-[12px] text-tpink select-text">{e}</div>
      ))}
      {report.tests.length > 0 && (
        <div>
          <div className="mb-1 flex items-center gap-3">
            <span className="font-semibold">{t('Testes')}</span>
            <span className={failed ? 'text-tpink' : 'text-tgreen'}>{t('{ok}/{n} passaram', { ok: report.tests.length - failed, n: report.tests.length })}</span>
            {failed > 0 && (
              <label className="flex items-center gap-1 text-[11.5px] text-dim">
                <input type="checkbox" checked={onlyFail} onChange={(e) => setOnlyFail(e.target.checked)} /> {t('só falhas')}
              </label>
            )}
          </div>
          <ul className="flex flex-col gap-1">
            {tests.map((x, i) => (
              <li key={i} className="flex gap-2">
                <span className={`w-4 shrink-0 font-semibold ${x.ok ? 'text-tgreen' : 'text-tpink'}`}>{x.ok ? '✓' : '✕'}</span>
                <span className="min-w-0">
                  {x.name}
                  {x.error && <span className="block font-mono text-[11.5px] text-tpink select-text">{x.error}</span>}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {report.logs.length > 0 && (
        <div>
          <div className="mb-1 font-semibold">Console</div>
          <pre className="max-h-[40vh] overflow-auto rounded-md bg-bg p-2 font-mono text-[11.5px] text-dim select-text">{report.logs.join('\n')}</pre>
        </div>
      )}
      {!report.errors.length && !report.tests.length && !report.logs.length && <p className="text-faint">{t('Sem testes nem saída no console.')}</p>}
    </div>
  )
}
