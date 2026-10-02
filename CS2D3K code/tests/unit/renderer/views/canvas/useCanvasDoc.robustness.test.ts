// Regression tests from the robustness audit (QUALITY.md): unreadable files and load-time normalization.
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { flushPromises, loadTestVault } from '../../../helpers/vault'
import { flushAll } from '@/lib/fileops'
import { useUi } from '@/store/ui'
import { useCanvasDoc, type CanvasDoc } from '@/views/canvas/useCanvasDoc'
import type { CanvasData } from '@/views/canvas/model'

const mounted: Root[] = []

async function mountDoc(path: string, normalize?: (d: CanvasData) => CanvasData): Promise<() => CanvasDoc> {
  let latest: CanvasDoc | null = null
  function Probe(): null {
    latest = useCanvasDoc(path, normalize)
    return null
  }
  const root = createRoot(document.createElement('div'))
  mounted.push(root)
  act(() => root.render(createElement(Probe)))
  await act(async () => {
    await flushPromises()
  })
  return () => latest!
}

beforeAll(() => {
  ;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})

afterEach(() => {
  for (const r of mounted.splice(0)) act(() => r.unmount())
})

describe('views/canvas/useCanvasDoc robustness', () => {
  it('an unreadable file (locked, no permission…) is flagged invalid instead of looking like an empty canvas', async () => {
    const mem = await loadTestVault({ 'locked.canvas': '{"nodes":[{"id":"a","type":"text","x":0,"y":0,"width":10,"height":10}],"edges":[]}' })
    const readText = mem.api.fs.readText
    mem.api.fs.readText = async () => {
      throw new Error('EBUSY: resource busy or locked')
    }
    try {
      const doc = await mountDoc('locked.canvas')
      expect(doc().loaded).toBe(true)
      expect(doc().invalid).toBe(true)
    } finally {
      mem.api.fs.readText = readText
    }
  })

  it('applies the normalizer in memory without rewriting the file', async () => {
    const raw = '{"nodes":[{"id":"a","type":"text","x":0,"y":0,"width":10,"height":10,"text":"x"}],"edges":[]}'
    const mem = await loadTestVault({ 'n.canvas': raw })
    const doc = await mountDoc('n.canvas', (d) => ({ ...d, nodes: d.nodes.map((n) => ({ ...n, text: 'normalized' })) }))
    expect(doc().data.nodes[0].text).toBe('normalized')
    flushAll()
    await flushPromises(20)
    expect(mem.files.get('n.canvas')).toBe(raw)
    expect(mem.writes).toEqual([])
  })

  it('a failed save is reported to the user and retried on the next change', async () => {
    const mem = await loadTestVault({ 'ro.canvas': '{"nodes":[],"edges":[]}' })
    useUi.setState({ notices: [] })
    const doc = await mountDoc('ro.canvas')
    const writeText = mem.api.fs.writeText
    mem.api.fs.writeText = async () => {
      throw new Error('EPERM: operation not permitted')
    }
    try {
      act(() => doc().update((d) => ({ ...d, nodes: [{ id: 'n', type: 'text', x: 0, y: 0, width: 10, height: 10, text: 'kept' }] })))
      await act(async () => {
        doc().flush()
        await flushPromises(10)
      })
      expect(useUi.getState().notices.map((n) => n.message)).toContainEqual(expect.stringMatching(/Couldn't save "ro.canvas".*EPERM/))
    } finally {
      mem.api.fs.writeText = writeText
    }
    act(() => doc().update((d) => ({ ...d })))
    await act(async () => {
      doc().flush()
      await flushPromises(10)
    })
    expect(mem.files.get('ro.canvas')).toContain('kept')
  })
})
