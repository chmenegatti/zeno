// Diff de linhas (LCS) pra comparar duas respostas do histórico. Textos enormes são cortados antes.

export type DiffLine = { t: 'same' | 'add' | 'del'; text: string }

export const DIFF_MAX_LINES = 2000

/** a → b, linha a linha; `cut` = algum lado passou do limite e foi truncado */
export function diffLines(a: string, b: string): { lines: DiffLine[]; cut: boolean } {
  let A = a.split('\n')
  let B = b.split('\n')
  const cut = A.length > DIFF_MAX_LINES || B.length > DIFF_MAX_LINES
  A = A.slice(0, DIFF_MAX_LINES)
  B = B.slice(0, DIFF_MAX_LINES)
  // prefixo e sufixo iguais saem da tabela (caso comum: pouca diferença)
  let pre = 0
  while (pre < A.length && pre < B.length && A[pre] === B[pre]) pre++
  let suf = 0
  while (suf < A.length - pre && suf < B.length - pre && A[A.length - 1 - suf] === B[B.length - 1 - suf]) suf++
  const a2 = A.slice(pre, A.length - suf)
  const b2 = B.slice(pre, B.length - suf)
  const n = a2.length
  const m = b2.length
  const L: Uint32Array[] = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1))
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = a2[i] === b2[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1])
  const mid: DiffLine[] = []
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (a2[i] === b2[j]) {
      mid.push({ t: 'same', text: a2[i++] })
      j++
    } else if (L[i + 1][j] >= L[i][j + 1]) mid.push({ t: 'del', text: a2[i++] })
    else mid.push({ t: 'add', text: b2[j++] })
  }
  while (i < n) mid.push({ t: 'del', text: a2[i++] })
  while (j < m) mid.push({ t: 'add', text: b2[j++] })
  const same = (x: string[]): DiffLine[] => x.map((text) => ({ t: 'same', text }))
  return { lines: [...same(A.slice(0, pre)), ...mid, ...same(A.slice(A.length - suf))], cut }
}
