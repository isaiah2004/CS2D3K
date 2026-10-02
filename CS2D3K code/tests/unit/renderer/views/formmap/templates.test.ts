import { describe, expect, it } from 'vitest'
import { productDefinitionZones, TEMPLATES } from '@/views/formmap/templates'
import { FORMMAP_VERSION, KINDS, zoneAt, zones, type ZoneNode } from '@/views/formmap/schema'
import { intersects, parseCanvas, serializeCanvas } from '@/views/canvas/model'

const center = (z: ZoneNode): { x: number; y: number; width: number; height: number } => ({ x: z.x + z.width / 2, y: z.y + z.height / 2, width: 0, height: 0 })

describe('formmap/templates', () => {
  it('has unique template ids, each with a name, emoji and description', () => {
    expect(new Set(TEMPLATES.map((t) => t.id)).size).toBe(TEMPLATES.length)
    for (const t of TEMPLATES) {
      expect(t.name).toBeTruthy()
      expect(t.emoji).toBeTruthy()
      expect(t.description).toBeTruthy()
    }
    expect(TEMPLATES.map((t) => t.id)).toEqual(expect.arrayContaining(['product-definition', 'brainstorm', 'blank']))
  })

  describe.each(TEMPLATES.map((t) => [t.id, t] as const))('%s', (id, t) => {
    it('builds a doc stamped with the current version and its template id', () => {
      const d = t.build()
      expect(d.formmap).toMatchObject({ version: FORMMAP_VERSION, template: id })
    })

    it('builds nodes with unique ids and edges that reference existing nodes', () => {
      const d = t.build()
      const ids = d.nodes.map((n) => n.id)
      expect(new Set(ids).size).toBe(ids.length)
      for (const e of d.edges) {
        expect(ids).toContain(e.fromNode)
        expect(ids).toContain(e.toNode)
      }
    })

    it('builds fresh ids every time (templates can be applied twice)', () => {
      const a = t.build().nodes.map((n) => n.id)
      const b = new Set(t.build().nodes.map((n) => n.id))
      expect(a.some((x) => b.has(x))).toBe(false)
    })

    it('builds zones with a label, emoji, prompt, positive size, a known default kind and assignable fields', () => {
      for (const z of zones(t.build())) {
        expect(z.label).toBeTruthy()
        expect(z.emoji).toBeTruthy()
        expect(z.prompt).toBeTruthy()
        expect(z.width).toBeGreaterThan(0)
        expect(z.height).toBeGreaterThan(0)
        expect(z.locked).toBe(true)
        if (z.defaultKind) expect(KINDS[z.defaultKind]).toBeDefined()
        for (const [k, v] of Object.entries(z.assign ?? {})) {
          // the zone's own default kind must be able to receive what it assigns
          const f = KINDS[z.defaultKind!].fields.find((x) => x.key === k)
          expect(f).toBeDefined()
          if (f?.options) expect(f.options.map((o) => o.value)).toContain(v)
        }
      }
    })

    it('gives ordered zones unique pitch orders', () => {
      const orders = zones(t.build())
        .map((z) => z.order)
        .filter((o): o is number => o !== undefined)
      expect(new Set(orders).size).toBe(orders.length)
    })

    it('survives a serialize → parse round trip unchanged', () => {
      const d = t.build()
      const { data, valid } = parseCanvas(serializeCanvas(d))
      expect(valid).toBe(true)
      expect(data).toEqual(d)
    })
  })

  describe('product definition', () => {
    const zs = productDefinitionZones()

    it('lays out the definition zones in pitch order: idea → philosophy → approach → goal → MVP → later → questions', () => {
      const ordered = zs.filter((z) => z.order !== undefined).sort((a, b) => a.order! - b.order!)
      expect(ordered.map((z) => z.label)).toEqual(['Core idea', 'Philosophy', 'Engineering approach', 'Final goal', 'Initial features (MVP)', 'Later features', 'Open questions'])
      expect(ordered.map((z) => z.order)).toEqual([1, 2, 3, 4, 5, 6, 7])
    })

    it('keeps the idea inbox out of the pitch', () => {
      const inbox = zs.find((z) => z.label === 'Idea inbox')
      expect(inbox?.order).toBeUndefined()
      expect(inbox?.defaultKind).toBe('idea')
    })

    it('assigns phases and the goal horizon through zones (position = meaning)', () => {
      const by = (label: string): ZoneNode => zs.find((z) => z.label === label)!
      expect(by('Initial features (MVP)').assign).toEqual({ phase: 'mvp' })
      expect(by('Later features').assign).toEqual({ phase: 'later' })
      expect(by('Final goal').assign).toEqual({ horizon: 'final' })
    })

    it('has no overlapping zones, so every zone center resolves to itself', () => {
      for (let i = 0; i < zs.length; i++) for (let j = i + 1; j < zs.length; j++) expect(intersects(zs[i], zs[j])).toBe(false)
      const d = { nodes: zs, edges: [] }
      for (const z of zs) expect(zoneAt(d, center(z))?.id).toBe(z.id)
    })

    it('comes with an MVP budget', () => {
      const t = TEMPLATES.find((x) => x.id === 'product-definition')!
      expect(t.build().formmap?.mvpBudget).toBeGreaterThan(0)
    })
  })

  it('blank builds an empty map', () => {
    const d = TEMPLATES.find((x) => x.id === 'blank')!.build()
    expect(d.nodes).toEqual([])
    expect(d.edges).toEqual([])
  })
})
