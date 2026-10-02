import { useEffect, useMemo, useState } from 'react'
import { useActiveFile } from '@/store/workspace'
import { useMetadata, getBacklinks, resolveLink } from '@/store/metadata'
import { extname, stem, basename } from '@/lib/path'
import { Collapsible, openAt, snippetStyle } from './common'

interface Mention {
  source: string
  line: number
  text: string
}

/** Lines in source files that link to target (linked mentions) */
function useLinkedMentions(target: string | null): Mention[] {
  const version = useMetadata((s) => s.version)
  const [contents, setContents] = useState<Record<string, string[]>>({})
  const sources = useMemo(() => (target ? getBacklinks(target).map((b) => b.source) : []), [target, version])
  useEffect(() => {
    let cancelled = false
    void (async () => {
      const out: Record<string, string[]> = {}
      for (const s of sources) {
        try {
          out[s] = (await window.api.fs.readText(s)).split(/\r?\n/)
        } catch {
          /* ignore */
        }
      }
      if (!cancelled) setContents(out)
    })()
    return () => {
      cancelled = true
    }
  }, [sources])
  if (!target) return []
  const metas = useMetadata.getState().metas
  const out: Mention[] = []
  for (const s of sources) {
    const meta = metas[s]
    const lines = contents[s]
    if (!meta) continue
    const seen = new Set<number>()
    for (const l of meta.links) {
      if (seen.has(l.line)) continue
      if (resolveLink(l.link, s) === target) {
        seen.add(l.line)
        out.push({ source: s, line: l.line, text: s.endsWith('.canvas') || s.endsWith('.formmap') ? '(card)' : (lines?.[l.line] ?? '').trim() })
      }
    }
  }
  return out
}

export function displayName(p: string): string {
  return ['md', 'canvas', 'formmap'].includes(extname(p)) ? stem(p) : basename(p)
}

export default function BacklinksPane() {
  const active = useActiveFile()
  const mentions = useLinkedMentions(active)
  const [unlinked, setUnlinked] = useState<Mention[]>([])
  const [showUnlinked, setShowUnlinked] = useState(false)

  // unlinked mentions: plain-text occurrences of the note name
  useEffect(() => {
    if (!active || !showUnlinked) {
      setUnlinked([])
      return
    }
    let cancelled = false
    const name = stem(active)
    void window.api.fs.search({ query: name, exts: ['md'], maxResults: 200 }).then((res) => {
      if (cancelled) return
      const linked = new Set(mentions.map((m) => `${m.source}:${m.line}`))
      const out: Mention[] = []
      for (const r of res) {
        if (r.path === active) continue
        for (const m of r.matches) {
          if (linked.has(`${r.path}:${m.line}`)) continue
          if (/\[\[/.test(m.text) && m.text.toLowerCase().includes(`[[${name.toLowerCase()}`)) continue
          out.push({ source: r.path, line: m.line, text: m.text.trim() })
        }
      }
      setUnlinked(out)
    })
    return () => {
      cancelled = true
    }
  }, [active, showUnlinked, mentions.length])

  const group = (ms: Mention[]): Map<string, Mention[]> => {
    const g = new Map<string, Mention[]>()
    for (const m of ms) {
      const arr = g.get(m.source)
      if (arr) arr.push(m)
      else g.set(m.source, [m])
    }
    return g
  }

  if (!active) return <div className="empty-state">No active file.</div>
  const linkedGroups = group(mentions)
  return (
    <div className="pane-body">
      <div className="pane-title" style={{ padding: '4px 4px 8px' }}>
        Backlinks for <span style={{ color: 'var(--text-normal)' }}>{displayName(active)}</span>
      </div>
      <Collapsible title="Linked mentions" count={linkedGroups.size}>
        {linkedGroups.size === 0 && <div className="empty-state">No backlinks found.</div>}
        {[...linkedGroups].map(([src, ms]) => (
          <Collapsible key={src} title={displayName(src)} count={ms.length}>
            {ms.map((m, i) => (
              <div key={i} style={snippetStyle} onClick={(e) => openAt(src, { line: m.line, newTab: e.ctrlKey })} className="hover-bg">
                {m.text || '(empty line)'}
              </div>
            ))}
          </Collapsible>
        ))}
      </Collapsible>
      <Collapsible
        title={
          <span
            onClick={(e) => {
              e.stopPropagation()
              setShowUnlinked(!showUnlinked)
            }}
          >
            Unlinked mentions {showUnlinked ? '' : '(click to search)'}
          </span>
        }
        count={showUnlinked ? group(unlinked).size : undefined}
        defaultOpen
      >
        {showUnlinked &&
          [...group(unlinked)].map(([src, ms]) => (
            <Collapsible key={src} title={displayName(src)} count={ms.length}>
              {ms.map((m, i) => (
                <div key={i} style={snippetStyle} onClick={() => openAt(src, { line: m.line })} className="hover-bg">
                  {m.text}
                </div>
              ))}
            </Collapsible>
          ))}
      </Collapsible>
    </div>
  )
}
