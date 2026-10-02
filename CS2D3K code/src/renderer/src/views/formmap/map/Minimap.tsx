// Minimap: zones + cards at a glance, the current viewport, click/drag to navigate.
// Cards are drawn on a <canvas> (redrawn only when the cards, the dimming or the mapping change); the viewport rectangle
// follows the camera every frame through the engine's viewport subscription, without re-rendering React.
import { memo, useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, Map as MapIcon } from 'lucide-react'
import { boundsOf, colorCss, type CanvasNode, type Rect, type Viewport } from '../../canvas/model'
import type { EngineApi } from '../../canvas/engine'
import { onThemeChange, resolveColor } from '@/theme/theme'
import { KINDS, isForm, isZone, type FormNode } from '../schema'

const W = 176
const H = 112

interface Props {
  nodes: CanvasNode[]
  /** viewport as of the last React render (sets the mapping; the rectangle itself follows `api` per frame) */
  vp: Viewport
  size: { w: number; h: number }
  api: EngineApi
  /** ids of dimmed nodes (null = none) */
  dimmed: ReadonlySet<string> | null
  onNavigate(world: { x: number; y: number }, animate: boolean): void
}

interface Mapping {
  world: Rect
  s: number
  ox: number
  oy: number
}

/** resolved CSS colors for the canvas (cleared on theme change) */
const colorCache = new Map<string, string>()
const colorOf = (expr: string): string => {
  let v = colorCache.get(expr)
  if (!v) colorCache.set(expr, (v = resolveColor(expr)))
  return v
}
/** redraws while cards keep changing (dragging) are coalesced to at most one per this many ms */
const REDRAW_MS = 100

const viewOf = (vp: Viewport, size: { w: number; h: number }): Rect => ({ x: -vp.x / vp.zoom, y: -vp.y / vp.zoom, width: size.w / vp.zoom, height: size.h / vp.zoom })

export default memo(function Minimap({ nodes, vp, size, api, dimmed, onNavigate }: Props) {
  const [open, setOpen] = useState(() => localStorage.getItem('cs2d3k.formmap.minimap') !== '0')
  const stageRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const viewRef = useRef<SVGRectElement>(null)
  const [redrawTick, setRedrawTick] = useState(0)
  useEffect(() => {
    const refresh = (): void => {
      colorCache.clear()
      setRedrawTick((t) => t + 1)
    }
    const mo = new MutationObserver(refresh)
    mo.observe(document.body, { attributes: true, attributeFilter: ['class'] })
    const off = onThemeChange(refresh)
    return () => {
      mo.disconnect()
      off()
    }
  }, [])

  const content = useMemo(() => boundsOf(nodes.filter((n) => n.type !== 'drawing')), [nodes])
  const zoneNodes = useMemo(() => nodes.filter(isZone), [nodes])
  const view = viewOf(vp, size)
  const b = boundsOf(content ? [content, view] : [view])!
  const pad = Math.max(b.width, b.height) * 0.04
  const world = { x: b.x - pad, y: b.y - pad, width: b.width + pad * 2, height: b.height + pad * 2 }
  // empty map before the view is measured: world is 0×0 → avoid Infinity / NaN coordinates
  const fit = Math.min(W / world.width, H / world.height)
  const s = Number.isFinite(fit) && fit > 0 ? fit : 1
  const m: Mapping = { world, s, ox: (W - world.width * s) / 2, oy: (H - world.height * s) / 2 }
  const mapRef = useRef(m)
  mapRef.current = m
  const tx = (x: number): number => m.ox + (x - world.x) * s
  const ty = (y: number): number => m.oy + (y - world.y) * s
  // a stable key for the mapping: redraw the cards only when it really changes
  const mapKey = `${world.x.toFixed(1)},${world.y.toFixed(1)},${s.toFixed(6)}`

  // cards on the canvas
  const drawState = useRef({ last: 0, timer: 0 })
  useEffect(() => {
    const c = canvasRef.current
    if (!open || !c) return
    const st = drawState.current
    const wait = st.last + REDRAW_MS - performance.now()
    if (wait > 0) {
      // throttled: the latest props draw when the window ends
      clearTimeout(st.timer)
      st.timer = window.setTimeout(() => setRedrawTick((t) => t + 1), wait)
      return
    }
    st.last = performance.now()
    const dpr = window.devicePixelRatio || 1
    if (c.width !== W * dpr) {
      c.width = W * dpr
      c.height = H * dpr
    }
    const ctx = c.getContext('2d')!
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, W, H)
    const { s: sc, ox, oy, world: wr } = mapRef.current
    const faint = colorOf('var(--text-faint)')
    for (const n of nodes) {
      if (isZone(n) || n.type === 'drawing') continue
      ctx.globalAlpha = dimmed?.has(n.id) ? 0.2 : 0.9
      ctx.fillStyle = isForm(n) ? colorOf(KINDS[(n as FormNode).kind]?.color ?? 'var(--text-faint)') : faint
      ctx.fillRect(ox + (n.x - wr.x) * sc, oy + (n.y - wr.y) * sc, Math.max(1.5, n.width * sc), Math.max(1.5, n.height * sc))
    }
    ctx.globalAlpha = 1
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, nodes, dimmed, mapKey, redrawTick])
  useEffect(() => () => clearTimeout(drawState.current.timer), [])

  // the viewport rectangle follows the camera every frame
  useEffect(() => {
    if (!open) return
    const place = (v: Viewport): void => {
      const r = viewRef.current
      if (!r) return
      const { s: sc, ox, oy, world: wr } = mapRef.current
      const sz = api.viewSize()
      const vw = viewOf(v, sz)
      r.setAttribute('x', String(ox + (vw.x - wr.x) * sc))
      r.setAttribute('y', String(oy + (vw.y - wr.y) * sc))
      r.setAttribute('width', String(Math.max(0, vw.width * sc)))
      r.setAttribute('height', String(Math.max(0, vw.height * sc)))
    }
    place(api.getViewport())
    return api.onViewportChange(place)
    // the subscription must not churn on every render; mapRef carries the current mapping
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, api.onViewportChange, mapKey])

  const toWorld = (e: { clientX: number; clientY: number }): { x: number; y: number } => {
    const r = stageRef.current!.getBoundingClientRect()
    const { s: sc, ox, oy, world: wr } = mapRef.current
    // the minimap is CSS-scaled in narrow views: map client px back to stage px first
    const px = ((e.clientX - r.left) * W) / (r.width || W)
    const py = ((e.clientY - r.top) * H) / (r.height || H)
    return { x: wr.x + (px - ox) / sc, y: wr.y + (py - oy) / sc }
  }
  const toggle = (v: boolean): void => {
    setOpen(v)
    localStorage.setItem('cs2d3k.formmap.minimap', v ? '1' : '0')
  }

  if (!open) {
    return (
      <button className="fm-minimap-toggle" data-canvas-ui title="Show minimap" onClick={() => toggle(true)}>
        <MapIcon size={15} />
      </button>
    )
  }

  return (
    <div className="fm-minimap" data-canvas-ui>
      <button className="fm-minimap-close" title="Hide minimap" onClick={() => toggle(false)}>
        <ChevronDown size={13} />
      </button>
      <div
        ref={stageRef}
        className="fm-minimap-stage"
        style={{ width: W, height: H }}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId)
          onNavigate(toWorld(e), true)
        }}
        onPointerMove={(e) => {
          if (e.buttons & 1) onNavigate(toWorld(e), false)
        }}
      >
        <svg width={W} height={H}>
          {zoneNodes.map((z) => (
            <rect
              key={z.id}
              className="fm-minimap-zone"
              x={tx(z.x)}
              y={ty(z.y)}
              width={z.width * s}
              height={z.height * s}
              rx={2}
              style={{ '--mm': colorCss(z.color) ?? 'var(--text-faint)' } as React.CSSProperties}
            />
          ))}
        </svg>
        <canvas ref={canvasRef} className="fm-minimap-cards" style={{ width: W, height: H }} />
        <svg width={W} height={H}>
          <rect ref={viewRef} className="fm-minimap-view" rx={2} />
        </svg>
      </div>
    </div>
  )
})
