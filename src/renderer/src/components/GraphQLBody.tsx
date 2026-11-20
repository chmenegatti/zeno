// Body GraphQL (#4): consulta com autocomplete/validação pelo schema (introspecção), variáveis em
// JSON e operação. Carregado sob demanda (lazy) pra não pesar o bundle de quem não usa GraphQL.

import { useEffect, useMemo, useRef, useState } from 'react'
import { buildClientSchema, getIntrospectionQuery, parse, print, type GraphQLSchema, type IntrospectionQuery } from 'graphql'
import { graphql, updateSchema } from 'cm6-graphql'
import type { EditorView } from '@uiw/react-codemirror'
import type { RequestDoc } from '@shared/types'
import { buildGql, operationNames, parseGql, type GqlBody } from '@shared/graphql'
import { api, useStore } from '../state'
import { CodeEditor, type TagSupport } from './CodeEditor'
import { Select } from './Select'

export interface GraphQLCtx {
  wsId: string
  req: RequestDoc
  envId: string | null
}

type SchemaState = { schema?: GraphQLSchema; error?: string; at: number }

/** schema por workspace + ambiente + URL, enquanto o app está aberto */
const cache = new Map<string, SchemaState>()
const listeners = new Set<() => void>()
const keyOf = (c: GraphQLCtx): string => `${c.wsId}\n${c.envId ?? ''}\n${c.req.url}`

function asJSON(t: string): unknown {
  try {
    return JSON.parse(t)
  } catch {
    return null
  }
}

async function fetchSchema(c: GraphQLCtx, interactive: boolean): Promise<SchemaState> {
  const req: RequestDoc = { ...c.req, method: 'POST', body: { mime: 'application/json', text: JSON.stringify({ query: getIntrospectionQuery() }) } }
  let st: SchemaState
  try {
    const r = await api.graphqlIntrospect(c.wsId, req, c.envId, interactive)
    if (r.error) st = { error: r.error, at: Date.now() }
    else {
      const data = asJSON(r.body) as { data?: IntrospectionQuery; errors?: { message?: string }[] } | null
      if (data?.data?.__schema) st = { schema: buildClientSchema(data.data), at: Date.now() }
      else if (data?.errors?.length) st = { error: data.errors.map((e) => e.message ?? '').join('; ') || `HTTP ${r.status}`, at: Date.now() }
      else st = { error: `HTTP ${r.status}: resposta não é introspecção GraphQL`, at: Date.now() }
    }
  } catch (e) {
    st = { error: e instanceof Error ? e.message : String(e), at: Date.now() }
  }
  cache.set(keyOf(c), st)
  listeners.forEach((f) => f())
  return st
}

function typeCount(s: GraphQLSchema): number {
  return Object.keys(s.getTypeMap()).filter((n) => !n.startsWith('__')).length
}

export default function GraphQLBody({ text, onChange, ctx, tags }: { text: string; onChange: (text: string) => void; ctx: GraphQLCtx; tags?: TagSupport }) {
  // estado local: o texto salvo é derivado (as variáveis podem estar incompletas enquanto se digita)
  const [g, setG] = useState<GqlBody>(() => parseGql(text))
  const lastText = useRef(text)
  useEffect(() => {
    // trocou de request (ou mudou fora daqui): relê
    if (text !== lastText.current) {
      lastText.current = text
      setG(parseGql(text))
    }
  }, [text])
  const set = (patch: Partial<GqlBody>): void => {
    const next = { ...g, ...patch }
    setG(next)
    const t = buildGql(next)
    lastText.current = t
    onChange(t)
  }

  const key = keyOf(ctx)
  const [, tick] = useState(0)
  useEffect(() => {
    const f = (): void => tick((n) => n + 1)
    listeners.add(f)
    return () => {
      listeners.delete(f)
    }
  }, [])
  const st = cache.get(key)
  const [busy, setBusy] = useState(false)
  const load = async (interactive: boolean): Promise<void> => {
    setBusy(true)
    await fetchSchema(ctx, interactive)
    setBusy(false)
  }
  // primeira vez nesta URL: busca sozinho (sem abrir login OAuth)
  useEffect(() => {
    if (ctx.req.url.trim() && !cache.has(key)) void load(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  const view = useRef<EditorView | null>(null)
  const schema = st?.schema
  useEffect(() => {
    if (view.current) updateSchema(view.current, schema)
  }, [schema])
  const extra = useMemo(() => [graphql(schema)], [])

  const ops = useMemo(() => operationNames(g.query), [g.query])
  const format = (): void => {
    try {
      set({ query: print(parse(g.query)) })
    } catch (e) {
      useStore.getState().notify(`Consulta inválida: ${e instanceof Error ? e.message.split('\n')[0] : e}`)
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col border-t border-line">
      <div className="flex flex-wrap items-center gap-2 px-2 py-1 text-[11.5px]">
        <span className={schema ? 'text-tgreen' : st?.error ? 'text-tred' : 'text-faint'} title={st?.error}>
          {busy ? 'buscando schema…' : schema ? `schema: ${typeCount(schema)} tipos` : st?.error ? `sem schema: ${st.error.slice(0, 80)}` : 'sem schema'}
        </span>
        <button className="btn btn-ghost px-2 py-0.5 text-[11.5px]" disabled={busy || !ctx.req.url.trim()} title="Manda a consulta de introspecção pra URL do request (com headers e auth), sem gravar no histórico" onClick={() => void load(true)}>
          {schema ? 'Atualizar schema' : 'Buscar schema'}
        </button>
        <div className="flex-1" />
        {(ops.length > 1 || g.operationName) && (
          <label className="flex items-center gap-1.5 text-dim">
            operação
            <Select className="field py-0.5 text-[11.5px]" value={g.operationName} onChange={(v) => set({ operationName: v })}>
              <option value="">(automática)</option>
              {[...new Set([...ops, ...(g.operationName ? [g.operationName] : [])])].map((o) => (
                <option key={o} value={o}>{o}</option>
              ))}
            </Select>
          </label>
        )}
        <button className="btn btn-ghost px-2 py-0.5 text-[11.5px]" title="Reorganiza a consulta (remove comentários)" onClick={format}>
          Formatar
        </button>
      </div>
      <div className="min-h-0 flex-[3] border-t border-line">
        <CodeEditor
          value={g.query}
          onChange={(query) => set({ query })}
          tags={tags}
          extra={extra}
          placeholder="query { … }  (Ctrl+Espaço sugere campos do schema)"
          onView={(v) => {
            view.current = v
            if (schema) updateSchema(v, schema)
          }}
        />
      </div>
      <div className="border-t border-line px-2 py-1 text-[11.5px] text-dim">Variáveis (JSON)</div>
      <div className="min-h-0 flex-[2] border-t border-line">
        <CodeEditor value={g.variables} onChange={(variables) => set({ variables })} lang="json" tags={tags} placeholder='{ "id": 1 }' />
      </div>
    </div>
  )
}
