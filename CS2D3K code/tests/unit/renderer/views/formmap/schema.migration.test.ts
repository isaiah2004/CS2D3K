// Loading old and odd form-maps: version 1 (kinds + zones) migrates to version 2 without losing data; hand-edited data
// is repaired in memory (QUALITY.md: one odd card must not crash the lenses).
import { describe, expect, it } from 'vitest'
import { FORMMAP_VERSION, normalizeFormMap, forms, groups, metaOf, cardTitle, type FormMapData, type FormNode, type GroupNode, type KanbanNode } from '@/views/formmap/schema'
import { PD_FIELDS, PD_PRESETS, PD_RELATION_RULES } from '@/views/formmap/pack'
import type { CanvasData } from '@/views/canvas/model'
import { LEGACY_PATH, load, loadSample } from './fixtures'

const box = { x: 0, y: 0, width: 100, height: 50 }
type Raw = Record<string, unknown> & { id: string; type: string }

describe('formmap/schema migration of version 1 files', () => {
  const raw = load(LEGACY_PATH, false)
  const m = normalizeFormMap(raw) as FormMapData
  const rawNodes = raw.nodes as Raw[]

  it('bumps the version and keeps the title and template', () => {
    expect(raw.formmap?.version).toBe(1)
    expect(metaOf(m)).toMatchObject({ version: FORMMAP_VERSION, title: 'CS2D3K Definition', template: 'product-definition' })
  })

  it('keeps every node (same ids, positions and sizes) and every relation', () => {
    expect(m.nodes.map((n) => n.id)).toEqual(rawNodes.map((n) => n.id))
    m.nodes.forEach((n, i) => expect([n.x, n.y, n.width, n.height]).toEqual([rawNodes[i].x, rawNodes[i].y, rawNodes[i].width, rawNodes[i].height]))
    expect(m.edges).toEqual(raw.edges)
  })

  it("turns each card's kind into its first tag and keeps its title, text, votes and every field value", () => {
    for (const r of rawNodes.filter((n) => n.type === 'form')) {
      const f = m.nodes.find((n) => n.id === r.id) as FormNode
      expect(f.tags?.[0]).toBe(r.kind)
      expect('kind' in f).toBe(false)
      expect(f.fields).toEqual(r.fields)
      expect([f.title, f.text, f.votes]).toEqual([r.title, r.text, r.votes])
    }
  })

  it('turns zones into groups: locked, with their label, emoji, prompt, color, assign, order and default kind as preset', () => {
    const zs = rawNodes.filter((n) => n.type === 'zone')
    expect(zs).toHaveLength(8)
    for (const z of zs) {
      const g = m.nodes.find((n) => n.id === z.id) as GroupNode
      expect(g.type).toBe('group')
      expect(g).toMatchObject({ label: z.label, emoji: z.emoji, prompt: z.prompt, color: z.color, locked: true, preset: z.defaultKind })
      expect(g.assign).toEqual(z.assign)
      expect(g.order).toEqual(z.order)
      expect('defaultKind' in g).toBe(false)
    }
  })

  it('registers every field used, with the types, labels and options of the old schema', () => {
    const reg = metaOf(m).fields!
    for (const r of rawNodes.filter((n) => n.type === 'form')) for (const k of Object.keys(r.fields as object)) expect(reg[k], k).toEqual(PD_FIELDS[k])
    expect(reg.phase.options!.map((o) => o.value)).toEqual(['mvp', 'next', 'later', 'someday'])
    expect(reg.fun).toMatchObject({ type: 'rating', max: 5, label: 'Fun factor' })
    // one status field: each kind's statuses stay offered to that kind's cards
    expect(reg.status.options!.filter((o) => o.for?.includes('question')).map((o) => o.value)).toEqual(['open', 'decided', 'parked'])
  })

  it('colors the tags that were kinds, and adds the kind presets, relation rules and coach checks', () => {
    const meta = metaOf(m)
    expect(meta.tags).toMatchObject({ idea: { color: 'yellow' }, goal: { color: 'red' }, feature: { color: 'green' } })
    expect(meta.presets).toEqual(PD_PRESETS)
    expect(meta.relationRules).toEqual(PD_RELATION_RULES)
    expect(meta.checks?.map((c) => c.id)).toEqual(expect.arrayContaining(['feature-no-goal', 'goal-no-features', 'mvp-budget', 'open-questions']))
  })

  it('moves the MVP budget into the budget check', () => {
    expect(metaOf(m).mvpBudget).toBeUndefined()
    expect(metaOf(m).checks?.find((c) => c.id === 'mvp-budget')).toMatchObject({ type: 'sum', field: 'effort', max: 24 })
  })

  it('is idempotent: a migrated map normalizes to itself', () => {
    expect(normalizeFormMap(m)).toBe(m)
  })

  it('migrates the old sample into the same cards as the regenerated sample', () => {
    const now = loadSample()
    const strip = (f: FormNode): object => ({ id: f.id, title: f.title, text: f.text, tags: f.tags, fields: f.fields, votes: f.votes })
    expect(forms(m).map(strip)).toEqual(forms(now).map(strip))
    expect(groups(m).map((g) => [g.id, g.label, g.preset, g.assign, g.order])).toEqual(groups(now).map((g) => [g.id, g.label, g.preset, g.assign, g.order]))
  })

  it('keeps unknown keys of nodes and of the meta', () => {
    const d: CanvasData = { formmap: { version: 1, custom: 'keep' }, nodes: [{ id: 'f', type: 'form', kind: 'goal', fields: {}, extra: 42, ...box }, { id: 'z', type: 'zone', label: 'Z', mine: true, ...box }], edges: [] }
    const n = normalizeFormMap(d) as FormMapData
    expect(n.nodes[0].extra).toBe(42)
    expect(n.nodes[1]).toMatchObject({ type: 'group', mine: true, locked: true })
    expect((n.formmap as Record<string, unknown>).custom).toBe('keep')
  })

  it('keeps zones that were explicitly unlocked unlocked', () => {
    const d: CanvasData = { formmap: { version: 1 }, nodes: [{ id: 'z', type: 'zone', label: 'Z', locked: false, ...box }], edges: [] }
    expect(normalizeFormMap(d).nodes[0]).toMatchObject({ type: 'group', locked: false })
  })

  it('migrates a converted canvas (version 1, no kinds) without adding presets', () => {
    const d: CanvasData = { formmap: { version: 1, template: 'converted' }, nodes: [{ id: 't', type: 'text', text: 'hi', ...box }, { id: 'g', type: 'group', label: 'G', ...box }], edges: [] }
    const n = normalizeFormMap(d) as FormMapData
    expect(n.formmap).toEqual({ version: 2, template: 'converted' })
    expect(n.nodes).toEqual(d.nodes)
  })
})

describe('formmap/schema normalizeFormMap robustness', () => {
  it('repairs odd version 1 data: unknown kinds become tags, bad fields / votes / zones / drawings / relations', () => {
    const d: CanvasData = {
      formmap: { version: 1, title: 5, mvpBudget: 'lots' },
      nodes: [
        { id: 'f1', type: 'form', kind: 'nonsense', fields: 'oops', votes: 'many', ...box },
        { id: 'f2', type: 'form', kind: 'toString', title: 7, ...box },
        { id: 'z', type: 'zone', label: 3 as unknown as string, defaultKind: 'bogus', assign: 'x', order: 'first', ...box },
        { id: 'd', type: 'drawing', points: 'nope', ...box }
      ],
      edges: [
        { id: 'e1', fromNode: 'f1', toNode: 'f2', relation: 5 },
        { id: 'e2', fromNode: 'f1', toNode: 'f2', relation: 'serves' },
        { id: 'e3', fromNode: 'f1', toNode: 'f2', relation: 'blocks' }
      ]
    }
    const n = normalizeFormMap(d) as FormMapData
    const [f1, f2, z, dr] = n.nodes as Raw[]
    expect(f1).toMatchObject({ tags: ['nonsense'], fields: {} })
    expect(f1.votes).toBeUndefined()
    expect(f2).toMatchObject({ tags: ['toString'], title: '' })
    expect(() => cardTitle(f1 as unknown as FormNode)).not.toThrow()
    expect(z).toMatchObject({ type: 'group', label: '', preset: 'bogus' })
    expect(z.assign).toBeUndefined()
    expect(z.order).toBeUndefined()
    expect(dr.points).toEqual([])
    expect('relation' in n.edges[0]).toBe(false)
    expect(n.edges[1].relation).toBe('serves')
    // any relation name is valid now (custom relations)
    expect(n.edges[2].relation).toBe('blocks')
    expect(n.formmap?.title).toBeUndefined()
    expect(n.formmap?.mvpBudget).toBeUndefined()
  })

  it('returns the same object for valid version 2 data (no spurious re-render / save)', () => {
    const d: CanvasData = {
      formmap: { version: 2, title: 'T', fields: { phase: { type: 'select', options: [{ value: 'mvp' }] } }, tags: { goal: { color: 'red' } } },
      nodes: [
        { id: 'f', type: 'form', title: 'G', tags: ['goal'], fields: { phase: 'mvp' }, votes: 2, ...box },
        { id: 'g', type: 'group', label: 'Z', assign: { phase: 'mvp' }, locked: true, ...box },
        { id: 'k', type: 'kanban', title: 'K', columns: [{ id: 'c', title: 'C', cards: [{ id: 'x', title: 'X' }] }], ...box },
        { id: 'd', type: 'drawing', points: [0, 0, 1, 1], ...box },
        { id: 't', type: 'text', text: 'plain canvas node', ...box }
      ],
      edges: [{ id: 'e', fromNode: 'f', toNode: 'g', relation: 'custom thing' }]
    }
    expect(normalizeFormMap(d)).toBe(d)
  })

  it('registers fields and tags that cards use but the registries lack, with inferred types', () => {
    const d: CanvasData = {
      formmap: { version: 2 },
      nodes: [{ id: 'f', type: 'form', title: 'A', tags: ['#ux', 'ux', 7], fields: { Owner: 'Ana', Points: 3, Done: true, Tasks: [{ text: 'a', done: false }] }, ...box }],
      edges: []
    }
    const n = normalizeFormMap(d) as FormMapData
    expect((n.nodes[0] as FormNode).tags).toEqual(['ux'])
    expect(n.formmap?.fields).toEqual({ Owner: { type: 'text' }, Points: { type: 'number' }, Done: { type: 'checkbox' }, Tasks: { type: 'checklist' } })
    expect(Object.keys(n.formmap?.tags ?? {})).toEqual(['ux'])
    expect(normalizeFormMap(n)).toBe(n)
  })

  it('repairs kanban nodes: ids, columns, cards, titles and tags', () => {
    const d: CanvasData = {
      formmap: { version: 2 },
      nodes: [{ id: 'k', type: 'kanban', title: 9, columns: [{ title: 'A', cards: [{ title: 'x' }, 'junk', { id: 'dup', title: 'y', tags: 'one' }] }, { id: 'c2', cards: 'no' }, 'junk', { id: 'c3', title: 'C', cards: [{ id: 'dup', title: 'z' }] }], ...box }],
      edges: []
    }
    const k = normalizeFormMap(d).nodes[0] as KanbanNode
    expect(k.title).toBe('')
    expect(k.columns.map((c) => c.title)).toEqual(['A', '', 'C'])
    expect(k.columns[0].cards.map((c) => c.title)).toEqual(['x', 'y'])
    expect(k.columns[0].cards[1].tags).toEqual(['one'])
    expect(k.columns[1].cards).toEqual([])
    const ids = k.columns.flatMap((c) => [c.id, ...c.cards.map((x) => x.id)])
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids.every((id) => typeof id === 'string' && id)).toBe(true)
  })

  it('leaves an empty file alone (the template picker shows)', () => {
    const d: CanvasData = { nodes: [], edges: [] }
    expect(normalizeFormMap(d)).toBe(d)
  })

  it('replaces a non-object meta', () => {
    const n = normalizeFormMap({ formmap: 'x', nodes: [], edges: [] } as unknown as CanvasData) as FormMapData
    expect(n.formmap).toMatchObject({ version: FORMMAP_VERSION })
  })
})
