// The real graph engine behind the loading screen, growing as notes are indexed (loaded lazily: the progress bar
// shows right away, the graph joins a moment later).
import { useEffect, useRef } from 'react'
import { useGraphEngine } from '@/views/graph/common'
import { resolveColor } from '@/theme/theme'
import type { LoadGraph } from '@/lib/loadGraph'

/** how often new notes are handed to the engine (each hand-off rebuilds its arrays) */
const FEED_MS = 150
/** the newest nodes glow in the accent color and fade to the node color over this many hand-offs */
const TRAIL = [1, 0.7, 0.45, 0.2]

function rgb(c: string): [number, number, number] | null {
  const m = /^#([0-9a-f]{6})$/i.exec(c)
  if (!m) return null
  const v = parseInt(m[1], 16)
  return [v >> 16, (v >> 8) & 255, v & 255]
}

/** accent → node color steps for the current theme */
function trailColors(): string[] {
  const accent = resolveColor('var(--interactive-accent)')
  const a = rgb(accent)
  const b = rgb(resolveColor('var(--graph-node)'))
  if (!a || !b) return TRAIL.map(() => accent)
  return TRAIL.map((t) => '#' + a.map((x, i) => Math.round(b[i] + (x - b[i]) * t).toString(16).padStart(2, '0')).join(''))
}

export default function LoadingGraph({ graph }: { graph: LoadGraph }) {
  const hostRef = useRef<HTMLDivElement>(null)
  const engine = useGraphEngine(hostRef, {}, { maxFitScale: 1.25, fitPadding: 70, backgroundVar: 'background-primary', appearLimit: 2500, appearFirst: true })

  useEffect(() => {
    if (!engine) return
    engine.setDisplay({ arrows: false, textFade: 0, nodeSize: 1.35, linkThickness: 1 })
    let seen = -1
    let first = true
    const feed = (): void => {
      if ((graph.version === seen && !graph.glowing) || !graph.nodes.length) return
      seen = graph.version
      engine.setData(graph.take(trailColors()))
      // start framed on the first nodes instead of zooming out from the default camera
      if (first) engine.fitNow()
      first = false
    }
    feed()
    const t = setInterval(feed, FEED_MS)
    return () => clearInterval(t)
  }, [engine, graph])

  return <div className="loading-graph" ref={hostRef} />
}
