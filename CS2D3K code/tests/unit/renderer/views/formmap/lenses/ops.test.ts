import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/views/formmap/fun/celebrate', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/views/formmap/fun/celebrate')>()),
  celebrate: vi.fn()
}))

import { celebrate } from '@/views/formmap/fun/celebrate'
import {
  addCard,
  addRelation,
  bestZoneFor,
  deleteNodes,
  freeSpotInZone,
  freeSpotOutside,
  inferRelation,
  moveToZone,
  patchNode,
  removeEdge,
  setField,
  setKind,
  setMeta,
  setRelation,
  vote,
  zoneIndex,
  zonesInOrder
} from '@/views/formmap/lenses/ops'
import { intersects } from '@/views/canvas/model'
import { forms, KINDS, zoneAt, type FormMapData, type FormMapEdge, type FormNode, type ZoneNode } from '@/views/formmap/schema'
import { card, doc, edge, fakeCtl, nodeById, zone } from '../fixtures'

const form = (d: FormMapData, id: string): FormNode => nodeById(d, id) as FormNode

/** A small product-definition-like board: MVP / Later / Questions zones plus a core zone without assign. */
function board(extra: FormNode[] = []): FormMapData {
  return doc([
    zone('core', { x: 0, y: 0, width: 2000, height: 300 }, { label: 'Core idea', order: 1, defaultKind: 'note' }),
    zone('mvp', { x: 0, y: 400, width: 700, height: 700 }, { label: 'MVP', order: 5, defaultKind: 'feature', assign: { phase: 'mvp' } }),
    zone('later', { x: 800, y: 400, width: 700, height: 700 }, { label: 'Later', order: 6, defaultKind: 'feature', assign: { phase: 'later' } }),
    zone('qs', { x: 1600, y: 400, width: 700, height: 700 }, { label: 'Questions', order: 7, defaultKind: 'question' }),
    zone('inbox', { x: -600, y: 400, width: 400, height: 700 }, { label: 'Inbox', defaultKind: 'idea' }),
    ...extra
  ])
}

beforeEach(() => {
  vi.mocked(celebrate).mockClear()
})

describe('formmap/lenses/ops geometry', () => {
  it('zonesInOrder puts ordered zones first (ascending), then the rest top-to-bottom, left-to-right', () => {
    const d = doc([
      zone('u2', { x: 50, y: 100, width: 10, height: 10 }),
      zone('o2', { x: 0, y: 0, width: 10, height: 10 }, { order: 2 }),
      zone('u1', { x: 0, y: 100, width: 10, height: 10 }),
      zone('o1', { x: 0, y: 900, width: 10, height: 10 }, { order: 1 }),
      zone('u0', { x: 0, y: 50, width: 10, height: 10 })
    ])
    expect(zonesInOrder(d).map((z) => z.id)).toEqual(['o1', 'o2', 'u0', 'u1', 'u2'])
  })

  it('zoneIndex maps every form card to its zone id or null', () => {
    const d = board([card('in', 'feature', { x: 100, y: 500 }), card('out', 'idea', { x: 5000, y: 5000 })])
    expect(zoneIndex(d)).toEqual(new Map([['in', 'mvp'], ['out', null]]))
  })

  it('freeSpotInZone returns the first padded grid spot below the zone header when the zone is empty', () => {
    const z = zone('z', { x: 100, y: 200, width: 600, height: 600 })
    expect(freeSpotInZone(doc([z]), z, { width: 200, height: 100 })).toEqual({ x: 124, y: 264 })
  })

  it('freeSpotInZone avoids cards already in the zone and keeps the new card inside', () => {
    const z = zone('z', { x: 0, y: 0, width: 600, height: 600 })
    const taken = card('t', 'idea', { x: 24, y: 64, width: 200, height: 100 })
    const at = freeSpotInZone(doc([z, taken]), z, { width: 200, height: 100 })
    const r = { ...at, width: 200, height: 100 }
    expect(intersects(r, taken)).toBe(false)
    expect(zoneAt(doc([z]), r)?.id).toBe('z')
  })

  it('freeSpotInZone ignores the excluded card (the one being moved)', () => {
    const z = zone('z', { x: 0, y: 0, width: 600, height: 600 })
    const self = card('self', 'idea', { x: 24, y: 64, width: 200, height: 100 })
    expect(freeSpotInZone(doc([z, self]), z, { width: 200, height: 100 }, 'self')).toEqual({ x: 24, y: 64 })
  })

  it('freeSpotInZone still lands the card center inside a full zone', () => {
    const z = zone('z', { x: 0, y: 0, width: 300, height: 200 })
    const blocker = card('b', 'idea', { x: 0, y: 0, width: 300, height: 200 })
    const size = { width: 200, height: 100 }
    const at = freeSpotInZone(doc([z, blocker]), z, size)
    expect(zoneAt(doc([z]), { ...at, ...size })?.id).toBe('z')
  })

  it('freeSpotOutside places right of all content without overlapping, or at the origin on an empty map', () => {
    expect(freeSpotOutside(doc([]), { width: 100, height: 100 })).toEqual({ x: 0, y: 0 })
    const d = doc([zone('z', { x: 0, y: 0, width: 500, height: 500 }), card('c', 'idea', { x: 600, y: 100, width: 100, height: 100 })])
    const at = freeSpotOutside(d, { width: 100, height: 100 })
    expect(at.x).toBeGreaterThan(700)
    expect(zoneAt(d, { ...at, width: 100, height: 100 })).toBeNull()
  })

  it('bestZoneFor prefers the zone whose default kind and assigned values match', () => {
    const d = board()
    expect(bestZoneFor(d, 'feature', { phase: 'later' })?.id).toBe('later')
    expect(bestZoneFor(d, 'feature', { phase: 'mvp' })?.id).toBe('mvp')
    expect(bestZoneFor(d, 'feature', {})?.id).toBe('mvp') // first in pitch order
    expect(bestZoneFor(d, 'question', {})?.id).toBe('qs')
    expect(bestZoneFor(d, 'idea', {})?.id).toBe('inbox')
  })

  it('bestZoneFor rejects zones that assign a conflicting value, and zones assigning the avoided key', () => {
    const d = board()
    expect(bestZoneFor(d, 'feature', { phase: 'someday' })).toBeNull()
    expect(bestZoneFor(d, 'feature', {}, 'phase')).toBeNull()
    expect(bestZoneFor(d, 'goal', {})).toBeNull()
  })
})

describe('formmap/lenses/ops card edits', () => {
  it('moveToZone moves a card into a zone and applies its fields in one update', () => {
    const { ctl, data, updates } = fakeCtl(board([card('f', 'feature', { x: 100, y: 500, fields: { phase: 'mvp' } })]))
    moveToZone(ctl, 'f', 'later')
    const f = form(data(), 'f')
    expect(zoneAt(data(), f)?.id).toBe('later')
    expect(f.fields.phase).toBe('later')
    expect(updates).toHaveLength(1)
  })

  it('moveToZone(null) moves a card out of every zone, keeping its fields', () => {
    const { ctl, data } = fakeCtl(board([card('f', 'feature', { x: 100, y: 500, fields: { phase: 'mvp' } })]))
    moveToZone(ctl, 'f', null)
    expect(zoneAt(data(), form(data(), 'f'))).toBeNull()
    expect(form(data(), 'f').fields.phase).toBe('mvp')
  })

  it('moveToZone is a no-op when the card is already there, or is not a form card', () => {
    const start = board([card('f', 'feature', { x: 100, y: 500 })])
    const { ctl, data } = fakeCtl(start)
    moveToZone(ctl, 'f', 'mvp')
    moveToZone(ctl, 'mvp', 'later')
    moveToZone(ctl, 'missing', 'later')
    expect(data()).toBe(start)
  })

  it('setField sets and clears a field on several cards', () => {
    const { ctl, data } = fakeCtl(doc([card('a', 'feature', { x: 9000 }), card('b', 'feature', { x: 9500, fields: { priority: 'must' } })]))
    setField(ctl, ['a', 'b'], 'priority', 'could')
    expect(form(data(), 'a').fields.priority).toBe('could')
    expect(form(data(), 'b').fields.priority).toBe('could')
    setField(ctl, 'a', 'priority', undefined)
    setField(ctl, 'b', 'priority', '')
    expect('priority' in form(data(), 'a').fields).toBe(false)
    expect('priority' in form(data(), 'b').fields).toBe(false)
  })

  it('setField moves a card to the zone that assigns the new value (MVP → Later), so position keeps meaning', () => {
    const { ctl, data } = fakeCtl(board([card('f', 'feature', { x: 100, y: 500, fields: { phase: 'mvp' } })]))
    setField(ctl, 'f', 'phase', 'later')
    expect(zoneAt(data(), form(data(), 'f'))?.id).toBe('later')
    expect(form(data(), 'f').fields.phase).toBe('later')
  })

  it('setField keeps the card in place when no zone assigns the new value', () => {
    const { ctl, data } = fakeCtl(board([card('f', 'feature', { x: 100, y: 500, fields: { phase: 'mvp' } })]))
    setField(ctl, 'f', 'phase', 'someday')
    expect(form(data(), 'f')).toMatchObject({ x: 100, y: 500, fields: { phase: 'someday' } })
  })

  // regression: clearing a zone-assigned field matched any zone that does not assign it (e.g. "Core idea")
  it('setField clearing a zone-assigned field does not teleport the card into an unrelated zone', () => {
    for (const value of [undefined, '']) {
      const { ctl, data } = fakeCtl(board([card('f', 'feature', { x: 100, y: 500, fields: { phase: 'mvp' } })]))
      setField(ctl, 'f', 'phase', value)
      const f = form(data(), 'f')
      expect('phase' in f.fields).toBe(false)
      expect(zoneAt(data(), f)?.id).not.toBe('core')
      expect(f).toMatchObject({ x: 100, y: 500 })
    }
  })

  it('setField does not move cards for fields outside the zone assign', () => {
    const { ctl, data } = fakeCtl(board([card('f', 'feature', { x: 100, y: 500, fields: { phase: 'mvp' } })]))
    setField(ctl, 'f', 'priority', 'must')
    expect(form(data(), 'f')).toMatchObject({ x: 100, y: 500 })
  })

  it('setField leaves unchanged and non-form nodes alone', () => {
    const start = board([card('f', 'feature', { x: 100, y: 500, fields: { phase: 'mvp' } })])
    const { ctl, data } = fakeCtl(start)
    setField(ctl, 'f', 'phase', 'mvp')
    setField(ctl, 'mvp', 'phase', 'later')
    expect(data().nodes).toEqual(start.nodes)
  })

  it('setField celebrates wins (feature done, question decided, approach accepted) at the given point', () => {
    const { ctl } = fakeCtl(doc([card('f', 'feature'), card('q', 'question'), card('a', 'approach')]))
    setField(ctl, 'f', 'status', 'done', { clientX: 5, clientY: 6 })
    expect(celebrate).toHaveBeenLastCalledWith(5, 6)
    setField(ctl, 'q', 'status', 'decided')
    setField(ctl, 'a', 'status', 'accepted')
    expect(celebrate).toHaveBeenCalledTimes(3)
  })

  it('setField does not celebrate ordinary changes or repeats', () => {
    const { ctl } = fakeCtl(doc([card('f', 'feature', { fields: { status: 'done' } }), card('q', 'question')]))
    setField(ctl, 'f', 'status', 'done')
    setField(ctl, 'q', 'status', 'parked')
    setField(ctl, 'f', 'phase', 'mvp')
    expect(celebrate).not.toHaveBeenCalled()
  })

  it('setKind changes the kind and keeps the fields (switching back is lossless)', () => {
    const { ctl, data } = fakeCtl(doc([card('a', 'idea', { fields: { status: 'raw', source: 'x' } }), card('b', 'goal')]))
    setKind(ctl, ['a', 'b'], 'feature')
    expect(form(data(), 'a')).toMatchObject({ kind: 'feature', fields: { status: 'raw', source: 'x' } })
    expect(form(data(), 'b').kind).toBe('feature')
    setKind(ctl, 'a', 'idea')
    expect(form(data(), 'a')).toMatchObject({ kind: 'idea', fields: { status: 'raw', source: 'x' } })
  })

  it('vote adds and removes votes, never below zero, coalescing undo per card', () => {
    const { ctl, data, updates } = fakeCtl(doc([card('a', 'idea')]))
    vote(ctl, 'a', 1)
    vote(ctl, 'a', 1)
    expect(form(data(), 'a').votes).toBe(2)
    vote(ctl, 'a', -5)
    expect(form(data(), 'a').votes).toBe(0)
    expect(updates).toEqual([{ history: 'vote:a' }, { history: 'vote:a' }, { history: 'vote:a' }])
  })

  it('addCard puts a card in its natural zone with the zone fields applied, and returns its id', () => {
    const { ctl, data } = fakeCtl(board())
    const id = addCard(ctl, 'feature', { title: 'Later thing', fields: { phase: 'later' } })
    const f = form(data(), id)
    expect(f).toMatchObject({ kind: 'feature', title: 'Later thing', fields: { phase: 'later' }, ...KINDS.feature.defaultSize })
    expect(zoneAt(data(), f)?.id).toBe('later')
  })

  it('addCard into the default zone assigns its fields', () => {
    const { ctl, data } = fakeCtl(board())
    const id = addCard(ctl, 'feature')
    expect(form(data(), id).fields.phase).toBe('mvp')
  })

  it('addCard honours an explicit zone, or null for outside all zones', () => {
    const { ctl, data } = fakeCtl(board())
    const inQs = addCard(ctl, 'feature', { zoneId: 'qs' })
    const outside = addCard(ctl, 'feature', { zoneId: null })
    expect(zoneAt(data(), form(data(), inQs))?.id).toBe('qs')
    expect(zoneAt(data(), form(data(), outside))).toBeNull()
  })

  it('addCard with avoidKey keeps a "no phase" feature out of phase-assigning zones', () => {
    const { ctl, data } = fakeCtl(board())
    const id = addCard(ctl, 'feature', { avoidKey: 'phase' })
    const f = form(data(), id)
    expect(f.fields.phase).toBeUndefined()
    expect(zoneAt(data(), f)).toBeNull()
  })

  it('addCard never stacks new cards on top of each other', () => {
    const { ctl, data } = fakeCtl(board())
    for (let i = 0; i < 6; i++) addCard(ctl, 'feature', { fields: { phase: 'mvp' } })
    const cards = forms(data())
    for (let i = 0; i < cards.length; i++) for (let j = i + 1; j < cards.length; j++) expect(intersects(cards[i], cards[j])).toBe(false)
    for (const c of cards) expect(zoneAt(data(), c)?.id).toBe('mvp')
  })

  it('deleteNodes removes nodes and every edge touching them (or listed by id)', () => {
    const { ctl, data } = fakeCtl(doc([card('a', 'feature'), card('b', 'goal'), card('c', 'goal')], [edge('a', 'b', 'serves'), edge('c', 'b', 'relates'), edge('a', 'c', 'serves')]))
    deleteNodes(ctl, ['a', 'c->b'])
    expect(data().nodes.map((n) => n.id)).toEqual(['b', 'c'])
    expect(data().edges).toEqual([])
  })

  it('patchNode shallow-patches any node, with an optional history key', () => {
    const { ctl, data, updates } = fakeCtl(board())
    patchNode(ctl, 'mvp', { locked: false, label: 'Must ship' }, 'zone')
    expect(nodeById(data(), 'mvp') as ZoneNode).toMatchObject({ locked: false, label: 'Must ship', assign: { phase: 'mvp' } })
    patchNode(ctl, 'later', { emoji: '🔭' })
    expect(updates).toEqual([{ history: 'zone' }, undefined])
  })

  it('setMeta merges into the formmap meta, creating it when missing', () => {
    const { ctl, data } = fakeCtl(doc([]))
    setMeta(ctl, { mvpBudget: 30 })
    expect(data().formmap).toEqual({ version: 1, mvpBudget: 30 })
    setMeta(ctl, { title: 'T' })
    expect(data().formmap).toEqual({ version: 1, mvpBudget: 30, title: 'T' })
  })
})

describe('formmap/lenses/ops relations', () => {
  it('inferRelation picks a sensible default per kind pair', () => {
    expect(inferRelation('feature', 'goal')).toBe('serves')
    expect(inferRelation('approach', 'goal')).toBe('serves')
    expect(inferRelation('feature', 'principle')).toBe('because')
    expect(inferRelation('idea', 'feature')).toBe('refines')
    expect(inferRelation('feature', 'feature')).toBe('depends')
    expect(inferRelation('feature', 'approach')).toBe('depends')
    expect(inferRelation('note', 'question')).toBe('relates')
  })

  it('addRelation adds an arrowed, typed edge once, and never a self-loop', () => {
    const { ctl, data } = fakeCtl(doc([card('a', 'feature'), card('g', 'goal')]))
    addRelation(ctl, 'a', 'g', 'serves')
    addRelation(ctl, 'a', 'g', 'serves')
    addRelation(ctl, 'a', 'a', 'depends')
    expect(data().edges).toHaveLength(1)
    expect(data().edges[0]).toMatchObject({ fromNode: 'a', toNode: 'g', relation: 'serves', toEnd: 'arrow' })
    addRelation(ctl, 'a', 'g', 'relates')
    expect(data().edges).toHaveLength(2)
  })

  it('addRelation treats an untyped edge as relates when checking duplicates', () => {
    const { ctl, data } = fakeCtl(doc([card('a', 'feature'), card('b', 'feature')], [edge('a', 'b')]))
    addRelation(ctl, 'a', 'b', 'relates')
    expect(data().edges).toHaveLength(1)
  })

  it('setRelation retypes one edge and removeEdge deletes it', () => {
    const { ctl, data } = fakeCtl(doc([card('a', 'feature'), card('b', 'feature')], [edge('a', 'b', 'relates'), edge('b', 'a', 'relates')]))
    setRelation(ctl, 'a->b', 'depends')
    expect((data().edges as FormMapEdge[]).map((e) => e.relation)).toEqual(['depends', 'relates'])
    removeEdge(ctl, 'a->b')
    expect(data().edges.map((e) => e.id)).toEqual(['b->a'])
  })
})
