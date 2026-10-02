import { describe, expect, it } from 'vitest'
import {
  applyZone,
  cardTitle,
  EFFORTS,
  effortPoints,
  FEATURE_STATUS,
  fieldDef,
  forms,
  isDrawing,
  isForm,
  isZone,
  KIND_ORDER,
  KINDS,
  newForm,
  optionOf,
  PHASES,
  PRIORITIES,
  RELATIONS,
  zoneAt,
  zones,
  type FormKind
} from '@/views/formmap/schema'
import { card, doc, zone } from './fixtures'

describe('formmap/schema constants', () => {
  it('lists every kind exactly once in KIND_ORDER, and every KIND_ORDER kind is defined', () => {
    expect(new Set(KIND_ORDER).size).toBe(KIND_ORDER.length)
    expect([...KIND_ORDER].sort()).toEqual(Object.keys(KINDS).sort())
  })

  it('keys each kind definition by its own kind and gives it a label, emoji, color and positive default size', () => {
    for (const k of KIND_ORDER) {
      const def = KINDS[k]
      expect(def.kind).toBe(k)
      expect(def.label).toBeTruthy()
      expect(def.plural).toBeTruthy()
      expect(def.emoji).toBeTruthy()
      expect(def.color).toBeTruthy()
      expect(def.defaultSize.width).toBeGreaterThan(0)
      expect(def.defaultSize.height).toBeGreaterThan(0)
    }
  })

  it('gives every field a unique key per kind, and every select field non-empty options with unique values', () => {
    for (const k of KIND_ORDER) {
      const keys = KINDS[k].fields.map((f) => f.key)
      expect(new Set(keys).size).toBe(keys.length)
      for (const f of KINDS[k].fields) {
        if (f.type !== 'select') continue
        expect(f.options?.length).toBeGreaterThan(0)
        const values = f.options!.map((o) => o.value)
        expect(new Set(values).size).toBe(values.length)
      }
    }
  })

  it('uses the shared option lists for feature phase, priority, effort and status', () => {
    expect(fieldDef('feature', 'phase')?.options).toBe(PHASES)
    expect(fieldDef('feature', 'priority')?.options).toBe(PRIORITIES)
    expect(fieldDef('feature', 'effort')?.options).toBe(EFFORTS)
    expect(fieldDef('feature', 'status')?.options).toBe(FEATURE_STATUS)
  })

  it('has strictly increasing effort points', () => {
    const pts = EFFORTS.map((e) => e.points)
    for (let i = 1; i < pts.length; i++) expect(pts[i]).toBeGreaterThan(pts[i - 1])
  })

  it('keys each relation definition by its own relation', () => {
    for (const [k, def] of Object.entries(RELATIONS)) {
      expect(def.relation).toBe(k)
      expect(def.label).toBeTruthy()
      expect(def.color).toBeTruthy()
    }
  })

  it('has a phase called mvp (the coach and the doc export rely on it)', () => {
    expect(PHASES.some((p) => p.value === 'mvp')).toBe(true)
  })
})

describe('formmap/schema node helpers', () => {
  it('recognises form, zone and drawing nodes by type', () => {
    const d = doc([card('f', 'idea'), zone('z', { x: 0, y: 0, width: 10, height: 10 }), { id: 'd', type: 'drawing', x: 0, y: 0, width: 1, height: 1, points: [] }, { id: 't', type: 'text', x: 0, y: 0, width: 1, height: 1 }])
    expect(d.nodes.filter(isForm).map((n) => n.id)).toEqual(['f'])
    expect(d.nodes.filter(isZone).map((n) => n.id)).toEqual(['z'])
    expect(d.nodes.filter(isDrawing).map((n) => n.id)).toEqual(['d'])
  })

  it('forms() and zones() return only their node type, in document order', () => {
    const d = doc([card('b', 'goal'), zone('z1', { x: 0, y: 0, width: 1, height: 1 }), { id: 't', type: 'text', x: 0, y: 0, width: 1, height: 1 }, card('a', 'idea'), zone('z2', { x: 0, y: 0, width: 1, height: 1 })])
    expect(forms(d).map((n) => n.id)).toEqual(['b', 'a'])
    expect(zones(d).map((n) => n.id)).toEqual(['z1', 'z2'])
    expect(forms(doc([]))).toEqual([])
  })
})

describe('formmap/schema newForm', () => {
  it.each(KIND_ORDER)('creates an empty %s card at the point with the kind default size', (kind: FormKind) => {
    const n = newForm(kind, { x: 12, y: -40 })
    expect(n).toMatchObject({ type: 'form', kind, title: '', text: '', fields: {}, x: 12, y: -40, ...KINDS[kind].defaultSize })
    expect(n.id).toMatch(/^[0-9a-f]{16}$/)
  })

  it('gives each new card a fresh id', () => {
    const ids = new Set(Array.from({ length: 50 }, () => newForm('idea', { x: 0, y: 0 }).id))
    expect(ids.size).toBe(50)
  })

  it('lets init override defaults (title, fields, size, even id)', () => {
    const n = newForm('feature', { x: 0, y: 0 }, { id: 'fixed', title: 'T', fields: { phase: 'mvp' }, width: 999 })
    expect(n).toMatchObject({ id: 'fixed', title: 'T', fields: { phase: 'mvp' }, width: 999, height: KINDS.feature.defaultSize.height })
  })
})

describe('formmap/schema zoneAt', () => {
  const big = zone('big', { x: 0, y: 0, width: 1000, height: 1000 })
  const small = zone('small', { x: 100, y: 100, width: 300, height: 300 })

  it('returns the zone containing the center of the rect', () => {
    const d = doc([big])
    expect(zoneAt(d, { x: 10, y: 10, width: 100, height: 100 })?.id).toBe('big')
  })

  it('uses the center, so a card hanging over the edge still belongs to the zone its center is in', () => {
    const d = doc([big])
    expect(zoneAt(d, { x: 900, y: 900, width: 150, height: 150 })?.id).toBe('big') // center 975,975
    expect(zoneAt(d, { x: 950, y: 950, width: 150, height: 150 })).toBeNull() // center 1025,1025
  })

  it('treats the zone border as inside', () => {
    const d = doc([big])
    expect(zoneAt(d, { x: -50, y: -50, width: 100, height: 100 })?.id).toBe('big') // center 0,0
    expect(zoneAt(d, { x: 1000, y: 1000, width: 0, height: 0 })?.id).toBe('big')
  })

  it('returns null outside every zone and when there are no zones', () => {
    expect(zoneAt(doc([big]), { x: 2000, y: 0, width: 10, height: 10 })).toBeNull()
    expect(zoneAt(doc([card('c', 'idea')]), { x: 0, y: 0, width: 10, height: 10 })).toBeNull()
  })

  it('picks the smallest zone when zones nest, regardless of document order', () => {
    const r = { x: 200, y: 200, width: 10, height: 10 }
    expect(zoneAt(doc([big, small]), r)?.id).toBe('small')
    expect(zoneAt(doc([small, big]), r)?.id).toBe('small')
    // outside the small one, the big one wins
    expect(zoneAt(doc([small, big]), { x: 600, y: 600, width: 10, height: 10 })?.id).toBe('big')
  })

  it('keeps the first zone in document order when overlapping zones have the same area', () => {
    const a = zone('a', { x: 0, y: 0, width: 100, height: 100 })
    const b = zone('b', { x: 50, y: 50, width: 100, height: 100 })
    const r = { x: 70, y: 70, width: 10, height: 10 }
    expect(zoneAt(doc([a, b]), r)?.id).toBe('a')
    expect(zoneAt(doc([b, a]), r)?.id).toBe('b')
  })

  it('ignores non-zone nodes such as groups', () => {
    const d = doc([{ id: 'g', type: 'group', x: 0, y: 0, width: 500, height: 500 }])
    expect(zoneAt(d, { x: 10, y: 10, width: 10, height: 10 })).toBeNull()
  })
})

describe('formmap/schema applyZone', () => {
  const later = zone('later', { x: 0, y: 0, width: 100, height: 100 }, { assign: { phase: 'later' } })

  it('applies the zone assign fields the card kind has', () => {
    const c = card('f', 'feature', { fields: { phase: 'mvp', priority: 'must' } })
    const out = applyZone(c, later)
    expect(out.fields).toEqual({ phase: 'later', priority: 'must' })
    expect(out).not.toBe(c)
    expect(c.fields.phase).toBe('mvp') // input not mutated
  })

  it('skips assign keys the card kind does not have', () => {
    const c = card('q', 'question', { fields: { status: 'open' } })
    expect(applyZone(c, later)).toBe(c)
    const mixed = zone('m', { x: 0, y: 0, width: 1, height: 1 }, { assign: { phase: 'mvp', status: 'decided' } })
    expect(applyZone(c, mixed).fields).toEqual({ status: 'decided' })
  })

  it('returns the same object when nothing changes', () => {
    const c = card('f', 'feature', { fields: { phase: 'later' } })
    expect(applyZone(c, later)).toBe(c)
  })

  it('is a no-op for no zone, or a zone without assign', () => {
    const c = card('f', 'feature')
    expect(applyZone(c, null)).toBe(c)
    expect(applyZone(c, zone('z', { x: 0, y: 0, width: 1, height: 1 }))).toBe(c)
    expect(applyZone(c, zone('z', { x: 0, y: 0, width: 1, height: 1 }, { assign: {} }))).toBe(c)
  })
})

describe('formmap/schema cardTitle', () => {
  it('prefers the trimmed title', () => {
    expect(cardTitle(card('a', 'idea', { title: '  Hello  ', text: 'Body' }))).toBe('Hello')
  })

  it('falls back to the first line of the text, without markdown heading marks', () => {
    expect(cardTitle(card('a', 'idea', { title: '', text: '## Big idea\nmore text' }))).toBe('Big idea')
    expect(cardTitle(card('a', 'idea', { title: '   ', text: 'plain first line\nsecond' }))).toBe('plain first line')
  })

  it('does not truncate long titles', () => {
    const long = 'x'.repeat(500)
    expect(cardTitle(card('a', 'idea', { title: long }))).toBe(long)
  })

  it('falls back to "Untitled <kind>" when title and text are empty or missing', () => {
    expect(cardTitle(card('a', 'principle', { title: '', text: '' }))).toBe('Untitled principle')
    expect(cardTitle(card('a', 'question', { title: '', text: undefined }))).toBe('Untitled question')
    expect(cardTitle(card('a', 'goal', { title: '', text: '\nsecond line only' }))).toBe('Untitled goal')
  })
})

describe('formmap/schema field helpers', () => {
  it('fieldDef finds a field of a kind, or undefined', () => {
    expect(fieldDef('feature', 'effort')?.type).toBe('select')
    expect(fieldDef('principle', 'strength')).toMatchObject({ type: 'rating', max: 5 })
    expect(fieldDef('note', 'phase')).toBeUndefined()
    expect(fieldDef('idea', 'nope')).toBeUndefined()
  })

  it('optionOf finds the option for a value, tolerating missing fields and unknown values', () => {
    expect(optionOf(fieldDef('feature', 'phase'), 'later')?.label).toBe('Later')
    expect(optionOf(fieldDef('feature', 'phase'), 'nope')).toBeUndefined()
    expect(optionOf(undefined, 'mvp')).toBeUndefined()
    expect(optionOf(fieldDef('goal', 'metric'), 'x')).toBeUndefined() // text field: no options
  })

  it('effortPoints maps t-shirt sizes to points and anything else to 0', () => {
    expect(effortPoints('xs')).toBe(1)
    expect(effortPoints('m')).toBe(3)
    expect(effortPoints('xl')).toBe(8)
    expect(effortPoints(undefined)).toBe(0)
    expect(effortPoints('huge')).toBe(0)
    expect(effortPoints(5)).toBe(0)
  })
})
