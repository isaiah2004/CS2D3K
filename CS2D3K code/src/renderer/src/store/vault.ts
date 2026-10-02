import { create } from 'zustand'
import type { FileEntry, FsEvent, VaultInfo } from '@shared/types'
import { dirname, isChildOf } from '@/lib/path'

interface VaultStore {
  info: VaultInfo | null
  files: Record<string, FileEntry>
  /** bumps every time the file list changes */
  version: number
  loading: boolean
  setInfo(info: VaultInfo | null): void
  loadFiles(): Promise<void>
  applyEvents(events: FsEvent[]): void
  /** optimistic local updates (watcher will confirm) */
  upsert(entry: FileEntry): void
  removeLocal(path: string): void
  renameLocal(from: string, to: string): void
}

export const useVault = create<VaultStore>((set, get) => ({
  info: null,
  files: {},
  version: 0,
  loading: false,
  setInfo(info) {
    set({ info, files: {}, version: get().version + 1 })
  },
  async loadFiles() {
    set({ loading: true })
    const list = await window.api.fs.list()
    const files: Record<string, FileEntry> = {}
    for (const f of list) files[f.path] = f
    set({ files, loading: false, version: get().version + 1 })
  },
  applyEvents(events) {
    const files = { ...get().files }
    let changed = false
    for (const ev of events) {
      if ((ev.type === 'add' || ev.type === 'addDir' || ev.type === 'change') && ev.entry) {
        const prev = files[ev.path]
        if (!prev || prev.mtime !== ev.entry.mtime || prev.size !== ev.entry.size) {
          files[ev.path] = ev.entry
          changed = true
        }
        // make sure parent folders exist in the map
        let d = dirname(ev.path)
        while (d && !files[d]) {
          files[d] = { path: d, name: d.split('/').pop()!, isDir: true, ext: '', mtime: Date.now(), ctime: Date.now(), size: 0 }
          d = dirname(d)
          changed = true
        }
      } else if (ev.type === 'unlink' || ev.type === 'unlinkDir') {
        for (const p of Object.keys(files)) {
          if (isChildOf(p, ev.path)) {
            delete files[p]
            changed = true
          }
        }
      }
    }
    if (changed) set({ files, version: get().version + 1 })
  },
  upsert(entry) {
    set({ files: { ...get().files, [entry.path]: entry }, version: get().version + 1 })
  },
  removeLocal(path) {
    const files = { ...get().files }
    for (const p of Object.keys(files)) if (isChildOf(p, path)) delete files[p]
    set({ files, version: get().version + 1 })
  },
  renameLocal(from, to) {
    const files: Record<string, FileEntry> = {}
    for (const [p, f] of Object.entries(get().files)) {
      if (isChildOf(p, from)) {
        const np = to + p.slice(from.length)
        files[np] = { ...f, path: np, name: np.split('/').pop()! }
      } else files[p] = f
    }
    set({ files, version: get().version + 1 })
  }
}))

export const getFiles = (): Record<string, FileEntry> => useVault.getState().files
export const fileExists = (p: string): boolean => !!useVault.getState().files[p]

/** Map of folder path -> child entries; memoized by version. */
let childCache: { version: number; map: Map<string, FileEntry[]> } | null = null
export function childrenMap(): Map<string, FileEntry[]> {
  const { version, files } = useVault.getState()
  if (childCache && childCache.version === version) return childCache.map
  const map = new Map<string, FileEntry[]>()
  map.set('', [])
  for (const f of Object.values(files)) {
    const d = dirname(f.path)
    let arr = map.get(d)
    if (!arr) map.set(d, (arr = []))
    arr.push(f)
    if (f.isDir && !map.has(f.path)) map.set(f.path, [])
  }
  childCache = { version, map }
  return map
}

export function allFiles(): FileEntry[] {
  return Object.values(useVault.getState().files).filter((f) => !f.isDir)
}
