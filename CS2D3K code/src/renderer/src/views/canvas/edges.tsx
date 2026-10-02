// SVG edge layer + HTML edge labels.
// Geometry is cached per edge and only recomputed when the edge or one of its endpoint nodes changes; every edge is a
// memoized component, so dragging a card re-renders only the edges attached to it. The engine passes only the edges
// that intersect the mounted (culled) area.
import { memo, useEffect, useMemo, useRef, useState } from 'react'
import { autoSides, colorCss, edgeGeometry, sidePoint, type CanvasEdge, type CanvasNode, type EdgeGeometry, type Rect } from './model'
import { geometryBounds } from './cull'
import type { EdgeAppearance } from './engine'

type AppearanceFn = (e: CanvasEdge) => EdgeAppearance | undefined

export interface EdgeEntry {
  edge: CanvasEdge
  g: EdgeGeometry
  box: Rect
}

interface CacheItem extends EdgeEntry {
  a: CanvasNode
  b: CanvasNode
}

/** Edge geometries for the current nodes/edges, reusing cached results for untouched edges. */
export function useEdgeGeometries(nodes: CanvasNode[], edges: CanvasEdge[]): EdgeEntry[] {
  const cache = useRef(new Map<string, CacheItem>())
  return useMemo(() => {
    const byId = new Map<string, CanvasNode>()
    for (const n of nodes) byId.set(n.id, n)
    const prev = cache.current
    const next = new Map<string, CacheItem>()
    const out: EdgeEntry[] = []
    for (const e of edges) {
      const a = byId.get(e.fromNode)
      const b = byId.get(e.toNode)
      if (!a || !b) continue
      let item = prev.get(e.id)
      if (!item || item.edge !== e || item.a !== a || item.b !== b) {
        const [as, bs] = autoSides(a, b)
        const s1 = e.fromSide ?? as
        const s2 = e.toSide ?? bs
        const g = edgeGeometry(sidePoint(a, s1), s1, sidePoint(b, s2), s2, e.fromEnd === 'arrow', (e.toEnd ?? 'arrow') === 'arrow')
        item = { edge: e, a, b, g, box: geometryBounds(g) }
      }
      next.set(e.id, item)
      out.push(item)
    }
    cache.current = next
    return out
  }, [nodes, edges])
}

interface EdgeProps {
  id: string
  g: EdgeGeometry
  selected: boolean
  /** the stroke is drawn by the canvas layer: keep only the (invisible) hit path, show the stroke on hover */
  onCanvas: boolean
  color?: string
  dashed?: boolean
  className?: string
}

const EdgeView = memo(function EdgeView({ id, g, selected, onCanvas, color, dashed, className }: EdgeProps) {
  return (
    <g
      className={`canvas-edge${selected ? ' is-selected' : ''}${onCanvas ? ' is-on-canvas' : ''}${color ? ' has-color' : ''}${dashed ? ' is-dashed' : ''}${className ? ' ' + className : ''}`}
      data-edge-id={id}
      style={color ? ({ '--canvas-color': color } as React.CSSProperties) : undefined}
    >
      <path className="canvas-edge-hit" d={g.path} />
      <path className="canvas-edge-line" d={g.path} />
      {g.fromArrow && <polygon className="canvas-edge-arrow" points={g.fromArrow} />}
      {g.toArrow && <polygon className="canvas-edge-arrow" points={g.toArrow} />}
    </g>
  )
})

export const EdgesLayer = memo(function EdgesLayer({
  entries,
  selection,
  appearance,
  onCanvas
}: {
  entries: EdgeEntry[]
  selection: Set<string>
  appearance?: AppearanceFn
  /** edges whose strokes the canvas layer draws */
  onCanvas?: ReadonlySet<string> | null
}) {
  return (
    <svg className="canvas-edges">
      {entries.map(({ edge: e, g }) => {
        const ap = appearance?.(e)
        return (
          <EdgeView
            key={e.id}
            id={e.id}
            g={g}
            selected={selection.has(e.id)}
            onCanvas={!!onCanvas?.has(e.id)}
            color={colorCss(e.color) ?? ap?.color}
            dashed={ap?.dashed}
            className={ap?.className}
          />
        )
      })}
    </svg>
  )
})

interface LabelProps {
  id: string
  x: number
  y: number
  text?: string
  selected: boolean
  editing: boolean
  implicit: boolean
  color?: string
  className?: string
  initial: string
  onCommit: (id: string, label: string | null) => void
}

const EdgeLabelView = memo(function EdgeLabelView({ id, x, y, text, selected, editing, implicit, color, className, initial, onCommit }: LabelProps) {
  // a zero-size flex anchor at the curve's middle centers the label without a transform (a transform per label is a
  // paint property node, which Chrome re-layerizes on every camera frame)
  return (
    <div className="canvas-edge-label-anchor" style={{ left: x, top: y }}>
      <div
        className={`canvas-edge-label${selected ? ' is-selected' : ''}${editing ? ' is-editing' : ''}${implicit ? ' is-implicit' : ''}${className ? ' ' + className : ''}`}
        data-edge-id={id}
        style={color ? ({ '--canvas-color': color } as React.CSSProperties) : undefined}
      >
        {editing ? <LabelInput initial={initial} onDone={(v) => onCommit(id, v)} /> : text}
      </div>
    </div>
  )
})

export const EdgeLabels = memo(function EdgeLabels({
  entries,
  selection,
  editingId,
  onCommitLabel,
  appearance
}: {
  entries: EdgeEntry[]
  selection: Set<string>
  editingId: string | null
  onCommitLabel: (id: string, label: string | null) => void
  appearance?: AppearanceFn
}) {
  return (
    <>
      {entries.map(({ edge: e, g }) => {
        const editing = editingId === e.id
        const ap = appearance?.(e)
        const text = e.label || ap?.label
        if (!text && !editing) return null
        return (
          <EdgeLabelView
            key={e.id}
            id={e.id}
            x={g.mid.x}
            y={g.mid.y}
            text={text}
            selected={selection.has(e.id)}
            editing={editing}
            implicit={!e.label && !!ap?.label}
            color={colorCss(e.color) ?? ap?.color}
            className={ap?.className}
            initial={e.label ?? ''}
            onCommit={onCommitLabel}
          />
        )
      })}
    </>
  )
})

function LabelInput({ initial, onDone }: { initial: string; onDone: (v: string | null) => void }) {
  const [v, setV] = useState(initial)
  const [done, setDone] = useState(false)
  useEffect(() => setV(initial), [initial])
  const finish = (val: string | null): void => {
    if (done) return
    setDone(true)
    onDone(val)
  }
  return (
    <input
      autoFocus
      data-interactive
      value={v}
      size={Math.max(6, v.length + 1)}
      placeholder="Label"
      onChange={(e) => setV(e.target.value)}
      onFocus={(e) => e.currentTarget.select()}
      onBlur={() => finish(v)}
      onKeyDown={(e) => {
        e.stopPropagation()
        if (e.key === 'Enter') finish(v)
        else if (e.key === 'Escape') finish(null)
      }}
    />
  )
}
