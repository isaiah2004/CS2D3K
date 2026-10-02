// Global graph view (main area): every note, optionally tags / attachments / unresolved links.
import { useEffect, useMemo, useRef } from 'react'
import { Maximize, SlidersHorizontal } from 'lucide-react'
import type { ViewProps } from '../types'
import { ViewHeaderActions, StatusBarItem } from '@/components/Slots'
import { useMetadata } from '@/store/metadata'
import { useVault } from '@/store/vault'
import { useGraphSettings } from './settings'
import { buildGraph } from './data'
import { isModClick, openNode, showNodeMenu, useDebounced, useGraphEngine, useFocusFile } from './common'
import GraphControls from './GraphControls'
import './graph.css'

export default function GraphView({ leafId, visible, focused }: ViewProps) {
  const hostRef = useRef<HTMLDivElement>(null)
  const leafRef = useRef(leafId)
  leafRef.current = leafId

  const s = useGraphSettings((st) => st.settings)
  const loaded = useGraphSettings((st) => st.loaded)
  const ready = useMetadata((m) => m.ready)
  const metaVersion = useMetadata((m) => m.version)
  const vaultVersion = useVault((v) => v.version)
  const active = useFocusFile()

  useEffect(() => {
    void useGraphSettings.getState().load()
  }, [])

  const engine = useGraphEngine(
    hostRef,
    {
      onClick: (n, e) => openNode(n, isModClick(e) ? 'tab' : 'default', leafRef.current),
      onContextMenu: (n, e) => showNodeMenu(n, e, leafRef.current)
    },
    { maxFitScale: 1.4, fitPadding: 60 }
  )

  // coalesce bursts of metadata updates (typing, bulk renames)
  const dataKey = useDebounced(`${metaVersion}:${vaultVersion}`, 250)
  const search = useDebounced(s.search, 150)
  const data = useMemo(
    () =>
      loaded && ready
        ? buildGraph({
            search,
            showTags: s.showTags,
            showAttachments: s.showAttachments,
            existingOnly: s.existingOnly,
            showOrphans: s.showOrphans,
            groups: s.groups
          })
        : null,
    // dataKey stands in for the metadata / vault stores
    [loaded, ready, dataKey, search, s.showTags, s.showAttachments, s.existingOnly, s.showOrphans, s.groups]
  )

  useEffect(() => {
    if (engine && data) engine.setData(data)
  }, [engine, data])
  useEffect(() => engine?.setVisible(visible), [engine, visible])
  useEffect(() => engine?.setFocus(active), [engine, active])
  // keep zoom-to-fit clear of the floating settings panel
  useEffect(() => engine?.setFitInsets(s.panelOpen ? 280 : 0), [engine, s.panelOpen])
  useEffect(
    () => engine?.setDisplay({ arrows: s.showArrows, textFade: s.textFade, nodeSize: s.nodeSize, linkThickness: s.linkThickness }),
    [engine, s.showArrows, s.textFade, s.nodeSize, s.linkThickness]
  )
  useEffect(
    () => engine?.setForces({ center: s.centerStrength, repel: s.repelStrength, link: s.linkStrength, distance: s.linkDistance }),
    [engine, s.centerStrength, s.repelStrength, s.linkStrength, s.linkDistance]
  )

  const set = useGraphSettings((st) => st.set)

  return (
    <div className="graph-view">
      <div className="graph-host" ref={hostRef} />
      {data && data.nodes.length === 0 && (
        <div className="graph-empty">{s.search ? 'No files match the current filters.' : 'No notes to show yet.'}</div>
      )}
      <GraphControls onAnimate={() => engine?.animate()} />
      <ViewHeaderActions>
        <button
          className={`clickable-icon small${s.panelOpen ? ' is-active' : ''}`}
          title="Graph settings"
          aria-label="Graph settings"
          onClick={() => set({ panelOpen: !s.panelOpen })}
        >
          <SlidersHorizontal />
        </button>
        <button className="clickable-icon small" title="Zoom to fit" aria-label="Zoom to fit" onClick={() => engine?.zoomToFit()}>
          <Maximize />
        </button>
      </ViewHeaderActions>
      <StatusBarItem active={focused}>
        <div className="status-bar-item">
          {data ? `${data.nodes.length} ${data.nodes.length === 1 ? 'node' : 'nodes'} · ${data.links.length} ${data.links.length === 1 ? 'link' : 'links'}` : 'Graph'}
        </div>
      </StatusBarItem>
    </div>
  )
}
