import { describe, expect, it } from 'vitest'
import { LodLayer, type LodNodeStyle, type LodScene } from '@/views/canvas/lodLayer'
import type { CanvasNode } from '@/views/canvas/model'

/** a 2D context that records every call (jsdom has no canvas) */
function recorder(): { ctx: CanvasRenderingContext2D; calls: { name: string; args: unknown[] }[] } {
  const calls: { name: string; args: unknown[] }[] = []
  const props: Record<string, unknown> = {}
  const ctx = new Proxy(props, {
    get: (t, k: string) => (k in t ? t[k] : (...args: unknown[]) => void calls.push({ name: k, args })),
    set: (t, k: string, v) => {
      t[k] = v
      return true
    }
  }) as unknown as CanvasRenderingContext2D
  return { ctx, calls }
}

function layer(): { l: LodLayer; calls: { name: string; args: unknown[] }[] } {
  const { ctx, calls } = recorder()
  const canvas = { getContext: () => ctx, style: {} as CSSStyleDeclaration, width: 0, height: 0 } as unknown as HTMLCanvasElement
  return { l: new LodLayer(canvas, document.body), calls }
}

const node = (id: string, x: number, y: number, width: number, height: number): CanvasNode => ({ id, type: 'kanban', x, y, width, height })
const scene = (nodes: CanvasNode[], style: (n: CanvasNode) => LodNodeStyle): LodScene => ({ nodes, layerOf: () => 'normal', style, selection: new Set(), edges: [], edgeStyle: () => ({}) })

describe('views/canvas/lodLayer kanban lanes', () => {
  it('draws one tinted lane (top stripe + a stub per card) per column inside a board card, with titles and counts', () => {
    const { l, calls } = layer()
    const k = node('k', 0, 0, 760, 400)
    l.render(
      scene([k], () => ({ title: 'Bugs', label: 'KANBAN', accent: 'red', lanes: [{ title: 'New', count: 2 }, { title: 'Fixed', count: 1, color: 'green' }] })),
      { x: 0, y: 0, width: 1000, height: 600 },
      1
    )
    const rects = calls.filter((c) => c.name === 'fillRect').map((c) => c.args)
    // accent stripe + lane 1 (tint, stripe, 2 stubs) + lane 2 (tint, stripe, 1 stub)
    expect(rects).toHaveLength(8)
    const [, tint1, , stub1a, stub1b, tint2] = rects
    expect(tint1[1]).toBe(46) // below the header strip
    expect(tint2[0]).toBeGreaterThan(tint1[0] as number)
    expect(stub1b[1]).toBeGreaterThan(stub1a[1] as number)
    const texts = calls.filter((c) => c.name === 'fillText').map((c) => c.args[0])
    expect(texts).toEqual(expect.arrayContaining(['KANBAN', 'Bugs', 'New · 2', 'Fixed · 1']))
  })

  it('caps the stubs at what fits in the lane', () => {
    const { l, calls } = layer()
    l.render(scene([node('k', 0, 0, 400, 200)], () => ({ title: 'B', lanes: [{ title: 'Many', count: 500 }] })), { x: 0, y: 0, width: 500, height: 300 }, 1)
    // lane height 200 - 46 - 12 = 142, minus the 40 px head → 2 stubs of 34 + 8
    expect(calls.filter((c) => c.name === 'fillRect')).toHaveLength(2 + 2)
  })

  it('draws no lanes for cards without them, nor for boards too small to hold them', () => {
    const { l, calls } = layer()
    l.render(
      scene([node('a', 0, 0, 200, 100), node('tiny', 300, 0, 20, 40)], (n) => (n.id === 'a' ? { title: 'Card' } : { title: 'T', lanes: [{ title: 'x', count: 0 }] })),
      { x: 0, y: 0, width: 400, height: 200 },
      1
    )
    expect(calls.filter((c) => c.name === 'fillRect')).toHaveLength(0)
  })
})
