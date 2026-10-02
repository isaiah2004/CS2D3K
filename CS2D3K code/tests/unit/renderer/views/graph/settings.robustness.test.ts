// Regression test from the robustness audit (QUALITY.md): graph settings must not leak from one vault into the next.
import { describe, expect, it, vi } from 'vitest'
import { memory } from '../../../helpers/vault'

describe('views/graph/settings across vaults', () => {
  it('opening another vault in the same window loads that vault’s graph settings', async () => {
    const mem = memory()
    mem.reset()
    vi.resetModules()
    const { useVault } = await import('@/store/vault')
    const { useGraphSettings } = await import('@/views/graph/settings')

    useVault.getState().setInfo({ path: '/vault-a', name: 'a' })
    mem.config.set('graph', { search: 'from A' })
    await useGraphSettings.getState().load()
    expect(useGraphSettings.getState().settings.search).toBe('from A')

    // close A, open B (no reload of the window)
    useVault.getState().setInfo({ path: '/vault-b', name: 'b' })
    mem.config.set('graph', { search: 'from B' })
    await useGraphSettings.getState().load()
    expect(useGraphSettings.getState().settings.search).toBe('from B')

    // same vault again: cached, no re-read
    mem.config.set('graph', { search: 'changed on disk' })
    await useGraphSettings.getState().load()
    expect(useGraphSettings.getState().settings.search).toBe('from B')
  })
})
