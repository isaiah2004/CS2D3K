import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { memory } from '../../../helpers/vault'
import type * as SettingsModule from '@/views/graph/settings'

// settings.ts caches its load promise at module level: import a fresh copy per test.
async function fresh(stored?: unknown): Promise<typeof SettingsModule> {
  const mem = memory()
  mem.reset()
  if (stored !== undefined) mem.config.set('graph', stored)
  vi.resetModules()
  return import('@/views/graph/settings')
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('views/graph/settings', () => {
  it('starts with the defaults and not loaded', async () => {
    const { useGraphSettings, DEFAULT_SETTINGS, DEFAULT_LOCAL } = await fresh()
    const s = useGraphSettings.getState()
    expect(s.loaded).toBe(false)
    expect(s.settings).toEqual(DEFAULT_SETTINGS)
    expect(s.local).toEqual(DEFAULT_LOCAL)
  })

  it('keeps defaults when nothing is stored', async () => {
    const { useGraphSettings, DEFAULT_SETTINGS } = await fresh()
    await useGraphSettings.getState().load()
    expect(useGraphSettings.getState().loaded).toBe(true)
    expect(useGraphSettings.getState().settings).toEqual(DEFAULT_SETTINGS)
  })

  it('merges stored settings over the defaults, including local graph settings', async () => {
    const { useGraphSettings, DEFAULT_SETTINGS, DEFAULT_LOCAL } = await fresh({ showTags: true, linkDistance: 200, local: { depth: 3 } })
    await useGraphSettings.getState().load()
    const s = useGraphSettings.getState()
    expect(s.settings).toEqual({ ...DEFAULT_SETTINGS, showTags: true, linkDistance: 200 })
    expect(s.local).toEqual({ ...DEFAULT_LOCAL, depth: 3 })
    expect(s.settings).not.toHaveProperty('local')
  })

  it('drops malformed groups and a non-object collapsed map', async () => {
    const { useGraphSettings } = await fresh({
      groups: [{ query: 'a', color: '#f00' }, null, { query: 1, color: '#0f0' }, { query: 'b' }, 'x'],
      collapsed: 'nope'
    })
    await useGraphSettings.getState().load()
    expect(useGraphSettings.getState().settings.groups).toEqual([{ query: 'a', color: '#f00' }])
    expect(useGraphSettings.getState().settings.collapsed).toEqual({})
  })

  it('replaces a non-array groups value with no groups', async () => {
    const { useGraphSettings } = await fresh({ groups: { query: 'a', color: 'red' } })
    await useGraphSettings.getState().load()
    expect(useGraphSettings.getState().settings.groups).toEqual([])
  })

  it('falls back to defaults for stored values of the wrong type', async () => {
    const { useGraphSettings, DEFAULT_SETTINGS, DEFAULT_LOCAL } = await fresh({
      showTags: 'yes',
      nodeSize: null,
      repelStrength: '10',
      search: 5,
      textFade: 0.5,
      local: { depth: 'deep', neighborLinks: false }
    })
    await useGraphSettings.getState().load()
    const s = useGraphSettings.getState()
    expect(s.settings).toEqual({ ...DEFAULT_SETTINGS, textFade: 0.5 })
    expect(s.local).toEqual({ ...DEFAULT_LOCAL, neighborLinks: false })
  })

  it('ignores a stored local value that is not an object', async () => {
    const { useGraphSettings, DEFAULT_LOCAL } = await fresh({ local: 'garbage' })
    await useGraphSettings.getState().load()
    expect(useGraphSettings.getState().local).toEqual(DEFAULT_LOCAL)
  })

  it('ignores stored data that is not an object', async () => {
    const { useGraphSettings, DEFAULT_SETTINGS } = await fresh('oops')
    await useGraphSettings.getState().load()
    expect(useGraphSettings.getState().settings).toEqual(DEFAULT_SETTINGS)
    expect(useGraphSettings.getState().loaded).toBe(true)
  })

  it('keeps defaults and still finishes loading when reading the config fails', async () => {
    const { useGraphSettings, DEFAULT_SETTINGS } = await fresh()
    const spy = vi.spyOn(window.api.config, 'read').mockRejectedValueOnce(new Error('disk'))
    await useGraphSettings.getState().load()
    expect(useGraphSettings.getState().loaded).toBe(true)
    expect(useGraphSettings.getState().settings).toEqual(DEFAULT_SETTINGS)
    spy.mockRestore()
  })

  it('loads only once even if called repeatedly', async () => {
    const { useGraphSettings } = await fresh({ showTags: true })
    const spy = vi.spyOn(window.api.config, 'read')
    const a = useGraphSettings.getState().load()
    const b = useGraphSettings.getState().load()
    expect(a).toBe(b)
    await a
    await useGraphSettings.getState().load()
    expect(spy).toHaveBeenCalledTimes(1)
    spy.mockRestore()
  })

  it('patches settings and persists them (debounced) together with local settings', async () => {
    const { useGraphSettings, DEFAULT_LOCAL } = await fresh()
    const mem = memory()
    useGraphSettings.getState().set({ showArrows: true })
    useGraphSettings.getState().setLocal({ depth: 2 })
    expect(useGraphSettings.getState().settings.showArrows).toBe(true)
    expect(mem.config.has('graph')).toBe(false)
    await vi.advanceTimersByTimeAsync(600)
    expect(mem.config.get('graph')).toMatchObject({ showArrows: true, local: { ...DEFAULT_LOCAL, depth: 2 } })
  })

  it('reset restores defaults but keeps the panel state', async () => {
    const { useGraphSettings, DEFAULT_SETTINGS } = await fresh()
    const st = useGraphSettings.getState()
    st.set({ showTags: true, panelOpen: true, collapsed: { forces: true }, groups: [{ query: 'x', color: 'red' }] })
    useGraphSettings.getState().reset()
    expect(useGraphSettings.getState().settings).toEqual({ ...DEFAULT_SETTINGS, panelOpen: true, collapsed: { forces: true } })
  })
})
