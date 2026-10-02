import { useState, type ReactNode } from 'react'
import { ChevronDown } from 'lucide-react'
import { useWorkspace } from '@/store/workspace'

/** Open a file and scroll to a line (0-based) — views read state.line / state.subpath */
export function openAt(path: string, opts: { line?: number; subpath?: string; newTab?: boolean; query?: string } = {}): void {
  useWorkspace.getState().openFile(path, {
    target: opts.newTab ? 'tab' : undefined,
    state: { line: opts.line, subpath: opts.subpath, query: opts.query, _nav: Date.now() }
  })
}

export function Collapsible({ title, count, children, defaultOpen = true, actions }: { title: ReactNode; count?: number; children: ReactNode; defaultOpen?: boolean; actions?: ReactNode }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div style={{ marginBottom: 6 }}>
      <div className="tree-item" style={{ paddingLeft: 2, fontWeight: 600, color: 'var(--text-normal)' }} onClick={() => setOpen(!open)}>
        <span className={`chevron${open ? '' : ' collapsed'}`}>
          <ChevronDown />
        </span>
        <span className="item-name">{title}</span>
        {count !== undefined && <span className="item-count">{count}</span>}
        {actions}
      </div>
      {open && children}
    </div>
  )
}

/** Renders text with [start,end) highlighted */
export function MatchText({ text, start, end }: { text: string; start: number; end: number }) {
  return (
    <>
      {text.slice(0, start)}
      <mark style={{ background: 'var(--text-highlight-bg)', color: 'inherit', borderRadius: 2 }}>{text.slice(start, end)}</mark>
      {text.slice(end)}
    </>
  )
}

export const snippetStyle: React.CSSProperties = {
  fontSize: 'var(--font-ui-smaller)',
  color: 'var(--text-muted)',
  padding: '4px 8px 4px 24px',
  borderRadius: 'var(--radius-s)',
  cursor: 'pointer',
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-word',
  lineHeight: 1.45,
  userSelect: 'text'
}
