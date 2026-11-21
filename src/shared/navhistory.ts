// Voltar/avançar entre requests (#152): o Zeno não tem abas, então a navegação lembra por onde você
// passou nesta sessão (só em memória), como num IDE.

export interface NavEntry {
  ws: string
  id: string
}

const same = (a: NavEntry | undefined, b: NavEntry | undefined): boolean => !!a && !!b && a.ws === b.ws && a.id === b.id

export class NavHistory {
  back: NavEntry[] = []
  fwd: NavEntry[] = []
  cur?: NavEntry
  /** mais recente primeiro, sem repetir */
  recent: NavEntry[] = []

  constructor(private max = 50) {}

  /** abriu um request (clique, paleta, novo…): vira o atual e limpa o "avançar" */
  visit(e: NavEntry): void {
    if (same(e, this.cur)) return
    if (this.cur) this.back = [...this.back, this.cur].slice(-this.max)
    this.fwd = []
    this.cur = e
    this.touch(e)
  }

  /** volta (-1) ou avança (1); pula requests que não existem mais */
  go(dir: -1 | 1, exists: (e: NavEntry) => boolean): NavEntry | undefined {
    const from = dir < 0 ? this.back : this.fwd
    const to = dir < 0 ? this.fwd : this.back
    while (from.length) {
      const e = from.pop()!
      if (!exists(e) || same(e, this.cur)) continue
      if (this.cur) to.push(this.cur)
      this.cur = e
      this.touch(e)
      return e
    }
    return undefined
  }

  /** request apagado: some de tudo */
  forget(exists: (e: NavEntry) => boolean): void {
    this.back = this.back.filter(exists)
    this.fwd = this.fwd.filter(exists)
    this.recent = this.recent.filter(exists)
  }

  private touch(e: NavEntry): void {
    this.recent = [e, ...this.recent.filter((x) => !same(x, e))].slice(0, this.max)
  }
}
