import type { ReactNode } from 'react'

export const METHOD_COLOR: Record<string, string> = {
  GET: 'text-tgreen',
  POST: 'text-torange',
  PUT: 'text-tblue',
  PATCH: 'text-tpurple',
  DELETE: 'text-tpink',
  HEAD: 'text-dim',
  OPTIONS: 'text-dim'
}

export function MethodBadge({ method, className = '' }: { method: string; className?: string }) {
  const short = method === 'DELETE' ? 'DEL' : method === 'OPTIONS' ? 'OPT' : method === 'PATCH' ? 'PTCH' : method
  return <span className={`font-mono text-[10.5px] font-semibold ${METHOD_COLOR[method] ?? 'text-dim'} ${className}`}>{short}</span>
}

/** seções dentro de um painel (não são abas de documento) */
export function Segmented<T extends string>({ value, options, onChange }: { value: T; options: { id: T; label: ReactNode }[]; onChange: (v: T) => void }) {
  return (
    <div className="flex gap-0.5">
      {options.map((o) => (
        <button
          key={o.id}
          onClick={() => onChange(o.id)}
          className={`rounded-md px-2.5 py-1 text-[12px] ${value === o.id ? 'bg-raised text-ink' : 'text-dim hover:text-ink'}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function Count({ n }: { n: number }) {
  return n ? <span className="ml-1 text-[10.5px] text-faint">{n}</span> : null
}

export function Modal({ title, children, onClose, wide }: { title: string; children: ReactNode; onClose: () => void; wide?: boolean }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`flex max-h-[86vh] flex-col rounded-xl border border-line bg-panel shadow-2xl ${wide ? 'w-[min(960px,92vw)]' : 'w-[min(520px,92vw)]'}`}>
        <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
          <span className="font-semibold">{title}</span>
          <button className="btn btn-ghost px-2 py-0.5" onClick={onClose}>✕</button>
        </div>
        <div className="min-h-0 flex-1 overflow-auto p-4">{children}</div>
      </div>
    </div>
  )
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(2)} MB`
}

/** ícone de pasta (aberta/fechada) */
export function FolderIcon({ open }: { open: boolean }) {
  return open ? (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M3 7.5V6a2 2 0 0 1 2-2h4l2 2.5h8a2 2 0 0 1 2 2V9" />
      <path d="M3.4 19.2 5.6 10.6A2 2 0 0 1 7.5 9.1h13.1a1 1 0 0 1 1 1.3l-2.1 7.9a2 2 0 0 1-1.9 1.5H4.4a1 1 0 0 1-1-1.3Z" fill="currentColor" fillOpacity="0.18" />
    </svg>
  ) : (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M3 6a2 2 0 0 1 2-2h4l2 2.5h8a2 2 0 0 1 2 2V18a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" fill="currentColor" fillOpacity="0.18" />
    </svg>
  )
}

export function Chevron({ open }: { open: boolean }) {
  return (
    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden style={{ transform: open ? 'rotate(90deg)' : undefined, transition: 'transform 120ms' }}>
      <path d="m9 6 6 6-6 6" />
    </svg>
  )
}
