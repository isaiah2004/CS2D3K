import { FileQuestion } from 'lucide-react'
import { useActiveFile, useWorkspace } from '@/store/workspace'
import { useMetadata } from '@/store/metadata'
import { openLinkText } from '@/lib/fileops'
import { FileIcon } from '@/components/FileIcon'
import { extname } from '@/lib/path'
import { Collapsible } from './common'
import { displayName } from './BacklinksPane'

export default function OutgoingLinksPane() {
  const active = useActiveFile()
  const resolved = useMetadata((s) => (active ? s.resolved[active] : undefined))
  const unresolved = useMetadata((s) => (active ? s.unresolved[active] : undefined))
  if (!active) return <div className="empty-state">No active file.</div>
  const res = Object.entries(resolved ?? {}).sort((a, b) => a[0].localeCompare(b[0]))
  const unres = Object.entries(unresolved ?? {}).sort((a, b) => a[0].localeCompare(b[0]))
  return (
    <div className="pane-body">
      <div className="pane-title" style={{ padding: '4px 4px 8px' }}>
        Outgoing links from <span style={{ color: 'var(--text-normal)' }}>{displayName(active)}</span>
      </div>
      <Collapsible title="Links" count={res.length}>
        {res.length === 0 && <div className="empty-state">No links.</div>}
        {res.map(([p, n]) => (
          <div key={p} className="tree-item" style={{ paddingLeft: 20 }} onClick={(e) => useWorkspace.getState().openFile(p, { target: e.ctrlKey ? 'tab' : undefined })} title={p}>
            <FileIcon ext={extname(p)} className="item-icon" />
            <span className="item-name">{displayName(p)}</span>
            {n > 1 && <span className="item-count">{n}</span>}
          </div>
        ))}
      </Collapsible>
      <Collapsible title="Unresolved links" count={unres.length}>
        {unres.map(([l, n]) => (
          <div key={l} className="tree-item" style={{ paddingLeft: 20, opacity: 0.75 }} onClick={() => void openLinkText(l, active)} title="Click to create">
            <FileQuestion className="item-icon" />
            <span className="item-name">{l}</span>
            {n > 1 && <span className="item-count">{n}</span>}
          </div>
        ))}
      </Collapsible>
    </div>
  )
}
