// Force-directed graph engine shared by the graph view and the local graph pane.
//  - the force simulation (forces.ts, d3-force’s model on typed arrays) runs in a Web Worker (sim.worker.ts) and
//    streams positions back as Float32Arrays; a fresh graph starts from a multilevel layout (layout.ts)
//  - drawing is WebGL2 (glRenderer.ts; Canvas 2D fallback in canvasRenderer.ts) from flat typed arrays (scene.ts)
//  - the main thread only draws: a requestAnimationFrame loop that runs while something changes (new positions,
//    camera, fades) and never while hidden; the simulation is paused while hidden too
import { cssVar, resolveColor, themePalette } from '@/theme/theme'
import type { GraphData } from './data'
import { CanvasRenderer } from './canvasRenderer'
import { GLRenderer } from './glRenderer'
import { SpatialGrid } from './grid'
import { seedLayout } from './layout'
import {
  DIRTY_ALL,
  DIRTY_COLORS,
  DIRTY_HL,
  DIRTY_POS,
  DIRTY_PROPS,
  parseHex,
  type FrameParams,
  type GNode,
  type LabelList,
  type RGBA,
  type Renderer,
  type Scene
} from './scene'
import { padCap, type SimForces, type SimOut } from './sim'
import { SimClient } from './simClient'

export type { GNode } from './scene'

export interface DisplayOptions {
  arrows: boolean
  textFade: number
  nodeSize: number
  linkThickness: number
}

export interface ForceOptions {
  center: number
  repel: number
  link: number
  distance: number
}

export interface EngineCallbacks {
  onClick?(node: GNode, e: MouseEvent): void
  onContextMenu?(node: GNode, e: MouseEvent): void
}

export interface EngineOptions {
  /** max zoom used by zoom-to-fit (keeps tiny graphs from being blown up) */
  maxFitScale?: number
  fitPadding?: number
  /** theme variable painted behind the canvas (used for label halos) */
  backgroundVar?: string
  /** bias the centering forces so the layout matches the viewport's aspect ratio (tall sidebars) */
  aspectForces?: boolean
  /** new nodes fade in when at most this many arrive in one update (default 300; bigger batches just appear) */
  appearLimit?: number
  /** fade in the first nodes too (default: a fresh graph appears at once) */
  appearFirst?: boolean
}

interface Camera {
  x: number
  y: number
  k: number
}

interface DragState {
  pointerId: number
  button: number
  startX: number
  startY: number
  lastX: number
  lastY: number
  node: GNode | null
  moved: boolean
}

const MIN_K = 0.02
const MAX_K = 6
const MIN_SCREEN_R = 1.6
const BASE_FONT = 12
/** most labels drawn per frame (highest priority first: hovered neighbourhood, focus, high degree) */
const MAX_LABELS = 600
/** above this many nodes label widths for zoom-to-fit are estimated instead of measured */
const MEASURE_LIMIT = 4000
const APPEAR_MS = 450
/** labels are re-rasterized at their exact size (and cached layers redrawn at full resolution) once the camera
 * rested this long */
const REST_MS = 180
const NO_APPEAR = -1e9

const clamp = (v: number, a: number, b: number): number => (v < a ? a : v > b ? b : v)

export class GraphEngine {
  readonly canvas: HTMLCanvasElement
  private host: HTMLElement
  private cb: EngineCallbacks
  private opts: Required<EngineOptions>
  private renderer: Renderer
  private sim: SimClient

  private nodes: GNode[] = []
  private byId = new Map<string, GNode>()
  private scene: Scene = {
    n: 0,
    cap: 0,
    m: 0,
    nodes: [],
    pos: new Float32Array(0),
    props: new Float32Array(0),
    colors: new Uint8Array(0),
    edges: new Uint32Array(0),
    hlNodes: new Uint32Array(64),
    hlNodeCount: 0,
    hlEdges: new Uint32Array(128),
    hlEdgeCount: 0,
    dirty: DIRTY_ALL
  }
  /** adjacency (CSR): neighbours of node i are adjNode[adjStart[i] .. adjStart[i + 1]], via links adjEdge[…] */
  private adjStart = new Int32Array(1)
  private adjNode = new Int32Array(0)
  private adjEdge = new Int32Array(0)
  /** node indices by label priority (degree, descending) */
  private labelOrder = new Int32Array(0)
  private hlFlag = new Uint8Array(0)

  // simulation state as last reported by the worker
  private gen = 0
  private simSeq = 0
  private ackSeq = -1
  private simRunning = false
  private simPaused = false
  private pendingPos: Float32Array | null = null
  private tickMs = 0
  private tps = 0

  private display: DisplayOptions = { arrows: false, textFade: 0, nodeSize: 1, linkThickness: 1 }
  private forces: ForceOptions = { center: 0.5, repel: 10, link: 1, distance: 120 }
  private aspect = 1

  private insetRight = 0
  private width = 0
  private height = 0
  private dpr = 1
  readonly cam: Camera = { x: 0, y: 0, k: 1 }
  /** camera follows the bounds of the graph until the user pans / zooms */
  private autoFit = true
  private camMoving = false
  private fitCache: Camera | null = null
  private fitTargetCam: Camera = { x: 0, y: 0, k: 1 }
  /** inputs the cached fit target was computed for: positions version, width, height, right inset */
  private fitKey = new Float64Array(4).fill(NaN)

  private palette: Record<string, string> = {}
  private colorCache = new Map<string, RGBA>()
  private font = 'sans-serif'
  private measureCtx: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D | null = null

  private focusId: string | null = null
  private hover: GNode | null = null
  private hlSource: GNode | null = null
  private hoverFade = 0

  private drag: DragState | null = null
  private dragPos = { x: 0, y: 0 }
  private mouse: { x: number; y: number } | null = null

  private grid = new SpatialGrid()
  private posVersion = 0
  private gridVersion = -1

  private visible = true
  private intersecting = true
  private raf = 0
  private lastT = 0
  private needsDraw = true
  private clock0 = performance.now()
  private appearUntil = 0
  private lastK = NaN
  private lastCX = NaN
  private lastCY = NaN
  /** time of the last zoom level change */
  private zoomChangedAt = -1
  /** time of the last camera change (-1: drawn at rest since) */
  private camChangedAt = -1

  private labels: LabelList = { count: 0, idx: new Int32Array(MAX_LABELS), alpha: new Float32Array(MAX_LABELS), fontPx: BASE_FONT, font: 'sans-serif' }
  private fp: FrameParams = {
    width: 0,
    height: 0,
    dpr: 1,
    cam: this.cam,
    time: 0,
    zooming: false,
    moving: false,
    minR: MIN_SCREEN_R,
    fade: 0,
    hlSource: -1,
    dimNode: 1,
    dimEdge: 1,
    linePx: 1,
    arrowAlpha: 0,
    arrowSize: 1,
    focus: -1,
    focusAlpha: 0,
    line: [0.5, 0.5, 0.5, 1],
    accent: [0.5, 0.5, 1, 1],
    text: [1, 1, 1, 1],
    bg: [0, 0, 0, 1],
    labels: this.labels
  }

  private ro: ResizeObserver
  private io: IntersectionObserver
  private mo: MutationObserver

  /** benchmark hooks (bench/run.mjs) */
  readonly bench = {
    /** when set, every engine frame pushes its main-thread cost (ms) */
    frameTimes: null as number[] | null,
    /** draw the current frame from scratch (no cached layers) and wait for the GPU to finish it */
    draw: (): void => {
      this.renderer.invalidate()
      this.draw()
      this.renderer.finish()
    },
    /** pan like a user drag would */
    pan: (dx: number, dy: number): void => {
      this.cam.x += dx
      this.cam.y += dy
      this.autoFit = false
      this.invalidate()
    },
    /** restart the layout (settling) */
    restart: (): void => this.animate(),
    stats: () => ({ renderer: this.renderer.kind, simInThread: this.sim.inThread, tickMs: this.tickMs, ticksPerSec: this.tps })
  }

  constructor(host: HTMLElement, cb: EngineCallbacks = {}, opts: EngineOptions = {}) {
    this.host = host
    this.cb = cb
    this.opts = {
      maxFitScale: opts.maxFitScale ?? 1.6,
      fitPadding: opts.fitPadding ?? 40,
      backgroundVar: opts.backgroundVar ?? 'graph-background',
      aspectForces: opts.aspectForces ?? false,
      appearLimit: opts.appearLimit ?? 300,
      appearFirst: opts.appearFirst ?? false
    }
    this.canvas = document.createElement('canvas')
    this.canvas.className = 'graph-canvas'
    host.appendChild(this.canvas)
    ;(this.canvas as HTMLCanvasElement & { __graph?: GraphEngine }).__graph = this
    // tests can force the Canvas 2D fallback (used when WebGL2 is unavailable)
    const force2d = (globalThis as { __CS2D3K_GRAPH_CANVAS2D?: boolean }).__CS2D3K_GRAPH_CANVAS2D === true
    this.renderer = (!force2d && GLRenderer.create(this.canvas)) || new CanvasRenderer(this.canvas)
    this.renderer.onRestore = () => {
      this.scene.dirty = DIRTY_ALL
      this.invalidate()
    }
    this.sim = new SimClient(this.onSim)

    this.refreshTheme()
    this.resize()

    this.ro = new ResizeObserver(() => this.resize())
    this.ro.observe(host)
    this.io = new IntersectionObserver((entries) => {
      const e = entries[entries.length - 1]
      this.intersecting = e.isIntersecting
      this.syncPaused()
      if (this.intersecting) this.invalidate()
    })
    this.io.observe(host)
    // quick theme swaps that only flip body classes (no onThemeChange) still need new colors
    this.mo = new MutationObserver(() => this.refreshTheme())
    this.mo.observe(document.body, { attributes: true, attributeFilter: ['class'] })

    const c = this.canvas
    c.addEventListener('pointerdown', this.onPointerDown)
    c.addEventListener('pointermove', this.onPointerMove)
    c.addEventListener('pointerup', this.onPointerUp)
    c.addEventListener('pointercancel', this.onPointerUp)
    c.addEventListener('pointerleave', this.onPointerLeave)
    c.addEventListener('wheel', this.onWheel, { passive: false })
    c.addEventListener('contextmenu', this.onContextMenu)
    c.addEventListener('auxclick', (e) => e.preventDefault())
  }

  destroy(): void {
    cancelAnimationFrame(this.raf)
    this.raf = 0
    this.sim.destroy()
    this.renderer.destroy()
    this.ro.disconnect()
    this.io.disconnect()
    this.mo.disconnect()
    this.canvas.remove()
  }

  // ---------------------------------------------------------------- public api

  get nodeCount(): number {
    return this.nodes.length
  }

  get linkCount(): number {
    return this.scene.m
  }

  /** which renderer is active ('webgl2' or the 'canvas2d' fallback) */
  get rendererKind(): string {
    return this.renderer.kind
  }

  setVisible(v: boolean): void {
    this.visible = v
    this.syncPaused()
    if (v) this.invalidate()
  }

  setData(data: GraphData): void {
    const now = this.now()
    const oldScene = this.scene
    const oldNodes = this.nodes
    const first = oldNodes.length === 0
    const old = this.byId
    const n = data.nodes.length
    const byId = new Map<string, GNode>()
    const nodes: GNode[] = new Array(n)
    const remap = new Int32Array(n)
    let sameNodes = n === oldNodes.length
    for (let i = 0; i < n; i++) {
      const d = data.nodes[i]
      let node = old.get(d.id)
      if (node && byId.has(d.id)) node = undefined
      if (node) {
        remap[i] = node.index
        if (node.index !== i) sameNodes = false
        node.index = i
        if (node.label !== d.label) {
          node.lw = -1
          node.lab = null
        }
        node.kind = d.kind
        node.label = d.label
        node.path = d.path
        node.tag = d.tag
        node.link = d.link
        node.groupColor = d.groupColor
      } else {
        remap[i] = -1
        sameNodes = false
        node = { ...d, index: i, degree: 0, r: 4, lw: -1, lab: null }
      }
      byId.set(d.id, node)
      nodes[i] = node
    }

    // links → packed (source | dir << 30, target) pairs
    const linksIn = data.links
    const edges = new Uint32Array(linksIn.length * 2)
    let m = 0
    for (const l of linksIn) {
      const s = byId.get(l.source)
      const t = byId.get(l.target)
      if (!s || !t || s === t) continue
      edges[2 * m] = (s.index | ((l.dir & 3) << 30)) >>> 0
      edges[2 * m + 1] = t.index
      m++
    }

    if (sameNodes && m === oldScene.m && equalPrefix(edges, oldScene.edges, 2 * m)) {
      // same structure (e.g. a group color changed): keep the layout running as-is
      this.nodes = nodes
      this.byId = byId
      this.scene.nodes = nodes
      this.recolor()
      return
    }

    // degrees + adjacency
    const deg = new Int32Array(n)
    for (let e = 0; e < m; e++) {
      deg[edges[2 * e] & 0x3fffffff]++
      deg[edges[2 * e + 1]]++
    }
    const adjStart = new Int32Array(n + 1)
    for (let i = 0; i < n; i++) adjStart[i + 1] = adjStart[i] + deg[i]
    const fill = adjStart.slice(0, n)
    const adjNode = new Int32Array(2 * m)
    const adjEdge = new Int32Array(2 * m)
    for (let e = 0; e < m; e++) {
      const s = edges[2 * e] & 0x3fffffff
      const t = edges[2 * e + 1]
      adjNode[fill[s]] = t
      adjEdge[fill[s]++] = e
      adjNode[fill[t]] = s
      adjEdge[fill[t]++] = e
    }
    for (let i = 0; i < n; i++) nodes[i].degree = deg[i]

    // positions: keep known nodes in place, spawn new ones next to placed neighbours
    const cap = padCap(n)
    const pos = new Float32Array(2 * cap)
    const props = new Float32Array(2 * cap)
    let added = 0
    for (let i = 0; i < n; i++) {
      const o = remap[i]
      if (o >= 0 && o < oldScene.n) {
        pos[2 * i] = oldScene.pos[2 * o]
        pos[2 * i + 1] = oldScene.pos[2 * o + 1]
        props[2 * i + 1] = oldScene.props[2 * o + 1]
      } else {
        pos[2 * i] = pos[2 * i + 1] = NaN
        props[2 * i + 1] = NO_APPEAR
        added++
      }
    }
    // a fresh graph gets an instant provisional placement; the worker replaces it with a multilevel layout
    if (first) seedLayout(n, pos)
    else if (added) this.spawn(n, adjStart, adjNode, pos)
    // fade new nodes in — unless a big batch arrives at once (cheaper to just show them)
    if ((!first || this.opts.appearFirst) && added && added <= this.opts.appearLimit) {
      for (let i = 0; i < n; i++) if (remap[i] < 0) props[2 * i + 1] = now
      this.appearUntil = now + APPEAR_MS
    }
    const removed = oldNodes.length + added - n

    // label priority: degree descending (counting sort)
    let maxDeg = 0
    for (let i = 0; i < n; i++) if (deg[i] > maxDeg) maxDeg = deg[i]
    const bucket = new Int32Array(maxDeg + 2)
    for (let i = 0; i < n; i++) bucket[maxDeg - deg[i] + 1]++
    for (let b = 0; b <= maxDeg; b++) bucket[b + 1] += bucket[b]
    const order = new Int32Array(n)
    for (let i = 0; i < n; i++) order[bucket[maxDeg - deg[i]]++] = i

    this.nodes = nodes
    this.byId = byId
    this.adjStart = adjStart
    this.adjNode = adjNode
    this.adjEdge = adjEdge
    this.labelOrder = order
    this.hlFlag = new Uint8Array(n)
    const sc = this.scene
    sc.n = n
    sc.cap = cap
    sc.m = m
    sc.nodes = nodes
    sc.pos = pos
    sc.props = props
    sc.colors = new Uint8Array(4 * cap)
    sc.edges = m * 2 === edges.length ? edges : edges.slice(0, 2 * m)
    sc.hlNodeCount = sc.hlEdgeCount = 0
    sc.dirty = DIRTY_ALL
    this.updateRadii()
    this.recolor()
    this.posVersion++
    this.fitCache = null
    if (this.pendingPos) this.pendingPos = null

    const hover = this.hover
    this.hlSource = null
    if (hover && byId.get(hover.id) !== hover) this.setHover(null)
    else if (hover) this.flagHighlight(hover)
    if (this.drag?.node && byId.get(this.drag.node.id) !== this.drag.node) this.drag = null

    let alpha: number
    if (first) alpha = 1
    else if (added || removed) alpha = added ? 0.35 : 0.2
    else alpha = 0.1
    const radii = new Float32Array(n)
    for (let i = 0; i < n; i++) radii[i] = props[2 * i]
    const src = new Uint32Array(m)
    const tgt = new Uint32Array(m)
    for (let e = 0; e < m; e++) {
      src[e] = sc.edges[2 * e] & 0x3fffffff
      tgt[e] = sc.edges[2 * e + 1]
    }
    this.gen++
    this.sim.send(
      { t: 'data', gen: this.gen, seq: ++this.simSeq, n, pos: pos.slice(), remap: first ? null : remap, src, tgt, radii, forces: this.simForces(), alpha },
      [src.buffer, tgt.buffer, radii.buffer]
    )
    this.simRunning = n > 0
    this.invalidate()
  }

  setFocus(id: string | null): void {
    if (id === this.focusId) return
    this.focusId = id
    this.recolor()
  }

  setDisplay(d: DisplayOptions): void {
    const sizeChanged = d.nodeSize !== this.display.nodeSize
    this.display = { ...d }
    if (sizeChanged && this.nodes.length) {
      this.updateRadii()
      const radii = new Float32Array(this.nodes.length)
      for (let i = 0; i < radii.length; i++) radii[i] = this.scene.props[2 * i]
      this.sim.send({ t: 'radii', seq: ++this.simSeq, radii, reheat: 0.15 }, [radii.buffer])
      this.simRunning = true
      this.fitCache = null
    }
    this.invalidate()
  }

  setForces(f: ForceOptions): void {
    const prev = this.forces
    this.forces = { ...f }
    const changed = prev.center !== f.center || prev.repel !== f.repel || prev.link !== f.link || prev.distance !== f.distance
    if (changed) this.sendForces(0.3)
  }

  /** Space (CSS px) covered by floating UI on the right; zoom-to-fit keeps the graph out of it. */
  setFitInsets(right: number): void {
    if (right === this.insetRight) return
    this.insetRight = right
    this.fitCache = null
    if (this.autoFit) this.invalidate()
  }

  /** Smoothly zoom so the whole graph is visible; the camera keeps following until the user pans / zooms. */
  zoomToFit(): void {
    this.autoFit = true
    this.invalidate()
  }

  /** Jump to the zoom-to-fit camera right away (no easing); the camera keeps following the graph afterwards. */
  fitNow(): void {
    this.autoFit = true
    if (!this.nodes.length || !this.width || !this.height) return
    const t = this.fitTarget()
    this.cam.x = t.x
    this.cam.y = t.y
    this.cam.k = t.k
    this.invalidate()
  }

  /** Re-run the layout from scratch with an animation. */
  animate(): void {
    if (this.nodes.length) {
      this.sim.send({ t: 'animate', seq: ++this.simSeq })
      this.simRunning = true
    }
    this.autoFit = true
    this.invalidate()
  }

  /** Re-read colors and font from the current theme. */
  refreshTheme(): void {
    this.palette = themePalette()
    this.colorCache.clear()
    const f = cssVar('--font-interface') || 'sans-serif'
    if (f !== this.font) {
      this.font = f
      this.labels.font = f
      for (const n of this.nodes) {
        n.lw = -1
        n.lab = null
      }
      this.renderer.resetLabels()
      this.fitCache = null
    }
    const p = this.palette
    const fp = this.fp
    fp.line = this.rgba(p['graph-line'])
    fp.accent = this.rgba(p['graph-node-focused'])
    fp.text = this.rgba(p['graph-text'])
    fp.bg = this.rgba(p[this.opts.backgroundVar] ?? resolveColor(`var(--${this.opts.backgroundVar})`))
    this.recolor()
  }

  /** Screen (CSS px, relative to the canvas) position of a node — used by tests. */
  screenPos(id: string): { x: number; y: number } | null {
    const n = this.byId.get(id)
    if (!n) return null
    const p = this.scene.pos
    return { x: p[2 * n.index] * this.cam.k + this.cam.x, y: p[2 * n.index + 1] * this.cam.k + this.cam.y }
  }

  /** RGB of the rendered frame at a canvas CSS pixel — used by tests. */
  readPixel(x: number, y: number): [number, number, number] {
    this.prepareFrame()
    return this.renderer.readPixel(this.scene, this.fp, x, y)
  }

  isSettled(): boolean {
    return !this.simBusy() && !this.pendingPos && !this.camMoving
  }

  // ---------------------------------------------------------------- simulation

  private simBusy(): boolean {
    return this.nodes.length > 0 && (this.simRunning || this.ackSeq !== this.simSeq)
  }

  private now(): number {
    return performance.now() - this.clock0
  }

  private simForces(): SimForces {
    const f = this.forces
    return { center: f.center, repel: f.repel, link: f.link, distance: f.distance, ax: this.aspect }
  }

  private sendForces(reheat: number): void {
    if (!this.nodes.length) return
    this.sim.send({ t: 'forces', seq: ++this.simSeq, forces: this.simForces(), reheat })
    this.simRunning = true
  }

  private syncPaused(): void {
    const paused = !this.shown()
    if (paused === this.simPaused) return
    this.simPaused = paused
    this.sim.send({ t: 'pause', paused })
  }

  private onSim = (msg: SimOut): void => {
    if (msg.gen !== this.gen) {
      if (msg.t === 'pos') this.sim.send({ t: 'buf', buf: msg.buf }, [msg.buf.buffer])
      return
    }
    this.ackSeq = msg.seq
    this.simRunning = msg.running
    if (msg.t === 'ack') return
    this.tickMs = msg.tickMs
    this.tps = msg.tps
    if (this.pendingPos) this.recycle(this.pendingPos)
    this.pendingPos = msg.buf
    this.invalidate()
  }

  private recycle(buf: Float32Array): void {
    if (buf.length === this.scene.pos.length) this.sim.send({ t: 'buf', buf }, [buf.buffer])
  }

  /** swap in the latest positions from the simulation */
  private consumePositions(): void {
    const buf = this.pendingPos
    if (!buf) return
    this.pendingPos = null
    const sc = this.scene
    if (buf.length !== sc.pos.length) return
    const old = sc.pos
    sc.pos = buf
    this.recycle(old)
    const d = this.drag
    if (d?.node && d.moved) {
      buf[2 * d.node.index] = this.dragPos.x
      buf[2 * d.node.index + 1] = this.dragPos.y
    }
    sc.dirty |= DIRTY_POS
    this.posVersion++
  }

  // ---------------------------------------------------------------- data helpers

  private spawn(n: number, adjStart: Int32Array, adjNode: Int32Array, pos: Float32Array): void {
    const pending: number[] = []
    for (let i = 0; i < n; i++) if (Number.isNaN(pos[2 * i])) pending.push(i)
    for (let pass = 0; pass < 4 && pending.length; pass++) {
      for (let j = pending.length - 1; j >= 0; j--) {
        const i = pending[j]
        let sx = 0
        let sy = 0
        let c = 0
        for (let a = adjStart[i]; a < adjStart[i + 1]; a++) {
          const nb = adjNode[a]
          if (Number.isNaN(pos[2 * nb])) continue
          sx += pos[2 * nb]
          sy += pos[2 * nb + 1]
          c++
        }
        if (!c) continue
        const ang = Math.random() * Math.PI * 2
        const d = 15 + Math.random() * 25
        pos[2 * i] = sx / c + Math.cos(ang) * d
        pos[2 * i + 1] = sy / c + Math.sin(ang) * d
        pending.splice(j, 1)
      }
    }
    if (!pending.length) return
    // centroid / spread of the placed nodes
    let cx = 0
    let cy = 0
    let c = 0
    for (let i = 0; i < n; i++)
      if (!Number.isNaN(pos[2 * i])) {
        cx += pos[2 * i]
        cy += pos[2 * i + 1]
        c++
      }
    let spread = 60
    if (c) {
      cx /= c
      cy /= c
      for (let i = 0; i < n; i++) if (!Number.isNaN(pos[2 * i])) spread = Math.max(spread, Math.hypot(pos[2 * i] - cx, pos[2 * i + 1] - cy))
    }
    for (const i of pending) {
      const a = Math.random() * Math.PI * 2
      const d = spread * (0.6 + Math.random() * 0.5)
      pos[2 * i] = cx + Math.cos(a) * d
      pos[2 * i + 1] = cy + Math.sin(a) * d
    }
  }

  private updateRadii(): void {
    const s = this.display.nodeSize
    const props = this.scene.props
    for (const n of this.nodes) {
      n.r = s * (3.6 + 1.8 * Math.sqrt(n.degree))
      props[2 * n.index] = n.r
    }
    this.scene.dirty |= DIRTY_PROPS
  }

  private rgba(c: string | undefined): RGBA {
    if (!c) return [0.5, 0.5, 0.5, 1]
    let v = this.colorCache.get(c)
    if (!v) {
      v = parseHex(c) ?? parseHex(resolveColor(c)) ?? [0.5, 0.5, 0.5, 1]
      this.colorCache.set(c, v)
    }
    return v
  }

  private nodeColor(n: GNode): string {
    const p = this.palette
    if (n.id === this.focusId) return p['graph-node-focused']
    if (n.groupColor) return n.groupColor
    switch (n.kind) {
      case 'tag':
        return p['graph-node-tag']
      case 'attachment':
        return p['graph-node-attachment']
      case 'unresolved':
        return p['graph-node-unresolved']
      default:
        return p['graph-node']
    }
  }

  private recolor(): void {
    const colors = this.scene.colors
    for (const n of this.nodes) {
      const c = this.rgba(this.nodeColor(n))
      const o = 4 * n.index
      colors[o] = Math.round(c[0] * 255)
      colors[o + 1] = Math.round(c[1] * 255)
      colors[o + 2] = Math.round(c[2] * 255)
      colors[o + 3] = Math.round(c[3] * 255)
    }
    this.scene.dirty |= DIRTY_COLORS
    this.invalidate()
  }

  // ---------------------------------------------------------------- frame loop

  private resize(): void {
    const w = this.host.clientWidth
    const h = this.host.clientHeight
    const dpr = window.devicePixelRatio || 1
    if (w === this.width && h === this.height && dpr === this.dpr) return
    // keep the world point at the center of the view in place
    if (this.width && this.height) {
      this.cam.x += (w - this.width) / 2
      this.cam.y += (h - this.height) / 2
    } else {
      this.cam.x = w / 2
      this.cam.y = h / 2
    }
    const hadSize = this.width > 0 && this.height > 0
    const aspectChanged = !hadSize || Math.abs(w / Math.max(1, h) - this.width / Math.max(1, this.height)) > 0.15
    this.width = w
    this.height = h
    this.dpr = dpr
    this.fitCache = null
    if (this.opts.aspectForces && aspectChanged && w > 0 && h > 0) {
      this.aspect = clamp(h / w, 0.5, 2.5)
      if (hadSize) this.sendForces(0.08)
    }
    this.canvas.width = Math.max(1, Math.round(w * dpr))
    this.canvas.height = Math.max(1, Math.round(h * dpr))
    this.canvas.style.width = w + 'px'
    this.canvas.style.height = h + 'px'
    this.renderer.resize(w, h, dpr)
    this.syncPaused()
    if (this.raf) cancelAnimationFrame(this.raf)
    this.raf = 0
    // draw synchronously so resizing never flashes an empty canvas
    this.needsDraw = true
    if (this.shown()) this.frame(performance.now())
  }

  private shown(): boolean {
    return this.visible && this.intersecting && this.width > 0 && this.height > 0
  }

  private invalidate(): void {
    this.needsDraw = true
    this.requestFrame()
  }

  private requestFrame(): void {
    if (!this.raf && this.shown()) this.raf = requestAnimationFrame(this.frame)
  }

  private frame = (t: number): void => {
    this.raf = 0
    if (!this.shown()) {
      this.lastT = 0
      return
    }
    const t0 = performance.now()
    const dt = this.lastT ? Math.min(50, t - this.lastT) : 16
    this.lastT = t
    let busy = false

    if (this.pendingPos) {
      this.consumePositions()
      this.needsDraw = true
      if (this.mouse && !this.drag) this.updateHover()
    }

    // hover fade
    const target = this.hover ? 1 : 0
    if (this.hoverFade !== target) {
      const step = dt / 160
      this.hoverFade = target > this.hoverFade ? Math.min(1, this.hoverFade + step) : Math.max(0, this.hoverFade - step)
      if (this.hoverFade === 0 && !this.hover) this.clearHighlight()
      busy = true
      this.needsDraw = true
    }

    // appear animation (computed on the GPU from the start time; just keep drawing)
    if (this.appearUntil > this.now() - 32) {
      busy = true
      this.needsDraw = true
    }

    this.camMoving = false
    if (this.autoFit && this.nodes.length) {
      const tgt = this.fitTarget()
      const ease = 1 - Math.pow(1 - 0.14, dt / 16)
      const lk = Math.log(tgt.k / this.cam.k)
      const dx = tgt.x - this.cam.x
      const dy = tgt.y - this.cam.y
      if (Math.abs(lk) > 0.002 || Math.abs(dx) > 0.3 || Math.abs(dy) > 0.3) {
        this.cam.k *= Math.exp(lk * ease)
        this.cam.x += dx * ease
        this.cam.y += dy * ease
        this.camMoving = true
        busy = true
        this.needsDraw = true
      } else if (this.cam.k !== tgt.k || this.cam.x !== tgt.x || this.cam.y !== tgt.y) {
        this.cam.k = tgt.k
        this.cam.x = tgt.x
        this.cam.y = tgt.y
        this.needsDraw = true
      }
    }

    if (this.camChangedAt >= 0) {
      if (this.now() - this.camChangedAt < REST_MS) busy = true
      else {
        // the camera came to rest: draw once more (exact-size label rasters, full-resolution layers)
        this.camChangedAt = -1
        this.needsDraw = true
      }
    }

    if (this.needsDraw) {
      this.needsDraw = false
      if (this.draw()) {
        // labels still being rasterized
        this.needsDraw = true
        busy = true
      }
    }
    this.bench.frameTimes?.push(performance.now() - t0)
    if (busy) this.requestFrame()
    else this.lastT = 0
  }

  private fontScale(k: number): number {
    return clamp(Math.pow(k, 0.35), 0.85, 1.25)
  }

  private measureLabels(): void {
    const big = this.nodes.length > MEASURE_LIMIT
    for (const n of this.nodes) {
      if (n.lw >= 0) continue
      if (big) {
        n.lw = n.label.length * BASE_FONT * 0.55
        continue
      }
      if (!this.measureCtx) {
        const c = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(1, 1) : document.createElement('canvas')
        this.measureCtx = c.getContext('2d') as OffscreenCanvasRenderingContext2D
      }
      const f = `${BASE_FONT}px ${this.font}`
      if (this.measureCtx.font !== f) this.measureCtx.font = f
      n.lw = this.measureCtx.measureText(n.label).width
    }
  }

  /** Camera that fits all nodes and their labels into the free area of the viewport. */
  private fitTarget(): Camera {
    const key = this.fitKey
    if (this.fitCache && key[0] === this.posVersion && key[1] === this.width && key[2] === this.height && key[3] === this.insetRight) return this.fitCache
    this.measureLabels()
    const { pos, props, n } = this.scene
    const availW = this.width - (this.width - this.insetRight >= 320 ? this.insetRight : 0)
    const pad = Math.min(this.opts.fitPadding, Math.min(availW, this.height) / 8)
    const W = Math.max(1, availW - pad * 2)
    const H = Math.max(1, this.height - pad * 2)
    // first guess from node bounds only, then refine with label extents (labels don't scale with zoom)
    let x0 = Infinity
    let y0 = Infinity
    let x1 = -Infinity
    let y1 = -Infinity
    for (let i = 0; i < n; i++) {
      const x = pos[2 * i]
      const y = pos[2 * i + 1]
      const r = props[2 * i]
      if (x - r < x0) x0 = x - r
      if (x + r > x1) x1 = x + r
      if (y - r < y0) y0 = y - r
      if (y + r > y1) y1 = y + r
    }
    let k = clamp(Math.min(W / Math.max(1, x1 - x0), H / Math.max(1, y1 - y0), this.opts.maxFitScale), MIN_K, MAX_K)
    let sx0 = 0
    let sx1 = 0
    let sy0 = 0
    let sy1 = 0
    for (let iter = 0; iter < 4; iter++) {
      const fs = this.fontScale(k)
      const textH = BASE_FONT * fs + 6
      sx0 = sy0 = Infinity
      sx1 = sy1 = -Infinity
      const wCap = W * 0.22
      for (let i = 0; i < n; i++) {
        const r = Math.max(props[2 * i] * k, MIN_SCREEN_R)
        // long labels may overflow a little in narrow panes rather than shrinking the whole graph
        const lh = (this.nodes[i].lw * fs) / 2
        const half = Math.max(r, lh < wCap ? lh : wCap)
        const cx = pos[2 * i] * k
        const cy = pos[2 * i + 1] * k
        if (cx - half < sx0) sx0 = cx - half
        if (cx + half > sx1) sx1 = cx + half
        if (cy - r < sy0) sy0 = cy - r
        if (cy + r + textH > sy1) sy1 = cy + r + textH
      }
      const s = Math.min(W / Math.max(1, sx1 - sx0), H / Math.max(1, sy1 - sy0))
      const nk = clamp(Math.min(k * s, this.opts.maxFitScale), MIN_K, MAX_K)
      if (Math.abs(nk - k) / k < 0.01) break
      k = nk
    }
    key[0] = this.posVersion
    key[1] = this.width
    key[2] = this.height
    key[3] = this.insetRight
    const fit = (this.fitCache = this.fitTargetCam)
    fit.k = k
    fit.x = pad + W / 2 - (sx0 + sx1) / 2
    fit.y = pad + H / 2 - (sy0 + sy1) / 2
    return this.fitCache
  }

  // ---------------------------------------------------------------- drawing

  private labelAlpha(k: number): number {
    const fadeAt = -1.4 + this.display.textFade * 0.45
    return clamp((Math.log2(k) - fadeAt) / 0.6, 0, 1)
  }

  /** fill the per-frame parameters (no allocations) */
  private prepareFrame(): void {
    const fp = this.fp
    const k = this.cam.k
    const fade = this.hoverFade
    fp.width = this.width
    fp.height = this.height
    fp.dpr = this.dpr
    fp.time = this.now()
    if (k !== this.lastK) {
      this.lastK = k
      this.zoomChangedAt = this.camChangedAt = fp.time
    }
    if (this.cam.x !== this.lastCX || this.cam.y !== this.lastCY) {
      this.lastCX = this.cam.x
      this.lastCY = this.cam.y
      this.camChangedAt = fp.time
    }
    fp.zooming = this.zoomChangedAt >= 0 && fp.time - this.zoomChangedAt < REST_MS
    fp.moving = (this.camChangedAt >= 0 && fp.time - this.camChangedAt < REST_MS) || this.simBusy() || this.appearUntil > fp.time
    fp.fade = fade
    fp.hlSource = this.hlSource && fade > 0 ? this.hlSource.index : -1
    fp.dimNode = 1 - 0.75 * fade
    fp.dimEdge = 1 - 0.8 * fade
    fp.linePx = this.display.linkThickness * clamp(Math.sqrt(k), 0.45, 1.6)
    fp.arrowAlpha = this.display.arrows ? clamp((k - 0.35) / 0.3, 0, 1) : 0
    fp.arrowSize = (clamp(this.display.linkThickness, 0.5, 3) * 3 + 5) / Math.max(k, 0.6)
    const focus = this.focusId ? this.byId.get(this.focusId) : undefined
    fp.focus = focus ? focus.index : -1
    fp.focusAlpha = focus ? (fade > 0 && !this.hlFlag[focus.index] ? fp.dimNode : 1) * 0.45 : 0
    this.collectLabels(focus)
  }

  private collectLabels(focus: GNode | undefined): void {
    const L = this.labels
    L.count = 0
    const k = this.cam.k
    const fade = this.hoverFade
    const base = this.labelAlpha(k)
    if (!(base > 0.01 || fade > 0 || focus)) return
    L.fontPx = BASE_FONT * this.fontScale(k)
    const sc = this.scene
    const fi = focus ? focus.index : -1
    if (fade > 0) for (let j = sc.hlNodeCount - 1; j >= 0 && L.count < MAX_LABELS; j--) this.addLabel(sc.hlNodes[j], base, fi)
    if (focus && !(fade > 0 && this.hlFlag[fi])) this.addLabel(fi, base, fi)
    const rest = fade > 0 ? base * (1 - 0.85 * fade) : base
    if (rest < 0.02) return
    const order = this.labelOrder
    for (let j = 0; j < order.length && L.count < MAX_LABELS; j++) {
      const i = order[j]
      if (i === fi || (fade > 0 && this.hlFlag[i])) continue
      this.addLabel(i, base, fi)
    }
  }

  /** queue node i's label if it is visible enough and on screen */
  private addLabel(i: number, base: number, focus: number): void {
    const fade = this.hoverFade
    const sc = this.scene
    const time = this.fp.time
    let a = base
    const hl = this.hlFlag[i] === 1
    if (fade > 0) a = hl ? Math.max(a, fade) : a * (1 - 0.85 * fade)
    if (i === focus) a = Math.max(a, hl || fade === 0 ? 1 : this.fp.dimNode)
    const t0 = sc.props[2 * i + 1]
    if (t0 > time - APPEAR_MS) a *= clamp((time - t0) / APPEAR_MS, 0, 1)
    if (a < 0.02) return
    const k = this.cam.k
    const sx = sc.pos[2 * i] * k + this.cam.x
    const sy = sc.pos[2 * i + 1] * k + this.cam.y
    if (sx < -200 || sx > this.width + 200 || sy < -40 || sy > this.height + 40) return
    const L = this.labels
    L.idx[L.count] = i
    L.alpha[L.count++] = a
  }

  /** draw the current state; returns true when another frame is needed (labels still rasterizing) */
  private draw(): boolean {
    if (this.renderer.lost) return false
    this.prepareFrame()
    return this.renderer.draw(this.scene, this.fp)
  }

  // ---------------------------------------------------------------- hover / highlight

  private clearHighlight(): void {
    if (!this.hlSource) return
    const sc = this.scene
    for (let j = 0; j < sc.hlNodeCount; j++) this.hlFlag[sc.hlNodes[j]] = 0
    sc.hlNodeCount = sc.hlEdgeCount = 0
    sc.dirty |= DIRTY_HL
    this.hlSource = null
  }

  private flagHighlight(n: GNode): void {
    this.clearHighlight()
    const sc = this.scene
    const i = n.index
    const a0 = this.adjStart[i]
    const a1 = this.adjStart[i + 1]
    const deg = a1 - a0
    if (sc.hlNodes.length < deg + 1) sc.hlNodes = new Uint32Array(Math.max(deg + 1, sc.hlNodes.length * 2))
    if (sc.hlEdges.length < deg * 2) sc.hlEdges = new Uint32Array(Math.max(deg * 2, sc.hlEdges.length * 2))
    let c = 0
    for (let a = a0; a < a1; a++) {
      const nb = this.adjNode[a]
      const e = this.adjEdge[a]
      sc.hlNodes[c] = nb
      sc.hlEdges[2 * c] = sc.edges[2 * e]
      sc.hlEdges[2 * c + 1] = sc.edges[2 * e + 1]
      this.hlFlag[nb] = 1
      c++
    }
    // the hovered node last, so it is drawn on top of its neighbours
    sc.hlNodes[c] = i
    this.hlFlag[i] = 1
    sc.hlNodeCount = c + 1
    sc.hlEdgeCount = c
    sc.dirty |= DIRTY_HL
    this.hlSource = n
  }

  private setHover(n: GNode | null): void {
    if (n === this.hover) return
    this.hover = n
    if (n) this.flagHighlight(n)
    this.updateCursor()
    this.invalidate()
  }

  private updateHover(): void {
    if (!this.mouse) return
    this.setHover(this.hitTest(this.mouse.x, this.mouse.y))
  }

  private updateCursor(): void {
    const d = this.drag
    const cursor = d && d.moved ? 'grabbing' : this.hover ? 'pointer' : 'default'
    if (this.canvas.style.cursor !== cursor) this.canvas.style.cursor = cursor
  }

  private hitTest(sx: number, sy: number): GNode | null {
    const sc = this.scene
    if (!sc.n) return null
    if (this.gridVersion !== this.posVersion) {
      this.grid.build(sc.pos, sc.props, sc.n)
      this.gridVersion = this.posVersion
    }
    const k = this.cam.k
    const i = this.grid.query((sx - this.cam.x) / k, (sy - this.cam.y) / k, 3 / k, MIN_SCREEN_R / k, sc.pos, sc.props)
    return i >= 0 ? this.nodes[i] : null
  }

  // ---------------------------------------------------------------- input

  private localPos(e: MouseEvent): { x: number; y: number } {
    const rect = this.canvas.getBoundingClientRect()
    return { x: e.clientX - rect.left, y: e.clientY - rect.top }
  }

  private onPointerDown = (e: PointerEvent): void => {
    if (e.button !== 0 && e.button !== 1) return
    if (e.button === 1) e.preventDefault()
    const { x, y } = this.localPos(e)
    this.mouse = { x, y }
    const node = this.hitTest(x, y)
    this.canvas.setPointerCapture(e.pointerId)
    this.drag = { pointerId: e.pointerId, button: e.button, startX: x, startY: y, lastX: x, lastY: y, node, moved: false }
    if (node) this.setHover(node)
  }

  private onPointerMove = (e: PointerEvent): void => {
    const { x, y } = this.localPos(e)
    this.mouse = { x, y }
    const d = this.drag
    if (!d || d.pointerId !== e.pointerId) {
      this.updateHover()
      // present a frame for every pointer move (pointer events are frame-aligned, so at most one cheap redraw per
      // display frame): an idle canvas would otherwise wait for the compositor's idle pacing before showing the
      // next hover change
      this.invalidate()
      return
    }
    if (!d.moved && Math.hypot(x - d.startX, y - d.startY) > 3) {
      d.moved = true
      if (d.node) this.autoFit = false
      this.updateCursor()
    }
    if (!d.moved) return
    if (d.node) {
      // move the node right away; the simulation follows with the pin
      const wx = (x - this.cam.x) / this.cam.k
      const wy = (y - this.cam.y) / this.cam.k
      this.dragPos.x = wx
      this.dragPos.y = wy
      const sc = this.scene
      sc.pos[2 * d.node.index] = wx
      sc.pos[2 * d.node.index + 1] = wy
      sc.dirty |= DIRTY_POS
      this.posVersion++
      this.sim.send({ t: 'drag', seq: ++this.simSeq, i: d.node.index, x: wx, y: wy })
      this.simRunning = true
    } else {
      this.cam.x += x - d.lastX
      this.cam.y += y - d.lastY
      this.autoFit = false
    }
    d.lastX = x
    d.lastY = y
    this.invalidate()
  }

  private onPointerUp = (e: PointerEvent): void => {
    const d = this.drag
    if (!d || d.pointerId !== e.pointerId) return
    this.drag = null
    if (this.canvas.hasPointerCapture(e.pointerId)) this.canvas.releasePointerCapture(e.pointerId)
    if (d.node && d.moved) {
      this.sim.send({ t: 'release', seq: ++this.simSeq, i: d.node.index, alpha: 0.12 })
      this.simRunning = true
    } else if (d.node && !d.moved && e.type === 'pointerup') {
      this.cb.onClick?.(d.node, e)
    }
    this.updateHover()
    this.updateCursor()
    this.invalidate()
  }

  private onPointerLeave = (): void => {
    if (this.drag) return
    this.mouse = null
    this.setHover(null)
  }

  private onWheel = (e: WheelEvent): void => {
    e.preventDefault()
    const { x, y } = this.localPos(e)
    let dy = e.deltaY
    if (e.deltaMode === 1) dy *= 16
    else if (e.deltaMode === 2) dy *= this.height
    // ctrlKey is set for trackpad pinch gestures
    const factor = Math.exp(-dy * (e.ctrlKey ? 0.01 : 0.0018))
    this.zoomAt(x, y, factor)
  }

  private zoomAt(x: number, y: number, factor: number): void {
    const k = clamp(this.cam.k * factor, MIN_K, MAX_K)
    const f = k / this.cam.k
    this.cam.x = x - (x - this.cam.x) * f
    this.cam.y = y - (y - this.cam.y) * f
    this.cam.k = k
    this.autoFit = false
    this.invalidate()
  }

  private onContextMenu = (e: MouseEvent): void => {
    e.preventDefault()
    const { x, y } = this.localPos(e)
    const node = this.hitTest(x, y)
    if (node) this.cb.onContextMenu?.(node, e)
  }
}

function equalPrefix(a: Uint32Array, b: Uint32Array, len: number): boolean {
  if (b.length < len) return false
  for (let i = 0; i < len; i++) if (a[i] !== b[i]) return false
  return true
}
