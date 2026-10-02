import { useEffect, useRef, useState } from 'react'
import { CaseSensitive, Regex, X, FileCode2, ChevronsDownUp } from 'lucide-react'
import type { SearchResult } from '@shared/types'
import { on, takeUnhandled } from '@/lib/events'
import { debounce } from '@/lib/util'
import { stem, extname } from '@/lib/path'
import { Collapsible, MatchText, openAt, snippetStyle } from './common'
import { useVault } from '@/store/vault'

export default function SearchPane() {
  const [query, setQuery] = useState('')
  const [caseSensitive, setCase] = useState(false)
  const [regex, setRegex] = useState(false)
  const [notesOnly, setNotesOnly] = useState(false)
  const [results, setResults] = useState<SearchResult[]>([])
  const [busy, setBusy] = useState(false)
  const [collapseKey, setCollapseKey] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const version = useVault((s) => s.version)

  const runRef = useRef(
    debounce(async (q: string, cs: boolean, re: boolean, notes: boolean) => {
      if (!q.trim()) {
        setResults([])
        setBusy(false)
        return
      }
      setBusy(true)
      try {
        const r = await window.api.fs.search({ query: q, caseSensitive: cs, regex: re, exts: notes ? ['md', 'canvas', 'formmap'] : undefined })
        setResults(r)
      } finally {
        setBusy(false)
      }
    }, 250)
  )

  useEffect(() => {
    runRef.current(query, caseSensitive, regex, notesOnly)
  }, [query, caseSensitive, regex, notesOnly, version])

  useEffect(
    () =>
      on('focus-search', ({ query: q }) => {
        if (q !== undefined) setQuery(q)
        inputRef.current?.focus()
        inputRef.current?.select()
      }),
    []
  )
  useEffect(() => {
    const pending = takeUnhandled('focus-search')
    if (pending?.query !== undefined) setQuery(pending.query)
    inputRef.current?.focus()
  }, [])

  const total = results.reduce((a, r) => a + r.matches.length, 0)

  return (
    <>
      <div style={{ padding: '8px 8px 4px', display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
          <input
            ref={inputRef}
            className="input"
            placeholder="Search files..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') setQuery('')
            }}
            style={{ paddingRight: 84 }}
          />
          <div style={{ position: 'absolute', right: 4, display: 'flex' }}>
            {query && (
              <button className="clickable-icon small" onClick={() => setQuery('')} title="Clear">
                <X />
              </button>
            )}
            <button className={`clickable-icon small${caseSensitive ? ' is-active' : ''}`} onClick={() => setCase(!caseSensitive)} title="Match case">
              <CaseSensitive />
            </button>
            <button className={`clickable-icon small${regex ? ' is-active' : ''}`} onClick={() => setRegex(!regex)} title="Use regular expression">
              <Regex />
            </button>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 'var(--font-ui-smaller)', color: 'var(--text-faint)' }}>
          <span style={{ flex: 1 }}>{busy ? 'Searching…' : query ? `${results.length} files · ${total} matches` : ''}</span>
          <button className={`clickable-icon small${notesOnly ? '' : ' is-active'}`} onClick={() => setNotesOnly(!notesOnly)} title={notesOnly ? 'Searching notes only — click to include code files' : 'Including code files — click for notes only'}>
            <FileCode2 />
          </button>
          <button className="clickable-icon small" onClick={() => setCollapseKey((k) => k + 1)} title="Collapse results">
            <ChevronsDownUp />
          </button>
        </div>
      </div>
      <div className="pane-body">
        {results.map((r) => (
          <Collapsible key={`${r.path}:${collapseKey}`} defaultOpen={collapseKey === 0} title={<span title={r.path}>{extname(r.path) === 'md' ? stem(r.path) : r.path}</span>} count={r.matches.length}>
            {r.matches.length === 0 && (
              <div style={snippetStyle} onClick={() => openAt(r.path)}>
                (file name match)
              </div>
            )}
            {r.matches.map((m, i) => (
              <div
                key={i}
                style={snippetStyle}
                className="search-snippet"
                onClick={(e) => openAt(r.path, { line: m.line, newTab: e.ctrlKey || e.metaKey, query })}
                onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--background-modifier-hover)')}
                onMouseLeave={(e) => (e.currentTarget.style.background = '')}
              >
                <MatchText text={m.text} start={m.start} end={m.end} />
              </div>
            ))}
          </Collapsible>
        ))}
        {query && !busy && results.length === 0 && <div className="empty-state">No matches found.</div>}
      </div>
    </>
  )
}
