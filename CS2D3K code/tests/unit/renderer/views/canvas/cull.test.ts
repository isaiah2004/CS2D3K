import { describe, expect, it } from 'vitest'
import { SpatialIndex, containsRect, expandRect, geometryBounds, textExcerpt, viewRect } from '@/views/canvas/cull'
import { edgeGeometry, intersects, type CanvasNode } from '@/views/canvas/model'

const node = (id: string, x: number, y: number, width = 100, height = 50): CanvasNode => ({ id, type: 'text', x, y, width, height })

/** deterministic pseudo-random numbers */
function rng(seed: number): () => number {
  let s = seed
  return () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648
}

describe('views/canvas/cull SpatialIndex', () => {
  it('finds exactly the nodes intersecting a rect (same answer as a linear scan)', () => {
    const r = rng(3)
    const nodes = Array.from({ length: 800 }, (_, i) => node(`n${i}`, (r() - 0.5) * 40000, (r() - 0.5) * 30000, 50 + r() * 600, 40 + r() * 400))
    // a few giant boxes (zones / groups) that span many cells
    nodes.push(node('giant', -30000, -30000, 60000, 60000), node('wide', -20000, 100, 40000, 300))
    const index = new SpatialIndex(nodes)
    for (let k = 0; k < 40; k++) {
      const q = { x: (r() - 0.5) * 40000, y: (r() - 0.5) * 30000, width: r() * 8000, height: r() * 6000 }
      const expected = new Set(nodes.filter((n) => intersects(n, q)).map((n) => n.id))
      expect(index.query(q)).toEqual(expected)
    }
  })

  it('handles negative coordinates, empty boards and huge queries', () => {
    expect(new SpatialIndex([]).query({ x: -1e6, y: -1e6, width: 2e6, height: 2e6 }).size).toBe(0)
    const idx = new SpatialIndex([node('a', -5000, -5000), node('b', 5000, 5000)])
    expect([...idx.query({ x: -5050, y: -5050, width: 100, height: 100 })]).toEqual(['a'])
    expect(idx.query({ x: -1e7, y: -1e7, width: 2e7, height: 2e7 })).toEqual(new Set(['a', 'b']))
  })
})

describe('views/canvas/cull rect helpers', () => {
  it('computes the world rect seen through a viewport', () => {
    expect(viewRect({ x: 100, y: -50, zoom: 2 }, 800, 600)).toEqual({ x: -50, y: 25, width: 400, height: 300 })
  })

  it('expands a rect by a fraction of its size on each side', () => {
    expect(expandRect({ x: 0, y: 0, width: 100, height: 50 }, 0.5)).toEqual({ x: -50, y: -25, width: 200, height: 100 })
  })

  it('tests containment', () => {
    const outer = { x: 0, y: 0, width: 100, height: 100 }
    expect(containsRect(outer, { x: 10, y: 10, width: 20, height: 20 })).toBe(true)
    expect(containsRect(outer, { x: 90, y: 10, width: 20, height: 20 })).toBe(false)
  })

  it('bounds an edge curve including its bulge and arrow heads', () => {
    const g = edgeGeometry({ x: 0, y: 0 }, 'bottom', { x: 400, y: 0 }, 'bottom', true, true)
    const b = geometryBounds(g)
    // sample the cubic: every point lies inside the bounds
    const [ax, ay, c1x, c1y, c2x, c2y, bx, by] = g.curve
    for (let t = 0; t <= 1; t += 0.05) {
      const u = 1 - t
      const x = u * u * u * ax + 3 * u * u * t * c1x + 3 * u * t * t * c2x + t * t * t * bx
      const y = u * u * u * ay + 3 * u * u * t * c1y + 3 * u * t * t * c2y + t * t * t * by
      expect(x >= b.x && x <= b.x + b.width && y >= b.y && y <= b.y + b.height).toBe(true)
    }
  })
})

describe('views/canvas/cull textExcerpt', () => {
  it('takes the first non-empty line as the title and strips markdown syntax', () => {
    expect(textExcerpt('\n## Card **12**\nSome [[Note|link]] and `code`.\n- item\n- [x] done')).toEqual({ title: 'Card 12', body: 'Some link and code. · item · done' })
  })

  it('skips fences but keeps their content, and caps the body', () => {
    const ex = textExcerpt('```py\nprint(1)\n```\n' + 'word '.repeat(100), 40)
    expect(ex.title).toBe('print(1)')
    expect(ex.body.length).toBeLessThanOrEqual(40)
    expect(ex.body.endsWith('…')).toBe(true)
  })

  it('returns empty strings for empty text', () => {
    expect(textExcerpt('  \n ')).toEqual({ title: '', body: '' })
  })
})
