import { describe, expect, it } from 'vitest'
import { multilevelSeed, phyllotaxis, seedLayout } from '@/views/graph/layout'

/** `k` cliques of `size` nodes, joined in a ring by one link each */
function cliqueRing(k: number, size: number): { n: number; src: Uint32Array; tgt: Uint32Array } {
  const src: number[] = []
  const tgt: number[] = []
  for (let c = 0; c < k; c++) {
    for (let a = 0; a < size; a++) for (let b = a + 1; b < size; b++) src.push(c * size + a), tgt.push(c * size + b)
    src.push(c * size)
    tgt.push(((c + 1) % k) * size + 1)
  }
  return { n: k * size, src: Uint32Array.from(src), tgt: Uint32Array.from(tgt) }
}

const forces = { repel: 10, link: 1, distance: 120, center: 0.5, ax: 1 }

describe('views/graph/layout', () => {
  it('provisional placement is d3’s phyllotaxis', () => {
    const pos = new Float32Array(20)
    seedLayout(10, pos)
    const p = phyllotaxis(7)
    expect(pos[14]).toBeCloseTo(p.x, 3)
    expect(pos[15]).toBeCloseTo(p.y, 3)
  })

  it('multilevel seed places every node, deterministically', () => {
    const g = cliqueRing(12, 15)
    const a = multilevelSeed(g.n, g.src.length, g.src, g.tgt, forces)
    const b = multilevelSeed(g.n, g.src.length, g.src, g.tgt, forces)
    expect(a.x).toHaveLength(g.n)
    for (let i = 0; i < g.n; i++) expect(Number.isFinite(a.x[i]) && Number.isFinite(a.y[i])).toBe(true)
    expect(Array.from(a.x)).toEqual(Array.from(b.x))
  })

  it('multilevel seed keeps communities together', () => {
    const size = 15
    const g = cliqueRing(12, size)
    const { x, y } = multilevelSeed(g.n, g.src.length, g.src, g.tgt, forces)
    const dist = (i: number, j: number): number => Math.hypot(x[i] - x[j], y[i] - y[j])
    let inner = 0
    let ni = 0
    let outer = 0
    let no = 0
    for (let i = 0; i < g.n; i++)
      for (let j = i + 1; j < g.n; j++) {
        if (Math.floor(i / size) === Math.floor(j / size)) (inner += dist(i, j)), ni++
        else (outer += dist(i, j)), no++
      }
    expect(inner / ni).toBeLessThan((outer / no) * 0.5)
  })

  it('streams intermediate full-resolution layouts', () => {
    const g = cliqueRing(30, 10)
    const sizes: number[] = []
    multilevelSeed(g.n, g.src.length, g.src, g.tgt, forces, (x) => sizes.push(x.length))
    expect(sizes.length).toBeGreaterThan(0)
    expect(sizes.every((s) => s === g.n)).toBe(true)
  })

  it('handles isolated nodes and tiny graphs', () => {
    const src = Uint32Array.from([0, 1])
    const tgt = Uint32Array.from([1, 2])
    const { x } = multilevelSeed(200, 2, src, tgt, forces)
    expect(Array.from(x).every(Number.isFinite)).toBe(true)
    const tiny = multilevelSeed(3, 2, src, tgt, forces)
    expect(tiny.x).toHaveLength(3)
  })
})
