import { Bookmark as BookmarkIcon, Search, Trash2, Waypoints } from 'lucide-react'
import { useBookmarks } from '@/store/bookmarks'
import { useWorkspace, getActiveFile } from '@/store/workspace'
import { useVault } from '@/store/vault'
import { showContextMenu } from '@/store/ui'
import { emit } from '@/lib/events'
import { FileIcon } from '@/components/FileIcon'
import { extname, stem, basename } from '@/lib/path'
import { useState } from 'react'

export default function BookmarksPane() {
  const items = useBookmarks((s) => s.items)
  const files = useVault((s) => s.files)
  const [drag, setDrag] = useState<number | null>(null)
  return (
    <>
      <div className="pane-header">
        <button
          className="clickable-icon small"
          title="Bookmark current file"
          onClick={() => {
            const t = getActiveFile()
            if (t) useBookmarks.getState().toggleFile(t)
          }}
        >
          <BookmarkIcon />
        </button>
      </div>
      <div className="pane-body">
        {items.length === 0 && <div className="empty-state">No bookmarks yet. Right-click a file and choose “Bookmark”.</div>}
        {items.map((b, i) => {
          const missing = b.type === 'file' && b.path && !files[b.path]
          const label = b.title ?? (b.type === 'file' && b.path ? (extname(b.path) === 'md' ? stem(b.path) : basename(b.path)) : b.type === 'search' ? b.query : 'Graph')
          return (
            <div
              key={i}
              className="tree-item"
              style={{ paddingLeft: 8, opacity: missing ? 0.5 : 1 }}
              draggable
              onDragStart={(e) => {
                setDrag(i)
                e.dataTransfer.setData('application/x-bookmark', String(i))
              }}
              onDragOver={(e) => {
                if (e.dataTransfer.types.includes('application/x-bookmark')) e.preventDefault()
              }}
              onDrop={(e) => {
                const from = Number(e.dataTransfer.getData('application/x-bookmark'))
                setDrag(null)
                if (!isNaN(from) && from !== i) useBookmarks.getState().move(from, i)
              }}
              onClick={(e) => {
                if (b.type === 'file' && b.path && !missing) useWorkspace.getState().openFile(b.path, { target: e.ctrlKey ? 'tab' : undefined })
                if (b.type === 'search') {
                  useWorkspace.getState().revealPane('search')
                  setTimeout(() => emit('focus-search', { query: b.query }), 30)
                }
                if (b.type === 'graph') useWorkspace.getState().openView('graph')
              }}
              onContextMenu={(e) => showContextMenu(e, [{ label: 'Remove bookmark', icon: <Trash2 />, danger: true, onClick: () => useBookmarks.getState().remove(i) }])}
            >
              {b.type === 'file' ? <FileIcon ext={extname(b.path ?? '')} className="item-icon" /> : b.type === 'search' ? <Search className="item-icon" /> : <Waypoints className="item-icon" />}
              <span className="item-name">{label}</span>
            </div>
          )
        })}
      </div>
    </>
  )
}
