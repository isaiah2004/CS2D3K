import { describe, expect, it } from 'vitest'
import { productDefinitionGroups, TEMPLATES } from '@/views/formmap/templates'
import { FORMMAP_VERSION, groupAt, groups, metaOf, normalizeFormMap, presetById, type GroupNode } from '@/views/formmap/schema'
import { boardColumns } from '@/views/formmap/boards'
import { PD_FIELDS, PD_PRESETS, PD_RELATION_RULES, PD_TAGS, pdChecks } from '@/views/formmap/pack'
import { intersects, parseCanvas, serializeCanvas } from '@/views/canvas/model'
import { load, loadSample, loadSprint, SAMPLE_PATH, SPRINT_PATH } from './fixtures'

const center = (z: GroupNode): { x: number; y: number; width: number; height: number } => ({ x: z.x + z.width / 2, y: z.y + z.height / 2, width: 0, height: 0 })
const template = (id: string): (typeof TEMPLATES)[number] => TEMPLATES.find((t) => t.id === id)!

describe('formmap/templates', () => {
  it('offers Blank, Brainstorm, Kanban and Product definition, with unique ids, names, emoji and descriptions', () => {
    expect(TEMPLATES.map((t) => t.id)).toEqual(['blank', 'brainstorm', 'kanban', 'product-definition'])
    for (const t of TEMPLATES) {
      expect(t.name).toBeTruthy()
      expect(t.emoji).toBeTruthy()
      expect(t.description).toBeTruthy()
    }
  })

  describe.each(TEMPLATES.map((t) => [t.id, t] as const))('%s', (id, t) => {
    it('builds a doc stamped with the current version and its template id', () => {
      expect(t.build().formmap).toMatchObject({ version: FORMMAP_VERSION, template: id })
    })

    it('builds unique ids and edges between existing nodes', () => {
      const d = t.build()
      const ids = d.nodes.map((n) => n.id)
      expect(new Set(ids).size).toBe(ids.length)
      for (const e of d.edges) expect(ids).toEqual(expect.arrayContaining([e.fromNode, e.toNode]))
    })

    it('builds fresh ids every time (templates can be applied twice)', () => {
      const a = t.build().nodes.map((n) => n.id)
      const b = new Set(t.build().nodes.map((n) => n.id))
      expect(a.some((x) => b.has(x))).toBe(false)
    })

    it('only references presets, fields and groups that exist', () => {
      const d = t.build()
      const meta = metaOf(d)
      for (const g of groups(d)) {
        expect(g.label).toBeTruthy()
        if (g.preset) expect(presetById(meta, g.preset), g.preset).toBeDefined()
        for (const k of Object.keys(g.assign ?? {})) expect(meta.fields?.[k], k).toBeDefined()
      }
      for (const b of meta.boards ?? []) {
        if (b.source.mode === 'groups') for (const gid of b.source.groupIds) expect(groups(d).some((g) => g.id === gid)).toBe(true)
        else expect(meta.fields?.[b.source.field]).toBeDefined()
      }
      if (meta.hudBoard) expect(meta.boards?.some((b) => b.id === meta.hudBoard)).toBe(true)
    })

    it('is already normalized and survives a serialize → parse round trip', () => {
      const d = t.build()
      expect(normalizeFormMap(d)).toBe(d)
      const { data, valid } = parseCanvas(serializeCanvas(d))
      expect(valid).toBe(true)
      expect(data).toEqual(d)
    })
  })

  it('blank builds an empty map', () => {
    const d = template('blank').build()
    expect([d.nodes, d.edges]).toEqual([[], []])
  })

  it('kanban builds To do / Doing / Done groups inside a board group, with a saved board over them', () => {
    const d = template('kanban').build()
    const meta = metaOf(d)
    const cols = groups(d).filter((g) => g.label !== 'Board')
    expect(cols.map((g) => g.label)).toEqual(['To do', 'Doing', 'Done'])
    expect(meta.boards).toHaveLength(1)
    const columns = boardColumns(d, meta.boards![0])
    expect(columns.map((c) => c.label)).toEqual(['To do', 'Doing', 'Done'])
    expect(columns[0].cards.length).toBe(2)
    expect(meta.presets?.map((p) => p.name)).toEqual(['Task', 'Bug'])
  })

  describe('product definition (the example)', () => {
    const gs = productDefinitionGroups()
    const d = template('product-definition').build()
    const meta = metaOf(d)

    it('lays out the groups in pitch order: idea → philosophy → approach → goal → MVP → later → questions', () => {
      const ordered = gs.filter((z) => z.order !== undefined).sort((a, b) => a.order! - b.order!)
      expect(ordered.map((z) => z.label)).toEqual(['Core idea', 'Philosophy', 'Engineering approach', 'Final goal', 'Initial features (MVP)', 'Later features', 'Open questions'])
      const inbox = gs.find((z) => z.label === 'Idea inbox')!
      expect(inbox.preset).toBe('idea')
      expect(inbox.order).toBeUndefined()
    })

    it('assigns phases and the goal horizon through groups (position = meaning)', () => {
      const by = (label: string): GroupNode => gs.find((z) => z.label === label)!
      expect(by('Initial features (MVP)').assign).toEqual({ phase: 'mvp' })
      expect(by('Later features').assign).toEqual({ phase: 'later' })
      expect(by('Final goal').assign).toEqual({ horizon: 'final' })
    })

    it('has no overlapping groups, so every group center resolves to itself', () => {
      for (let i = 0; i < gs.length; i++) for (let j = i + 1; j < gs.length; j++) expect(intersects(gs[i], gs[j])).toBe(false)
      for (const z of gs) expect(groupAt({ nodes: gs, edges: [] }, center(z))?.id).toBe(z.id)
    })

    it('ships the old kinds as presets + tags, with fields, relation rules, checks and two example boards', () => {
      expect(meta.presets).toEqual(PD_PRESETS)
      expect(meta.tags).toEqual(PD_TAGS)
      expect(meta.fields).toEqual(PD_FIELDS)
      expect(meta.relationRules).toEqual(PD_RELATION_RULES)
      expect(meta.checks).toEqual(pdChecks(40))
      expect(meta.boards?.map((b) => b.name)).toEqual(['Roadmap', 'Features by status'])
    })
  })
})

describe('sample form-maps', () => {
  it('the CS2D3K definition uses the same pack as the Product Definition template', () => {
    const meta = metaOf(loadSample())
    expect(meta.version).toBe(FORMMAP_VERSION)
    expect(meta.fields).toEqual(PD_FIELDS)
    expect(meta.tags).toEqual(PD_TAGS)
    expect(meta.presets).toEqual(PD_PRESETS)
    expect(meta.relationRules).toEqual(PD_RELATION_RULES)
    expect(meta.checks).toEqual(pdChecks(24))
  })

  it('the sample files are already in the current format (nothing to migrate)', () => {
    for (const p of [SAMPLE_PATH, SPRINT_PATH]) {
      const raw = load(p, false)
      expect(normalizeFormMap(raw)).toBe(raw)
    }
  })

  it('the sprint board shows a kanban node, a saved groups board and a field board', () => {
    const d = loadSprint()
    const meta = metaOf(d)
    expect(d.nodes.some((n) => n.type === 'kanban')).toBe(true)
    expect(meta.boards?.map((b) => b.source.mode)).toEqual(['groups', 'field'])
    expect(boardColumns(d, meta.boards![0]).map((c) => [c.label, c.cards.length])).toEqual([
      ['To do', 3],
      ['Doing', 2],
      ['Review', 1],
      ['Done', 1]
    ])
  })
})
