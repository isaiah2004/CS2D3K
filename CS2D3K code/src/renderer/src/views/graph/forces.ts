// Force simulation over flat typed arrays: the same model and integration as d3-force (many-body with a
// Barnes–Hut quadtree, link, center, x / y and collide forces, velocity decay), several times faster on large
// graphs because nothing is an object, the quadtree lives in preallocated interleaved arrays, nodes are visited
// in spatial order (consecutive nodes walk the same quads) and collisions use a uniform grid.
// Semantics follow d3-force v3 force by force so the settings panel behaves exactly as before.

/** deterministic LCG (as in d3-force) so the same vault gets the same layout */
export class Rng {
  private s: number
  constructor(seed = 1) {
    this.s = seed >>> 0
  }
  next(): number {
    this.s = (1664525 * this.s + 1013904223) >>> 0
    return this.s / 4294967296
  }
}

const MAX_DEPTH = 40
/** interleaved quad record: x0, y0, width, center of mass x / y, total strength */
const Q = 6

/** quadtree in flat arrays: quads are created parent-first, so reverse index order is a valid post-order */
class QuadTree {
  count = 0
  /** Q floats per quad */
  data = new Float64Array(0)
  /** 4 children per quad (-1 = none) */
  child = new Int32Array(0)
  /** first point of a leaf (-1 = none / internal quad) */
  point = new Int32Array(0)
  internal = new Uint8Array(0)
  /** coincident points chained per leaf */
  next = new Int32Array(0)
  /** points in depth-first leaf order (spatially coherent) */
  order = new Int32Array(0)

  private ensure(q: number): void {
    if (q <= this.point.length) return
    const cap = Math.max(q, this.point.length * 2, 1024)
    const data = new Float64Array(cap * Q)
    data.set(this.data)
    this.data = data
    const child = new Int32Array(cap * 4)
    child.set(this.child)
    this.child = child
    const point = new Int32Array(cap)
    point.set(this.point)
    this.point = point
    const internal = new Uint8Array(cap)
    internal.set(this.internal)
    this.internal = internal
  }

  private newQuad(x0: number, y0: number, w: number): number {
    const q = this.count++
    this.ensure(this.count)
    const c = 4 * q
    this.child[c] = this.child[c + 1] = this.child[c + 2] = this.child[c + 3] = -1
    this.point[q] = -1
    this.internal[q] = 0
    const d = q * Q
    this.data[d] = x0
    this.data[d + 1] = y0
    this.data[d + 2] = w
    return q
  }

  build(n: number, xs: Float64Array, ys: Float64Array): void {
    if (this.next.length < n) {
      this.next = new Int32Array(Math.max(n, this.next.length * 2))
      this.order = new Int32Array(this.next.length)
    }
    this.count = 0
    if (!n) return
    let x0 = Infinity
    let y0 = Infinity
    let x1 = -Infinity
    let y1 = -Infinity
    for (let i = 0; i < n; i++) {
      const x = xs[i]
      const y = ys[i]
      if (x < x0) x0 = x
      if (x > x1) x1 = x
      if (y < y0) y0 = y
      if (y > y1) y1 = y
    }
    const w = Math.max(x1 - x0, y1 - y0, 1e-6) * 1.0001
    this.newQuad(x0, y0, w)
    const next = this.next
    for (let i = 0; i < n; i++) {
      const x = xs[i]
      const y = ys[i]
      next[i] = -1
      let q = 0
      let depth = 0
      for (;;) {
        const d = q * Q
        if (this.internal[q]) {
          const h = this.data[d + 2] / 2
          const right = x >= this.data[d] + h ? 1 : 0
          const bottom = y >= this.data[d + 1] + h ? 1 : 0
          const k = 4 * q + (bottom << 1) + right
          const c = this.child[k]
          if (c < 0) {
            const nq = this.newQuad(this.data[d] + right * h, this.data[d + 1] + bottom * h, h)
            this.child[k] = nq
            this.point[nq] = i
            break
          }
          q = c
          depth++
          continue
        }
        const j = this.point[q]
        if (j < 0) {
          this.point[q] = i
          break
        }
        if ((xs[j] === x && ys[j] === y) || depth >= MAX_DEPTH) {
          next[i] = j
          this.point[q] = i
          break
        }
        // split the leaf: push its point one level down, then retry
        this.internal[q] = 1
        this.point[q] = -1
        const h = this.data[d + 2] / 2
        const right = xs[j] >= this.data[d] + h ? 1 : 0
        const bottom = ys[j] >= this.data[d + 1] + h ? 1 : 0
        const nq = this.newQuad(this.data[d] + right * h, this.data[d + 1] + bottom * h, h)
        this.child[4 * q + (bottom << 1) + right] = nq
        this.point[nq] = j
      }
    }
  }

  /** d3 forceManyBody's accumulate: strength sums and |strength|-weighted centers, plus the leaf order */
  aggregate(xs: Float64Array, ys: Float64Array, strength: Float64Array): void {
    const { child, point, internal, data, next } = this
    for (let q = this.count - 1; q >= 0; q--) {
      const d = q * Q
      if (internal[q]) {
        let s = 0
        let wsum = 0
        let x = 0
        let y = 0
        for (let k = 0; k < 4; k++) {
          const c = child[4 * q + k]
          if (c < 0) continue
          const cd = c * Q
          const v = data[cd + 5]
          const a = v < 0 ? -v : v
          if (a) {
            s += v
            wsum += a
            x += a * data[cd + 3]
            y += a * data[cd + 4]
          }
        }
        data[d + 3] = wsum ? x / wsum : data[d] + data[d + 2] / 2
        data[d + 4] = wsum ? y / wsum : data[d + 1] + data[d + 2] / 2
        data[d + 5] = s
      } else {
        let p = point[q]
        let s = 0
        if (p >= 0) {
          data[d + 3] = xs[p]
          data[d + 4] = ys[p]
        }
        while (p >= 0) {
          s += strength[p]
          p = next[p]
        }
        data[d + 5] = s
      }
    }
    // leaves in depth-first order
    const order = this.order
    const stack = STACK
    let o = 0
    let sp = 0
    stack[sp++] = 0
    while (sp > 0) {
      const q = stack[--sp]
      if (internal[q]) {
        for (let k = 3; k >= 0; k--) {
          const c = child[4 * q + k]
          if (c >= 0) stack[sp++] = c
        }
      } else for (let p = point[q]; p >= 0; p = next[p]) order[o++] = p
    }
  }
}

/** traversal stack: depth ≤ MAX_DEPTH, ≤ 4 entries pushed per level */
const STACK = new Int32Array(4 * (MAX_DEPTH + 2))

export class ForceSim {
  n = 0
  x = new Float64Array(0)
  y = new Float64Array(0)
  vx = new Float64Array(0)
  vy = new Float64Array(0)
  /** pinned position (NaN = free) */
  fx = new Float64Array(0)
  fy = new Float64Array(0)
  /** many-body strength per node (negative repels) */
  charge = new Float64Array(0)
  /** collide radius per node (used when collideStrength > 0) */
  radius = new Float64Array(0)

  m = 0
  src = new Uint32Array(0)
  tgt = new Uint32Array(0)
  linkDist = new Float64Array(0)
  linkStrength = new Float64Array(0)
  linkBias = new Float64Array(0)

  alpha = 1
  alphaMin = 0.001
  alphaDecay = 1 - Math.pow(0.001, 1 / 300)
  alphaTarget = 0
  velocityDecay = 0.42
  theta = 0.9
  distanceMin = 1
  distanceMax = Infinity
  /** forceCenter(0, 0) strength (shifts the mean position) */
  centerStrength = 0
  /** forceX(0) / forceY(0) strengths */
  xStrength = 0
  yStrength = 0
  collideStrength = 0

  rng = new Rng(1)
  private tree = new QuadTree()
  private px = new Float64Array(0)
  private py = new Float64Array(0)
  private cellStart = new Int32Array(0)
  private cellItems = new Int32Array(0)
  private cellOf = new Int32Array(0)
  private hist = new Int32Array(256)

  /** allocate for n nodes / m links (contents are undefined until filled) */
  resize(n: number, m: number): void {
    if (this.x.length < n) {
      this.x = new Float64Array(n)
      this.y = new Float64Array(n)
      this.vx = new Float64Array(n)
      this.vy = new Float64Array(n)
      this.fx = new Float64Array(n).fill(NaN)
      this.fy = new Float64Array(n).fill(NaN)
      this.charge = new Float64Array(n)
      this.radius = new Float64Array(n)
      this.px = new Float64Array(n)
      this.py = new Float64Array(n)
      this.cellItems = new Int32Array(n)
      this.cellOf = new Int32Array(n)
    }
    if (this.src.length < m) {
      this.src = new Uint32Array(m)
      this.tgt = new Uint32Array(m)
      this.linkDist = new Float64Array(m)
      this.linkStrength = new Float64Array(m)
      this.linkBias = new Float64Array(m)
    }
    this.n = n
    this.m = m
  }

  /** d3 forceLink defaults: bias = deg(s) / (deg(s) + deg(t)) */
  computeBias(): void {
    const deg = new Float64Array(this.n)
    for (let e = 0; e < this.m; e++) {
      deg[this.src[e]]++
      deg[this.tgt[e]]++
    }
    for (let e = 0; e < this.m; e++) {
      const a = deg[this.src[e]]
      this.linkBias[e] = a / (a + deg[this.tgt[e]])
    }
  }

  running(): boolean {
    return this.n > 0 && (this.alpha >= this.alphaMin || this.alphaTarget > 0)
  }

  tick(): void {
    this.alpha += (this.alphaTarget - this.alpha) * this.alphaDecay
    const alpha = this.alpha
    if (!this.n) return
    this.manyBody(alpha)
    this.links(alpha)
    this.center()
    this.towards(alpha)
    if (this.collideStrength > 0) this.collide()
    const { x, y, vx, vy, fx, fy } = this
    const decay = 1 - this.velocityDecay
    for (let i = 0; i < this.n; i++) {
      if (fx[i] !== fx[i]) x[i] += vx[i] *= decay
      else {
        x[i] = fx[i]
        vx[i] = 0
      }
      if (fy[i] !== fy[i]) y[i] += vy[i] *= decay
      else {
        y[i] = fy[i]
        vy[i] = 0
      }
    }
  }

  private jiggle(): number {
    return (this.rng.next() - 0.5) * 1e-6
  }

  private manyBody(alpha: number): void {
    const { n, x, y, vx, vy, charge } = this
    let any = false
    for (let i = 0; i < n; i++)
      if (charge[i]) {
        any = true
        break
      }
    if (!any) return
    const t = this.tree
    t.build(n, x, y)
    t.aggregate(x, y, charge)
    const theta2 = this.theta * this.theta
    const dMin2 = this.distanceMin * this.distanceMin
    const dMax2 = this.distanceMax * this.distanceMax
    const { child, internal, data, point, next, order } = t
    const stack = STACK
    for (let o = 0; o < n; o++) {
      const i = order[o]
      const xi = x[i]
      const yi = y[i]
      let fxs = 0
      let fys = 0
      let sp = 0
      stack[sp++] = 0
      while (sp > 0) {
        const q = stack[--sp]
        const d = q * Q
        const v = data[d + 5]
        if (!v) continue
        let dx = data[d + 3] - xi
        let dy = data[d + 4] - yi
        let l = dx * dx + dy * dy
        const ww = data[d + 2]
        if (ww * ww < l * theta2) {
          if (l < dMax2) {
            if (dx === 0) (dx = this.jiggle()), (l += dx * dx)
            if (dy === 0) (dy = this.jiggle()), (l += dy * dy)
            if (l < dMin2) l = Math.sqrt(dMin2 * l)
            const f = (v * alpha) / l
            fxs += dx * f
            fys += dy * f
          }
          continue
        }
        if (internal[q]) {
          const c = 4 * q
          let k = child[c + 3]
          if (k >= 0) stack[sp++] = k
          k = child[c + 2]
          if (k >= 0) stack[sp++] = k
          k = child[c + 1]
          if (k >= 0) stack[sp++] = k
          k = child[c]
          if (k >= 0) stack[sp++] = k
          continue
        }
        if (l >= dMax2) continue
        let p = point[q]
        if (p !== i || next[p] >= 0) {
          if (dx === 0) (dx = this.jiggle()), (l += dx * dx)
          if (dy === 0) (dy = this.jiggle()), (l += dy * dy)
          if (l < dMin2) l = Math.sqrt(dMin2 * l)
        }
        while (p >= 0) {
          if (p !== i) {
            const f = (charge[p] * alpha) / l
            fxs += dx * f
            fys += dy * f
          }
          p = next[p]
        }
      }
      vx[i] += fxs
      vy[i] += fys
    }
  }

  private links(alpha: number): void {
    const { src, tgt, linkDist, linkStrength, linkBias, x, y, vx, vy } = this
    for (let e = 0; e < this.m; e++) {
      const s = src[e]
      const t = tgt[e]
      let dx = x[t] + vx[t] - x[s] - vx[s] || this.jiggle()
      let dy = y[t] + vy[t] - y[s] - vy[s] || this.jiggle()
      let l = Math.sqrt(dx * dx + dy * dy)
      l = ((l - linkDist[e]) / l) * alpha * linkStrength[e]
      dx *= l
      dy *= l
      const b = linkBias[e]
      vx[t] -= dx * b
      vy[t] -= dy * b
      vx[s] += dx * (1 - b)
      vy[s] += dy * (1 - b)
    }
  }

  private center(): void {
    if (!this.centerStrength) return
    const { n, x, y } = this
    let sx = 0
    let sy = 0
    for (let i = 0; i < n; i++) {
      sx += x[i]
      sy += y[i]
    }
    sx = (sx / n) * this.centerStrength
    sy = (sy / n) * this.centerStrength
    for (let i = 0; i < n; i++) {
      x[i] -= sx
      y[i] -= sy
    }
  }

  private towards(alpha: number): void {
    const { n, x, y, vx, vy } = this
    const ax = this.xStrength * alpha
    const ay = this.yStrength * alpha
    if (ax) for (let i = 0; i < n; i++) vx[i] -= x[i] * ax
    if (ay) for (let i = 0; i < n; i++) vy[i] -= y[i] * ay
  }

  /**
   * d3 forceCollide (one iteration): every pair i < j closer than ri + rj in predicted positions (x + vx) is
   * pushed apart, weighted by r². Pairs are found with a uniform grid whose cells are twice the 99th percentile
   * radius; the few larger nodes (hubs) search a correspondingly wider neighbourhood themselves.
   */
  private collide(): void {
    const { n, x, y, vx, vy, radius, px, py } = this
    let x0 = Infinity
    let y0 = Infinity
    let x1 = -Infinity
    let y1 = -Infinity
    let maxR = 0
    for (let i = 0; i < n; i++) {
      const a = (px[i] = x[i] + vx[i])
      const b = (py[i] = y[i] + vy[i])
      if (a < x0) x0 = a
      if (a > x1) x1 = a
      if (b < y0) y0 = b
      if (b > y1) y1 = b
      if (radius[i] > maxR) maxR = radius[i]
    }
    if (!(maxR > 0) || !Number.isFinite(x1 - x0 + y1 - y0)) return
    // 99th percentile radius from a histogram
    const hist = this.hist
    hist.fill(0)
    const bins = hist.length
    for (let i = 0; i < n; i++) hist[Math.min(bins - 1, Math.floor((radius[i] / maxR) * bins))]++
    let acc = 0
    let b99 = bins - 1
    for (let b = 0; b < bins; b++) {
      acc += hist[b]
      if (acc >= n * 0.99) {
        b99 = b
        break
      }
    }
    let cs = 2 * (((b99 + 1) / bins) * maxR)
    // keep the grid at most ~4n cells
    const cells0 = ((x1 - x0) / cs + 1) * ((y1 - y0) / cs + 1)
    if (cells0 > 4 * n + 64) cs *= Math.sqrt(cells0 / (4 * n + 64))
    const gw = Math.floor((x1 - x0) / cs) + 1
    const gh = Math.floor((y1 - y0) / cs) + 1
    const cells = gw * gh
    if (this.cellStart.length < cells + 1) this.cellStart = new Int32Array(Math.max(cells + 1, this.cellStart.length * 2))
    const start = this.cellStart
    start.fill(0, 0, cells + 1)
    const cellOf = this.cellOf
    for (let i = 0; i < n; i++) {
      const c = Math.floor((py[i] - y0) / cs) * gw + Math.floor((px[i] - x0) / cs)
      cellOf[i] = c
      start[c + 1]++
    }
    for (let c = 0; c < cells; c++) start[c + 1] += start[c]
    const items = this.cellItems
    for (let i = 0; i < n; i++) items[start[cellOf[i]]++] = i
    for (let c = cells; c > 0; c--) start[c] = start[c - 1]
    start[0] = 0

    const strength = this.collideStrength
    const half = cs / 2
    for (let i = 0; i < n; i++) {
      const ri = radius[i]
      const ri2 = ri * ri
      const bigI = ri > half
      const xi = x[i] + vx[i]
      const yi = y[i] + vy[i]
      const c = cellOf[i]
      const cx = c % gw
      const cy = (c - cx) / gw
      // small nodes only meet small nodes within one cell; big ones search as far as they can reach
      const ring = bigI ? Math.ceil((ri + maxR) / cs) : 1
      const ax0 = Math.max(0, cx - ring)
      const ax1 = Math.min(gw - 1, cx + ring)
      const ay0 = Math.max(0, cy - ring)
      const ay1 = Math.min(gh - 1, cy + ring)
      for (let gy = ay0; gy <= ay1; gy++) {
        for (let gx = ax0; gx <= ax1; gx++) {
          const cc = gy * gw + gx
          for (let s = start[cc], e = start[cc + 1]; s < e; s++) {
            const j = items[s]
            const rj = radius[j]
            // each pair once: small–small and big–big by the lower index, big–small by the big node
            if (rj > half ? !bigI || j <= i : !bigI && j <= i) continue
            const r = ri + rj
            let dx = xi - x[j] - vx[j]
            let dy = yi - y[j] - vy[j]
            let l = dx * dx + dy * dy
            if (l >= r * r) continue
            if (dx === 0) (dx = this.jiggle()), (l += dx * dx)
            if (dy === 0) (dy = this.jiggle()), (l += dy * dy)
            l = Math.sqrt(l)
            l = ((r - l) / l) * strength
            dx *= l
            dy *= l
            const rj2 = rj * rj
            const f = rj2 / (ri2 + rj2)
            vx[i] += dx * f
            vy[i] += dy * f
            vx[j] -= dx * (1 - f)
            vy[j] -= dy * (1 - f)
          }
        }
      }
    }
  }
}
