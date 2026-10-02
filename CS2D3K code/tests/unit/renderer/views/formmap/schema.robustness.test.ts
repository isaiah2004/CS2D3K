// Regression tests from the robustness audit (QUALITY.md): odd form-map data must not crash the lenses.
import { describe, expect, it } from 'vitest'
import { normalizeFormMap, KINDS, cardTitle, type FormNode } from '@/views/formmap/schema'
import type { CanvasData } from '@/views/canvas/model'

const box = { x: 0, y: 0, width: 100, height: 50 }

describe('views/formmap/schema normalizeFormMap', () => {
  it('repairs unknown kinds, non-object fields, bad votes, zones, drawings and relations', () => {
    const d: CanvasData = {
      formmap: { version: 1, title: 5, mvpBudget: 'lots' },
      nodes: [
        { id: 'f1', type: 'form', kind: 'nonsense', fields: 'oops', votes: 'many', ...box },
        { id: 'f2', type: 'form', kind: 'toString', title: 7, ...box },
        { id: 'z', type: 'zone', label: 3 as unknown as string, defaultKind: 'bogus', assign: 'x', order: 'first', ...box },
        { id: 'd', type: 'drawing', points: 'nope', ...box }
      ],
      edges: [
        { id: 'e1', fromNode: 'f1', toNode: 'f2', relation: 'nope' },
        { id: 'e2', fromNode: 'f1', toNode: 'f2', relation: 'serves' }
      ]
    }
    const n = normalizeFormMap(d)
    const [f1, f2, z, dr] = n.nodes
    expect(f1.kind).toBe('note')
    expect(f1.fields).toEqual({})
    expect(f1.votes).toBeUndefined()
    expect(f2.kind).toBe('note')
    expect(f2.title).toBe('')
    expect(() => cardTitle(f1 as FormNode)).not.toThrow()
    expect(KINDS[(f1 as FormNode).kind]).toBeDefined()
    expect(z.label).toBe('')
    expect(z.defaultKind).toBeUndefined()
    expect(z.assign).toBeUndefined()
    expect(z.order).toBeUndefined()
    expect(dr.points).toEqual([])
    expect('relation' in n.edges[0]).toBe(false)
    expect(n.edges[1].relation).toBe('serves')
    const meta = n.formmap as { title?: unknown; mvpBudget?: unknown }
    expect(meta.title).toBeUndefined()
    expect(meta.mvpBudget).toBeUndefined()
  })

  it('returns the same object for valid data (no spurious re-render / save)', () => {
    const d: CanvasData = {
      formmap: { version: 1, title: 'T' },
      nodes: [
        { id: 'f', type: 'form', kind: 'goal', title: 'G', fields: { phase: 'mvp' }, votes: 2, ...box },
        { id: 'z', type: 'zone', label: 'Z', assign: { phase: 'later' }, ...box },
        { id: 'd', type: 'drawing', points: [0, 0, 1, 1], ...box },
        { id: 't', type: 'text', text: 'plain canvas node', ...box }
      ],
      edges: [{ id: 'e', fromNode: 'f', toNode: 'z', relation: 'relates' }]
    }
    expect(normalizeFormMap(d)).toBe(d)
  })
})
