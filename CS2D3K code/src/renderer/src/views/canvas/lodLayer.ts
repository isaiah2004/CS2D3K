// Canvas layer of the canvas engine: cards that are not in the DOM (a huge board zoomed out, or cards still mounting)
// drawn as lightweight placeholders into one <canvas>.
//
// Why: Chrome re-layerizes the board's paint chunks on every camera frame at a cost proportional to the mounted card
// elements (their clips and transforms), so the DOM can't pan thousands of cards at high frame rates; and redrawing a
// 2D canvas every frame re-uploads all its geometry to the GPU process. Instead the layer renders once into a canvas
// placed in *world* space inside the camera-transformed world element: the compositor pans and zooms it like any
// layer, with no per-frame work. It re-renders only when its content changes, when the view leaves the rendered region,
// or after a zoom settles (crisp again).
import type { CanvasNode, Rect } from './model'
import type { EdgeEntry } from './edges'

/** How a card looks as a placeholder. Extensions provide it per node type (CanvasExtension.nodeLod). */
export interface LodNodeStyle {
  title?: string
  /** small label above the title (e.g. the kind), drawn in the accent color */
  label?: string
  /** CSS color: top stripe + tint for cards, tint + border for back-layer boxes */
  accent?: string
  /** CSS color of the border (default: the card border, or the node's color) */
  border?: string
  /** title above a back-layer box (group label / zone header) */
  header?: string
  dim?: boolean
  radius?: number
  /** monospace title (code) */
  mono?: boolean
  /** freehand stroke instead of a box: flattened points relative to the node's x/y */
  points?: number[]
  stroke?: string
  strokeWidth?: number
}

export interface LodEdgeStyle {
  color?: string
  dashed?: boolean
  dim?: boolean
}

export interface LodScene {
  /** nodes drawn by the layer, z-ordered */
  nodes: CanvasNode[]
  layerOf(n: CanvasNode): 'back' | 'normal' | 'front'
  style(n: CanvasNode): LodNodeStyle
  selection: ReadonlySet<string>
  edges: EdgeEntry[]
  edgeStyle(e: EdgeEntry): LodEdgeStyle
}

const DIM_CARD = 0.14
const DIM_BACK = 0.3
const DIM_EDGE = 0.07
/** max backing-store size per side (px) */
const MAX_PX = 4096

export class LodLayer {
  private ctx: CanvasRenderingContext2D
  private colors = new Map<string, string>()
  private probe: HTMLElement | null = null
  private fonts: { text: string; mono: string } | null = null
  private wraps = new WeakMap<CanvasNode, { key: string; lines: string[] }>()
  /** what is currently rendered: world region + the zoom it was rendered for */
  rendered: { region: Rect; zoom: number } | null = null

  constructor(
    readonly canvas: HTMLCanvasElement,
    /** element whose CSS variables apply (the engine root) */
    private host: HTMLElement
  ) {
    this.ctx = canvas.getContext('2d')!
  }

  /** theme changed: re-resolve colors and fonts */
  resetTheme(): void {
    this.colors.clear()
    this.fonts = null
  }

  /** resolve a CSS color expression (var(), color-mix(), names) against the host's variables */
  color(expr: string): string {
    let c = this.colors.get(expr)
    if (c === undefined) {
      if (!this.probe) {
        this.probe = document.createElement('span')
        this.probe.style.cssText = 'position:absolute;width:0;height:0;visibility:hidden;pointer-events:none'
      }
      if (this.probe.parentElement !== this.host) this.host.appendChild(this.probe)
      this.probe.style.color = ''
      this.probe.style.color = expr
      c = getComputedStyle(this.probe).color || '#888'
      this.colors.set(expr, c)
    }
    return c
  }

  private font(): { text: string; mono: string } {
    if (!this.fonts) {
      const cs = getComputedStyle(this.host)
      this.fonts = {
        text: cs.getPropertyValue('--font-interface').trim() || cs.getPropertyValue('--font-text').trim() || 'sans-serif',
        mono: cs.getPropertyValue('--font-monospace').trim() || 'monospace'
      }
    }
    return this.fonts
  }

  hide(): void {
    if (!this.rendered) return
    this.rendered = null
    this.canvas.style.display = 'none'
    this.canvas.width = 1
    this.canvas.height = 1
  }

  /** render `scene` over the world `region` for viewing at `zoom` */
  render(scene: LodScene, region: Rect, zoom: number): void {
    if (!scene.nodes.length && !scene.edges.length) {
      this.hide()
      return
    }
    const dpr = window.devicePixelRatio || 1
    const s = Math.max(0.01, Math.min(zoom * dpr, MAX_PX / Math.max(1, region.width), MAX_PX / Math.max(1, region.height)))
    const c = this.canvas
    const pw = Math.max(1, Math.ceil(region.width * s))
    const ph = Math.max(1, Math.ceil(region.height * s))
    if (c.width !== pw || c.height !== ph) {
      c.width = pw
      c.height = ph
    }
    const st = c.style
    st.display = ''
    st.left = `${region.x}px`
    st.top = `${region.y}px`
    st.width = `${pw / s}px`
    st.height = `${ph / s}px`
    const ctx = this.ctx
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, pw, ph)
    ctx.setTransform(s, 0, 0, s, -region.x * s, -region.y * s)
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    this.rendered = { region, zoom }

    const visible = (n: CanvasNode, above = 0): boolean =>
      n.x < region.x + region.width && n.x + n.width > region.x && n.y - above < region.y + region.height && n.y + n.height > region.y
    const nodes = scene.nodes.filter((n) => visible(n, 120))
    const back = nodes.filter((n) => scene.layerOf(n) === 'back')
    const cards = nodes.filter((n) => scene.layerOf(n) !== 'back')
    this.drawBoxes(scene, back, zoom, true)
    this.drawEdges(scene, region, zoom)
    this.drawBoxes(scene, cards, zoom, false)
    this.drawText(scene, nodes, zoom)
    ctx.globalAlpha = 1
  }

  // ---------------------------------------------------------------- shapes

  private drawBoxes(scene: LodScene, nodes: CanvasNode[], z: number, back: boolean): void {
    const ctx = this.ctx
    const sel = 'var(--interactive-accent)'
    for (const n of nodes) {
      const st = scene.style(n)
      const selected = scene.selection.has(n.id)
      if (st.points) {
        const pts = st.points
        if (pts.length < 4) continue
        ctx.globalAlpha = st.dim ? DIM_CARD : 1
        ctx.strokeStyle = this.color(st.stroke ?? 'var(--text-normal)')
        ctx.lineWidth = Math.max(st.strokeWidth ?? 3, 1 / z)
        ctx.beginPath()
        ctx.moveTo(n.x + pts[0], n.y + pts[1])
        for (let i = 2; i + 1 < pts.length; i += 2) ctx.lineTo(n.x + pts[i], n.y + pts[i + 1])
        ctx.stroke()
        continue
      }
      // rounded corners only where they are visible (plain rects are much cheaper to rasterize)
      const radius = st.radius ?? (back ? 12 : 8)
      const r = radius * z >= 1.5 ? Math.min(radius, n.width / 2, n.height / 2) : 0
      const shape = (): void => {
        ctx.beginPath()
        if (r) ctx.roundRect(n.x, n.y, n.width, n.height, r)
        else ctx.rect(n.x, n.y, n.width, n.height)
      }
      const tint = st.accent ?? (typeof n.color === 'string' && n.color ? n.color : undefined)
      if (back) {
        const a = st.dim ? DIM_BACK : 1
        shape()
        ctx.globalAlpha = (tint ? 0.06 : 0.035) * a
        ctx.fillStyle = this.color(tint ?? 'var(--text-normal)')
        ctx.fill()
        ctx.globalAlpha = a
        ctx.strokeStyle = this.color(selected ? sel : (st.border ?? (tint ? `color-mix(in srgb, ${tint} 45%, transparent)` : 'var(--canvas-node-border)')))
        ctx.lineWidth = Math.max(2, 0.75 / z)
        ctx.stroke()
        continue
      }
      const a = st.dim ? DIM_CARD : 1
      shape()
      ctx.globalAlpha = a
      ctx.fillStyle = this.color('var(--canvas-card)')
      ctx.fill()
      if (tint) {
        ctx.globalAlpha = 0.08 * a
        ctx.fillStyle = this.color(tint)
        ctx.fill()
        ctx.globalAlpha = a
      }
      ctx.strokeStyle = this.color(selected ? sel : (st.border ?? (typeof n.color === 'string' && n.color ? n.color : 'var(--canvas-node-border)')))
      ctx.lineWidth = selected ? Math.max(3, 2 / z) : Math.max(2, 0.75 / z)
      ctx.stroke()
      if (st.accent) {
        ctx.fillStyle = this.color(st.accent)
        ctx.fillRect(n.x + r * 0.6, n.y, Math.max(0, n.width - r * 1.2), Math.min(n.height / 4, Math.max(3, 1.5 / z)))
      }
    }
    ctx.globalAlpha = 1
  }

  private drawEdges(scene: LodScene, region: Rect, z: number): void {
    if (!scene.edges.length) return
    const ctx = this.ctx
    // batch by style: one path per color / dash / dim
    const groups = new Map<string, { color: string; alpha: number; dashed: boolean; list: EdgeEntry[] }>()
    for (const en of scene.edges) {
      const b = en.box
      if (b.x > region.x + region.width || b.x + b.width < region.x || b.y > region.y + region.height || b.y + b.height < region.y) continue
      const st = scene.edgeStyle(en)
      const color = scene.selection.has(en.edge.id) ? 'var(--interactive-accent)' : (st.color ?? 'var(--canvas-edge-color)')
      const alpha = st.dim ? DIM_EDGE : 1
      const k = `${color}|${alpha}|${st.dashed ? 1 : 0}`
      let g = groups.get(k)
      if (!g) groups.set(k, (g = { color, alpha, dashed: !!st.dashed, list: [] }))
      g.list.push(en)
    }
    ctx.lineWidth = Math.max(2.5, 1.5 / z)
    for (const g of groups.values()) {
      ctx.globalAlpha = g.alpha
      const color = this.color(g.color)
      ctx.strokeStyle = color
      ctx.fillStyle = color
      ctx.setLineDash(g.dashed ? [9, 7] : [])
      ctx.beginPath()
      for (const en of g.list) {
        const c = en.g.curve
        ctx.moveTo(c[0], c[1])
        ctx.bezierCurveTo(c[2], c[3], c[4], c[5], c[6], c[7])
      }
      ctx.stroke()
      ctx.setLineDash([])
      ctx.beginPath()
      for (const en of g.list)
        for (const pts of [en.g.fromArrowPts, en.g.toArrowPts]) {
          if (!pts) continue
          ctx.moveTo(pts[0], pts[1])
          ctx.lineTo(pts[2], pts[3])
          ctx.lineTo(pts[4], pts[5])
          ctx.closePath()
        }
      ctx.fill()
    }
    ctx.globalAlpha = 1
  }

  // ---------------------------------------------------------------- text

  private drawText(scene: LodScene, nodes: CanvasNode[], z: number): void {
    const ctx = this.ctx
    const fonts = this.font()
    const inv = 1 / z
    // same sizes as the zoomed-out DOM cards (.is-zoomed-out): constant on screen until a cap, then shrinking
    const fsTitle = 13 * Math.min(Math.max(inv * 0.72, 1), 3)
    const fsLabel = 10 * Math.min(Math.max(inv * 0.6, 1), 2.4)
    const fsHeader = 15.5 * Math.min(Math.max(inv, 1), 3.4)
    const showTitles = fsTitle * z >= 4.5
    const showHeaders = fsHeader * z >= 4
    if (!showTitles && !showHeaders) return
    ctx.textBaseline = 'top'
    const normal = this.color('var(--text-normal)')
    const muted = this.color('var(--text-muted)')
    for (const n of nodes) {
      const back = scene.layerOf(n) === 'back'
      if (back ? !showHeaders : !showTitles) continue
      const st = scene.style(n)
      ctx.globalAlpha = st.dim ? (back ? DIM_BACK : DIM_CARD) : 1
      if (back) {
        if (!st.header) continue
        ctx.font = `700 ${fsHeader}px ${fonts.text}`
        ctx.fillStyle = normal
        ctx.fillText(clip(st.header, n.width + 60, fsHeader), n.x + 6, n.y - fsHeader * 1.45)
        continue
      }
      const padX = 13
      let y = n.y + 10
      const bottom = n.y + n.height - 8
      if (st.label && y + fsLabel * 1.3 <= bottom) {
        ctx.font = `650 ${fsLabel}px ${fonts.text}`
        ctx.fillStyle = st.accent ? this.color(st.accent) : muted
        ctx.fillText(clip(st.label, n.width - padX * 2, fsLabel), n.x + padX, y)
        y += fsLabel * 1.7
      }
      if (!st.title) continue
      const lineH = fsTitle * 1.3
      const maxLines = Math.min(4, Math.floor((bottom - y) / lineH))
      if (maxLines < 1) continue
      const cpl = Math.max(3, Math.floor((n.width - padX * 2) / (fsTitle * (st.mono ? 0.62 : 0.56))))
      ctx.font = `${st.mono ? 500 : 700} ${fsTitle}px ${st.mono ? fonts.mono : fonts.text}`
      ctx.fillStyle = normal
      for (const l of this.wrap(n, st.title, cpl, maxLines)) {
        ctx.fillText(l, n.x + padX, y)
        y += lineH
      }
    }
    ctx.globalAlpha = 1
  }

  /** word-wrap by estimated characters per line (no text measuring); cached per node */
  private wrap(n: CanvasNode, text: string, cpl: number, maxLines: number): string[] {
    const key = `${cpl}|${maxLines}|${text}`
    const hit = this.wraps.get(n)
    if (hit?.key === key) return hit.lines
    const lines: string[] = []
    let cur = ''
    let cut = false
    for (const word of text.split(/\s+/)) {
      if (!word) continue
      const next = cur ? `${cur} ${word}` : word
      if (next.length <= cpl) {
        cur = next
        continue
      }
      if (cur) lines.push(cur)
      if (lines.length >= maxLines) {
        cut = true
        cur = ''
        break
      }
      cur = word.length > cpl ? word.slice(0, cpl - 1) + '…' : word
    }
    if (cur) lines.push(cur)
    if (lines.length > maxLines) {
      lines.length = maxLines
      cut = true
    }
    if (cut) {
      const last = lines[maxLines - 1]
      lines[maxLines - 1] = (last.length >= cpl ? last.slice(0, cpl - 1) : last) + '…'
    }
    this.wraps.set(n, { key, lines })
    return lines
  }
}

/** single line, cut to an estimated width */
function clip(s: string, maxW: number, fs: number): string {
  const max = Math.max(1, Math.floor(maxW / (fs * 0.58)))
  return s.length > max ? s.slice(0, Math.max(1, max - 1)) + '…' : s
}
