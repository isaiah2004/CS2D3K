import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { flushPromises, loadTestVault } from '../../../helpers/vault'
import { broadcastContent, flushAll } from '@/lib/fileops'
import { useCanvasDoc, type CanvasDoc } from '@/views/canvas/useCanvasDoc'
import type { CanvasData, CanvasNode } from '@/views/canvas/model'

// mounts React roots: give them headroom on a loaded full-suite run
vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 })

// Minimal renderHook: mounts a probe component and exposes the latest hook result.
const mounted: Root[] = []

async function mountDoc(path: string): Promise<{ doc: () => CanvasDoc; unmount: () => void }> {
  let latest: CanvasDoc | null = null
  function Probe(): null {
    latest = useCanvasDoc(path)
    return null
  }
  const root = createRoot(document.createElement('div'))
  mounted.push(root)
  act(() => root.render(createElement(Probe)))
  await settle()
  return { doc: () => latest!, unmount: () => act(() => root.unmount()) }
}

async function settle(ms = 0): Promise<void> {
  await act(async () => {
    await flushPromises(ms)
  })
}

const textNode = (id: string, x = 0): CanvasNode => ({ id, type: 'text', x, y: 0, width: 100, height: 50, text: id })
const addNode =
  (n: CanvasNode) =>
  (d: CanvasData): CanvasData => ({ ...d, nodes: [...d.nodes, n] })
const ids = (doc: CanvasDoc): string[] => doc.data.nodes.map((n) => n.id)

beforeAll(() => {
  ;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})

afterEach(() => {
  for (const r of mounted.splice(0)) act(() => r.unmount())
})

describe('views/canvas/useCanvasDoc', () => {
  it('loads and parses the canvas file', async () => {
    await loadTestVault({ 'a.canvas': JSON.stringify({ nodes: [textNode('n1')], edges: [], extra: 1 }) })
    const { doc } = await mountDoc('a.canvas')
    expect(doc().loaded).toBe(true)
    expect(doc().invalid).toBe(false)
    expect(ids(doc())).toEqual(['n1'])
    expect(doc().data.extra).toBe(1)
    expect(doc().canUndo).toBe(false)
  })

  it('marks an unparsable file invalid and never overwrites it unless edited', async () => {
    const mem = await loadTestVault({ 'bad.canvas': '{ not json' })
    const { doc, unmount } = await mountDoc('bad.canvas')
    expect(doc().invalid).toBe(true)
    expect(doc().data).toEqual({ nodes: [], edges: [] })
    doc().flush()
    unmount()
    await flushPromises()
    expect(mem.files.get('bad.canvas')).toBe('{ not json')
    expect(mem.writes).toHaveLength(0)
  })

  it('clears the invalid flag and saves once the user edits an invalid file', async () => {
    const mem = await loadTestVault({ 'bad.canvas': '{ not json' })
    const { doc } = await mountDoc('bad.canvas')
    act(() => doc().update(addNode(textNode('n1'))))
    expect(doc().invalid).toBe(false)
    act(() => doc().flush())
    await settle()
    expect(JSON.parse(mem.files.get('bad.canvas')!).nodes[0].id).toBe('n1')
  })

  it('treats a missing file as loaded and empty', async () => {
    await loadTestVault({})
    const { doc } = await mountDoc('missing.canvas')
    expect(doc().loaded).toBe(true)
    expect(doc().data).toEqual({ nodes: [], edges: [] })
  })

  it('does not record history or save when the updater returns the same object', async () => {
    const mem = await loadTestVault({ 'a.canvas': '{"nodes":[],"edges":[]}' })
    const { doc } = await mountDoc('a.canvas')
    act(() => doc().update((d) => d))
    act(() => doc().flush())
    await settle()
    expect(doc().canUndo).toBe(false)
    expect(mem.writes).toHaveLength(0)
  })

  it('undoes and redoes updates, and a new update clears the redo stack', async () => {
    await loadTestVault({ 'a.canvas': '' })
    const { doc } = await mountDoc('a.canvas')
    act(() => doc().update(addNode(textNode('a'))))
    act(() => doc().update(addNode(textNode('b'))))
    expect(ids(doc())).toEqual(['a', 'b'])
    act(() => doc().undo())
    expect(ids(doc())).toEqual(['a'])
    expect(doc().canRedo).toBe(true)
    act(() => doc().redo())
    expect(ids(doc())).toEqual(['a', 'b'])
    act(() => doc().undo())
    act(() => doc().update(addNode(textNode('c'))))
    expect(doc().canRedo).toBe(false)
    act(() => doc().redo())
    expect(ids(doc())).toEqual(['a', 'c'])
  })

  it('ignores undo/redo with empty stacks', async () => {
    await loadTestVault({ 'a.canvas': '' })
    const { doc } = await mountDoc('a.canvas')
    const before = doc().externalVersion
    act(() => doc().undo())
    act(() => doc().redo())
    expect(doc().externalVersion).toBe(before)
  })

  it('bumps externalVersion on undo/redo so the engine resyncs', async () => {
    await loadTestVault({ 'a.canvas': '' })
    const { doc } = await mountDoc('a.canvas')
    act(() => doc().update(addNode(textNode('a'))))
    const v = doc().externalVersion
    act(() => doc().undo())
    expect(doc().externalVersion).toBe(v + 1)
  })

  it('coalesces consecutive updates with the same history key into one undo step', async () => {
    await loadTestVault({ 'a.canvas': '' })
    const { doc } = await mountDoc('a.canvas')
    act(() => doc().update(addNode(textNode('a'))))
    const move = (x: number) => (d: CanvasData): CanvasData => ({ ...d, nodes: d.nodes.map((n) => ({ ...n, x })) })
    act(() => doc().update(move(10), { history: 'move' }))
    act(() => doc().update(move(20), { history: 'move' }))
    act(() => doc().update(move(30), { history: 'move' }))
    act(() => doc().undo())
    expect(doc().data.nodes[0].x).toBe(0)
  })

  it('does not coalesce updates with different keys', async () => {
    await loadTestVault({ 'a.canvas': '' })
    const { doc } = await mountDoc('a.canvas')
    act(() => doc().update(addNode(textNode('a')), { history: 'k1' }))
    act(() => doc().update(addNode(textNode('b')), { history: 'k2' }))
    act(() => doc().undo())
    expect(ids(doc())).toEqual(['a'])
  })

  it('caps the undo history at 200 steps, dropping the oldest', async () => {
    await loadTestVault({ 'a.canvas': '' })
    const { doc } = await mountDoc('a.canvas')
    act(() => {
      for (let i = 0; i < 201; i++) doc().update(addNode(textNode('n' + i)))
    })
    act(() => {
      for (let i = 0; i < 250; i++) doc().undo()
    })
    expect(ids(doc())).toEqual(['n0'])
    expect(doc().canUndo).toBe(false)
  })

  it('applies history:false updates without an undo entry', async () => {
    await loadTestVault({ 'a.canvas': '' })
    const { doc } = await mountDoc('a.canvas')
    act(() => doc().update(addNode(textNode('a')), { history: false }))
    expect(ids(doc())).toEqual(['a'])
    expect(doc().canUndo).toBe(false)
  })

  it('checkpoint() lets a sequence of history:false updates be undone as one step', async () => {
    await loadTestVault({ 'a.canvas': '' })
    const { doc } = await mountDoc('a.canvas')
    act(() => doc().checkpoint())
    act(() => doc().update(addNode(textNode('a')), { history: false }))
    act(() => doc().update(addNode(textNode('b')), { history: false }))
    act(() => doc().undo())
    expect(ids(doc())).toEqual([])
  })

  it('debounces saves and writes the serialized canvas on flush', async () => {
    const mem = await loadTestVault({ 'a.canvas': '' })
    const { doc } = await mountDoc('a.canvas')
    act(() => doc().update(addNode(textNode('a'))))
    act(() => doc().update(addNode(textNode('b'))))
    expect(mem.writes).toHaveLength(0)
    act(() => doc().flush())
    await settle()
    expect(mem.writes).toHaveLength(1)
    expect(JSON.parse(mem.files.get('a.canvas')!).nodes.map((n: CanvasNode) => n.id)).toEqual(['a', 'b'])
  })

  it('flushes pending saves through the global flusher (window close)', async () => {
    const mem = await loadTestVault({ 'a.canvas': '' })
    const { doc } = await mountDoc('a.canvas')
    act(() => doc().update(addNode(textNode('a'))))
    flushAll()
    await settle()
    expect(JSON.parse(mem.files.get('a.canvas')!).nodes).toHaveLength(1)
  })

  it('flushes a pending save on unmount', async () => {
    const mem = await loadTestVault({ 'a.canvas': '' })
    const { doc, unmount } = await mountDoc('a.canvas')
    act(() => doc().update(addNode(textNode('a'))))
    unmount()
    await flushPromises()
    expect(JSON.parse(mem.files.get('a.canvas')!).nodes).toHaveLength(1)
  })

  it('replaces data on external change, keeping it undoable', async () => {
    await loadTestVault({ 'a.canvas': JSON.stringify({ nodes: [textNode('a')], edges: [] }) })
    const { doc } = await mountDoc('a.canvas')
    const v = doc().externalVersion
    act(() => broadcastContent('a.canvas', JSON.stringify({ nodes: [textNode('x')], edges: [] })))
    expect(ids(doc())).toEqual(['x'])
    expect(doc().externalVersion).toBe(v + 1)
    act(() => doc().undo())
    expect(ids(doc())).toEqual(['a'])
  })

  it('ignores external changes that are invalid or identical to the current data', async () => {
    await loadTestVault({ 'a.canvas': JSON.stringify({ nodes: [textNode('a')], edges: [] }) })
    const { doc } = await mountDoc('a.canvas')
    const v = doc().externalVersion
    act(() => broadcastContent('a.canvas', '{ broken'))
    act(() => broadcastContent('a.canvas', JSON.stringify({ nodes: [textNode('a')], edges: [] })))
    expect(ids(doc())).toEqual(['a'])
    expect(doc().externalVersion).toBe(v)
    expect(doc().canUndo).toBe(false)
  })

  it('syncs a second view of the same file after a save, without echoing back to the saver', async () => {
    await loadTestVault({ 'a.canvas': '' })
    const one = await mountDoc('a.canvas')
    const two = await mountDoc('a.canvas')
    act(() => one.doc().update(addNode(textNode('a'))))
    act(() => one.doc().flush())
    await settle()
    expect(ids(two.doc())).toEqual(['a'])
    expect(one.doc().canUndo).toBe(true)
    act(() => one.doc().undo())
    expect(ids(one.doc())).toEqual([])
  })

  it('drops a pending local save when an external change wins', async () => {
    const mem = await loadTestVault({ 'a.canvas': '' })
    const { doc } = await mountDoc('a.canvas')
    act(() => doc().update(addNode(textNode('local'))))
    act(() => broadcastContent('a.canvas', JSON.stringify({ nodes: [textNode('remote')], edges: [] })))
    act(() => doc().flush())
    await settle()
    expect(ids(doc())).toEqual(['remote'])
    expect(mem.writes).toHaveLength(0)
  })
})
