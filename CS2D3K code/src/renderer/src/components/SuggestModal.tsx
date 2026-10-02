import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'

export interface SuggestModalProps<T> {
  placeholder: string
  /** compute items for query */
  getItems: (query: string) => T[]
  render: (item: T, query: string) => ReactNode
  onChoose: (item: T, e: { ctrl: boolean; shift: boolean; alt: boolean }, query: string) => void
  onClose: () => void
  instructions?: { keys: string; label: string }[]
  emptyText?: string | ((query: string) => ReactNode)
  initialQuery?: string
}

export default function SuggestModal<T>(p: SuggestModalProps<T>) {
  const [query, setQuery] = useState(p.initialQuery ?? '')
  const [sel, setSel] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const items = useMemo(() => p.getItems(query), [query, p.getItems])

  useEffect(() => {
    inputRef.current?.focus()
  }, [])
  useEffect(() => setSel(0), [query])
  useEffect(() => {
    const el = listRef.current?.children[sel] as HTMLElement | undefined
    el?.scrollIntoView({ block: 'nearest' })
  }, [sel])

  const choose = (i: number, e: { ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; altKey: boolean }): void => {
    const item = items[i]
    if (item === undefined && !(p.emptyText && query)) return
    p.onClose()
    p.onChoose(item, { ctrl: e.ctrlKey || e.metaKey, shift: e.shiftKey, alt: e.altKey }, query)
  }

  return (
    <div className="modal-backdrop" onMouseDown={p.onClose}>
      <div className="modal prompt" onMouseDown={(e) => e.stopPropagation()}>
        <div className="prompt-input-wrap">
          <input
            ref={inputRef}
            className="prompt-input"
            placeholder={p.placeholder}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              e.stopPropagation()
              if (e.key === 'ArrowDown') {
                e.preventDefault()
                setSel((s) => Math.min(items.length - 1, s + 1))
              } else if (e.key === 'ArrowUp') {
                e.preventDefault()
                setSel((s) => Math.max(0, s - 1))
              } else if (e.key === 'Enter') {
                e.preventDefault()
                choose(sel, e)
              } else if (e.key === 'Escape') {
                p.onClose()
              }
            }}
          />
        </div>
        <div className="prompt-results" ref={listRef}>
          {items.map((it, i) => (
            <div key={i} className={`suggestion-item${i === sel ? ' is-selected' : ''}`} onMouseMove={() => setSel(i)} onClick={(e) => choose(i, e)}>
              {p.render(it, query)}
            </div>
          ))}
          {items.length === 0 && p.emptyText && (
            <div className="empty-state">{typeof p.emptyText === 'function' ? p.emptyText(query) : p.emptyText}</div>
          )}
        </div>
        {p.instructions && (
          <div className="prompt-instructions">
            {p.instructions.map((ins) => (
              <span key={ins.keys}>
                <kbd>{ins.keys}</kbd> {ins.label}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

/** Highlights fuzzy-matched characters */
export function Highlighted({ text, indices }: { text: string; indices: number[] }) {
  if (!indices.length) return <>{text}</>
  const set = new Set(indices)
  const out: ReactNode[] = []
  let buf = ''
  let hl = false
  for (let i = 0; i < text.length; i++) {
    const h = set.has(i)
    if (h !== hl && buf) {
      out.push(hl ? <span key={i} className="suggestion-highlight">{buf}</span> : buf)
      buf = ''
    }
    hl = h
    buf += text[i]
  }
  if (buf) out.push(hl ? <span key="end" className="suggestion-highlight">{buf}</span> : buf)
  return <>{out}</>
}
