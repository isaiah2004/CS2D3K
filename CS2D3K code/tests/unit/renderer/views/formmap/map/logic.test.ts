import { describe, expect, it } from 'vitest'
import { alignTargets, cardsInGroup, centerIn, distributeTargets, findFree, formsOf, groupAtPoint, parentEdge, simplify, smoothPath, tidyGroup } from '@/views/formmap/map/logic'
import { GROUP_TOP } from '@/views/formmap/layout'
import { intersects, type CanvasNode } from '@/views/canvas/model'
import { card, doc, edge, group } from '../fixtures'

const rect = (id: string, x: number, y: number, width: number, height: number): CanvasNode => ({ id, type: 'text', x, y, width, height })

describe('formmap/map/logic mind-map parents', () => {
  it('parentEdge is the first outgoing upstream relation to another form card', () => {
    const d = doc(
      [card('f'), card('g'), card('p'), card('n'), rect('t', 0, 0, 10, 10), group('z', { x: 0, y: 0, width: 10, height: 10 })],
      [edge('f', 'n', 'relates'), edge('f', 't', 'serves'), edge('f', 'z', 'serves'), edge('p', 'f', 'because'), edge('f', 'g', 'serves'), edge('f', 'p', 'because')]
    )
    expect(parentEdge(d, 'f')?.id).toBe('f->g')
    expect(parentEdge(d, 'g')).toBeNull()
    expect(parentEdge(d, 'n')).toBeNull()
    // untyped edges count as relates
    expect(parentEdge(doc([card('a'), card('b')], [edge('a', 'b')]), 'a')).toBeNull()
  })
})

describe('formmap/map/logic groups', () => {
  const big = group('big', { x: 0, y: 0, width: 1000, height: 1000 })
  const small = group('small', { x: 100, y: 100, width: 200, height: 200 })

  it('centerIn checks the center of the rect, borders inclusive', () => {
    expect(centerIn(big, { x: 950, y: 950, width: 100, height: 100 })).toBe(true)
    expect(centerIn(big, { x: 960, y: 0, width: 100, height: 100 })).toBe(false)
    expect(centerIn(big, { x: -10, y: -10, width: 20, height: 20 })).toBe(true)
  })

  it('groupAtPoint returns the smallest group containing the point', () => {
    const d = doc([small, big])
    expect(groupAtPoint(d, { x: 150, y: 150 })?.id).toBe('small')
    expect(groupAtPoint(d, { x: 500, y: 500 })?.id).toBe('big')
    expect(groupAtPoint(d, { x: -1, y: 0 })).toBeNull()
  })

  it('cardsInGroup returns the nodes whose innermost group it is', () => {
    const d = doc([
      big,
      small,
      card('inBig', { x: 500, y: 500, width: 100, height: 100 }),
      card('inSmall', { x: 150, y: 150, width: 50, height: 50 }),
      rect('text', 600, 600, 50, 50),
      { id: 'group', type: 'group', x: 10, y: 600, width: 50, height: 50 },
      { id: 'pen', type: 'drawing', x: 10, y: 700, width: 50, height: 50, points: [] },
      card('outside', { x: 2000, y: 0 })
    ])
    expect(cardsInGroup(d, big).map((n) => n.id)).toEqual(['inBig', 'text'])
    expect(cardsInGroup(d, small).map((n) => n.id)).toEqual(['inSmall'])
  })
})

describe('formmap/map/logic findFree', () => {
  const r = { x: 0, y: 0, width: 200, height: 100 }

  it('keeps the requested rect when it is free', () => {
    expect(findFree(doc([card('far', { x: 2000, y: 2000 })]), r)).toEqual(r)
  })

  it('moves down first when the spot is taken, keeping clear of the blocker', () => {
    const blocker = card('b', { ...r })
    const out = findFree(doc([blocker]), r)
    expect(out.x).toBe(0)
    expect(out.y).toBeGreaterThan(r.y)
    expect(intersects(out, blocker)).toBe(false)
    expect(out).toMatchObject({ width: 200, height: 100 })
  })

  it('ignores groups, drawings and the ignored ids', () => {
    const d = doc([
      group('z', { x: -100, y: -100, width: 1000, height: 1000 }),
      { id: 'g', type: 'group', ...r },
      { id: 'p', type: 'drawing', ...r, points: [] },
      card('self', { ...r })
    ])
    expect(findFree(d, r, new Set(['self']))).toEqual(r)
  })

  it('never overlaps any card even in a crowded column', () => {
    const cards = Array.from({ length: 6 }, (_, i) => card(`c${i}`, { x: 0, y: i * 60, width: 200, height: 100 }))
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

describe('formmap/map/logic tidyGroup', () => {
  it('leaves an empty group as it is', () => {
    const z = group('z', { x: 0, y: 0, width: 700, height: 300 })
    expect(tidyGroup(doc([z]), z)).toEqual({ targets: new Map(), height: 300 })
  })

  it('lays the cards out in a grid below the header, in reading order', () => {
    const z = group('z', { x: 0, y: 0, width: 700, height: 600 })
    const d = doc([
      z,
      card('c', { x: 400, y: 300, width: 200, height: 100 }),
      card('a', { x: 50, y: 100, width: 200, height: 100 }),
      card('b', { x: 300, y: 110, width: 200, height: 100 }), // same row as a (within 40px)
      card('d', { x: 10, y: 450, width: 200, height: 100 })
    ])
    const { targets, height } = tidyGroup(d, z)
    expect([...targets.keys()]).toEqual(['a', 'b', 'c', 'd'])
    expect(Object.fromEntries(targets)).toEqual({ a: { x: 30, y: 40 }, b: { x: 250, y: 40 }, c: { x: 470, y: 40 }, d: { x: 30, y: 160 } })
    expect(height).toBe(600)
    for (const p of targets.values()) expect(p.y).toBeGreaterThanOrEqual(z.y + GROUP_TOP)
  })

  it('grows the group when the cards need more height, and never shrinks it', () => {
    const z = group('z', { x: 0, y: 0, width: 300, height: 200 })
    const d = doc([z, card('a', { x: 10, y: 10, width: 200, height: 40 }), card('b', { x: 10, y: 120, width: 200, height: 40 }), card('c', { x: 10, y: 150, width: 200, height: 40 })])
    const { targets, height } = tidyGroup(d, z)
    expect(targets.size).toBe(3) // one column
    const last = Math.max(...[...targets.values()].map((p) => p.y)) + 40
    expect(height).toBeGreaterThan(200)
    expect(height).toBeGreaterThanOrEqual(last)
  })

  it('does not touch cards that belong to a nested group', () => {
    const outer = group('outer', { x: 0, y: 0, width: 1000, height: 1000 })
    const inner = group('inner', { x: 500, y: 500, width: 400, height: 400 })
    const d = doc([outer, inner, card('o', { x: 10, y: 10 }), card('i', { x: 600, y: 600 })])
    expect([...tidyGroup(d, outer).targets.keys()]).toEqual(['o'])
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
    expect(formsOf([card('a'), rect('t', 0, 0, 1, 1), group('z', { x: 0, y: 0, width: 1, height: 1 })]).map((n) => n.id)).toEqual(['a'])
  })
})
