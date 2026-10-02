import { Link2, SquareTerminal } from 'lucide-react'
import { useActiveFile, useWorkspace } from '@/store/workspace'
import { useMetadata, getBacklinks } from '@/store/metadata'

export default function StatusBar() {
  const active = useActiveFile()
  useMetadata((s) => s.version)
  const backlinks = active && active.endsWith('.md') ? getBacklinks(active).length : null
  const bottomOpen = useWorkspace((s) => s.bottom.open)
  return (
    <div className="status-bar">
      <div id="status-bar-view-items" />
      {backlinks !== null && (
        <div className="status-bar-item clickable" title="Show backlinks" onClick={() => useWorkspace.getState().revealPane('backlinks')}>
          <Link2 /> {backlinks} backlink{backlinks === 1 ? '' : 's'}
        </div>
      )}
      <div
        className={`status-bar-item clickable${bottomOpen ? ' is-active' : ''}`}
        title="Toggle terminal panel (Ctrl+`)"
        onClick={() => useWorkspace.getState().toggleBottom()}
      >
        <SquareTerminal />
      </div>
    </div>
  )
}
