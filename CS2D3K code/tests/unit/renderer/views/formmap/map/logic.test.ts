import { describe, expect, it } from 'vitest'
import {
  alignTargets,
  cardsInZone,
  centerIn,
  childKind,
  distributeTargets,
  findFree,
  formsOf,
  inferRelation,
  parentEdge,
  simplify,
  smoothPath,
  tidyZone,
  zoneAtPoint,
  ZONE_HEADER
} from '@/views/formmap/map/logic'
import { intersects, type CanvasNode } from '@/views/canvas/model'
import { KIND_ORDER } from '@/views/formmap/schema'
import { card, doc, edge, zone } from '../fixtures'

const rect = (id: string, x: number, y: number, width: number, height: number): CanvasNode => ({ id, type: 'text', x, y, width, height })

describe('formmap/map/logic relations', () => {
  it('inferRelation defaults to relates when either kind is unknown', () => {
    expect(inferRelation(undefined, 'goal')).toBe('relates')
    expect(inferRelation('feature', undefined)).toBe('relates')
  })

  it('inferRelation: ideas refine whatever they connect to', () => {
    for (const to of KIND_ORDER) expect(inferRelation('idea', to)).toBe('refines')
  })

  it('inferRelation: features and approaches serve goals, and goals serve bigger goals', () => {
    expect(inferRelation('feature', 'goal')).toBe('serves')
    expect(inferRelation('approach', 'goal')).toBe('serves')
    expect(inferRelation('goal', 'goal')).toBe('serves')
  })

  it('inferRelation: anything but a principle is motivated "because" of a principle', () => {
    for (const from of ['feature', 'approach', 'goal', 'question', 'note'] as const) expect(inferRelation(from, 'principle')).toBe('because')
    expect(inferRelation('principle', 'principle')).toBe('relates')
  })

  it('inferRelation: features depend on features and approaches; approaches on approaches', () => {
    expect(inferRelation('feature', 'feature')).toBe('depends')
    expect(inferRelation('feature', 'approach')).toBe('depends')
    expect(inferRelation('approach', 'approach')).toBe('depends')
  })

  it('inferRelation: other pairs only relate', () => {
    expect(inferRelation('question', 'feature')).toBe('relates')
    expect(inferRelation('note', 'goal')).toBe('relates')
    expect(inferRelation('goal', 'feature')).toBe('relates')
    expect(inferRelation('approach', 'feature')).toBe('relates')
  })

  it('childKind: a Tab child is the kind that naturally hangs under the parent', () => {
    expect(childKind('goal')).toBe('feature')
    expect(childKind('principle')).toBe('approach')
    expect(childKind('approach')).toBe('feature')
    expect(childKind('question')).toBe('idea')
    for (const k of ['idea', 'feature', 'note'] as const) expect(childKind(k)).toBe(k)
  })

  it('parentEdge is the first outgoing upstream relation to another form card', () => {
    const d = doc(
      [card('f', 'feature'), card('g', 'goal'), card('p', 'principle'), card('n', 'note'), rect('t', 0, 0, 10, 10), zone('z', { x: 0, y: 0, width: 10, height: 10 })],
      [edge('f', 'n', 'relates'), edge('f', 't', 'serves'), edge('f', 'z', 'serves'), edge('p', 'f', 'because'), edge('f', 'g', 'serves'), edge('f', 'p', 'because')]
    )
    expect(parentEdge(d, 'f')?.id).toBe('f->g')
    expect(parentEdge(d, 'g')).toBeNull()
    expect(parentEdge(d, 'n')).toBeNull()
    // untyped edges count as relates
    expect(parentEdge(doc([card('a', 'feature'), card('b', 'goal')], [edge('a', 'b')]), 'a')).toBeNull()
  })
})

describe('formmap/map/logic zones', () => {
  const big = zone('big', { x: 0, y: 0, width: 1000, height: 1000 })
  const small = zone('small', { x: 100, y: 100, width: 200, height: 200 })

  it('centerIn checks the center of the rect, borders inclusive', () => {
    expect(centerIn(big, { x: 950, y: 950, width: 100, height: 100 })).toBe(true)
    expect(centerIn(big, { x: 960, y: 0, width: 100, height: 100 })).toBe(false)
    expect(centerIn(big, { x: -10, y: -10, width: 20, height: 20 })).toBe(true)
  })

  it('zoneAtPoint returns the smallest zone containing the point', () => {
    const d = doc([small, big])
    expect(zoneAtPoint(d, { x: 150, y: 150 })?.id).toBe('small')
    expect(zoneAtPoint(d, { x: 500, y: 500 })?.id).toBe('big')
    expect(zoneAtPoint(d, { x: -1, y: 0 })).toBeNull()
  })

  it('cardsInZone returns cards centered in the zone but not in a smaller nested zone', () => {
    const d = doc([
      big,
      small,
      card('inBig', 'idea', { x: 500, y: 500, width: 100, height: 100 }),
      card('inSmall', 'idea', { x: 150, y: 150, width: 50, height: 50 }),
      rect('text', 600, 600, 50, 50),
      { id: 'group', type: 'group', x: 10, y: 600, width: 50, height: 50 },
      { id: 'pen', type: 'drawing', x: 10, y: 700, width: 50, height: 50, points: [] },
      card('outside', 'idea', { x: 2000, y: 0 })
    ])
    expect(cardsInZone(d, big).map((n) => n.id)).toEqual(['inBig', 'text'])
    expect(cardsInZone(d, small).map((n) => n.id)).toEqual(['inSmall'])
  })
})

describe('formmap/map/logic findFree', () => {
  const r = { x: 0, y: 0, width: 200, height: 100 }

  it('keeps the requested rect when it is free', () => {
    expect(findFree(doc([card('far', 'idea', { x: 2000, y: 2000 })]), r)).toEqual(r)
  })

  it('moves down first when the spot is taken, keeping clear of the blocker', () => {
    const blocker = card('b', 'idea', { ...r })
    const out = findFree(doc([blocker]), r)
    expect(out.x).toBe(0)
    expect(out.y).toBeGreaterThan(r.y)
    expect(intersects(out, blocker)).toBe(false)
    expect(out).toMatchObject({ width: 200, height: 100 })
  })

  it('ignores zones, groups, drawings and the ignored ids', () => {
    const d = doc([
      zone('z', { x: -100, y: -100, width: 1000, height: 1000 }),
      { id: 'g', type: 'group', ...r },
      { id: 'p', type: 'drawing', ...r, points: [] },
      card('self', 'idea', { ...r })
    ])
    expect(findFree(d, r, new Set(['self']))).toEqual(r)
  })

  it('never overlaps any card even in a crowded column', () => {
    const cards = Array.from({ length: 6 }, (_, i) => card(`c${i}`, 'idea', { x: 0, y: i * 60, width: 200, height: 100 }))
    const out = findFree(doc(cards), r)
    for (const c of cards) expect(intersects(out, c)).toBe(false)
  })
})

describe('formmap/map/logic align + distribute', () => {
  const a = rect('a', 0, 10, 100, 50)
  const b = rect('b', 300, 100, 50, 100)
  const c = rect('c', 120, 40, 80, 20)

  it('does nothing for fewer than two nodes', () => {
    expect(alignTargets([a], 'left').size).toBe(0)
    expect(alignTargets([], 'top').size).toBe(0)
  })

  it('aligns left / right / center on the selection bounds, keeping y', () => {
    expect(Object.fromEntries(alignTargets([a, b], 'left'))).toEqual({ a: { x: 0, y: 10 }, b: { x: 0, y: 100 } })
    expect(Object.fromEntries(alignTargets([a, b], 'right'))).toEqual({ a: { x: 250, y: 10 }, b: { x: 300, y: 100 } })
    expect(Object.fromEntries(alignTargets([a, b], 'center'))).toEqual({ a: { x: 125, y: 10 }, b: { x: 150, y: 100 } })
  })

  it('aligns top / bottom / middle on the selection bounds, keeping x', () => {
    expect(Object.fromEntries(alignTargets([a, b], 'top'))).toEqual({ a: { x: 0, y: 10 }, b: { x: 300, y: 10 } })
    expect(Object.fromEntries(alignTargets([a, b], 'bottom'))).toEqual({ a: { x: 0, y: 150 }, b: { x: 300, y: 100 } })
    expect(Object.fromEntries(alignTargets([a, b], 'middle'))).toEqual({ a: { x: 0, y: 80 }, b: { x: 300, y: 55 } })
  })

  it('rounds targets to whole pixels', () => {
    const odd = rect('o', 0, 0, 3, 3)
    const other = rect('p', 0, 0, 10, 10)
    for (const p of alignTargets([odd, other], 'center').values()) expect(Number.isInteger(p.x)).toBe(true)
  })

  it('distributes with even gaps, keeping the first and last in place', () => {
    const t = distributeTargets([b, a, c], 'x')
    // span 0..350, widths 230 → two gaps of 60
    expect(Object.fromEntries(t)).toEqual({ a: { x: 0, y: 10 }, c: { x: 160, y: 40 }, b: { x: 300, y: 100 } })
  })

  it('distributes vertically too', () => {
    const t = distributeTargets([a, b, c], 'y')
    // sorted by y: a(10,h50) c(40,h20) b(100,h100) → span 10..200, heights 170 → gaps 10
    expect(Object.fromEntries(t)).toEqual({ a: { x: 0, y: 10 }, c: { x: 120, y: 70 }, b: { x: 300, y: 100 } })
  })

  it('does not distribute fewer than three nodes', () => {
    expect(distributeTargets([a, b], 'x').size).toBe(0)
  })
})

describe('formmap/map/logic tidyZone', () => {
  it('leaves an empty zone as it is', () => {
    const z = zone('z', { x: 0, y: 0, width: 700, height: 300 })
    expect(tidyZone(doc([z]), z)).toEqual({ targets: new Map(), height: 300 })
  })

  it('lays the cards out in a grid below the header, in reading order', () => {
    const z = zone('z', { x: 0, y: 0, width: 700, height: 600 })
    const d = doc([
      z,
      card('c', 'idea', { x: 400, y: 300, width: 200, height: 100 }),
      card('a', 'idea', { x: 50, y: 100, width: 200, height: 100 }),
      card('b', 'idea', { x: 300, y: 110, width: 200, height: 100 }), // same row as a (within 40px)
      card('d', 'idea', { x: 10, y: 450, width: 200, height: 100 })
    ])
    const { targets, height } = tidyZone(d, z)
    expect([...targets.keys()]).toEqual(['a', 'b', 'c', 'd'])
    expect(Object.fromEntries(targets)).toEqual({ a: { x: 30, y: 70 }, b: { x: 250, y: 70 }, c: { x: 470, y: 70 }, d: { x: 30, y: 190 } })
    expect(height).toBe(600)
    for (const p of targets.values()) expect(p.y).toBeGreaterThanOrEqual(z.y + ZONE_HEADER)
  })

  it('grows the zone when the cards need more height, and never shrinks it', () => {
    const z = zone('z', { x: 0, y: 0, width: 300, height: 200 })
    const d = doc([z, card('a', 'idea', { x: 10, y: 10, width: 200, height: 40 }), card('b', 'idea', { x: 10, y: 120, width: 200, height: 40 }), card('c', 'idea', { x: 10, y: 150, width: 200, height: 40 })])
    const { targets, height } = tidyZone(d, z)
    expect(targets.size).toBe(3) // one column
    const last = Math.max(...[...targets.values()].map((p) => p.y)) + 40
    expect(height).toBeGreaterThan(200)
    expect(height).toBeGreaterThanOrEqual(last)
  })

  it('does not touch cards that belong to a nested zone', () => {
    const outer = zone('outer', { x: 0, y: 0, width: 1000, height: 1000 })
    const inner = zone('inner', { x: 500, y: 500, width: 400, height: 400 })
    const d = doc([outer, inner, card('o', 'idea', { x: 10, y: 10 }), card('i', 'idea', { x: 600, y: 600 })])
    expect([...tidyZone(d, outer).targets.keys()]).toEqual(['o'])
  })
})

describe('formmap/map/logic pen strokes', () => {
  it('simplify keeps short strokes untouched', () => {
    const two = [0, 0, 5, 5]
    expect(simplify(two, 1)).toBe(two)
    expect(simplify([], 1)).toEqual([])
  })

  it('simplify drops collinear points and keeps corners', () => {
    expect(simplify([0, 0, 1, 1, 2, 2, 3, 3], 0.1)).toEqual([0, 0, 3, 3])
    expect(simplify([0, 0, 5, 0, 10, 0, 10, 5, 10, 10], 1)).toEqual([0, 0, 10, 0, 10, 10])
  })

  it('simplify keeps wiggles larger than epsilon and drops smaller ones', () => {
    const pts = [0, 0, 5, 0.5, 10, 0]
    expect(simplify(pts, 1)).toEqual([0, 0, 10, 0])
    expect(simplify(pts, 0.1)).toEqual(pts)
  })

  it('smoothPath draws nothing for no points and a dot for one point', () => {
    expect(smoothPath([])).toBe('')
    expect(smoothPath([1, 2], 10, 20)).toBe('M 11 22 l 0.01 0')
  })

  it('smoothPath draws a line for two points and quadratic curves through midpoints otherwise', () => {
    expect(smoothPath([0, 0, 10, 10])).toBe('M 0 0 L 10 10')
    expect(smoothPath([0, 0, 5, 5, 10, 0])).toBe('M 0 0 Q 5 5 7.5 2.5 L 10 0')
    expect(smoothPath([0, 0, 10, 10], 1, 1)).toBe('M 1 1 L 11 11')
  })

  it('formsOf keeps only form cards', () => {
    expect(formsOf([card('a', 'idea'), rect('t', 0, 0, 1, 1), zone('z', { x: 0, y: 0, width: 1, height: 1 })]).map((n) => n.id)).toEqual(['a'])
  })
})
