// Initial placement of a freshly opened graph.
//  - main thread: an instant provisional phyllotaxis so the first frame never waits for the worker
//  - worker: a multilevel seed. The graph is coarsened by merging every node with its unassigned neighbours
//    ("solar systems", as in FM³) until it is small, the coarsest graph is laid out with the same forces
//    (charges scaled by cluster mass, link lengths by cluster size), then every level is expanded around its
//    parent's position and briefly refined. The real simulation then only has to polish locally, so a large
//    graph settles in a fraction of the ticks and never shows the "exploding hairball" phase.
import { ForceSim, Rng } from './forces'

/** d3's initial phyllotaxis arrangement (also used by "Animate") */
export function phyllotaxis(i: number, spacing = 10): { x: number; y: number } {
  const r = spacing * Math.sqrt(0.5 + i)
  const a = i * Math.PI * (3 - Math.sqrt(5))
  return { x: r * Math.cos(a), y: r * Math.sin(a) }
}

/** instant provisional placement (positions are NaN on entry) */
export function seedLayout(n: number, pos: Float32Array, spacing = 10): void {
  for (let i = 0; i < n; i++) {
    const p = phyllotaxis(i, spacing)
    pos[2 * i] = p.x
    pos[2 * i + 1] = p.y
  }
}

export interface SeedForces {
  repel: number
  link: number
  distance: number
  center: number
  ax: number
}

interface Level {
  n: number
  mass: Float64Array
  m: number
  src: Uint32Array
  tgt: Uint32Array
  /** coarse node of every node of this level (filled when the next level is built) */
  parent: Int32Array | null
}

function csr(n: number, m: number, src: Uint32Array, tgt: Uint32Array): { start: Int32Array; adj: Int32Array; deg: Int32Array } {
  const deg = new Int32Array(n)
  for (let e = 0; e < m; e++) {
    deg[src[e]]++
    deg[tgt[e]]++
  }
  const start = new Int32Array(n + 1)
  for (let i = 0; i < n; i++) start[i + 1] = start[i] + deg[i]
  const fill = start.slice(0, n)
  const adj = new Int32Array(2 * m)
  for (let e = 0; e < m; e++) {
    adj[fill[src[e]]++] = tgt[e]
    adj[fill[tgt[e]]++] = src[e]
  }
  return { start, adj, deg }
}

/** merge every unassigned node (highest degree first) with its unassigned neighbours; null if it barely shrinks */
function coarsen(L: Level): Level | null {
  const { n } = L
  const { start, adj, deg } = csr(n, L.m, L.src, L.tgt)
  // order by degree, descending (counting sort)
  let maxDeg = 0
  for (let i = 0; i < n; i++) if (deg[i] > maxDeg) maxDeg = deg[i]
  const bucket = new Int32Array(maxDeg + 2)
  for (let i = 0; i < n; i++) bucket[maxDeg - deg[i] + 1]++
  for (let b = 0; b <= maxDeg; b++) bucket[b + 1] += bucket[b]
  const order = new Int32Array(n)
  for (let i = 0; i < n; i++) order[bucket[maxDeg - deg[i]]++] = i

  const parent = new Int32Array(n).fill(-1)
  let nc = 0
  let isolatedCluster = -1
  let isolatedCount = 0
  for (let o = 0; o < n; o++) {
    const v = order[o]
    if (parent[v] >= 0) continue
    if (deg[v] === 0) {
      // isolated nodes are grouped in small batches so they keep coarsening too
      if (isolatedCluster < 0 || isolatedCount >= 8) {
        isolatedCluster = nc++
        isolatedCount = 0
      }
      parent[v] = isolatedCluster
      isolatedCount++
      continue
    }
    const c = nc++
    parent[v] = c
    for (let a = start[v]; a < start[v + 1]; a++) if (parent[adj[a]] < 0) parent[adj[a]] = c
  }
  if (nc > n * 0.85 || nc === n) return null
  L.parent = parent
  const mass = new Float64Array(nc)
  for (let i = 0; i < n; i++) mass[parent[i]] += L.mass[i]
  // coarse links (deduplicated)
  const seen = new Map<number, number>()
  const src: number[] = []
  const tgt: number[] = []
  for (let e = 0; e < L.m; e++) {
    let a = parent[L.src[e]]
    let b = parent[L.tgt[e]]
    if (a === b) continue
    if (a > b) [a, b] = [b, a]
    const key = a * nc + b
    if (seen.has(key)) continue
    seen.set(key, src.length)
    src.push(a)
    tgt.push(b)
  }
  return { n: nc, mass, m: src.length, src: Uint32Array.from(src), tgt: Uint32Array.from(tgt), parent: null }
}

/**
 * Multilevel initial layout. Returns x / y per node. `onLevel` gets intermediate full-resolution positions
 * while it runs (for streaming the unfolding graph to the screen).
 */
export function multilevelSeed(
  n: number,
  m: number,
  src: Uint32Array,
  tgt: Uint32Array,
  f: SeedForces,
  onLevel?: (x: Float64Array, y: Float64Array) => void
): { x: Float64Array; y: Float64Array } {
  const rng = new Rng(n * 7919 + m)
  const levels: Level[] = [{ n, mass: new Float64Array(n).fill(1), m, src, tgt, parent: null }]
  for (;;) {
    const L = levels[levels.length - 1]
    if (L.n <= 48) break
    const next = coarsen(L)
    if (!next) break
    levels.push(next)
  }

  const charge = -(f.repel * 32 + 10)
  const sim = new ForceSim()
  sim.rng = rng
  sim.velocityDecay = 0.42
  sim.distanceMax = 2000
  sim.centerStrength = 0.08
  sim.xStrength = f.center * 0.12 * f.ax
  sim.yStrength = (f.center * 0.12) / f.ax

  let x = new Float64Array(0)
  let y = new Float64Array(0)
  for (let li = levels.length - 1; li >= 1; li--) {
    const L = levels[li]
    sim.resize(L.n, L.m)
    if (li === levels.length - 1) {
      // coarsest level: phyllotaxis, spaced for the clusters' sizes
      let avg = 0
      for (let i = 0; i < L.n; i++) avg += L.mass[i]
      const spacing = Math.max(10, f.distance * 0.25 * Math.sqrt(avg / L.n))
      for (let i = 0; i < L.n; i++) {
        const p = phyllotaxis(i, spacing)
        sim.x[i] = p.x
        sim.y[i] = p.y
      }
    } else {
      sim.x.set(x.subarray(0, L.n))
      sim.y.set(y.subarray(0, L.n))
    }
    sim.vx.fill(0, 0, L.n)
    sim.vy.fill(0, 0, L.n)
    for (let i = 0; i < L.n; i++) sim.charge[i] = charge * L.mass[i]
    sim.src.set(L.src)
    sim.tgt.set(L.tgt)
    const deg = new Float64Array(L.n)
    for (let e = 0; e < L.m; e++) {
      deg[L.src[e]]++
      deg[L.tgt[e]]++
    }
    for (let e = 0; e < L.m; e++) {
      const s = L.src[e]
      const t = L.tgt[e]
      sim.linkDist[e] = f.distance * 0.5 * (Math.sqrt(L.mass[s]) + Math.sqrt(L.mass[t]))
      sim.linkStrength[e] = f.link / Math.max(1, Math.min(deg[s], deg[t]))
    }
    sim.computeBias()
    // coarse levels are cheap: lay them out thoroughly; finer ones only need local refinement
    const coarsest = li === levels.length - 1
    const ticks = coarsest ? 300 : Math.round(Math.min(150, Math.max(25, 4e5 / L.n)))
    sim.alpha = coarsest ? 1 : 0.35
    sim.alphaDecay = 1 - Math.pow(sim.alphaMin / sim.alpha, 1 / ticks)
    sim.theta = L.n > 5000 ? 1.2 : 0.9
    // stream the unfolding layout (full resolution) every ~60 ms so the opening never looks frozen
    let lastPost = performance.now()
    for (let t = 0; t < ticks; t++) {
      sim.tick()
      if (onLevel && performance.now() - lastPost > 60) {
        onLevel(...expandTo0(levels, li, sim.x, sim.y, f.distance))
        lastPost = performance.now()
      }
    }
    if (onLevel && coarsest) onLevel(...expandTo0(levels, li, sim.x, sim.y, f.distance))

    // expand into the next finer level: children around their cluster's position
    const fine = levels[li - 1]
    const parent = fine.parent!
    const nx = new Float64Array(fine.n)
    const ny = new Float64Array(fine.n)
    const kids = childCounts(parent, L.n)
    const seen = new Int32Array(L.n)
    for (let i = 0; i < fine.n; i++) {
      const c = parent[i]
      const k = seen[c]++
      // one child stays in the middle, the others fill a disc sized for the cluster
      const r = k ? clusterRadius(f.distance, L.mass[c], k, kids[c]) : 0
      const a = k * GOLDEN + rng.next() * 0.5
      nx[i] = sim.x[c] + r * Math.cos(a)
      ny[i] = sim.y[c] + r * Math.sin(a)
    }
    x = nx
    y = ny
  }
  if (levels.length === 1) {
    x = new Float64Array(n)
    y = new Float64Array(n)
    for (let i = 0; i < n; i++) {
      const p = phyllotaxis(i)
      x[i] = p.x
      y[i] = p.y
    }
  }
  return { x, y }
}

const GOLDEN = Math.PI * (3 - Math.sqrt(5))

function childCounts(parent: Int32Array, nc: number): Int32Array {
  const c = new Int32Array(nc)
  for (let i = 0; i < parent.length; i++) c[parent[i]]++
  return c
}

/** radius of the k-th of `kids` children in a disc whose area grows with the cluster's mass */
function clusterRadius(distance: number, mass: number, k: number, kids: number): number {
  return distance * 0.3 * Math.sqrt((mass * k) / Math.max(1, kids)) + 1
}

/** full-resolution positions for an intermediate level: every node at its ancestor, spread in a small disc */
function expandTo0(levels: Level[], li: number, x: Float64Array, y: Float64Array, distance: number): [Float64Array, Float64Array] {
  let cx = x
  let cy = y
  for (let l = li; l >= 1; l--) {
    const fine = levels[l - 1]
    const parent = fine.parent!
    const nx = new Float64Array(fine.n)
    const ny = new Float64Array(fine.n)
    const kids = childCounts(parent, levels[l].n)
    const seen = new Int32Array(levels[l].n)
    for (let i = 0; i < fine.n; i++) {
      const c = parent[i]
      const k = seen[c]++
      const r = k ? clusterRadius(distance, levels[l].mass[c], k, kids[c]) : 0
      const a = k * GOLDEN
      nx[i] = cx[c] + r * Math.cos(a)
      ny[i] = cy[c] + r * Math.sin(a)
    }
    cx = nx
    cy = ny
  }
  return [cx, cy]
}
