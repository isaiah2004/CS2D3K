// Opening / closing a vault: wires stores, watcher and theme together.
import { useVault } from '@/store/vault'
import { useSettings, flushSettings } from '@/store/settings'
import { useWorkspace, flushWorkspace } from '@/store/workspace'
import { useMetadata, saveMetadataCache } from '@/store/metadata'
import { useLoading } from '@/store/loading'
import { useUi } from '@/store/ui'
import { applyTheme } from '@/theme/theme'
import { notifyFileChanged, flushAll, isIndexedPath } from './fileops'
import { useBookmarks } from '@/store/bookmarks'
import { CACHE_NAME } from './metaCache'

let unsubFs: (() => void) | null = null
/** bumped by every vault load: an older load that is still running stops touching the stores */
let loadId = 0

const folderName = (abs: string): string => abs.split(/[\\/]/).filter(Boolean).pop() ?? abs

/** Opens a vault, showing the loading screen until it is indexed. Errors stay on the loading screen (with Retry). */
export function openVault(absPath: string): Promise<boolean> {
  return load({ path: absPath, name: folderName(absPath) }, () => window.api.vault.open(absPath), false, () => void openVault(absPath))
}

export function createVault(parentAbs: string, name: string): Promise<boolean> {
  return load({ path: `${parentAbs}/${name}`, name }, () => window.api.vault.create(parentAbs, name), true, () => void createVault(parentAbs, name))
}

async function load(
  target: { path: string; name: string },
  open: () => Promise<{ path: string; name: string }>,
  fresh: boolean,
  retry: () => void
): Promise<boolean> {
  const loading = useLoading.getState()
  // one vault at a time (a second click while one is loading)
  if (loading.active && !loading.error) return false
  const id = ++loadId
  loading.begin(target)
  try {
    const info = await open()
    if (id !== loadId) return false
    useLoading.getState().update({ vault: info })
    await activate(info, fresh, id)
    if (id !== loadId) return false
    useLoading.getState().finish()
    return true
  } catch (e) {
    if (id !== loadId) return false
    console.warn('could not open vault', e)
    unsubFs?.()
    unsubFs = null
    useWorkspace.getState().reset()
    useVault.getState().setInfo(null)
    useMetadata.setState({ metas: {}, resolved: {}, unresolved: {}, ready: false })
    // "Error invoking remote method 'vault:open': Error: ENOTDIR…" → "ENOTDIR…"
    const message = ((e as Error).message || String(e)).replace(/^Error invoking remote method '[^']*': (\w*Error: )?/, '')
    useLoading.getState().fail(message, retry)
    return false
  }
}

async function activate(info: { path: string; name: string }, fresh: boolean, id: number): Promise<void> {
  unsubFs?.()
  useWorkspace.getState().reset()
  await useSettings.getState().load()
  await applyTheme()
  useVault.getState().setInfo(info)

  // the main process already started listing the vault and reading the metadata cache when it opened it: decode
  // the cache while the list arrives, then read only the notes that changed
  const progress = useLoading.getState()
  const graph = progress.graph
  const cache = window.api.cache.read(CACHE_NAME)
  progress.update({ stage: 'scanning' })
  const files = useVault.getState().loadFiles()
  await Promise.all([
    files.then(() => useWorkspace.getState().restore()),
    useMetadata.getState().indexAll({
      cache,
      files,
      onProgress: (p) => {
        if (id === loadId) useLoading.getState().update({ stage: p.stage, done: p.done, total: p.total, cached: p.cached, rate: p.rate })
      },
      onNotes: (notes, expected) => {
        if (id === loadId) graph?.add(notes, expected)
      }
    }),
    useBookmarks.getState().load()
  ])
  if (id !== loadId) return
  useLoading.getState().update({ stage: 'restoring' })

  unsubFs = window.api.fs.onChange((events) => {
    useVault.getState().applyEvents(events)
    let structural = false
    for (const ev of events) {
      if (ev.type === 'change' || ev.type === 'add') void notifyFileChanged(ev.path)
      if (ev.type === 'unlink' && isIndexedPath(ev.path)) useMetadata.getState().remove(ev.path)
      if (ev.type === 'unlink' || ev.type === 'unlinkDir') useWorkspace.getState().onDelete(ev.path)
      if (ev.type !== 'change') structural = true
    }
    if (structural) useMetadata.getState().reresolve()
  })

  if (fresh) {
    const welcome = `# Welcome to ${info.name}\n\nThis is your new vault.\n\n- Create notes with **Ctrl+N**\n- Link notes with [[double brackets]]\n- Open the command palette with **Ctrl+P**\n- Open the graph with **Ctrl+G**\n- Toggle the terminal with **Ctrl+\`**\n\n\`\`\`js\nconsole.log('Run me with the ▶ button!')\n\`\`\`\n`
    try {
      const entry = await window.api.fs.createFile('Welcome.md', welcome)
      useVault.getState().upsert(entry)
      useMetadata.getState().updateContent('Welcome.md', welcome)
      useWorkspace.getState().openFile('Welcome.md')
    } catch {
      /* exists */
    }
  }
}

export async function closeVault(): Promise<void> {
  flushAll()
  flushWorkspace()
  flushSettings()
  unsubFs?.()
  unsubFs = null
  await saveMetadataCache()
  await window.api.vault.close()
  useUi.getState().closeModal()
  useWorkspace.getState().reset()
  useVault.getState().setInfo(null)
  useMetadata.setState({ metas: {}, resolved: {}, unresolved: {}, ready: false })
}
