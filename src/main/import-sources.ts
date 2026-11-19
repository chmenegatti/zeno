// Detecta o formato de cada arquivo/URL e converte: Insomnia v4 (JSON) e v5 (YAML), OpenAPI 3.x,
// Swagger 2.0 e Postman (coleção v2.x + arquivos de ambiente).

import YAML from 'yaml'
import { convert, fromExportV4, fromExportV5, isInsomniaV4, isInsomniaV5, type ParseResult } from './import-insomnia'
import { convertOpenApi, isOpenApi } from './import-openapi'
import { convertPostman, isPostmanCollection, isPostmanEnvironment } from './import-postman'
import type { Workspace } from '../shared/types'

export interface Source {
  /** nome do arquivo ou URL, pra mensagens */
  name: string
  text: string
  /** URL de onde veio (resolve servers relativos do OpenAPI) */
  url?: string
}

function parse(src: Source): unknown {
  const t = src.text.replace(/^﻿/, '').trim()
  if (!t) throw new Error(`${src.name}: arquivo vazio`)
  if (t.startsWith('{') || t.startsWith('[')) {
    try {
      return JSON.parse(t)
    } catch {
      /* talvez YAML com chaves */
    }
  }
  try {
    return YAML.parse(t, { maxAliasCount: 1000 })
  } catch (e) {
    throw new Error(`${src.name}: não é JSON nem YAML válido (${(e as Error).message.split('\n')[0]})`)
  }
}

/** importador de plugin: reconhece o texto e devolve um export do Insomnia v4 */
export interface ExtraImporter {
  name: string
  detect: (text: string) => boolean
  convert: (text: string) => unknown
}

export function parseSources(sources: Source[], extra: ExtraImporter[] = []): ParseResult {
  const workspaces = new Map<string, Workspace>()
  const warnings: string[] = []
  const add = (r: ParseResult): void => {
    for (const w of r.workspaces) workspaces.set(w.id, w)
    warnings.push(...r.warnings)
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const collections: any[] = []
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const envs: { name: string; doc: any }[] = []

  for (const src of sources) {
    // plugins primeiro: formatos que o Zeno não conhece (inclusive não-JSON/YAML)
    const im = extra.find((x) => x.detect(src.text))
    if (im) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const out = im.convert(src.text) as any
      if (!isInsomniaV4(out)) throw new Error(`${src.name}: o importador "${im.name}" não devolveu um export do Insomnia v4`)
      add(convert(fromExportV4(out)))
      continue
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const raw = parse(src) as any
    if (isInsomniaV4(raw)) add(convert(fromExportV4(raw)))
    else if (isInsomniaV5(raw)) {
      const spec = raw.spec?.contents
      const specDoc = typeof spec === 'string' ? parse({ name: src.name, text: spec }) : spec
      if (!raw.collection?.length && isOpenApi(specDoc)) add(convertOpenApi(specDoc, { sourceUrl: src.url }))
      else add(convert(fromExportV5(raw)))
    } else if (isOpenApi(raw)) add(convertOpenApi(raw, { sourceUrl: src.url }))
    else if (isPostmanCollection(raw)) collections.push(raw)
    else if (isPostmanEnvironment(raw)) envs.push({ name: src.name, doc: raw })
    else if (raw?.info?.schema && /collection\/v1/.test(String(raw.info.schema)))
      throw new Error(`${src.name}: coleção Postman v1; exporte de novo como v2.1`)
    else throw new Error(`${src.name}: formato não reconhecido (esperado Insomnia, OpenAPI/Swagger ou Postman)`)
  }

  // ambientes do Postman viram sub-ambientes das coleções importadas junto
  for (const c of collections) add(convertPostman(c, envs.map((e) => e.doc)))
  if (envs.length && !collections.length) throw new Error('ambientes do Postman precisam ser escolhidos junto com a coleção')

  const list = [...workspaces.values()].sort((a, b) => a.name.localeCompare(b.name))
  if (!list.length) throw new Error('nada para importar')
  return { workspaces: list, warnings }
}

/** baixa um spec/coleção por URL (http/https) */
export async function fetchSource(url: string): Promise<Source> {
  if (!/^https?:\/\//i.test(url.trim())) throw new Error('informe uma URL http(s)')
  const res = await fetch(url.trim(), { signal: AbortSignal.timeout(20000), headers: { Accept: 'application/json, application/yaml, text/yaml, */*' } })
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`)
  const text = await res.text()
  if (text.length > 30 * 1024 * 1024) throw new Error(`${url}: arquivo grande demais`)
  return { name: url, text, url: res.url || url }
}
