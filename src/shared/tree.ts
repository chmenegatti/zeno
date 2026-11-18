import type { Auth, Folder, KV, RequestDoc, TreeNode, Workspace } from './types'

export function sortNodes<T extends { sortKey: number; name: string }>(nodes: T[]): T[] {
  return nodes.sort((a, b) => a.sortKey - b.sortKey || a.name.localeCompare(b.name))
}

export function walk(nodes: TreeNode[], fn: (n: TreeNode, ancestors: Folder[]) => void, ancestors: Folder[] = []): void {
  for (const n of nodes) {
    fn(n, ancestors)
    if (n.kind === 'folder') walk(n.children, fn, [...ancestors, n])
  }
}

/** acha nó e a cadeia de pastas ancestrais */
export function findNode(ws: Workspace, id: string): { node: TreeNode; ancestors: Folder[] } | null {
  let found: { node: TreeNode; ancestors: Folder[] } | null = null
  walk(ws.children, (n, ancestors) => {
    if (!found && n.id === id) found = { node: n, ancestors }
  })
  return found
}

export function countTree(nodes: TreeNode[]): { folders: number; requests: number } {
  let folders = 0
  let requests = 0
  walk(nodes, (n) => (n.kind === 'folder' ? folders++ : requests++))
  return { folders, requests }
}

/** auth efetiva: sobe pelas pastas enquanto for inherit */
export function effectiveAuth(req: RequestDoc, ancestors: Folder[]): Auth {
  if (req.auth.type !== 'inherit') return req.auth
  for (let i = ancestors.length - 1; i >= 0; i--) {
    if (ancestors[i].auth.type !== 'inherit') return ancestors[i].auth
  }
  return { type: 'none' }
}

/** headers das pastas (raiz primeiro) + do request; request vence em nome igual */
export function effectiveHeaders(req: RequestDoc, ancestors: Folder[]): KV[] {
  const map = new Map<string, KV>()
  for (const f of ancestors) for (const h of f.headers) if (h.enabled && h.name) map.set(h.name.toLowerCase(), h)
  for (const h of req.headers) if (h.enabled && h.name) map.set(h.name.toLowerCase(), h)
  return [...map.values()]
}

export function newId(prefix: 'req' | 'fld' | 'env' | 'wrk'): string {
  const hex = Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('')
  return `${prefix}_${hex}`
}

export function slugify(name: string): string {
  const s = name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
  return s || 'sem-nome'
}
