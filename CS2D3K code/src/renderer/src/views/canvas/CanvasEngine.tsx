// Canvas engine: an infinite, zoomable board of cards (JSON Canvas) with executable code cells.
// Used directly by CanvasView (.canvas) and, with a CanvasExtension, by richer views (form-map).
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { Maximize, SquareCode, Pencil, Palette, ExternalLink, Play, Group as GroupIcon, BringToFront, SendToBack, Scan, Copy, Scissors, Trash2, ClipboardPaste, BoxSelect, StickyNote, FileText, SquareCode as CodeIcon, Globe, ArrowRight, ArrowLeftRight, Minus, Repeat, Type, FolderOpen } from 'lucide-react'
import type { TabState } from '@/store/workspace'
import { ViewHeaderActions, StatusBarItem } from '@/components/Slots'
import { useWorkspace } from '@/store/workspace'
import { useUi, showContextMenu, promptText, type MenuItem } from '@/store/ui'
import { registerCommands } from '@/store/commands'
import { FILE_MIME } from '@/components/Layout'
import { clamp, debounce, hexId } from '@/lib/util'
import { extname } from '@/lib/path'
import { IMAGE_EXTS } from '@/lib/filetypes'
import type { CanvasDoc } from './useCanvasDoc'
import type { CanvasExtension, EngineApi, EngineRenderCtx, NodeTypeDef } from './engine'
import { NodeView, defaultLodStyle, openVaultFile, type NodeApi } from './nodes'
import { EdgesLayer, EdgeLabels, useEdgeGeometries, type EdgeEntry } from './edges'
import { CULL_MARGIN, DOM_BUDGET, LOD_ZOOM, MAX_PINNED_SELECTION, SpatialIndex, containsRect, expandRect, viewRect } from './cull'
import { LodLayer, type LodScene } from './lodLayer'
import { onThemeChange } from '@/theme/theme'
import { ZoomControls, CreateToolbar, SelectionToolbar, FilePicker, colorMenu, type CreateKind } from './controls'
import { focusEditorIn } from './CmEditor'
import {
  GRID,
  MIN_ZOOM,
  MAX_ZOOM,
  MIN_W,
  MIN_H,
  DEFAULT_SIZE,
  snap,
  boundsOf,
  colorCss,
  contains,
  intersects,
  normRect,
  sidePoint,
  nearestSide,
  edgeGeometry,
  oppositeSide,
  nodesInsideGroups,
  cloneWithNewIds,
  looksLikeUrl,
  parseCanvas,
  type CanvasData,
  type CanvasEdge,
  type CanvasNode,
  type Point,
  type Rect,
  type Side,
  type Viewport
} from './model'
import './canvas.css'

// ------------------------------------------------------------------ module-level: commands + clipboard

interface CanvasInstance {
  zoomToFit(): void
  zoomToSelection(): void
  create(kind: CreateKind): void
}

let activeInstance: CanvasInstance | null = null
let internalClipboard: { nodes: CanvasNode[]; edges: CanvasEdge[] } | null = null

registerCommands([
  { id: 'canvas:zoom-to-fit', name: 'Canvas: Zoom to fit', check: () => !!activeInstance, run: () => activeInstance?.zoomToFit() },
  { id: 'canvas:zoom-to-selection', name: 'Canvas: Zoom to selection', check: () => !!activeInstance, run: () => activeInstance?.zoomToSelection() },
  { id: 'canvas:add-card', name: 'Canvas: Add card', check: () => !!activeInstance, run: () => activeInstance?.create('text') },
  { id: 'canvas:add-note', name: 'Canvas: Add note from vault', check: () => !!activeInstance, run: () => activeInstance?.create('note') },
  { id: 'canvas:add-code', name: 'Canvas: Add code cell', check: () => !!activeInstance, run: () => activeInstance?.create('code') },
  { id: 'canvas:add-link', name: 'Canvas: Add web page', check: () => !!activeInstance, run: () => activeInstance?.create('link') },
  { id: 'canvas:add-group', name: 'Canvas: Add group', check: () => !!activeInstance, run: () => activeInstance?.create('group') }
])

type Drag =
  | { kind: 'pan'; sx: number; sy: number; vx: number; vy: number; moved: boolean }
  | { kind: 'marquee'; sx: number; sy: number; start: Point; base: Set<string>; additive: boolean; moved: boolean }
  | { kind: 'move'; sx: number; sy: number; start: Point; origins: Map<string, Point>; primary: string; moved: boolean; selectOnly: string | null; alt: boolean }
  | { kind: 'resize'; sx: number; sy: number; start: Point; id: string; dir: string; rect: Rect; moved: boolean }
  | { kind: 'edge'; sx: number; sy: number; from: string; side: Side; moved: boolean }

interface TempEdge {
  from: string
  side: Side
  to: Point
  toNode?: string
  toSide?: Side
  /** waiting for the user to pick a node type to create at `to` */
  pending?: boolean
}

const EDITABLE = 'input, textarea, select, [contenteditable], .cm-editor'
const INTERACTIVE = '[data-interactive], input, textarea, select, button, .cm-editor, audio, video'

function validViewport(v: unknown): v is Viewport {
  if (!v || typeof v !== 'object') return false
  const o = v as Viewport
  return Number.isFinite(o.x) && Number.isFinite(o.y) && Number.isFinite(o.zoom) && o.zoom > 0
}

const easeOut = (t: number): number => 1 - Math.pow(1 - t, 3)
const mod = (a: number, b: number): number => ((a % b) + b) % b

/** the dot grid layer overhangs the view by this much so it can be shifted (compositor-only) by up to one grid step */
const GRID_PAD = 160
/** camera idle time after which a gesture counts as finished (crisp re-raster, re-cull, React viewport state) */
const SETTLE_MS = 150
/** React viewport state (zoom %, status bar, overlays) refreshes at most this often while the camera moves */
const VP_STATE_MS = 120
/** cards in view mounted synchronously in the render that culls (the rest mount a chunk per frame) */
const INSTANT_MOUNT = 24
const NO_EDGES: EdgeEntry[] = []

interface CullState {
  /** mounted world area (view + margin); null until the view is measured */
  rect: Rect | null
  /** the view when culled (upgrade priority) */
  view: Rect | null
  /** placeholders only (zoomed out) */
  lod: boolean
}

function textCardSize(text: string): { width: number; height: number } {
  const lines = text.split('\n').reduce((n, l) => n + Math.max(1, Math.ceil(l.length / 34)), 0)
  return { width: 260, height: snap(Math.min(400, 36 + lines * 25)) || 60 }
}

function fileNodeSize(path: string): { width: number; height: number } {
  const ext = extname(path)
  if (ext === 'md') return { width: 400, height: 400 }
  if (IMAGE_EXTS.has(ext)) return { width: 400, height: 300 }
  if (ext === 'canvas') return { width: 260, height: 160 }
  return { width: 460, height: 400 }
}

/** Top-left for a node of `size` so that its `side` midpoint (or center) sits at `at`. */
function placeAt(size: { width: number; height: number }, at: Point, side?: Side): Point {
  let x = at.x - size.width / 2
  let y = at.y - size.height / 2
  if (side === 'left') x = at.x
  if (side === 'right') x = at.x - size.width
  if (side === 'top') y = at.y
  if (side === 'bottom') y = at.y - size.height
  return { x: snap(x), y: snap(y) }
}

/** Near `center`, find a spot where a node of `size` doesn't overlap existing cards. */
function freeSpot(size: { width: number; height: number }, center: Point, nodes: CanvasNode[]): Point {
  const cards = nodes.filter((n) => n.type !== 'group')
  const base = placeAt(size, center)
  const sx = snap(size.width + 40)
  const sy = snap(size.height + 40)
  for (let ring = 0; ring <= 4; ring++) {
    for (let i = -ring; i <= ring; i++) {
      for (let j = -ring; j <= ring; j++) {
        if (Math.max(Math.abs(i), Math.abs(j)) !== ring) continue
        const r = { x: base.x + i * sx, y: base.y + j * sy, width: size.width, height: size.height }
        const pad = { x: r.x - 20, y: r.y - 20, width: r.width + 40, height: r.height + 40 }
        if (!cards.some((n) => intersects(pad, n))) return { x: r.x, y: r.y }
      }
    }
  }
  return base
}

// ------------------------------------------------------------------ component

export interface CanvasEngineProps {
  tab: TabState
  visible: boolean
  focused: boolean
  doc: CanvasDoc
  /** vault path of the document (latest, follows renames) */
  path: string
  ext?: CanvasExtension
  /** receives the imperative engine api */
  engineRef?: React.MutableRefObject<EngineApi | null>
}

export default function CanvasEngine({ tab, visible, focused, doc, path, ext, engineRef }: CanvasEngineProps) {
  const { data, update, flush: flushDoc } = doc
  const extRef = useRef(ext)
  extRef.current = ext
  const defOf = (n: CanvasNode): NodeTypeDef | undefined => extRef.current?.nodeTypes?.[n.type]
  const isContainer = useCallback((n: CanvasNode): boolean => n.type === 'group' || !!extRef.current?.nodeTypes?.[n.type]?.container, [])
  const layerOf = useCallback((n: CanvasNode): 'back' | 'normal' | 'front' => (n.type === 'group' ? 'back' : (extRef.current?.nodeTypes?.[n.type]?.layer ?? 'normal')), [])
  const canMove = (n: CanvasNode): boolean => defOf(n)?.canMove?.(n) ?? true
  const dataRef = useRef(data)
  dataRef.current = data

  const rootRef = useRef<HTMLDivElement>(null)
  const visibleRef = useRef(visible)
  visibleRef.current = visible

  // ---------------------------------------------------------------- viewport
  // The camera lives in vpRef and is applied imperatively (world transform, grid offset, selection toolbar) on every
  // change — panning and zooming never re-render React per frame. React state (`vp`) follows, throttled, for the zoom
  // label, status bar and overlays; the culled node set follows only when the camera leaves the mounted area or settles.
  const vpKey = ext?.viewportKey ?? 'viewport'
  const savedVp = tab.state?.[vpKey]
  const [vp, setVpState] = useState<Viewport>(() => (validViewport(savedVp) ? savedVp : { x: 0, y: 0, zoom: 1 }))
  const vpRef = useRef(vp)
  const needsFit = useRef(!validViewport(savedVp))
  const sizeRef = useRef({ w: 0, h: 0 })
  const animRef = useRef<number | null>(null)
  const tabId = tab.id

  const persistVp = useMemo(() => debounce((v: Viewport) => useWorkspace.getState().updateTabState(tabId, { [vpKey]: v }), 400), [tabId, vpKey])
  useEffect(() => () => persistVp.flush(), [persistVp])

  const worldRef = useRef<HTMLDivElement>(null)
  const gridRef = useRef<HTMLDivElement>(null)
  const gridStep = useRef(0)
  const toolbarRef = useRef<HTMLDivElement>(null)
  /** selection toolbar anchor: world bounds of the selection + px to lift it above labels (at the rendered label scale) */
  const toolbarAnchor = useRef<{ b: Rect; lift: number } | null>(null)
  const vpListeners = useRef(new Set<(v: Viewport) => void>())
  const onViewportChange = useCallback((cb: (v: Viewport) => void) => {
    vpListeners.current.add(cb)
    return () => void vpListeners.current.delete(cb)
  }, [])
  /** cached client rect of the root (no forced layout per wheel / pointer event); refreshed on resize and gesture start */
  const rootRectRef = useRef<DOMRect | null>(null)
  const rootRect = useCallback((): DOMRect => (rootRectRef.current ??= rootRef.current!.getBoundingClientRect()), [])

  // canvas layer (see lodLayer.ts): a world-space texture moved by the compositor with the world. It re-renders when its
  // scene changes (layout effect below), when the view uncovers scene content outside the rendered region, and once a
  // zoom has settled (crisp again) — never just because the camera moved.
  const lodLayer = useRef<LodLayer | null>(null)
  const lodSceneRef = useRef<(LodScene & { bounds: Rect | null }) | null>(null)
  const lodRenderedScene = useRef<LodScene | null>(null)
  const lodHitRef = useRef<{ index: SpatialIndex; dom: Set<string>; active: boolean; orderOf: Map<string, number> } | null>(null)
  const movingRef = useRef(false)
  /** scene content in view that the rendered region doesn't cover */
  const lodUncovered = (): boolean => {
    const r = lodLayer.current?.rendered
    const b = lodSceneRef.current?.bounds
    const { w, h } = sizeRef.current
    if (!r || !b || !w) return false
    const view = viewRect(vpRef.current, w, h)
    const x1 = Math.max(view.x, b.x)
    const y1 = Math.max(view.y, b.y)
    const x2 = Math.min(view.x + view.width, b.x + b.width)
    const y2 = Math.min(view.y + view.height, b.y + b.height)
    return x2 > x1 && y2 > y1 && !containsRect(r.region, { x: x1, y: y1, width: x2 - x1, height: y2 - y1 })
  }
  const renderLod = useCallback((force: boolean) => {
    const layer = lodLayer.current
    const scene = lodSceneRef.current
    const { w, h } = sizeRef.current
    if (!layer || !scene || !w || !h) return
    if (!scene.bounds) {
      layer.hide()
      lodRenderedScene.current = scene
      return
    }
    const v = vpRef.current
    const r = layer.rendered
    const zoomOff = !r || Math.abs(Math.log(v.zoom / r.zoom)) > Math.log(1.15)
    if (!force && r && !(zoomOff && !movingRef.current) && !lodUncovered()) return
    const view = viewRect(v, w, h)
    const area = expandRect(view, 0.5)
    const b = scene.bounds
    const x1 = Math.max(area.x, b.x)
    const y1 = Math.max(area.y, b.y)
    const x2 = Math.min(area.x + area.width, b.x + b.width)
    const y2 = Math.min(area.y + area.height, b.y + b.height)
    if (x2 <= x1 || y2 <= y1) layer.hide()
    else layer.render(scene, { x: x1, y: y1, width: x2 - x1, height: y2 - y1 }, v.zoom)
    lodRenderedScene.current = scene
  }, [])
  const lodRaf = useRef(0)
  const scheduleLodRender = useCallback(() => {
    if (lodRaf.current) return
    lodRaf.current = requestAnimationFrame(() => {
      lodRaf.current = 0
      renderLod(true)
    })
  }, [renderLod])
  useEffect(() => () => cancelAnimationFrame(lodRaf.current), [])

  const applyCamera = useCallback(() => {
    const v = vpRef.current
    const w = worldRef.current
    if (w) w.style.transform = `translate(${v.x}px, ${v.y}px) scale(${v.zoom})`
    const g = gridRef.current
    if (g) {
      let step = GRID * v.zoom
      while (step < 14) step *= 2
      if (step !== gridStep.current) {
        gridStep.current = step
        const dotR = clamp(v.zoom * 1.1, 0.8, 1.6)
        g.style.backgroundImage = `radial-gradient(circle, var(--canvas-dot) ${dotR}px, transparent ${dotR + 0.4}px)`
        g.style.backgroundSize = `${step}px ${step}px`
      }
      // dots sit on world multiples of the step; the layer only moves by less than one step (compositor transform)
      g.style.transform = `translate(${mod(v.x - step / 2 + GRID_PAD, step)}px, ${mod(v.y - step / 2 + GRID_PAD, step)}px)`
    }
    const tb = toolbarRef.current
    const a = toolbarAnchor.current
    if (tb && a) {
      tb.style.left = `${(a.b.x + a.b.width / 2) * v.zoom + v.x}px`
      tb.style.top = `${Math.max(48, a.b.y * v.zoom + v.y - a.lift * v.zoom - 12)}px`
    }
    for (const cb of vpListeners.current) cb(v)
    if (lodUncovered()) scheduleLodRender()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scheduleLodRender])

  // ---------------------------------------------------------------- culling state
  const [cull, setCull] = useState<CullState>({ rect: null, view: null, lod: vp.zoom < LOD_ZOOM })
  /** recull when the view leaves this rect (the view at the last cull + half the margin) */
  const cullTrigger = useRef<Rect | null>(null)
  const recullRaf = useRef(0)
  const recull = useCallback(() => {
    const { w, h } = sizeRef.current
    if (!w || !h) return
    const v = vpRef.current
    const view = viewRect(v, w, h)
    cullTrigger.current = expandRect(view, CULL_MARGIN / 2)
    setCull({ rect: expandRect(view, CULL_MARGIN), view, lod: v.zoom < LOD_ZOOM })
  }, [])
  const scheduleRecull = useCallback(() => {
    if (recullRaf.current) return
    recullRaf.current = requestAnimationFrame(() => {
      recullRaf.current = 0
      recull()
    })
  }, [recull])
  useEffect(() => () => cancelAnimationFrame(recullRaf.current), [])

  // ---------------------------------------------------------------- camera motion
  const movingTimer = useRef<number | null>(null)
  const vpStateTimer = useRef<number | null>(null)
  /** the current gesture changed the zoom (no re-culling until it settles) */
  const zoomedInGesture = useRef(false)
  /** finest zoom the moving world layer may have been rastered at; pending re-promotion (rAF id) */
  const rasterZoom = useRef(1)
  const repromote = useRef(0)
  // zoom-dependent CSS (handle, label and edge sizes) restyles every node, so apply it once a gesture settles
  const [uiZoom, setUiZoom] = useState(vp.zoom)
  useEffect(
    () => () => {
      if (movingTimer.current !== null) clearTimeout(movingTimer.current)
      if (vpStateTimer.current !== null) clearTimeout(vpStateTimer.current)
    },
    []
  )

  const settle = useCallback(() => {
    movingTimer.current = null
    movingRef.current = false
    // drop the compositor layer once the camera rests: text re-rasters crisply (and with subpixel AA) at the final zoom
    zoomedInGesture.current = false
    cancelAnimationFrame(repromote.current)
    repromote.current = 0
    worldRef.current?.classList.remove('is-moving')
    if (vpStateTimer.current !== null) clearTimeout(vpStateTimer.current)
    vpStateTimer.current = null
    const v = vpRef.current
    setVpState(v)
    setUiZoom(v.zoom)
    recull()
  }, [recull])

  const setVp = useCallback(
    (v: Viewport) => {
      const prev = vpRef.current
      vpRef.current = v
      applyCamera()
      persistVp(v)
      if (v.zoom !== prev.zoom) zoomedInGesture.current = true
      // while the camera moves, the world is its own compositor layer: panning / zooming doesn't repaint the cards
      movingRef.current = true
      const wEl = worldRef.current
      if (wEl && !repromote.current) {
        if (!wEl.classList.contains('is-moving')) {
          wEl.classList.add('is-moving')
          rasterZoom.current = v.zoom
        } else if (v.zoom > rasterZoom.current) {
          // zooming in, Chrome may re-raster the layer at the larger scale: remember the finest scale it may have used
          rasterZoom.current = v.zoom
        } else if (v.zoom < rasterZoom.current * 0.6) {
          // a will-change layer keeps its raster scale: zoomed far out, Chrome would rasterize ever more tiles at the old,
          // too-fine scale (hundreds of ms per frame). Drop the layer for a frame and re-promote it at this zoom.
          wEl.classList.remove('is-moving')
          repromote.current = requestAnimationFrame(() => {
            repromote.current = 0
            if (!movingRef.current) return
            wEl.classList.add('is-moving')
            rasterZoom.current = vpRef.current.zoom
          })
        }
      }
      if (movingTimer.current !== null) clearTimeout(movingTimer.current)
      movingTimer.current = window.setTimeout(settle, SETTLE_MS)
      if (vpStateTimer.current === null)
        vpStateTimer.current = window.setTimeout(() => {
          vpStateTimer.current = null
          setVpState(vpRef.current)
        }, VP_STATE_MS)
      // mount more only when a pan leaves the mounted area. Zoom gestures never re-cull mid-gesture (that would mount and
      // unmount cards every few frames): the canvas layer draws whatever isn't mounted, and the settle re-culls.
      const { w, h } = sizeRef.current
      const t = cullTrigger.current
      if (w && h && !zoomedInGesture.current && (!t || !containsRect(t, viewRect(v, w, h)))) scheduleRecull()
    },
    [applyCamera, persistVp, settle, scheduleRecull]
  )

  const cancelAnim = useCallback(() => {
    if (animRef.current !== null) cancelAnimationFrame(animRef.current)
    animRef.current = null
  }, [])

  const animateTo = useCallback(
    (target: Viewport, animate = true) => {
      cancelAnim()
      const { w, h } = sizeRef.current
      const from = vpRef.current
      if (!animate || !visibleRef.current || !w) {
        setVp(target)
        return
      }
      // interpolate the world point at the view center + log zoom: feels natural
      const c0 = { x: (w / 2 - from.x) / from.zoom, y: (h / 2 - from.y) / from.zoom }
      const c1 = { x: (w / 2 - target.x) / target.zoom, y: (h / 2 - target.y) / target.zoom }
      const z0 = Math.log(from.zoom)
      const z1 = Math.log(target.zoom)
      const t0 = performance.now()
      const dur = 260
      const step = (now: number): void => {
        const t = Math.min(1, (now - t0) / dur)
        const k = easeOut(t)
        const zoom = Math.exp(z0 + (z1 - z0) * k)
        const cx = c0.x + (c1.x - c0.x) * k
        const cy = c0.y + (c1.y - c0.y) * k
        setVp(t >= 1 ? target : { x: w / 2 - cx * zoom, y: h / 2 - cy * zoom, zoom })
        animRef.current = t >= 1 ? null : requestAnimationFrame(step)
      }
      animRef.current = requestAnimationFrame(step)
    },
    [cancelAnim, setVp]
  )

  const toWorld = useCallback(
    (clientX: number, clientY: number): Point => {
      const r = rootRect()
      const v = vpRef.current
      return { x: (clientX - r.left - v.x) / v.zoom, y: (clientY - r.top - v.y) / v.zoom }
    },
    [rootRect]
  )

  const viewCenter = useCallback((): Point => {
    const { w, h } = sizeRef.current
    const v = vpRef.current
    return { x: (w / 2 - v.x) / v.zoom, y: (h / 2 - v.y) / v.zoom }
  }, [])

  const zoomAt = useCallback(
    (factor: number, sx: number, sy: number, animate = false) => {
      const v = vpRef.current
      const zoom = clamp(v.zoom * factor, MIN_ZOOM, MAX_ZOOM)
      const wx = (sx - v.x) / v.zoom
      const wy = (sy - v.y) / v.zoom
      const next = { x: sx - wx * zoom, y: sy - wy * zoom, zoom }
      if (animate) animateTo(next)
      else setVp(next)
    },
    [animateTo, setVp]
  )

  const fitRect = useCallback(
    (rect: Rect | null, maxZoom: number, animate = true) => {
      const { w, h } = sizeRef.current
      if (!w || !h) return
      if (!rect) {
        animateTo({ x: w / 2, y: h / 2, zoom: 1 }, animate)
        return
      }
      const pad = Math.min(80, w * 0.08, h * 0.08)
      const zoom = clamp(Math.min((w - pad * 2) / Math.max(rect.width, 1), (h - pad * 2) / Math.max(rect.height, 1)), MIN_ZOOM, maxZoom)
      animateTo({ x: w / 2 - (rect.x + rect.width / 2) * zoom, y: h / 2 - (rect.y + rect.height / 2) * zoom, zoom }, animate)
    },
    [animateTo]
  )

  // ---------------------------------------------------------------- selection / editing
  const [selection, setSelectionState] = useState<Set<string>>(() => new Set())
  const selRef = useRef(selection)
  const setSelection = useCallback((s: Set<string>) => {
    selRef.current = s
    setSelectionState(s)
    extRef.current?.onSelectionChange?.([...s])
  }, [])
  const [editing, setEditingState] = useState<string | null>(null)
  const editingRef = useRef<string | null>(null)
  const setEditing = useCallback((id: string | null) => {
    editingRef.current = id
    setEditingState(id)
  }, [])

  const [interacting, setInteracting] = useState(false)
  const [moving, setMoving] = useState<Set<string> | null>(null)
  const [marquee, setMarquee] = useState<Rect | null>(null)
  const [tempEdge, setTempEdge] = useState<TempEdge | null>(null)
  const [picker, setPicker] = useState<{ at?: Point; connect?: { from: string; side: Side } } | null>(null)
  const dragRef = useRef<Drag | null>(null)
  const spaceRef = useRef(false)
  const [spaceDown, setSpaceDown] = useState(false)
  const pointerRef = useRef<{ world: Point; inside: boolean }>({ world: { x: 0, y: 0 }, inside: false })
  const suppressClick = useRef(false)

  const fitAll = useCallback(() => fitRect(boundsOf(dataRef.current.nodes), extRef.current?.fitMaxZoom ?? 1), [fitRect])
  const fitSelection = useCallback(() => {
    const nodes = dataRef.current.nodes.filter((n) => selRef.current.has(n.id))
    if (nodes.length) fitRect(boundsOf(nodes), 1.5)
    else fitAll()
  }, [fitRect, fitAll])

  // drop selection ids that disappeared (undo, external change)
  useEffect(() => {
    const ids = new Set([...data.nodes.map((n) => n.id), ...data.edges.map((e) => e.id)])
    const sel = selRef.current
    if ([...sel].some((id) => !ids.has(id))) setSelection(new Set([...sel].filter((id) => ids.has(id))))
    if (editingRef.current && !ids.has(editingRef.current)) setEditing(null)
  }, [data, setSelection, setEditing])

  // ---------------------------------------------------------------- size + first fit
  useLayoutEffect(() => {
    const el = rootRef.current!
    const measure = (): void => {
      sizeRef.current = { w: el.clientWidth, h: el.clientHeight }
      rootRectRef.current = null
    }
    const ro = new ResizeObserver(() => {
      measure()
      if (needsFit.current && doc.loaded && el.clientWidth) {
        needsFit.current = false
        fitRect(boundsOf(dataRef.current.nodes), extRef.current?.fitMaxZoom ?? 1, false)
      }
      recull()
    })
    ro.observe(el)
    const onWinResize = (): void => void (rootRectRef.current = null)
    window.addEventListener('resize', onWinResize)
    measure()
    applyCamera()
    recull()
    return () => {
      ro.disconnect()
      window.removeEventListener('resize', onWinResize)
    }
  }, [doc.loaded, fitRect, applyCamera, recull])

  useLayoutEffect(() => {
    if (doc.loaded && needsFit.current && sizeRef.current.w) {
      needsFit.current = false
      fitRect(boundsOf(dataRef.current.nodes), extRef.current?.fitMaxZoom ?? 1, false)
      recull()
    }
  }, [doc.loaded, fitRect, recull])

  // ---------------------------------------------------------------- data helpers
  const focusCanvas = useCallback(() => rootRef.current?.focus({ preventScroll: true }), [])

  /**
   * Node drawn on the canvas layer under a world point (not in the DOM, so the DOM can't report it): topmost by layer
   * and order. Back-layer boxes are hit on their header strip, and on their body only if they can move (a locked
   * zone's body is background, like its DOM counterpart).
   */
  const hitCanvasNode = (w: Point): CanvasNode | null => {
    const h = lodHitRef.current
    if (!h?.active) return null
    const head = 28 * Math.min(clamp(1 / vpRef.current.zoom, 1, 4), 3.4)
    const ids = h.index.query({ x: w.x - 0.5, y: w.y - 0.5, width: 1, height: head + 1 })
    let best: CanvasNode | null = null
    let bestRank = -1
    const rankOf = { back: 0, normal: 1, front: 2 }
    for (const id of ids) {
      if (h.dom.has(id)) continue
      const i = h.orderOf.get(id)
      const n = i === undefined ? undefined : dataRef.current.nodes[i]
      if (!n) continue
      const layer = layerOf(n)
      const inside = w.x >= n.x && w.x <= n.x + n.width && w.y >= n.y && w.y <= n.y + n.height
      if (layer === 'back') {
        const onHead = w.x >= n.x && w.x <= n.x + n.width && w.y >= n.y - head && w.y < n.y
        if (!onHead && !(inside && canMove(n))) continue
      } else if (!inside) continue
      const rank = rankOf[layer] * 1e7 + i!
      if (rank > bestRank) {
        best = n
        bestRank = rank
      }
    }
    return best
  }

  /** node element under a target; parts marked data-canvas-bg (e.g. a locked zone's body) count as background */
  const hitNode = (target: HTMLElement): HTMLElement | null => {
    const el = target.closest<HTMLElement>('[data-node-id]')
    if (!el) return null
    const bg = target.closest('[data-canvas-bg]')
    return bg && el.contains(bg) ? null : el
  }

  // nodes that must stay mounted while culled (running code cells, …)
  const [apiPins, setApiPins] = useState<ReadonlySet<string>>(() => new Set())
  const pin = useCallback((id: string, on: boolean) => {
    setApiPins((s) => {
      if (s.has(id) === on) return s
      const next = new Set(s)
      if (on) next.add(id)
      else next.delete(id)
      return next
    })
  }, [])

  const api = useMemo<NodeApi>(
    () => ({
      canvasPath: path,
      updateNode: (id, patch, history) =>
        update((d) => ({ ...d, nodes: d.nodes.map((n) => (n.id === id ? { ...n, ...patch } : n)) }), { history: history ?? true }),
      setEditing,
      focusCanvas,
      pin
    }),
    [path, update, setEditing, focusCanvas, pin]
  )

  const updateEdge = useCallback(
    (id: string, patch: Partial<CanvasEdge>) => update((d) => ({ ...d, edges: d.edges.map((e) => (e.id === id ? { ...e, ...patch } : e)) })),
    [update]
  )

  const addEdge = useCallback(
    (from: string, fromSide: Side, to: string, toSide: Side) => {
      let edge: CanvasEdge = { id: hexId(), fromNode: from, fromSide, toNode: to, toSide }
      if (extRef.current?.onEdgeCreate) edge = extRef.current.onEdgeCreate(edge, dataRef.current)
      update((d) => ({ ...d, edges: [...d.edges, edge] }))
      setSelection(new Set([edge.id]))
    },
    [update, setSelection]
  )

  const focusNode = useCallback((id: string) => {
    setTimeout(() => focusEditorIn(rootRef.current?.querySelector(`[data-node-id="${id}"]`) ?? null), 60)
  }, [])

  /** Add a node centered at `at` (or attached by its `side` when connecting). */
  const addNode = useCallback(
    (partial: Partial<CanvasNode> & { type: string }, at?: Point, connect?: { from: string; side: Side }): CanvasNode => {
      const size = { ...(DEFAULT_SIZE[partial.type as keyof typeof DEFAULT_SIZE] ?? DEFAULT_SIZE.text), ...(partial.width ? { width: partial.width } : {}), ...(partial.height ? { height: partial.height } : {}) }
      const p = at ?? viewCenter()
      let toSide: Side | undefined
      if (connect) {
        const src = dataRef.current.nodes.find((n) => n.id === connect.from)
        if (src) {
          const sp = sidePoint(src, connect.side)
          const vx = sp.x - p.x
          const vy = sp.y - p.y
          toSide = Math.abs(vx) > Math.abs(vy) ? (vx < 0 ? 'left' : 'right') : vy < 0 ? 'top' : 'bottom'
        }
      }
      const pos = at || connect ? placeAt(size, p, toSide) : freeSpot(size, p, dataRef.current.nodes)
      const node: CanvasNode = { id: hexId(), ...partial, x: pos.x, y: pos.y, width: size.width, height: size.height }
      let edge: CanvasEdge | null = connect && toSide ? { id: hexId(), fromNode: connect.from, fromSide: connect.side, toNode: node.id, toSide } : null
      if (edge && extRef.current?.onEdgeCreate) edge = extRef.current.onEdgeCreate(edge, { ...dataRef.current, nodes: [...dataRef.current.nodes, node] })
      update((d) => ({
        ...d,
        nodes: layerOf(node) === 'back' ? [node, ...d.nodes] : [...d.nodes, node],
        edges: edge ? [...d.edges, edge] : d.edges
      }))
      setSelection(new Set([node.id]))
      return node
    },
    [update, setSelection, viewCenter, layerOf]
  )

  const addGroup = useCallback(
    (at?: Point) => {
      const sel = dataRef.current.nodes.filter((n) => selRef.current.has(n.id))
      const b = !at && sel.length ? boundsOf(sel) : null
      let node: CanvasNode
      if (b) {
        const pad = 40
        const x = snap(b.x - pad)
        const y = snap(b.y - pad)
        node = { id: hexId(), type: 'group', label: '', x, y, width: snap(b.x + b.width + pad) - x, height: snap(b.y + b.height + pad) - y }
        update((d) => ({ ...d, nodes: [node, ...d.nodes] }))
        setSelection(new Set([node.id]))
      } else node = addNode({ type: 'group', label: '' }, at)
      setEditing(node.id)
    },
    [update, addNode, setSelection, setEditing]
  )

  /** Add file nodes side by side, the first centered at `at` (default: a free spot near the view center, like the toolbar's other cards). */
  const addFiles = useCallback(
    (paths: string[], at?: Point, connect?: { from: string; side: Side }) => {
      const first = fileNodeSize(paths[0])
      const spot = at ? null : freeSpot(first, viewCenter(), dataRef.current.nodes)
      const start = at ?? { x: spot!.x + first.width / 2, y: spot!.y + first.height / 2 }
      let x = start.x
      const created: string[] = []
      paths.forEach((p, i) => {
        const size = fileNodeSize(p)
        const n = addNode({ type: 'file', file: p, ...size }, { x: x + (i ? size.width / 2 : 0), y: start.y }, i === 0 ? connect : undefined)
        created.push(n.id)
        x = n.x + n.width + GRID
      })
      setSelection(new Set(created))
    },
    [addNode, setSelection, viewCenter]
  )

  const create = useCallback(
    async (kind: CreateKind, at?: Point, connect?: { from: string; side: Side }) => {
      if (kind === 'text') {
        const n = addNode({ type: 'text', text: '' }, at, connect)
        setEditing(n.id)
      } else if (kind === 'code') {
        const n = addNode({ type: 'code', language: 'python', code: '' }, at, connect)
        focusNode(n.id)
      } else if (kind === 'note') {
        setPicker({ at, connect })
        return
      } else if (kind === 'link') {
        const url = await promptText({
          title: 'Add web page',
          placeholder: 'https://example.com',
          okLabel: 'Add',
          validate: (v) => (looksLikeUrl(v) || /^[\w-]+(\.[\w-]+)+(\/\S*)?$/.test(v.trim()) ? null : 'Enter a valid URL')
        })
        if (url) {
          const u = /^https?:\/\//i.test(url.trim()) ? url.trim() : `https://${url.trim()}`
          addNode({ type: 'link', url: u }, at, connect)
        }
      } else if (kind === 'group') addGroup(at)
      setTempEdge(null)
      focusCanvas()
    },
    [addNode, addGroup, setEditing, focusNode, focusCanvas]
  )

  const selectedNodes = useCallback(() => dataRef.current.nodes.filter((n) => selRef.current.has(n.id)), [])

  const deleteSelection = useCallback(() => {
    const sel = selRef.current
    if (!sel.size) return
    update((d) => ({
      ...d,
      nodes: d.nodes.filter((n) => !sel.has(n.id)),
      edges: d.edges.filter((e) => !sel.has(e.id) && !sel.has(e.fromNode) && !sel.has(e.toNode))
    }))
    setSelection(new Set())
    setEditing(null)
  }, [update, setSelection, setEditing])

  /** Selected nodes plus the contents of selected groups. */
  const selectionWithContents = useCallback((): CanvasNode[] => {
    const d = dataRef.current
    const sel = selRef.current
    const groups = d.nodes.filter((n) => sel.has(n.id) && isContainer(n)).map((n) => n.id)
    const inside = nodesInsideGroups(d.nodes, groups, isContainer)
    return d.nodes.filter((n) => sel.has(n.id) || inside.has(n.id))
  }, [isContainer])

  const insertClones = useCallback(
    (nodes: CanvasNode[], edges: CanvasEdge[], dx: number, dy: number) => {
      const c = cloneWithNewIds(nodes, edges, dx, dy)
      update((d) => ({
        ...d,
        nodes: [...c.nodes.filter((n) => layerOf(n) === 'back'), ...d.nodes, ...c.nodes.filter((n) => layerOf(n) !== 'back')],
        edges: [...d.edges, ...c.edges]
      }))
      setSelection(new Set(c.nodes.map((n) => n.id)))
      return c
    },
    [update, setSelection, layerOf]
  )

  const duplicate = useCallback(() => {
    const nodes = selectionWithContents()
    if (!nodes.length) return
    const ids = new Set(nodes.map((n) => n.id))
    const edges = dataRef.current.edges.filter((e) => ids.has(e.fromNode) && ids.has(e.toNode))
    const b = boundsOf(nodes)!
    insertClones(nodes, edges, snap(b.width + 40), 0)
  }, [selectionWithContents, insertClones])

  const copy = useCallback(
    (cut = false) => {
      const nodes = selectionWithContents()
      if (!nodes.length) return
      const ids = new Set(nodes.map((n) => n.id))
      const edges = dataRef.current.edges.filter((e) => ids.has(e.fromNode) && ids.has(e.toNode))
      internalClipboard = structuredClone({ nodes, edges })
      void navigator.clipboard.writeText(JSON.stringify({ nodes, edges }, null, '\t')).catch(() => {})
      if (cut) deleteSelection()
    },
    [selectionWithContents, deleteSelection]
  )

  const paste = useCallback(
    async (at?: Point) => {
      let text = ''
      try {
        text = await navigator.clipboard.readText()
      } catch {
        /* fall back to the internal clipboard */
      }
      const p = at ?? (pointerRef.current.inside ? pointerRef.current.world : viewCenter())
      let payload: CanvasData | null = null
      if (text.trim().startsWith('{')) {
        try {
          const j = JSON.parse(text)
          if (j && Array.isArray(j.nodes)) payload = parseCanvas(text).data
        } catch {
          /* plain text */
        }
      }
      if (!payload && !text && internalClipboard) payload = { nodes: internalClipboard.nodes, edges: internalClipboard.edges }
      if (payload && payload.nodes.length) {
        const b = boundsOf(payload.nodes)!
        insertClones(payload.nodes, payload.edges, snap(p.x - (b.x + b.width / 2)), snap(p.y - (b.y + b.height / 2)))
        return
      }
      const t = text.trim()
      if (!t) return
      if (looksLikeUrl(t)) addNode({ type: 'link', url: t }, p)
      else addNode({ type: 'text', text, ...textCardSize(text) }, p)
    },
    [insertClones, addNode, viewCenter]
  )

  const reorder = useCallback(
    (front: boolean) => {
      const sel = selRef.current
      update((d) => {
        const picked = d.nodes.filter((n) => sel.has(n.id))
        const rest = d.nodes.filter((n) => !sel.has(n.id))
        return { ...d, nodes: front ? [...rest, ...picked] : [...picked, ...rest] }
      })
    },
    [update]
  )

  const setColor = useCallback(
    (ids: Set<string>, color: string | undefined) => {
      update((d) => ({
        ...d,
        nodes: d.nodes.map((n) => (ids.has(n.id) ? withColor(n, color) : n)),
        edges: d.edges.map((e) => (ids.has(e.id) ? withColor(e, color) : e))
      }))
    },
    [update]
  )

  const customColor = useCallback(
    async (ids: Set<string>) => {
      const v = await promptText({ title: 'Custom color', placeholder: '#7c3aed', okLabel: 'Apply', validate: (s) => (/^#?[0-9a-f]{6}$/i.test(s.trim()) ? null : 'Use a hex color like #7c3aed') })
      if (v) setColor(ids, v.trim().startsWith('#') ? v.trim() : `#${v.trim()}`)
    },
    [setColor]
  )

  const startEditing = useCallback(
    (id: string) => {
      const n = dataRef.current.nodes.find((x) => x.id === id)
      if (!n) return
      setSelection(new Set([id]))
      if (n.type === 'text' || n.type === 'group' || extRef.current?.nodeTypes?.[n.type]?.editable) setEditing(id)
      else if (n.type === 'code') focusNode(id)
      else if (n.type === 'file' && n.file) openVaultFile(n.file, false, n.subpath)
    },
    [setSelection, setEditing, focusNode]
  )

  // ---------------------------------------------------------------- instance (commands)
  const instRef = useRef<CanvasInstance>({ zoomToFit: () => {}, zoomToSelection: () => {}, create: () => {} })
  instRef.current.zoomToFit = fitAll
  instRef.current.zoomToSelection = fitSelection
  instRef.current.create = (k) => void create(k)
  useEffect(() => {
    if (!focused) return
    const inst = instRef.current
    activeInstance = inst
    if (document.activeElement === document.body) focusCanvas()
    return () => {
      if (activeInstance === inst) activeInstance = null
    }
  }, [focused, focusCanvas])

  // pause work while hidden
  useEffect(() => {
    if (visible) return
    cancelAnim()
    flushDoc()
    persistVp.flush()
  }, [visible, cancelAnim, flushDoc, persistVp])

  // ---------------------------------------------------------------- wheel (native, non-passive)
  useEffect(() => {
    const root = rootRef.current!
    const canScrollInside = (target: HTMLElement, dx: number, dy: number): boolean => {
      const nodeEl = target.closest<HTMLElement>('[data-node-id]')
      if (!nodeEl) return false
      const id = nodeEl.dataset.nodeId!
      const active = selRef.current.has(id) || editingRef.current === id || nodeEl.contains(document.activeElement)
      if (!active) return false
      for (let el: HTMLElement | null = target; el && el !== nodeEl; el = el.parentElement) {
        const cs = getComputedStyle(el)
        if (dy && /(auto|scroll)/.test(cs.overflowY) && el.scrollHeight > el.clientHeight + 1) {
          if ((dy < 0 && el.scrollTop > 0) || (dy > 0 && el.scrollTop + el.clientHeight < el.scrollHeight - 1)) return true
        }
        if (dx && /(auto|scroll)/.test(cs.overflowX) && el.scrollWidth > el.clientWidth + 1) {
          if ((dx < 0 && el.scrollLeft > 0) || (dx > 0 && el.scrollLeft + el.clientWidth < el.scrollWidth - 1)) return true
        }
      }
      return false
    }
    let lastWheel = 0
    const onWheel = (e: WheelEvent): void => {
      const target = e.target as HTMLElement
      if (target.closest('[data-canvas-ui]')) {
        e.preventDefault()
        return
      }
      cancelAnim()
      if (e.timeStamp - lastWheel > 250) rootRectRef.current = null
      lastWheel = e.timeStamp
      let dx = e.deltaX
      let dy = e.deltaY
      if (e.deltaMode === 1) {
        dx *= 16
        dy *= 16
      } else if (e.deltaMode === 2) {
        dx *= sizeRef.current.w
        dy *= sizeRef.current.h
      }
      if (e.ctrlKey || e.metaKey) {
        const r = rootRect()
        e.preventDefault()
        const factor = Math.abs(dy) >= 50 ? (dy > 0 ? 1 / 1.2 : 1.2) : Math.exp(-dy * 0.01)
        zoomAt(factor, e.clientX - r.left, e.clientY - r.top)
        return
      }
      if (e.shiftKey && !dx) {
        dx = dy
        dy = 0
      }
      if (canScrollInside(target, dx, dy)) return
      e.preventDefault()
      const v = vpRef.current
      setVp({ ...v, x: v.x - dx, y: v.y - dy })
    }
    root.addEventListener('wheel', onWheel, { passive: false })
    // swallow the click that ends a drag (so links inside cards don't fire)
    const onClickCapture = (e: MouseEvent): void => {
      if (suppressClick.current) {
        suppressClick.current = false
        e.stopPropagation()
        e.preventDefault()
      }
    }
    root.addEventListener('click', onClickCapture, true)
    return () => {
      root.removeEventListener('wheel', onWheel)
      root.removeEventListener('click', onClickCapture, true)
    }
  }, [cancelAnim, zoomAt, setVp, rootRect])

  // pending edge (dropped on empty space) disappears when its menu closes
  const menuOpen = useUi((s) => !!s.menu)
  useEffect(() => {
    if (!menuOpen && !picker) setTempEdge((t) => (t?.pending ? null : t))
  }, [menuOpen, picker])

  // ---------------------------------------------------------------- pointer interactions
  const onPointerMoveDrag = (e: PointerEvent): void => {
    const d = dragRef.current
    if (!d) return
    const dist = Math.hypot(e.clientX - d.sx, e.clientY - d.sy)
    if (d.kind === 'pan') {
      d.moved = true
      const v = vpRef.current
      setVp({ ...v, x: d.vx + (e.clientX - d.sx), y: d.vy + (e.clientY - d.sy) })
      return
    }
    const w = toWorld(e.clientX, e.clientY)
    if (!d.moved) {
      if (dist < 4) return
      d.moved = true
      setInteracting(true)
      if (d.kind === 'move' || d.kind === 'resize') doc.checkpoint()
      if (d.kind === 'move') {
        setMoving(new Set(d.origins.keys()))
        extRef.current?.onMoveStart?.([...d.origins.keys()])
      }
    }
    const free = e.ctrlKey || e.metaKey
    if (d.kind === 'marquee') {
      const r = normRect(d.start, w)
      setMarquee(r)
      const hit = dataRef.current.nodes.filter((n) => (isContainer(n) ? contains(r, n) : intersects(r, n))).map((n) => n.id)
      setSelection(new Set([...(d.additive ? d.base : []), ...hit]))
    } else if (d.kind === 'move') {
      if (d.alt) {
        // alt-drag: drag a copy
        d.alt = false
        const ids = new Set(d.origins.keys())
        const nodes = dataRef.current.nodes.filter((n) => ids.has(n.id))
        const edges = dataRef.current.edges.filter((ed) => ids.has(ed.fromNode) && ids.has(ed.toNode))
        const c = cloneWithNewIds(nodes, edges, 0, 0)
        update((dd) => ({ ...dd, nodes: [...c.nodes.filter((n) => layerOf(n) === 'back'), ...dd.nodes, ...c.nodes.filter((n) => layerOf(n) !== 'back')], edges: [...dd.edges, ...c.edges] }), { history: false })
        const origins = new Map<string, Point>()
        nodes.forEach((n, i) => {
          origins.set(c.nodes[i].id, d.origins.get(n.id)!)
          if (n.id === d.primary) d.primary = c.nodes[i].id
        })
        d.origins = origins
        setMoving(new Set(origins.keys()))
        setSelection(new Set(c.nodes.filter((_, i) => selRef.current.has(nodes[i].id)).map((n) => n.id)))
      }
      const o = d.origins.get(d.primary)!
      let dx = w.x - d.start.x
      let dy = w.y - d.start.y
      if (!free) {
        dx = snap(o.x + dx) - o.x
        dy = snap(o.y + dy) - o.y
      }
      update((dd) => ({ ...dd, nodes: dd.nodes.map((n) => { const org = d.origins.get(n.id); return org ? { ...n, x: org.x + dx, y: org.y + dy } : n }) }), { history: false })
      extRef.current?.onMoveDrag?.([...d.origins.keys()], e)
    } else if (d.kind === 'resize') {
      const r = d.rect
      const dx = w.x - d.start.x
      const dy = w.y - d.start.y
      const sn = (v: number): number => (free ? v : snap(v))
      let { x, y, width, height } = r
      if (d.dir.includes('e')) width = Math.max(MIN_W, sn(r.x + r.width + dx) - r.x)
      if (d.dir.includes('s')) height = Math.max(MIN_H, sn(r.y + r.height + dy) - r.y)
      if (d.dir.includes('w')) {
        const left = Math.min(sn(r.x + dx), r.x + r.width - MIN_W)
        x = left
        width = r.x + r.width - left
      }
      if (d.dir.includes('n')) {
        const top = Math.min(sn(r.y + dy), r.y + r.height - MIN_H)
        y = top
        height = r.y + r.height - top
      }
      update((dd) => ({ ...dd, nodes: dd.nodes.map((n) => (n.id === d.id ? { ...n, x, y, width, height } : n)) }), { history: false })
    } else if (d.kind === 'edge') {
      const el = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null
      const nodeEl = el ? hitNode(el) : null
      const toId = nodeEl?.dataset.nodeId ?? hitCanvasNode(w)?.id
      const cand = toId && toId !== d.from ? dataRef.current.nodes.find((n) => n.id === toId) : undefined
      const toNode = cand && defOf(cand)?.connectable !== false ? cand : undefined
      let toSide: Side | undefined
      if (toNode) {
        const hs = el?.closest<HTMLElement>('[data-handle]')
        toSide = hs && hs.dataset.node === toNode.id ? (hs.dataset.handle as Side) : nearestSide(toNode, w)
      }
      setTempEdge({ from: d.from, side: d.side, to: w, toNode: toNode?.id, toSide })
    }
  }

  const onPointerUpDrag = (e: PointerEvent): void => {
    const d = dragRef.current
    dragRef.current = null
    window.removeEventListener('pointermove', onPointerMoveDrag)
    window.removeEventListener('pointerup', onPointerUpDrag)
    window.removeEventListener('pointercancel', onPointerUpDrag)
    if (!d) return
    setInteracting(false)
    if (d.moved && d.kind !== 'pan') suppressClick.current = true
    setTimeout(() => (suppressClick.current = false), 0)
    if (d.kind === 'pan') return
    if (d.kind === 'marquee') {
      setMarquee(null)
      if (!d.moved && !d.additive) setSelection(new Set())
    } else if (d.kind === 'move') {
      setMoving(null)
      if (!d.moved && d.selectOnly) setSelection(new Set([d.selectOnly]))
      if (d.moved) extRef.current?.onMoveEnd?.([...d.origins.keys()], e)
    } else if (d.kind === 'edge') {
      if (!d.moved) {
        setTempEdge(null)
        return
      }
      const t = tempEdgeRef.current
      if (t?.toNode && t.toSide) {
        setTempEdge(null)
        addEdge(d.from, d.side, t.toNode, t.toSide)
        return
      }
      const at = toWorld(e.clientX, e.clientY)
      setTempEdge({ from: d.from, side: d.side, to: at, pending: true })
      const connect = { from: d.from, side: d.side }
      const custom = extRef.current?.edgeDropItems?.(at, connect)
      const items: MenuItem[] = custom ?? [
        { label: 'Add card', icon: <StickyNote />, onClick: () => void create('text', at, connect) },
        { label: 'Add note from vault', icon: <FileText />, onClick: () => void create('note', at, connect) },
        { label: 'Add code cell', icon: <CodeIcon />, onClick: () => void create('code', at, connect) },
        { label: 'Add web page', icon: <Globe />, onClick: () => void create('link', at, connect) }
      ]
      useUi.getState().showMenu({ x: e.clientX, y: e.clientY }, items)
    }
  }

  const tempEdgeRef = useRef(tempEdge)
  tempEdgeRef.current = tempEdge

  const beginDrag = (d: Drag): void => {
    dragRef.current = d
    window.addEventListener('pointermove', onPointerMoveDrag)
    window.addEventListener('pointerup', onPointerUpDrag)
    window.addEventListener('pointercancel', onPointerUpDrag)
  }

  const onPointerDown = (e: React.PointerEvent): void => {
    const root = rootRef.current!
    const target = e.target as HTMLElement
    if (!root.contains(target) || target.closest('[data-canvas-ui]')) return
    cancelAnim()
    rootRectRef.current = null
    if (extRef.current?.onPointerDown?.(e, toWorld(e.clientX, e.clientY))) return
    const nodeEl = hitNode(target)
    const edgeId = target.closest<HTMLElement>('[data-edge-id]')?.dataset.edgeId
    const nodeId = nodeEl?.dataset.nodeId ?? (edgeId ? undefined : hitCanvasNode(toWorld(e.clientX, e.clientY))?.id)
    const ed = editingRef.current
    if (ed && ed !== nodeId && ed !== edgeId) setEditing(null)

    const base = { sx: e.clientX, sy: e.clientY, moved: false }
    if (e.button === 1 || (e.button === 0 && spaceRef.current)) {
      e.preventDefault()
      const v = vpRef.current
      beginDrag({ kind: 'pan', ...base, vx: v.x, vy: v.y })
      return
    }
    if (e.button !== 0) return
    const w = toWorld(e.clientX, e.clientY)
    const additive = e.shiftKey || e.ctrlKey || e.metaKey

    // connection handle → new edge
    const handle = target.closest<HTMLElement>('[data-handle]')
    if (handle && nodeId) {
      e.preventDefault()
      const side = handle.dataset.handle as Side
      setTempEdge({ from: nodeId, side, to: sidePoint(dataRef.current.nodes.find((n) => n.id === nodeId)!, side) })
      beginDrag({ kind: 'edge', ...base, from: nodeId, side })
      return
    }
    // resize
    const rz = target.closest<HTMLElement>('[data-resize]')
    if (rz && nodeId) {
      e.preventDefault()
      const n = dataRef.current.nodes.find((x) => x.id === nodeId)!
      if (!selRef.current.has(nodeId)) setSelection(new Set([nodeId]))
      if (defOf(n)?.canResize?.(n) === false) return
      beginDrag({ kind: 'resize', ...base, start: w, id: nodeId, dir: rz.dataset.resize!, rect: { x: n.x, y: n.y, width: n.width, height: n.height } })
      return
    }
    if (nodeId) {
      const interactive = nodeEl && target.closest(INTERACTIVE)
      if (interactive && nodeEl.contains(interactive)) {
        if (!selRef.current.has(nodeId)) setSelection(additive ? new Set([...selRef.current, nodeId]) : new Set([nodeId]))
        return
      }
      if (ed === nodeId) return
      let sel = new Set(selRef.current)
      let selectOnly: string | null = null
      if (additive) {
        if (sel.has(nodeId)) {
          sel.delete(nodeId)
          setSelection(sel)
          return
        }
        sel.add(nodeId)
      } else if (!sel.has(nodeId)) sel = new Set([nodeId])
      else selectOnly = nodeId
      setSelection(sel)
      const nodes = dataRef.current.nodes
      const primaryNode = nodes.find((n) => n.id === nodeId)
      if (document.activeElement !== root) focusCanvas()
      if (primaryNode && !canMove(primaryNode)) return
      const groups = nodes.filter((n) => sel.has(n.id) && canMove(n) && isContainer(n)).map((n) => n.id)
      const inside = nodesInsideGroups(nodes, groups, isContainer)
      const origins = new Map<string, Point>()
      for (const n of nodes) if ((sel.has(n.id) && canMove(n)) || inside.has(n.id)) origins.set(n.id, { x: n.x, y: n.y })
      beginDrag({ kind: 'move', ...base, start: w, origins, primary: nodeId, selectOnly, alt: e.altKey })
      return
    }
    if (edgeId) {
      const sel = new Set(additive ? selRef.current : [])
      if (additive && sel.has(edgeId)) sel.delete(edgeId)
      else sel.add(edgeId)
      setSelection(sel)
      focusCanvas()
      return
    }
    // background → marquee
    focusCanvas()
    beginDrag({ kind: 'marquee', ...base, start: w, base: new Set(selRef.current), additive })
  }

  const onDoubleClick = (e: React.MouseEvent): void => {
    const root = rootRef.current!
    const target = e.target as HTMLElement
    if (!root.contains(target) || target.closest('[data-canvas-ui]') || target.closest(INTERACTIVE)) return
    const w = toWorld(e.clientX, e.clientY)
    const nodeEl = hitNode(target)
    const edgeId = target.closest<HTMLElement>('[data-edge-id]')?.dataset.edgeId
    const hitN = nodeEl ? (dataRef.current.nodes.find((x) => x.id === nodeEl.dataset.nodeId) ?? null) : edgeId ? null : hitCanvasNode(w)
    if (!edgeId && extRef.current?.onDoubleClick?.(e, w, hitN)) return
    if (hitN) {
      const n = hitN
      if (!n) return
      if (n.type === 'group' && !target.closest('[data-group-label]')) {
        void create('text', w)
        return
      }
      if (n.type === 'file' && n.file) {
        if (!target.closest('[data-file-label]')) openVaultFile(n.file, e.ctrlKey || e.metaKey, n.subpath)
        return
      }
      startEditing(n.id)
      return
    }
    if (edgeId) {
      setSelection(new Set([edgeId]))
      setEditing(edgeId)
      return
    }
    void create('text', w)
  }

  // ---------------------------------------------------------------- context menus
  const nodeMenu = (e: React.MouseEvent, id: string): void => {
    if (!selRef.current.has(id)) setSelection(new Set([id]))
    const sel = selRef.current
    const nodes = dataRef.current.nodes.filter((n) => sel.has(n.id))
    const n = dataRef.current.nodes.find((x) => x.id === id)!
    const single = nodes.length === 1
    const items: MenuItem[] = []
    if (single && n.type === 'text') items.push({ label: 'Edit', icon: <Pencil />, hint: 'Enter', onClick: () => startEditing(id) })
    if (single && n.type === 'group') items.push({ label: 'Edit label', icon: <Type />, onClick: () => startEditing(id) })
    if (single && n.type === 'file' && n.file) {
      items.push({ label: 'Open file', icon: <FolderOpen />, onClick: () => openVaultFile(n.file!, false, n.subpath) })
      items.push({ label: 'Open in new tab', icon: <ExternalLink />, onClick: () => openVaultFile(n.file!, true, n.subpath) })
    }
    if (single && n.type === 'link' && n.url) items.push({ label: 'Open in browser', icon: <ExternalLink />, onClick: () => void window.api.app.openExternal(n.url!) })
    if (single && n.type === 'code') {
      items.push({
        label: 'Run',
        icon: <Play />,
        hint: 'Ctrl+Enter',
        onClick: () => rootRef.current?.querySelector<HTMLButtonElement>(`[data-node-id="${id}"] .canvas-code-run:not(.is-running)`)?.click()
      })
    }
    if (items.length) items.push({ separator: true })
    const ids = new Set(sel)
    items.push({ label: 'Set color', icon: <Palette />, submenu: colorMenu(single ? n.color : undefined, (c) => setColor(ids, c), () => void customColor(ids)) })
    items.push({ label: 'Create group', icon: <GroupIcon />, onClick: () => addGroup() })
    items.push({ label: 'Bring to front', icon: <BringToFront />, onClick: () => reorder(true) })
    items.push({ label: 'Send to back', icon: <SendToBack />, onClick: () => reorder(false) })
    items.push({ label: 'Zoom to selection', icon: <Scan />, hint: 'Shift+2', onClick: fitSelection })
    items.push({ separator: true })
    items.push({ label: 'Duplicate', icon: <Copy />, hint: 'Ctrl+D', onClick: duplicate })
    items.push({ label: 'Copy', icon: <Copy />, hint: 'Ctrl+C', onClick: () => copy() })
    items.push({ label: 'Cut', icon: <Scissors />, hint: 'Ctrl+X', onClick: () => copy(true) })
    items.push({ separator: true })
    items.push({ label: 'Remove', icon: <Trash2 />, danger: true, hint: 'Del', onClick: deleteSelection })
    showContextMenu(e, extRef.current?.nodeMenu ? extRef.current.nodeMenu(n, items, nodes) : items)
  }

  const edgeMenu = (e: React.MouseEvent, id: string): void => {
    setSelection(new Set([id]))
    const edge = dataRef.current.edges.find((x) => x.id === id)!
    const from = edge.fromEnd === 'arrow'
    const to = (edge.toEnd ?? 'arrow') === 'arrow'
    const items: MenuItem[] = [
      { label: edge.label ? 'Edit label' : 'Add label', icon: <Type />, onClick: () => setEditing(id) },
      { label: 'Set color', icon: <Palette />, submenu: colorMenu(edge.color, (c) => setColor(new Set([id]), c), () => void customColor(new Set([id]))) },
      {
        label: 'Arrows',
        icon: <ArrowRight />,
        submenu: [
          { label: 'No arrows', icon: <Minus />, checked: !from && !to, onClick: () => updateEdge(id, { fromEnd: 'none', toEnd: 'none' }) },
          { label: 'One-way', icon: <ArrowRight />, checked: !from && to, onClick: () => updateEdge(id, { fromEnd: 'none', toEnd: 'arrow' }) },
          { label: 'Two-way', icon: <ArrowLeftRight />, checked: from && to, onClick: () => updateEdge(id, { fromEnd: 'arrow', toEnd: 'arrow' }) }
        ]
      },
      {
        label: 'Reverse direction',
        icon: <Repeat />,
        onClick: () => updateEdge(id, { fromNode: edge.toNode, toNode: edge.fromNode, fromSide: edge.toSide, toSide: edge.fromSide, fromEnd: edge.toEnd, toEnd: edge.fromEnd ?? 'none' })
      },
      { separator: true },
      { label: 'Remove', icon: <Trash2 />, danger: true, hint: 'Del', onClick: deleteSelection }
    ]
    showContextMenu(e, extRef.current?.edgeMenu ? extRef.current.edgeMenu(edge, items) : items)
  }

  const backgroundMenu = (e: React.MouseEvent): void => {
    const at = toWorld(e.clientX, e.clientY)
    const items: MenuItem[] = [
      { label: 'Add card', icon: <StickyNote />, onClick: () => void create('text', at) },
      { label: 'Add note from vault', icon: <FileText />, onClick: () => void create('note', at) },
      { label: 'Add code cell', icon: <CodeIcon />, onClick: () => void create('code', at) },
      { label: 'Add web page', icon: <Globe />, onClick: () => void create('link', at) },
      { label: 'Add group', icon: <GroupIcon />, onClick: () => void create('group', at) },
      { separator: true },
      { label: 'Paste', icon: <ClipboardPaste />, hint: 'Ctrl+V', onClick: () => void paste(at) },
      { label: 'Select all', icon: <BoxSelect />, hint: 'Ctrl+A', onClick: () => setSelection(new Set(dataRef.current.nodes.map((n) => n.id))) },
      { label: 'Zoom to fit', icon: <Maximize />, hint: 'Shift+1', onClick: fitAll }
    ]
    showContextMenu(e, extRef.current?.backgroundMenu ? extRef.current.backgroundMenu(at, items) : items)
  }

  const onContextMenu = (e: React.MouseEvent): void => {
    const root = rootRef.current!
    const target = e.target as HTMLElement
    if (!root.contains(target)) return
    if (target.closest('[data-canvas-ui]')) {
      e.preventDefault()
      return
    }
    if (target.closest('input, textarea')) return
    const edgeId = target.closest<HTMLElement>('[data-edge-id]')?.dataset.edgeId
    const nodeId = hitNode(target)?.dataset.nodeId ?? (edgeId ? undefined : hitCanvasNode(toWorld(e.clientX, e.clientY))?.id)
    if (nodeId) nodeMenu(e, nodeId)
    else if (edgeId) edgeMenu(e, edgeId)
    else backgroundMenu(e)
  }

  // ---------------------------------------------------------------- keyboard
  const nudge = (dx: number, dy: number): void => {
    const nodes = selectionWithContents()
    if (!nodes.length) return
    const ids = new Set(nodes.map((n) => n.id))
    update((d) => ({ ...d, nodes: d.nodes.map((n) => (ids.has(n.id) ? { ...n, x: n.x + dx, y: n.y + dy } : n)) }), { history: 'nudge' })
  }

  const onKeyDown = (e: React.KeyboardEvent): void => {
    const root = rootRef.current!
    const target = e.target as HTMLElement
    if (!root.contains(target)) return
    if (target !== root && target.closest(EDITABLE)) return
    if (extRef.current?.onKeyDown?.(e)) return
    const mod = e.ctrlKey || e.metaKey
    const key = e.key.toLowerCase()
    const handled = (): void => {
      e.preventDefault()
      e.stopPropagation()
    }
    if (e.key === ' ' && !mod) {
      handled()
      if (!spaceRef.current) {
        spaceRef.current = true
        setSpaceDown(true)
      }
      return
    }
    if (mod && key === 'z') {
      handled()
      if (e.shiftKey) doc.redo()
      else doc.undo()
    } else if (mod && key === 'y') {
      handled()
      doc.redo()
    } else if (mod && key === 'a') {
      handled()
      setSelection(new Set(dataRef.current.nodes.map((n) => n.id)))
    } else if (mod && key === 'd') {
      handled()
      duplicate()
    } else if (mod && key === 'c') {
      handled()
      copy()
    } else if (mod && key === 'x') {
      handled()
      copy(true)
    } else if (mod && key === 'v') {
      handled()
      void paste()
    } else if (!mod && (e.key === 'Delete' || e.key === 'Backspace')) {
      handled()
      deleteSelection()
    } else if (e.key === 'Escape') {
      handled()
      setEditing(null)
      setSelection(new Set())
    } else if (e.shiftKey && !mod && e.code === 'Digit1') {
      handled()
      fitAll()
    } else if (e.shiftKey && !mod && e.code === 'Digit2') {
      handled()
      fitSelection()
    } else if (!mod && e.key === 'Enter') {
      const sel = [...selRef.current]
      if (sel.length === 1 && dataRef.current.nodes.some((n) => n.id === sel[0])) {
        handled()
        startEditing(sel[0])
      } else if (sel.length === 1) {
        handled()
        setEditing(sel[0])
      }
    } else if (!mod && e.key.startsWith('Arrow')) {
      if (!selRef.current.size) return
      handled()
      const step = e.shiftKey ? 1 : GRID
      const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0
      const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0
      nudge(dx, dy)
    } else if (mod && (e.key === '=' || e.key === '+')) {
      handled()
      zoomAt(1.25, sizeRef.current.w / 2, sizeRef.current.h / 2, true)
    } else if (mod && e.key === '-') {
      handled()
      zoomAt(0.8, sizeRef.current.w / 2, sizeRef.current.h / 2, true)
    } else if (mod && e.key === '0') {
      handled()
      zoomAt(1 / vpRef.current.zoom, sizeRef.current.w / 2, sizeRef.current.h / 2, true)
    }
  }

  const onKeyUp = (e: React.KeyboardEvent): void => {
    if (e.key === ' ' && spaceRef.current) {
      spaceRef.current = false
      setSpaceDown(false)
    }
  }

  // ---------------------------------------------------------------- file drops
  const onDragOver = (e: React.DragEvent): void => {
    if (!e.dataTransfer.types.includes(FILE_MIME)) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
  }
  const onDrop = (e: React.DragEvent): void => {
    const raw = e.dataTransfer.getData(FILE_MIME)
    if (!raw) return
    e.preventDefault()
    e.stopPropagation()
    const paths = raw.split('\n').map((s) => s.trim()).filter((p) => p && p !== path)
    if (paths.length) addFiles(paths, toWorld(e.clientX, e.clientY))
    focusCanvas()
  }

  // ---------------------------------------------------------------- hover / focus tracking (culling pins, LOD chrome)
  const [hoverId, setHoverId] = useState<string | null>(null)
  const hoverRef = useRef<string | null>(null)
  const onPointerOver = (e: React.PointerEvent): void => {
    // cards get their resize / connection handles only while hovered or selected: a dozen invisible elements per card
    // (the handles are transparent until hovered = a paint effect per handle) cost Chrome work on every camera frame
    const id = (e.target as HTMLElement).closest<HTMLElement>('[data-node-id]')?.dataset.nodeId ?? null
    if (id === hoverRef.current) return
    hoverRef.current = id
    setHoverId(id)
  }
  const [focusNodeId, setFocusNodeId] = useState<string | null>(null)
  const nodeIdOf = (el: EventTarget | null): string | null => (el instanceof HTMLElement ? (el.closest<HTMLElement>('[data-node-id]')?.dataset.nodeId ?? null) : null)

  // ---------------------------------------------------------------- render plan
  // How a node is drawn, decided per cull:
  //  - full (zoom ≥ LOD_ZOOM): covered nodes mount as DOM cards, progressively (nearest the view first); the canvas
  //    layer draws the ones still waiting, so nothing is ever blank.
  //  - DOM placeholders (zoomed out, at most DOM_BUDGET nodes around the view): light DOM cards, fully interactive.
  //  - canvas (zoomed out, more nodes): only pinned nodes are DOM; the canvas layer draws the other cards and the
  //    edges, and pointer hits on them are resolved against the data (spatial index).
  const nodes = data.nodes
  const index = useMemo(() => new SpatialIndex(nodes), [nodes])
  // never culled: the selection (bounded), what is being edited / dragged / typed in, running code cells
  const pinned = useMemo(() => {
    const s = new Set<string>(apiPins)
    if (selection.size <= MAX_PINNED_SELECTION) for (const id of selection) s.add(id)
    if (editing) s.add(editing)
    if (focusNodeId) s.add(focusNodeId)
    if (moving) for (const id of moving) s.add(id)
    return s
  }, [apiPins, selection, editing, focusNodeId, moving])
  // small boards are never culled (nothing to gain, and every card stays reachable in the DOM); LOD still applies
  const covered = useMemo(
    () => (nodes.length <= DOM_BUDGET ? new Set(nodes.map((n) => n.id)) : cull.rect ? index.query(cull.rect) : new Set<string>()),
    [nodes, index, cull.rect]
  )
  const canvasMode = cull.lod && covered.size > DOM_BUDGET

  const mountRef = useRef(new Set<string>())
  const [mountTick, setMountTick] = useState(0)
  const chunkRef = useRef(16)
  const plan = useMemo(() => {
    const mounted = mountRef.current
    const list: CanvasNode[] = []
    let pending = 0
    if (cull.lod) {
      mounted.clear()
      for (const n of nodes) if (pinned.has(n.id) || (!canvasMode && covered.has(n.id))) list.push(n)
    } else {
      for (const id of mounted) if (!covered.has(id)) mounted.delete(id)
      // the first cards in view mount synchronously (small boards never show placeholders); the rest per frame
      let budget = INSTANT_MOUNT
      const view = cull.view
      for (const n of nodes) {
        if (!covered.has(n.id) || mounted.has(n.id)) continue
        if (budget > 0 && (!view || intersects(view, n))) {
          mounted.add(n.id)
          budget--
        } else pending++
      }
      for (const n of nodes) if (mounted.has(n.id) || pinned.has(n.id)) list.push(n)
    }
    return { list, ids: new Set(list.map((n) => n.id)), pending }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes, covered, pinned, canvasMode, cull.lod, cull.view, mountTick])

  useEffect(() => {
    if (!plan.pending || !visible) return
    const mounted = mountRef.current
    const view = cull.view
    const cx = view ? view.x + view.width / 2 : 0
    const cy = view ? view.y + view.height / 2 : 0
    const dist = (n: CanvasNode): number => Math.hypot(n.x + n.width / 2 - cx, n.y + n.height / 2 - cy)
    const queue = nodes.filter((n) => covered.has(n.id) && !mounted.has(n.id)).sort((a, b) => dist(a) - dist(b))
    let cancelled = false
    const raf = requestAnimationFrame(() => {
      if (cancelled) return
      const t0 = performance.now()
      for (const n of queue.splice(0, chunkRef.current)) mounted.add(n.id)
      flushSync(() => setMountTick((t) => t + 1))
      // adapt the chunk to what the machine manages within a frame
      const dt = performance.now() - t0
      chunkRef.current = dt < 4 ? Math.min(256, chunkRef.current * 2) : dt > 10 ? Math.max(4, chunkRef.current >> 1) : chunkRef.current
    })
    return () => {
      cancelled = true
      cancelAnimationFrame(raf)
    }
  }, [plan, visible, cull.view, nodes, covered])

  // pinned nodes being edited / typed in / running render in full even when zoomed out
  const isPlaceholder = (id: string): boolean => cull.lod && id !== editing && id !== focusNodeId && !apiPins.has(id)
  const edgeTargetId = tempEdge?.toNode
  const allEdges = useEdgeGeometries(nodes, data.edges)
  const edgeEntries = useMemo(() => {
    const r = cull.rect
    return r ? allEdges.filter((en) => intersects(en.box, r)) : []
  }, [allEdges, cull.rect])
  const domEdges = useMemo(
    () => (canvasMode ? edgeEntries.filter((en) => plan.ids.has(en.edge.fromNode) || plan.ids.has(en.edge.toNode)) : edgeEntries),
    [canvasMode, edgeEntries, plan]
  )
  // big boards: the canvas layer draws the edge strokes (long SVG edges are re-rasterized on every zoom step and dominate
  // its cost); the SVG keeps their hit paths. Edges of pinned (selected, dragged…) cards and selected edges stay SVG.
  const bigBoard = nodes.length > DOM_BUDGET
  const lodEdges = useStableArray(
    useMemo(() => {
      if (!bigBoard) return NO_EDGES
      if (canvasMode) return allEdges.filter((en) => !plan.ids.has(en.edge.fromNode) && !plan.ids.has(en.edge.toNode))
      return allEdges.filter((en) => !pinned.has(en.edge.fromNode) && !pinned.has(en.edge.toNode) && !selection.has(en.edge.id) && editing !== en.edge.id)
    }, [bigBoard, canvasMode, allEdges, plan, pinned, selection, editing])
  )
  // labels sit at the curve's middle: only those whose middle is in the mounted area (long edges cross it by thousands)
  const labelEdges = useMemo(() => {
    const r = cull.rect
    if (!bigBoard || !r) return domEdges
    return domEdges.filter(({ g, edge }) => editing === edge.id || (g.mid.x >= r.x && g.mid.x <= r.x + r.width && g.mid.y >= r.y && g.mid.y <= r.y + r.height))
  }, [bigBoard, domEdges, cull.rect, editing])
  const edgesOnCanvas = useMemo(() => (bigBoard && !canvasMode ? new Set(lodEdges.map((en) => en.edge.id)) : null), [bigBoard, canvasMode, lodEdges])

  const commitLabel = useCallback(
    (id: string, label: string | null) => {
      setEditing(null)
      if (label !== null) updateEdge(id, { label: label.trim() || undefined })
      focusCanvas()
    },
    [setEditing, updateEdge, focusCanvas]
  )

  // the world's content only re-renders when what is mounted or how it looks changes — not when the camera moves
  const worldContent = useMemo(() => {
    const renderNode = (n: CanvasNode): React.ReactNode => {
      const lod = isPlaceholder(n.id)
      const sel = selection.has(n.id)
      return (
        <NodeView
          key={n.id}
          node={n}
          selected={sel}
          editing={editing === n.id}
          edgeTarget={edgeTargetId === n.id}
          api={api}
          def={ext?.nodeTypes?.[n.type]}
          extraClass={ext?.nodeClass?.(n)}
          lod={lod}
          chrome={sel || hoverId === n.id || edgeTargetId === n.id}
        />
      )
    }
    const groups = plan.list.filter((n) => layerOf(n) === 'back').sort((a, b) => b.width * b.height - a.width * a.height)
    const cards = plan.list.filter((n) => layerOf(n) === 'normal')
    const fronts = plan.list.filter((n) => layerOf(n) === 'front')
    return (
      <>
        {groups.map(renderNode)}
        <EdgesLayer entries={domEdges} selection={selection} appearance={ext?.edgeAppearance} onCanvas={edgesOnCanvas} />
        {cards.map(renderNode)}
        {fronts.map(renderNode)}
        <EdgeLabels appearance={ext?.edgeAppearance} entries={labelEdges} selection={selection} editingId={editing} onCommitLabel={commitLabel} />
      </>
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plan, domEdges, labelEdges, edgesOnCanvas, selection, editing, edgeTargetId, api, ext, hoverId, focusNodeId, apiPins, cull.lod, layerOf, commitLabel])

  // ---------------------------------------------------------------- canvas layer (nodes not in the DOM)
  const lodCanvasRef = useRef<HTMLCanvasElement>(null)
  const [themeTick, setThemeTick] = useState(0)
  useEffect(() => {
    const refresh = (): void => {
      lodLayer.current?.resetTheme()
      setThemeTick((t) => t + 1)
    }
    // the canvas resolves CSS colors itself: follow theme changes, including a bare body class swap
    const mo = new MutationObserver(refresh)
    mo.observe(document.body, { attributes: true, attributeFilter: ['class'] })
    const off = onThemeChange(refresh)
    return () => {
      mo.disconnect()
      off()
    }
  }, [])
  // every node not in the DOM; the layer only draws those near the view. Kept referentially stable while the
  // membership doesn't change (dragging a mounted card must not re-render the layer)
  const lodNodes = useStableArray(useMemo(() => nodes.filter((n) => !plan.ids.has(n.id)), [nodes, plan]))
  // keyed on the style functions (not the extension object, which hosts rebuild on every render)
  const nodeLod = ext?.nodeLod
  const edgeAppearance = ext?.edgeAppearance
  const lodScene = useMemo(() => {
    const bounds = boundsOf([...lodNodes.map((n) => ({ x: n.x, y: n.y - 120, width: n.width, height: n.height + 120 })), ...lodEdges.map((en) => en.box)])
    return {
      nodes: lodNodes,
      bounds,
      layerOf,
      style: (n: CanvasNode) => nodeLod?.(n) ?? defaultLodStyle(n),
      selection,
      edges: lodEdges,
      edgeStyle: (en: EdgeEntry) => {
        const ap = edgeAppearance?.(en.edge)
        return { color: colorCss(en.edge.color) ?? ap?.color, dashed: ap?.dashed, dim: ap?.dim }
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lodNodes, lodEdges, layerOf, nodeLod, edgeAppearance, selection, themeTick])
  lodSceneRef.current = lodScene
  // hit testing for nodes drawn on the canvas (read by the pointer handlers at event time)
  const orderOf = useMemo(() => new Map(nodes.map((n, i) => [n.id, i])), [nodes])
  lodHitRef.current = { index, dom: plan.ids, active: lodNodes.length > 0, orderOf }
  useLayoutEffect(() => {
    if (!lodLayer.current && lodCanvasRef.current && rootRef.current) lodLayer.current = new LodLayer(lodCanvasRef.current, rootRef.current)
    // while cards mount chunk by chunk, the scene only loses the cards that just mounted (their DOM card covers the
    // stale placeholder): re-render once mounting is done, not per chunk
    renderLod(lodRenderedScene.current !== lodScene && !(plan.pending > 0 && !cull.lod))
  })

  const tempGeo = useMemo(() => {
    if (!tempEdge) return null
    const from = nodes.find((n) => n.id === tempEdge.from)
    if (!from) return null
    const p1 = sidePoint(from, tempEdge.side)
    const to = tempEdge.toNode ? nodes.find((n) => n.id === tempEdge.toNode) : undefined
    if (to && tempEdge.toSide) return edgeGeometry(p1, tempEdge.side, sidePoint(to, tempEdge.toSide), tempEdge.toSide, false, true)
    if (Math.hypot(tempEdge.to.x - p1.x, tempEdge.to.y - p1.y) < 2) return null
    return edgeGeometry(p1, tempEdge.side, tempEdge.to, tempEdge.pending ? oppositeSide(tempEdge.side) : null, false, true)
  }, [tempEdge, nodes])

  const zoomInv = 1 / uiZoom
  const labelScale = clamp(zoomInv, 1, 4)
  const rootStyle = { '--zoom-inv': zoomInv, '--label-scale': labelScale } as React.CSSProperties

  // selection toolbar position (screen space; follows the camera imperatively, see applyCamera)
  const selNodes = useMemo(() => nodes.filter((n) => selection.has(n.id)), [nodes, selection])
  const selBounds = boundsOf(selNodes)
  const showSelToolbar = !!selBounds && !interacting && !marquee && !tempEdge && editing === null
  // groups, file nodes and back-layer extension nodes (form-map zones) draw a label/header above their box
  const labelAbove = selNodes.some((n) => n.type === 'file' || layerOf(n) === 'back')
  toolbarAnchor.current = selBounds ? { b: selBounds, lift: labelAbove ? 30 * labelScale : 0 } : null
  const camNow = vpRef.current
  const toolbarPos = selBounds
    ? {
        x: (selBounds.x + selBounds.width / 2) * camNow.zoom + camNow.x,
        y: Math.max(48, selBounds.y * camNow.zoom + camNow.y - (labelAbove ? 30 * labelScale * camNow.zoom : 0) - 12)
      }
    : null
  const singleSel = selNodes.length === 1 ? selNodes[0] : null

  const rootCls = [
    'canvas-view',
    interacting && 'is-interacting',
    spaceDown && 'is-space-down',
    dragRef.current?.kind === 'pan' && 'is-panning',
    cull.lod && 'is-zoomed-out',
    canvasMode && 'is-canvas-lod',
    ext?.className
  ]
    .filter(Boolean)
    .join(' ')

  // ---------------------------------------------------------------- engine api (for extensions / hosts)
  const engineApi: EngineApi = {
    root: () => rootRef.current,
    data: () => dataRef.current,
    getSelection: () => [...selRef.current],
    select: (ids) => setSelection(new Set(ids)),
    getViewport: () => vpRef.current,
    setViewport: (v, animate = true) => animateTo(v, animate),
    onViewportChange,
    viewSize: () => sizeRef.current,
    toWorld,
    toScreen: (p) => ({ x: p.x * vpRef.current.zoom + vpRef.current.x, y: p.y * vpRef.current.zoom + vpRef.current.y }),
    viewCenter,
    fitNodes: (ids, maxZoom = 1, animate = true) => {
      const set = new Set(ids)
      const ns = dataRef.current.nodes.filter((n) => set.has(n.id))
      if (ns.length) fitRect(boundsOf(ns), maxZoom, animate)
    },
    fitAll,
    addNode,
    create: (k, at) => void create(k, at),
    setEditing,
    startEditing,
    focus: focusCanvas,
    deleteSelection
  }
  if (engineRef) engineRef.current = engineApi
  if (rootRef.current) (rootRef.current as HTMLDivElement & { __canvasEngine?: EngineApi }).__canvasEngine = engineApi
  const ctx: EngineRenderCtx = { vp, size: sizeRef.current, selection, moving, interacting, api: engineApi }
  const chrome = !ext?.hideChrome

  return (
    <div
      ref={rootRef}
      className={rootCls}
      tabIndex={0}
      data-accepts-file-drop
      data-node-count={nodes.length}
      data-edge-count={data.edges.length}
      data-mounted={plan.list.length}
      data-render={canvasMode ? 'canvas' : cull.lod ? 'lod' : 'full'}
      data-ready={doc.loaded && cull.rect ? '' : undefined}
      style={rootStyle}
      onPointerDown={onPointerDown}
      onPointerMove={(e) => {
        pointerRef.current = { world: toWorld(e.clientX, e.clientY), inside: true }
      }}
      onPointerOver={onPointerOver}
      onPointerLeave={() => {
        pointerRef.current.inside = false
        if (hoverRef.current !== null) {
          hoverRef.current = null
          setHoverId(null)
        }
      }}
      onFocus={(e) => {
        const id = nodeIdOf(e.target)
        if (id !== focusNodeId) setFocusNodeId(id)
      }}
      onDoubleClick={onDoubleClick}
      onContextMenu={onContextMenu}
      onKeyDown={onKeyDown}
      onKeyUp={onKeyUp}
      onBlur={(e) => {
        const next = e.currentTarget.contains(e.relatedTarget as Node) ? nodeIdOf(e.relatedTarget) : null
        if (next !== focusNodeId) setFocusNodeId(next)
        if (!e.currentTarget.contains(e.relatedTarget as Node) && spaceRef.current) {
          spaceRef.current = false
          setSpaceDown(false)
        }
      }}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onScroll={(e) => {
        // the root clips (overflow: hidden) but the browser still scrolls it to reveal a focused element in a card that is
        // partly off-screen; that would shift the whole board away from the viewport math, so keep it pinned
        const el = e.currentTarget
        if (e.target === el && (el.scrollLeft || el.scrollTop)) {
          el.scrollLeft = 0
          el.scrollTop = 0
        }
      }}
    >
      <div ref={gridRef} className="canvas-grid" />
      <div ref={worldRef} className="canvas-world">
        <canvas ref={lodCanvasRef} className="canvas-lod-layer" />
        {worldContent}
        {tempGeo && (
          <svg className="canvas-edges canvas-edges-temp">
            <path className="canvas-edge-line" d={tempGeo.path} />
            {tempGeo.toArrow && <polygon className="canvas-edge-arrow" points={tempGeo.toArrow} />}
          </svg>
        )}
        {marquee && <div className="canvas-marquee" style={{ transform: `translate(${marquee.x}px, ${marquee.y}px)`, width: marquee.width, height: marquee.height }} />}
        {ext?.renderWorld?.(ctx)}
      </div>

      {doc.loaded && nodes.length === 0 && (
        <div className="canvas-empty-hint">
          <div className="canvas-empty-title">{doc.invalid ? 'Could not read this canvas' : 'Empty canvas'}</div>
          <div>
            {doc.invalid
              ? 'The file is not valid JSON Canvas. It will not be modified unless you add something here.'
              : 'Double-click to add a card, drag files from the explorer, or use the toolbar below.'}
          </div>
        </div>
      )}

      {chrome && showSelToolbar && toolbarPos && (
        <SelectionToolbar
          elRef={toolbarRef}
          x={toolbarPos.x}
          y={toolbarPos.y}
          canEdit={!!singleSel && (singleSel.type === 'text' || singleSel.type === 'group' || singleSel.type === 'code' || !!ext?.nodeTypes?.[singleSel.type]?.editable)}
          onColor={(e) => {
            const ids = new Set(selRef.current)
            const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
            useUi.getState().showMenu({ x: r.left, y: r.bottom + 4 }, colorMenu(singleSel?.color, (c) => setColor(ids, c), () => void customColor(ids)))
          }}
          onFit={fitSelection}
          onEdit={() => singleSel && startEditing(singleSel.id)}
          onDelete={deleteSelection}
        />
      )}

      {chrome && (
      <ZoomControls
        zoom={vp.zoom}
        onZoomIn={() => zoomAt(1.25, sizeRef.current.w / 2, sizeRef.current.h / 2, true)}
        onZoomOut={() => zoomAt(0.8, sizeRef.current.w / 2, sizeRef.current.h / 2, true)}
        onReset={() => zoomAt(1 / vpRef.current.zoom, sizeRef.current.w / 2, sizeRef.current.h / 2, true)}
        onFit={fitAll}
        onFitSelection={fitSelection}
        hasSelection={selNodes.length > 0}
        onUndo={doc.undo}
        onRedo={doc.redo}
        canUndo={doc.canUndo}
        canRedo={doc.canRedo}
      />
      )}
      {chrome && (ext && 'toolbar' in ext ? ext.toolbar : <CreateToolbar onCreate={(k) => void create(k)} />)}
      {ext?.renderOverlay?.(ctx)}

      {picker && (
        <FilePicker
          exclude={path}
          onClose={() => {
            setPicker(null)
            focusCanvas()
          }}
          onPick={(p) => addFiles([p], picker.at, picker.connect)}
        />
      )}

      {ext && 'headerActions' in ext ? (
        ext.headerActions && <ViewHeaderActions>{ext.headerActions}</ViewHeaderActions>
      ) : (
        <ViewHeaderActions>
          <button className="clickable-icon small" title="Add code cell" onClick={() => void create('code')}>
            <SquareCode />
          </button>
          <button className="clickable-icon small" title="Zoom to fit (Shift+1)" onClick={fitAll}>
            <Maximize />
          </button>
        </ViewHeaderActions>
      )}
      <StatusBarItem active={focused}>
        <div className="status-bar-item">
          {ext?.status
            ? ext.status(ctx)
            : `${nodes.length} ${nodes.length === 1 ? 'card' : 'cards'} · ${data.edges.length} ${data.edges.length === 1 ? 'edge' : 'edges'} · ${Math.round(vp.zoom * 100)}%`}
        </div>
      </StatusBarItem>
    </div>
  )
}

/** the previous array while its elements are the same objects (keeps memoized consumers from re-running) */
function useStableArray<T>(arr: T[]): T[] {
  const ref = useRef(arr)
  const prev = ref.current
  if (prev !== arr && (prev.length !== arr.length || arr.some((x, i) => x !== prev[i]))) ref.current = arr
  return ref.current
}

function withColor<T extends { color?: string }>(o: T, color: string | undefined): T {
  const next = { ...o }
  if (color) next.color = color
  else delete next.color
  return next
}
