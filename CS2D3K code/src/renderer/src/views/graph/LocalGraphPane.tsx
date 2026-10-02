// Local graph sidebar pane: neighbourhood of the active file, follows it as it changes.
import { useEffect, useMemo, useRef } from 'react'
import { Hash, Maximize, Paperclip, Share2 } from 'lucide-react'
import { useActiveFile } from '@/store/workspace'
import { useMetadata } from '@/store/metadata'
import { useVault } from '@/store/vault'
import { useGraphSettings } from './settings'
import { buildLocalGraph } from './data'
import { isModClick, openNode, showNodeMenu, useDebounced, useGraphEngine } from './common'
import './graph.css'

export default function LocalGraphPane() {
  const hostRef = useRef<HTMLDivElement>(null)
  const active = useActiveFile()
  const local = useGraphSettings((st) => st.local)
  const s = useGraphSettings((st) => st.settings)
  const setLocal = useGraphSettings((st) => st.setLocal)
  const loaded = useGraphSettings((st) => st.loaded)
  const ready = useMetadata((m) => m.ready)
  const metaVersion = useMetadata((m) => m.version)
  const vaultVersion = useVault((v) => v.version)

  useEffect(() => {
    void useGraphSettings.getState().load()
  }, [])

  const engine = useGraphEngine(
    hostRef,
    {
      onClick: (n, e) => openNode(n, isModClick(e) ? 'tab' : 'default'),
      onContextMenu: (n, e) => showNodeMenu(n, e)
    },
    { maxFitScale: 1.3, fitPadding: 16, backgroundVar: 'background-secondary', aspectForces: true }
  )

  const dataKey = useDebounced(`${metaVersion}:${vaultVersion}`, 250)
  const data = useMemo(
    () =>
      active && loaded && ready
        ? buildLocalGraph(active, {
            depth: local.depth,
            showTags: local.showTags,
            showAttachments: local.showAttachments,
            neighborLinks: local.neighborLinks,
            groups: s.groups
          })
        : null,
    // dataKey stands in for the metadata / vault stores
    [active, loaded, ready, dataKey, local.depth, local.showTags, local.showAttachments, local.neighborLinks, s.groups]
  )

  // follow the active file: keep shared nodes in place and re-frame smoothly
  const centerRef = useRef<string | null>(null)
  useEffect(() => {
    if (!engine || !data || !active) return
    engine.setData(data)
    engine.setFocus(active)
    if (centerRef.current !== active) {
      centerRef.current = active
      engine.zoomToFit()
    }
  }, [engine, data, active])
  useEffect(() => engine?.setVisible(!!data), [engine, data])
  useEffect(
    () => engine?.setDisplay({ arrows: s.showArrows, textFade: s.textFade - 1, nodeSize: s.nodeSize, linkThickness: s.linkThickness }),
    [engine, s.showArrows, s.textFade, s.nodeSize, s.linkThickness]
  )
  useEffect(
    () => engine?.setForces({ center: s.centerStrength, repel: s.repelStrength, link: s.linkStrength, distance: Math.min(s.linkDistance, 160) }),
    [engine, s.centerStrength, s.repelStrength, s.linkStrength, s.linkDistance]
  )

  const iconBtn = (on: boolean, title: string, onClick: () => void, icon: React.ReactNode) => (
    <button className={`clickable-icon small${on ? ' is-active' : ''}`} title={title} aria-label={title} aria-pressed={on} onClick={onClick}>
      {icon}
    </button>
  )

  return (
    <div className="local-graph">
      <div className="local-graph-toolbar">
        <label className="local-graph-depth" title="Depth">
          <span>Depth</span>
          <input
            type="range"
            min={1}
            max={3}
            step={1}
            value={local.depth}
            aria-label="Depth"
            style={{ '--graph-slider-pct': `${((local.depth - 1) / 2) * 100}%` } as React.CSSProperties}
            onChange={(e) => setLocal({ depth: Number(e.target.value) })}
          />
          <span className="local-graph-depth-value">{local.depth}</span>
        </label>
        <div className="local-graph-actions">
          {iconBtn(local.showTags, 'Show tags', () => setLocal({ showTags: !local.showTags }), <Hash />)}
          {iconBtn(local.showAttachments, 'Show attachments', () => setLocal({ showAttachments: !local.showAttachments }), <Paperclip />)}
          {iconBtn(local.neighborLinks, 'Show links between neighbors', () => setLocal({ neighborLinks: !local.neighborLinks }), <Share2 />)}
          <button className="clickable-icon small" title="Zoom to fit" aria-label="Zoom to fit" onClick={() => engine?.zoomToFit()}>
            <Maximize />
          </button>
        </div>
      </div>
      <div className="local-graph-body">
        <div className={`graph-host${data ? '' : ' is-empty'}`} ref={hostRef} />
        {!data && <div className="graph-empty">{active ? 'This file is not part of the graph.' : 'No file is open.'}</div>}
      </div>
    </div>
  )
}
