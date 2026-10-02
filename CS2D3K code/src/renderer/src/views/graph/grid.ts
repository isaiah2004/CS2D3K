// Uniform spatial grid over node positions for hit-testing (rebuilt lazily when positions changed).
export class SpatialGrid {
  private start = new Int32Array(0)
  private items = new Int32Array(0)
  private x0 = 0
  private y0 = 0
  private cs = 1
  private gw = 0
  private gh = 0
  private maxR = 0

  /** `props` holds (radius, …) pairs per node */
  build(pos: Float32Array, props: Float32Array, n: number): void {
    let x0 = Infinity
    let y0 = Infinity
    let x1 = -Infinity
    let y1 = -Infinity
    let maxR = 0
    for (let i = 0; i < n; i++) {
      const x = pos[2 * i]
      const y = pos[2 * i + 1]
      if (x < x0) x0 = x
      if (x > x1) x1 = x
      if (y < y0) y0 = y
      if (y > y1) y1 = y
      if (props[2 * i] > maxR) maxR = props[2 * i]
    }
    if (!n || !Number.isFinite(x0 + x1 + y0 + y1)) {
      this.gw = this.gh = 0
      return
    }
    const w = Math.max(1, x1 - x0)
    const h = Math.max(1, y1 - y0)
    // ~1 node per cell on average
    let cs = Math.sqrt((w * h) / n)
    cs = Math.max(cs, w / 2048, h / 2048, 1e-3)
    const gw = Math.floor(w / cs) + 1
    const gh = Math.floor(h / cs) + 1
    const cells = gw * gh
    if (this.start.length < cells + 1) this.start = new Int32Array(cells + 1)
    else this.start.fill(0, 0, cells + 1)
    if (this.items.length < n) this.items = new Int32Array(n)
    const start = this.start
    for (let i = 0; i < n; i++) start[this.cell(pos[2 * i], pos[2 * i + 1], x0, y0, cs, gw) + 1]++
    for (let c = 0; c < cells; c++) start[c + 1] += start[c]
    // fill using start[c] as a cursor, then shift back
    for (let i = 0; i < n; i++) this.items[start[this.cell(pos[2 * i], pos[2 * i + 1], x0, y0, cs, gw)]++] = i
    for (let c = cells; c > 0; c--) start[c] = start[c - 1]
    start[0] = 0
    this.x0 = x0
    this.y0 = y0
    this.cs = cs
    this.gw = gw
    this.gh = gh
    this.maxR = maxR
  }

  private cell(x: number, y: number, x0: number, y0: number, cs: number, gw: number): number {
    return Math.floor((y - y0) / cs) * gw + Math.floor((x - x0) / cs)
  }

  /** closest node whose (radius, at least minR) + slack disc contains the point, or -1 */
  query(wx: number, wy: number, slack: number, minR: number, pos: Float32Array, props: Float32Array): number {
    if (!this.gw) return -1
    const R = Math.max(this.maxR, minR) + slack
    const cs = this.cs
    const cx0 = Math.max(0, Math.floor((wx - R - this.x0) / cs))
    const cx1 = Math.min(this.gw - 1, Math.floor((wx + R - this.x0) / cs))
    const cy0 = Math.max(0, Math.floor((wy - R - this.y0) / cs))
    const cy1 = Math.min(this.gh - 1, Math.floor((wy + R - this.y0) / cs))
    let best = -1
    let bestD = Infinity
    for (let cy = cy0; cy <= cy1; cy++) {
      const row = cy * this.gw
      for (let cx = cx0; cx <= cx1; cx++) {
        const c = row + cx
        for (let j = this.start[c], e = this.start[c + 1]; j < e; j++) {
          const i = this.items[j]
          const r = (props[2 * i] > minR ? props[2 * i] : minR) + slack
          const dx = pos[2 * i] - wx
          if (dx > r || dx < -r) continue
          const dy = pos[2 * i + 1] - wy
          if (dy > r || dy < -r) continue
          const d = dx * dx + dy * dy
          if (d <= r * r && d < bestD) {
            bestD = d
            best = i
          }
        }
      }
    }
    return best
  }
}
