import { useCallback } from 'react'
import SuggestModal, { Highlighted } from './SuggestModal'
import { useUi, notice } from '@/store/ui'
import { useWorkspace } from '@/store/workspace'
import { allFiles } from '@/store/vault'
import { fuzzyMatch } from '@/lib/util'
import { createNote } from '@/lib/fileops'
import { dirname, stem, extname } from '@/lib/path'
import { useMetadata } from '@/store/metadata'

interface Item {
  path: string
  display: string
  indices: number[]
  unresolved?: boolean
}

export default function QuickSwitcher() {
  const close = useUi((s) => s.closeModal)

  const getItems = useCallback((q: string): Item[] => {
    const files = allFiles().sort((a, b) => b.mtime - a.mtime)
    const disp = (p: string): string => (extname(p) === 'md' ? p.slice(0, -3) : p)
    if (!q.trim()) return files.slice(0, 50).map((f) => ({ path: f.path, display: disp(f.path), indices: [] }))
    const scored = files
      .map((f) => {
        const d = disp(f.path)
        // score on name first, fall back to full path
        const mName = fuzzyMatch(q, stem(f.path))
        const mPath = fuzzyMatch(q, d)
        if (!mName && !mPath) return null
        const offset = d.length - stem(f.path).length - (extname(f.path) && extname(f.path) !== 'md' ? extname(f.path).length + 1 : 0)
        const useName = mName && (!mPath || mName.score + 5 >= mPath.score)
        return {
          path: f.path,
          display: d,
          indices: useName ? mName!.indices.map((i) => i + offset) : mPath!.indices,
          score: (useName ? mName!.score + 5 : mPath!.score) + (extname(f.path) === 'md' ? 2 : 0)
        }
      })
      .filter((x): x is Item & { score: number } => !!x)
      .sort((a, b) => b.score - a.score)
      .slice(0, 100)
    // unresolved links matching query
    const unres = new Set<string>()
    for (const m of Object.values(useMetadata.getState().unresolved)) for (const k of Object.keys(m)) if (fuzzyMatch(q, k)) unres.add(k)
    const extra = [...unres].slice(0, 5).map((u) => ({ path: u, display: u, indices: [], unresolved: true }))
    return [...scored, ...extra]
  }, [])

  return (
    <SuggestModal<Item>
      placeholder="Find or create a note..."
      getItems={getItems}
      onClose={close}
      emptyText={(q) => (
        <span>
          No notes found. Press <kbd>Enter</kbd> to create <b>{q}</b>
        </span>
      )}
      onChoose={(it, e, q) => {
        if (!it || it.unresolved) {
          const name = (it?.path ?? q).trim()
          if (!name) return
          const folder = name.includes('/') ? dirname(name) : undefined
          createNote(folder, name.split('/').pop()!, '', e.ctrl ? 'tab' : 'replace').catch((err: Error) => notice(`Couldn't create "${name}": ${err.message}`, 'error'))
          return
        }
        useWorkspace.getState().openFile(it.path, { target: e.ctrl ? 'tab' : e.shift ? 'split-right' : undefined })
      }}
      instructions={[
        { keys: '↑↓', label: 'to navigate' },
        { keys: '↵', label: 'to open' },
        { keys: 'ctrl ↵', label: 'to open in new tab' },
        { keys: 'shift ↵', label: 'to open to the right' },
        { keys: 'esc', label: 'to dismiss' }
      ]}
      render={(it) => (
        <>
          <div className="suggestion-main">
            <Highlighted text={it.display} indices={it.indices} />
            {it.unresolved && <span className="suggestion-note"> — not created yet</span>}
          </div>
          {extname(it.path) && extname(it.path) !== 'md' && !it.unresolved && <span className="kbd">{extname(it.path).toUpperCase()}</span>}
        </>
      )}
    />
  )
}
