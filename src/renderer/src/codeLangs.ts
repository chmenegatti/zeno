// Realce de sintaxe por linguagem na tela "Gerar código" (alvos do httpsnippet → modo do CodeMirror).

import { javascript } from '@codemirror/lang-javascript'
import { php } from '@codemirror/lang-php'
import { StreamLanguage, type StreamParser } from '@codemirror/language'
import { c, csharp, java, kotlin, objectiveC } from '@codemirror/legacy-modes/mode/clike'
import { clojure } from '@codemirror/legacy-modes/mode/clojure'
import { crystal } from '@codemirror/legacy-modes/mode/crystal'
import { go } from '@codemirror/legacy-modes/mode/go'
import { http } from '@codemirror/legacy-modes/mode/http'
import { oCaml } from '@codemirror/legacy-modes/mode/mllike'
import { powerShell } from '@codemirror/legacy-modes/mode/powershell'
import { python } from '@codemirror/legacy-modes/mode/python'
import { r } from '@codemirror/legacy-modes/mode/r'
import { ruby } from '@codemirror/legacy-modes/mode/ruby'
import { rust } from '@codemirror/legacy-modes/mode/rust'
import { shell } from '@codemirror/legacy-modes/mode/shell'
import { swift } from '@codemirror/legacy-modes/mode/swift'
import type { Extension } from '@codemirror/state'

const LEGACY: Record<string, StreamParser<unknown>> = {
  shell,
  python,
  go,
  java,
  kotlin,
  csharp,
  c,
  objc: objectiveC,
  ruby,
  swift,
  rust,
  powershell: powerShell,
  http,
  r,
  clojure,
  crystal,
  ocaml: oCaml
}

/** linguagem do CodeMirror pro alvo do httpsnippet (sem realce se não conhecer) */
export function codeLang(target: string | undefined): Extension[] {
  if (!target) return []
  if (target === 'javascript' || target === 'node') return [javascript()]
  if (target === 'php') return [php()]
  const mode = LEGACY[target]
  return mode ? [StreamLanguage.define(mode)] : []
}
