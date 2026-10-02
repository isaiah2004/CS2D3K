// The typed-array force simulation must behave like d3-force (the graph's settings panel maps onto d3's model).
import { describe, expect, it } from 'vitest'
import { forceCenter, forceCollide, forceLink, forceManyBody, forceSimulation, forceX, forceY, type SimulationNodeDatum } from 'd3-force'
import { ForceSim, Rng } from '@/views/graph/forces'

interface D3Node extends SimulationNodeDatum {
  x: number
  y: number
  r: number
}

function randomGraph(n: number, m: number, seed = 7): { x: number[]; y: number[]; r: number[]; src: number[]; tgt: number[] } {
  const rng = new Rng(seed)
  const x = Array.from({ length: n }, () => (rng.next() - 0.5) * 800)
  const y = Array.from({ length: n }, () => (rng.next() - 0.5) * 800)
  const r = Array.from({ length: n }, () => 4 + rng.next() * 10)
  const src: number[] = []
  const tgt: number[] = []
  const seen = new Set<number>()
  while (src.length < m) {
    const a = Math.floor(rng.next() * n)
    const b = Math.floor(rng.next() * n)
    if (a === b || seen.has(Math.min(a, b) * n + Math.max(a, b))) continue
    seen.add(Math.min(a, b) * n + Math.max(a, b))
    src.push(a)
    tgt.push(b)
  }
  return { x, y, r, src, tgt }
}

function ours(g: ReturnType<typeof randomGraph>, opts: Partial<ForceSim>): ForceSim {
  const s = new ForceSim()
  s.resize(g.x.length, g.src.length)
  s.x.set(g.x)
  s.y.set(g.y)
  s.vx.fill(0)
  s.vy.fill(0)
  s.radius.set(g.r)
  s.src.set(g.src)
  s.tgt.set(g.tgt)
  const deg = new Float64Array(g.x.length)
  g.src.forEach((a, e) => (deg[a]++, deg[g.tgt[e]]++))
  for (let e = 0; e < g.src.length; e++) {
    s.linkDist[e] = 60
    s.linkStrength[e] = 1 / Math.min(deg[g.src[e]], deg[g.tgt[e]])
  }
  s.computeBias()
  Object.assign(s, opts)
  return s
}

function d3sim(g: ReturnType<typeof randomGraph>) {
  const nodes: D3Node[] = g.x.map((x, i) => ({ x, y: g.y[i], r: g.r[i] }))
  const links = g.src.map((s, e) => ({ source: s, target: g.tgt[e] }))
  const sim = forceSimulation(nodes).stop().velocityDecay(0.42)
  return { nodes, links, sim }
}

const maxDiff = (a: ArrayLike<number>, b: number[]): number => b.reduce((m, v, i) => Math.max(m, Math.abs(v - a[i])), 0)

describe('views/graph/forces', () => {
  it('link, center and x / y forces match d3-force exactly', () => {
    const g = randomGraph(120, 300)
    const { nodes, links, sim } = d3sim(g)
    sim
      .force('link', forceLink(links).distance(60))
      .force('center', forceCenter(0, 0).strength(0.08))
      .force('x', forceX(0).strength(0.05))
      .force('y', forceY(0).strength(0.07))
    const s = ours(g, { centerStrength: 0.08, xStrength: 0.05, yStrength: 0.07 })
    for (let t = 0; t < 5; t++) {
      sim.tick()
      s.tick()
    }
    expect(maxDiff(s.x, nodes.map((n) => n.x))).toBeLessThan(1e-9)
    expect(maxDiff(s.y, nodes.map((n) => n.y))).toBeLessThan(1e-9)
  })

  it('many-body matches d3-force exactly without the Barnes–Hut approximation', () => {
    const g = randomGraph(150, 0)
    const { nodes, sim } = d3sim(g)
    sim.force('charge', forceManyBody().strength(-330).theta(0).distanceMax(500))
    const s = ours(g, { theta: 0, distanceMax: 500 })
    s.charge.fill(-330)
    for (let t = 0; t < 3; t++) {
      sim.tick()
      s.tick()
    }
    expect(maxDiff(s.x, nodes.map((n) => n.x))).toBeLessThan(1e-6)
    expect(maxDiff(s.y, nodes.map((n) => n.y))).toBeLessThan(1e-6)
  })

  it('the Barnes–Hut approximation stays close to the exact forces', () => {
    const g = randomGraph(2000, 0, 3)
    const exact = ours(g, { theta: 0 })
    const approx = ours(g, { theta: 1.2 })
    exact.charge.fill(-330)
    approx.charge.fill(-330)
    exact.tick()
    approx.tick()
    let err = 0
    let mag = 0
    for (let i = 0; i < g.x.length; i++) {
      // velocities after one tick are proportional to the force
      err += Math.hypot(exact.vx[i] - approx.vx[i], exact.vy[i] - approx.vy[i])
      mag += Math.hypot(exact.vx[i], exact.vy[i])
    }
    expect(err / mag).toBeLessThan(0.05)
  })

  it('collide separates overlapping nodes like d3-force', () => {
    // well separated overlapping pairs (pair order cannot change the result) plus one hub overlapping two nodes
    const x: number[] = []
    const y: number[] = []
    const r: number[] = []
    for (let k = 0; k < 40; k++) {
      x.push((k % 8) * 300, (k % 8) * 300 + 7)
      y.push(Math.floor(k / 8) * 300, Math.floor(k / 8) * 300 + 3)
      r.push(5, 6)
    }
    x.push(5000, 5030, 4960)
    y.push(5000, 5010, 4990)
    r.push(45, 6, 7)
    const g = { x, y, r, src: [], tgt: [] }
    const { nodes, sim } = d3sim(g)
    sim.force('collide', forceCollide<D3Node>((n) => n.r).strength(0.6))
    const s = ours(g, { collideStrength: 0.6 })
    sim.tick()
    s.tick()
    expect(maxDiff(s.x, nodes.map((n) => n.x))).toBeLessThan(1e-9)
    expect(maxDiff(s.y, nodes.map((n) => n.y))).toBeLessThan(1e-9)
  })

  it('settles: cools below alphaMin, keeps every position finite and links near their length', () => {
    const g = randomGraph(300, 330, 11)
    const s = ours(g, { theta: 0.9, distanceMax: 2000, centerStrength: 0.08, xStrength: 0.06, yStrength: 0.06, collideStrength: 0.6 })
    s.charge.fill(-100)
    let ticks = 0
    while (s.running() && ticks < 1000) {
      s.tick()
      ticks++
    }
    expect(ticks).toBe(300)
    expect(s.running()).toBe(false)
    for (let i = 0; i < 300; i++) expect(Number.isFinite(s.x[i]) && Number.isFinite(s.y[i])).toBe(true)
    let linked = 0
    for (let e = 0; e < g.src.length; e++) linked += Math.hypot(s.x[g.src[e]] - s.x[g.tgt[e]], s.y[g.src[e]] - s.y[g.tgt[e]])
    let any = 0
    for (let i = 0; i < 300; i++) any += Math.hypot(s.x[i] - s.x[(i * 7 + 1) % 300], s.y[i] - s.y[(i * 7 + 1) % 300])
    expect(linked / g.src.length).toBeLessThan(any / 300)
  })

  it('pinned nodes stay where they are pinned', () => {
    const g = randomGraph(50, 60)
    const s = ours(g, { theta: 0.9 })
    s.charge.fill(-200)
    s.fx[3] = 123
    s.fy[3] = -45
    for (let t = 0; t < 20; t++) s.tick()
    expect([s.x[3], s.y[3]]).toEqual([123, -45])
  })
})
