// Exposes app state to the e2e test suite as `window.__cs2d3k` (only when CS2D3K_TEST=1).
import { useVault } from '@/store/vault'
import { useWorkspace, getActiveTab, getActiveFile, allLeaves } from '@/store/workspace'
import { useMetadata, resolveLink, getBacklinks, lastIndexStats, saveMetadataCache, type IndexStats } from '@/store/metadata'
import { useLoading } from '@/store/loading'
import { useSettings } from '@/store/settings'
import { useCommands, executeCommand } from '@/store/commands'
import { useUi } from '@/store/ui'
import { useBookmarks } from '@/store/bookmarks'
import * as fileops from './fileops'

export interface TestHooks {
  stores: Record<string, { getState(): unknown; setState?(s: unknown): void }>
  executeCommand: typeof executeCommand
  getActiveTab: typeof getActiveTab
  getActiveFile: typeof getActiveFile
  resolveLink: typeof resolveLink
  getBacklinks: typeof getBacklinks
  fileops: typeof fileops
  /** summary of the layout: one entry per leaf with tab titles/paths/types */
  layout(): { leaf: string; active: string | null; tabs: { id: string; type: string; path?: string }[] }[]
  /** resolves when the vault is loaded and indexed */
  ready(): Promise<void>
  /** what the last vault load did: notes taken from the metadata cache vs read from disk */
  loadStats(): IndexStats | null
  /** writes the metadata cache now (instead of shortly after loading) */
  saveMetadataCache(): Promise<void>
}

declare global {
  interface Window {
    __cs2d3k?: TestHooks
  }
}

export function installTestHooks(): void {
  window.__cs2d3k = {
    stores: {
      vault: useVault,
      workspace: useWorkspace,
      metadata: useMetadata,
      settings: useSettings,
      commands: useCommands,
      ui: useUi,
      bookmarks: useBookmarks,
      loading: useLoading
    } as TestHooks['stores'],
    executeCommand,
    getActiveTab,
    getActiveFile,
    resolveLink,
    getBacklinks,
    fileops,
    loadStats: () => lastIndexStats,
    saveMetadataCache,
    layout: () =>
      allLeaves(useWorkspace.getState().root).map((l) => ({
        leaf: l.id,
        active: l.active,
        tabs: l.tabs.map((t) => ({ id: t.id, type: t.type, path: t.path }))
      })),
    ready: () =>
      new Promise((resolve) => {
        // the Shell mounts only after the vault finished loading; its effects register the core commands and the
        // global hotkey listener, so wait for those too (keys pressed before that would be lost)
        const check = (): boolean =>
          !!useVault.getState().info && useMetadata.getState().ready && useWorkspace.getState().restored && !!useCommands.getState().commands['app:command-palette']
        if (check()) return resolve()
        const t = setInterval(() => {
          if (check()) {
            clearInterval(t)
            resolve()
          }
        }, 25)
      })
  }
}
