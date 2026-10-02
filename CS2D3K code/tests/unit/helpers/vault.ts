// Test helper (cf. Logseq's test-helper/load-test-files): load a fixture vault into the stores.
import type { MemoryVault } from './memoryApi'
import { useVault } from '@/store/vault'
import { useMetadata } from '@/store/metadata'
import { useWorkspace } from '@/store/workspace'
import { useSettings, DEFAULT_SETTINGS } from '@/store/settings'

export function memory(): MemoryVault {
  return (globalThis as unknown as { __mem: MemoryVault }).__mem
}

/** Reset every store and load `files` as the current vault (metadata indexed). */
export async function loadTestVault(files: Record<string, string>): Promise<MemoryVault> {
  const mem = memory()
  mem.reset(files)
  useSettings.setState({ settings: structuredClone(DEFAULT_SETTINGS), loaded: true })
  useWorkspace.getState().reset()
  useVault.getState().setInfo({ path: '/vault', name: 'vault' })
  await useVault.getState().loadFiles()
  useMetadata.setState({ metas: {}, resolved: {}, unresolved: {}, ready: false, version: 0 })
  await useMetadata.getState().indexAll()
  await useWorkspace.getState().restore()
  return mem
}

/** Wait for pending promise callbacks / debounced work. */
export function flushPromises(ms = 0): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}
