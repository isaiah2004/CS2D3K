import { describe, expect, it } from 'vitest'
import { SpatialGrid } from '@/views/graph/grid'
import { Rng } from '@/views/graph/forces'

/** reference: closest node whose (max(r, minR) + slack) disc contains the point */
function brute(px: number, py: number, slack: number, minR: number, pos: Float32Array, props: Float32Array, n: number): number {
  let best = -1
  let bestD = Infinity
  for (let i = 0; i < n; i++) {
    const r = Math.max(props[2 * i], minR) + slack
    const d = (pos[2 * i] - px) ** 2 + (pos[2 * i + 1] - py) ** 2
    if (d <= r * r && d < bestD) {
      bestD = d
      best = i
    }
  }
  return best
}

describe('views/graph/grid', () => {
  it('hit-tests exactly like a linear scan', () => {
    const rng = new Rng(5)
    const n = 3000
    const pos = new Float32Array(2 * n)
    const props = new Float32Array(2 * n)
    for (let i = 0; i < n; i++) {
      pos[2 * i] = (rng.next() - 0.5) * 4000
      pos[2 * i + 1] = (rng.next() - 0.5) * 2500
      // a few hubs much larger than the cell size
      props[2 * i] = i % 500 === 0 ? 120 : 3 + rng.next() * 8
    }
    const grid = new SpatialGrid()
    grid.build(pos, props, n)
    let hits = 0
    for (let k = 0; k < 2000; k++) {
      const px = (rng.next() - 0.5) * 4200
      const py = (rng.next() - 0.5) * 2700
      for (const [slack, minR] of [
        [3, 1.6],
        [30, 40]
      ]) {
        const want = brute(px, py, slack, minR, pos, props, n)
        expect(grid.query(px, py, slack, minR, pos, props)).toBe(want)
        if (want >= 0) hits++
      }
    }
    expect(hits).toBeGreaterThan(100)
  })

  it('handles empty and degenerate inputs', () => {
    const grid = new SpatialGrid()
    grid.build(new Float32Array(0), new Float32Array(0), 0)
    expect(grid.query(0, 0, 1, 1, new Float32Array(0), new Float32Array(0))).toBe(-1)
    const pos = new Float32Array([5, 5, 5, 5])
    const props = new Float32Array([2, 0, 2, 0])
    grid.build(pos, props, 2)
    expect(grid.query(5, 5, 0, 0, pos, props)).toBe(0)
  })
})
