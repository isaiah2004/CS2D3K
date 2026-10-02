// Canvas 2D fallback renderer, used when WebGL2 is unavailable. Same output as the WebGL renderer, but every
// frame is re-recorded as 2D paths, so it is only fast enough for small and medium graphs.
import { cssRgba, DIRTY_COLORS, type FrameParams, type Renderer, type Scene } from './scene'

const TAU = Math.PI * 2

export class CanvasRenderer implements Renderer {
  readonly kind = 'canvas2d'
  lost = false
  onRestore: (() => void) | null = null
  private canvas: HTMLCanvasElement
  private ctx: CanvasRenderingContext2D
  private width = 0
  private height = 0
  private dpr = 1
  /** node colors as CSS strings, rebuilt when the color array changes */
  private colorCss: string[] = []
  private colorsFor: Uint8Array | null = null

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas
    this.ctx = canvas.getContext('2d')!
  }

  resize(width: number, height: number, dpr: number): void {
    this.width = width
    this.height = height
    this.dpr = dpr
  }

  resetLabels(): void {}
  invalidate(): void {}
  finish(): void {}
  destroy(): void {}

  readPixel(scene: Scene, f: FrameParams, x: number, y: number): [number, number, number] {
    this.draw(scene, f)
    const d = this.ctx.getImageData(Math.round(x * this.dpr), Math.round(y * this.dpr), 1, 1).data
    return [d[0], d[1], d[2]]
  }

  draw(scene: Scene, f: FrameParams): boolean {
    const { ctx, dpr, width: w, height: h } = this
    const { cam, fade } = f
    const k = cam.k
    const { pos, props, edges } = scene
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.globalAlpha = 1
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height)
    if (!scene.n) return false
    if (this.colorsFor !== scene.colors || scene.dirty & DIRTY_COLORS) this.rebuildColors(scene)
    scene.dirty = 0
    ctx.setTransform(dpr * k, 0, 0, dpr * k, dpr * cam.x, dpr * cam.y)

    const m = 40 / k
    const vx0 = -cam.x / k - m
    const vy0 = -cam.y / k - m
    const vx1 = (w - cam.x) / k + m
    const vy1 = (h - cam.y) / k + m
    const minR = f.minR / k
    const appear = (i: number): number => Math.min(1, Math.max(0, (f.time - props[2 * i + 1]) / 450))
    const radius = (i: number): number => Math.max(props[2 * i], minR)
    const edgeInView = (s: number, t: number): boolean => {
      const sx = pos[2 * s]
      const sy = pos[2 * s + 1]
      const tx = pos[2 * t]
      const ty = pos[2 * t + 1]
      return !((sx < vx0 && tx < vx0) || (sx > vx1 && tx > vx1) || (sy < vy0 && ty < vy0) || (sy > vy1 && ty > vy1))
    }
    const segs = (list: Uint32Array, count: number): void => {
      ctx.beginPath()
      for (let e = 0; e < count; e++) {
        const s = list[2 * e] & 0x3fffffff
        const t = list[2 * e + 1]
        if (!edgeInView(s, t)) continue
        ctx.moveTo(pos[2 * s], pos[2 * s + 1])
        ctx.lineTo(pos[2 * t], pos[2 * t + 1])
      }
    }
    const hl = fade > 0 && f.hlSource >= 0

    // ---- links
    ctx.lineCap = 'round'
    ctx.lineWidth = f.linePx / k
    ctx.strokeStyle = cssRgba(f.line)
    ctx.globalAlpha = f.dimEdge
    segs(edges, scene.m)
    ctx.stroke()
    if (hl) {
      ctx.lineWidth = (f.linePx * (1 + 0.5 * fade)) / k
      ctx.globalAlpha = 1
      ctx.strokeStyle = mixCss(f.line, f.accent, fade)
      segs(scene.hlEdges, scene.hlEdgeCount)
      ctx.stroke()
    }

    // ---- arrows
    if (f.arrowAlpha > 0) {
      const size = f.arrowSize
      const arrows = (list: Uint32Array, count: number, color: string, alpha: number): void => {
        ctx.globalAlpha = alpha
        ctx.fillStyle = color
        ctx.beginPath()
        for (let e = 0; e < count; e++) {
          const dir = list[2 * e] >>> 30
          const s = list[2 * e] & 0x3fffffff
          const t = list[2 * e + 1]
          if (!dir || !edgeInView(s, t)) continue
          if (dir & 1) this.arrowPath(pos, s, t, radius(t), size, k)
          if (dir & 2) this.arrowPath(pos, t, s, radius(s), size, k)
        }
        ctx.fill()
      }
      arrows(edges, scene.m, cssRgba(f.line), f.arrowAlpha * f.dimEdge)
      if (hl) arrows(scene.hlEdges, scene.hlEdgeCount, mixCss(f.line, f.accent, fade), f.arrowAlpha)
    }

    // ---- nodes (one path per color)
    const node = (i: number, alpha: number, color: string): void => {
      const x = pos[2 * i]
      const y = pos[2 * i + 1]
      const a = appear(i)
      const r = radius(i) * (0.5 + 0.5 * a)
      if (x + r < vx0 || x - r > vx1 || y + r < vy0 || y - r > vy1) return
      ctx.globalAlpha = alpha * a
      ctx.fillStyle = color
      ctx.beginPath()
      ctx.arc(x, y, r, 0, TAU)
      ctx.fill()
    }
    let prev = ''
    ctx.globalAlpha = f.dimNode
    ctx.beginPath()
    for (let i = 0; i < scene.n; i++) {
      const a = appear(i)
      if (a < 1) continue
      const c = this.colorCss[i]
      if (c !== prev) {
        if (prev) ctx.fill()
        ctx.fillStyle = prev = c
        ctx.beginPath()
      }
      const x = pos[2 * i]
      const y = pos[2 * i + 1]
      const r = radius(i)
      if (x + r < vx0 || x - r > vx1 || y + r < vy0 || y - r > vy1) continue
      ctx.moveTo(x + r, y)
      ctx.arc(x, y, r, 0, TAU)
    }
    if (prev) ctx.fill()
    for (let i = 0; i < scene.n; i++) if (props[2 * i + 1] > f.time - 450) node(i, f.dimNode, this.colorCss[i])
    if (hl) {
      for (let j = 0; j < scene.hlNodeCount; j++) {
        const i = scene.hlNodes[j]
        node(i, 1, i === f.hlSource ? mixCss(rgbaOf(scene.colors, i), f.accent, fade) : this.colorCss[i])
      }
    }
    if (f.focus >= 0 && f.focusAlpha > 0) {
      const i = f.focus
      ctx.globalAlpha = f.focusAlpha
      ctx.strokeStyle = cssRgba(f.accent)
      ctx.lineWidth = 1.5 / k
      ctx.beginPath()
      ctx.arc(pos[2 * i], pos[2 * i + 1], radius(i) + 3 / k, 0, TAU)
      ctx.stroke()
    }

    // ---- labels (screen space)
    const L = f.labels
    if (L.count) {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.font = `${L.fontPx.toFixed(1)}px ${L.font}`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'top'
      ctx.fillStyle = cssRgba(f.text)
      ctx.strokeStyle = cssRgba(f.bg)
      ctx.lineWidth = 3
      ctx.lineJoin = 'round'
      for (let j = L.count - 1; j >= 0; j--) {
        const i = L.idx[j]
        const sx = pos[2 * i] * k + cam.x
        const ty = pos[2 * i + 1] * k + cam.y + radius(i) * k + 4
        const label = scene.nodes[i].label
        ctx.globalAlpha = L.alpha[j] * 0.85
        ctx.strokeText(label, sx, ty)
        ctx.globalAlpha = L.alpha[j]
        ctx.fillText(label, sx, ty)
      }
    }
    ctx.globalAlpha = 1
    return false
  }

  private rebuildColors(scene: Scene): void {
    const c = scene.colors
    this.colorCss.length = scene.n
    for (let i = 0; i < scene.n; i++) this.colorCss[i] = `rgba(${c[4 * i]},${c[4 * i + 1]},${c[4 * i + 2]},${c[4 * i + 3] / 255})`
    this.colorsFor = c
  }

  private arrowPath(pos: Float32Array, from: number, to: number, r: number, size: number, k: number): void {
    const fx = pos[2 * from]
    const fy = pos[2 * from + 1]
    const tx0 = pos[2 * to]
    const ty0 = pos[2 * to + 1]
    const dx = tx0 - fx
    const dy = ty0 - fy
    const len = Math.hypot(dx, dy)
    if (len < r + size) return
    const ux = dx / len
    const uy = dy / len
    const tx = tx0 - ux * (r + 1 / k)
    const ty = ty0 - uy * (r + 1 / k)
    const bx = tx - ux * size
    const by = ty - uy * size
    const hw = size * 0.45
    this.ctx.moveTo(tx, ty)
    this.ctx.lineTo(bx - uy * hw, by + ux * hw)
    this.ctx.lineTo(bx + uy * hw, by - ux * hw)
    this.ctx.closePath()
  }
}

function rgbaOf(c: Uint8Array, i: number): [number, number, number, number] {
  return [c[4 * i] / 255, c[4 * i + 1] / 255, c[4 * i + 2] / 255, c[4 * i + 3] / 255]
}

function mixCss(a: number[], b: number[], t: number): string {
  return cssRgba([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t, a[3] + (b[3] - a[3]) * t])
}
