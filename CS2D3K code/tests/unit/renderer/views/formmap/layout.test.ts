import { describe, expect, it } from 'vitest'
import { cardSizeFor, childGroups, freeSpotInGroup, freeSpotOutside, GROUP_PAD, GROUP_TOP } from '@/views/formmap/layout'
import { groupAt, groups, isInside, parentGroup } from '@/views/formmap/schema'
import { intersects } from '@/views/canvas/model'
import { card, doc, group } from './fixtures'

describe('formmap/layout', () => {
  it('places a card at the first padded spot of an empty group', () => {
    const g = group('g', { x: 100, y: 200, width: 600, height: 600 })
    expect(freeSpotInGroup(doc([g]), g, { width: 200, height: 100 })).toEqual({ x: 100 + GROUP_PAD, y: 200 + GROUP_TOP })
  })

  it('avoids cards and nested groups, and keeps the card inside the group', () => {
    const g = group('g', { x: 0, y: 0, width: 600, height: 600 })
    const nested = group('n', { x: 0, y: 0, width: 600, height: 250 })
    const taken = card('t', { x: 24, y: 280, width: 200, height: 100 })
    const d = doc([g, nested, taken])
    const at = freeSpotInGroup(d, g, { width: 200, height: 100 })
    const r = { ...at, width: 200, height: 100 }
    expect(intersects(r, taken)).toBe(false)
    expect(intersects(r, nested)).toBe(false)
    expect(groupAt(d, r)?.id).toBe('g')
  })

  it('cascades inside a full group so the card still belongs to it', () => {
    const g = group('g', { x: 0, y: 0, width: 260, height: 160 })
    const d = doc([g, card('a', { x: 20, y: 20, width: 220, height: 120 })])
    const at = freeSpotInGroup(d, g, { width: 200, height: 100 })
    expect(groupAt(d, { ...at, width: 200, height: 100 })?.id).toBe('g')
  })

  it('places a card outside every group, right of all content', () => {
    const d = doc([group('g', { x: 0, y: 0, width: 500, height: 500 }), card('a', { x: 600, y: 0 })])
    expect(freeSpotOutside(d, { width: 100, height: 50 })).toEqual({ x: 880, y: 0 })
    expect(freeSpotOutside(doc([]), { width: 100, height: 50 })).toEqual({ x: 0, y: 0 })
  })

  it('finds nested groups at any depth, and parents by size (no cycles between overlapping groups)', () => {
    const a = group('a', { x: 0, y: 0, width: 1000, height: 1000 })
    const b = group('b', { x: 100, y: 100, width: 500, height: 500 })
    const c = group('c', { x: 150, y: 150, width: 100, height: 100 })
    // overlapping twins: each contains the other's center
    const t1 = group('t1', { x: 2000, y: 0, width: 400, height: 400 })
    const t2 = group('t2', { x: 2150, y: 150, width: 380, height: 380 })
    const d = doc([a, b, c, t1, t2])
    expect(childGroups(d, a).map((g) => g.id)).toEqual(['b', 'c'])
    expect(childGroups(d, b).map((g) => g.id)).toEqual(['c'])
    expect(parentGroup(groups(d), c)?.id).toBe('b')
    expect(isInside(groups(d), c, 'a')).toBe(true)
    expect(parentGroup(groups(d), t2)?.id).toBe('t1')
    expect(parentGroup(groups(d), t1)).toBeNull()
  })

  it('sizes converted cards by their content', () => {
    const plain = cardSizeFor({})
    const rich = cardSizeFor({ text: 'x'.repeat(200), tags: ['a'], fields: { b: 1 } })
    expect(plain).toEqual({ width: 260, height: 100 })
    expect(rich.height).toBeGreaterThan(plain.height)
    expect(rich.height % 10).toBe(0)
  })
})
