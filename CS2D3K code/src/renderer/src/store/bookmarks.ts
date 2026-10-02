import { create } from 'zustand'

export interface Bookmark {
  type: 'file' | 'search' | 'graph'
  path?: string
  query?: string
  title?: string
}

interface BookmarkStore {
  items: Bookmark[]
  load(): Promise<void>
  toggleFile(path: string): void
  add(b: Bookmark): void
  remove(index: number): void
  move(from: number, to: number): void
  isBookmarked(path: string): boolean
  onRename(from: string, to: string): void
}

const save = (items: Bookmark[]): void => {
  window.api.config.write('bookmarks', { items }).catch((e) => console.warn('could not save bookmarks', e))
}

export const useBookmarks = create<BookmarkStore>((set, get) => ({
  items: [],
  async load() {
    const d = await window.api.config.read<{ items: Bookmark[] }>('bookmarks')
    set({ items: d?.items ?? [] })
  },
  toggleFile(path) {
    const items = get().items
    const i = items.findIndex((b) => b.type === 'file' && b.path === path)
    const next = i >= 0 ? items.filter((_, j) => j !== i) : [...items, { type: 'file' as const, path }]
    set({ items: next })
    save(next)
  },
  add(b) {
    const next = [...get().items, b]
    set({ items: next })
    save(next)
  },
  remove(index) {
    const next = get().items.filter((_, i) => i !== index)
    set({ items: next })
    save(next)
  },
  move(from, to) {
    const next = [...get().items]
    if (from < 0 || from >= next.length) return
    const [x] = next.splice(from, 1)
    next.splice(to, 0, x)
    set({ items: next })
    save(next)
  },
  isBookmarked(path) {
    return get().items.some((b) => b.type === 'file' && b.path === path)
  },
  onRename(from, to) {
    let changed = false
    const next = get().items.map((b) => {
      if (b.path && (b.path === from || b.path.startsWith(from + '/'))) {
        changed = true
        return { ...b, path: to + b.path.slice(from.length) }
      }
      return b
    })
    if (changed) {
      set({ items: next })
      save(next)
    }
  }
}))
