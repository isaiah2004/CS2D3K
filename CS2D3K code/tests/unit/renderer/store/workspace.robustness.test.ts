// Regression tests from the robustness audit (QUALITY.md): a pending layout save must not leak into the next vault.
import { describe, expect, it } from 'vitest'
import { flushPromises, loadTestVault } from '../../helpers/vault'
import { useWorkspace, flushWorkspace } from '@/store/workspace'

describe('store/workspace persistence across vault switches', () => {
  it('reset() drops a pending (debounced) save of the old layout', async () => {
    const mem = await loadTestVault({ 'a.md': 'a' })
    mem.config.delete('workspace')
    useWorkspace.getState().openFile('a.md')
    useWorkspace.getState().reset()
    await flushPromises(700)
    expect(mem.config.has('workspace')).toBe(false)
  })

  it('flushWorkspace() writes the pending save immediately (vault close / window unload)', async () => {
    const mem = await loadTestVault({ 'a.md': 'a' })
    mem.config.delete('workspace')
    useWorkspace.getState().openFile('a.md')
    flushWorkspace()
    await flushPromises()
    expect(JSON.stringify(mem.config.get('workspace'))).toContain('a.md')
  })
})
