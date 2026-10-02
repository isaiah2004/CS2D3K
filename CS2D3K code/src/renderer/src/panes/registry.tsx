import { lazy, type ComponentType, type LazyExoticComponent } from 'react'
import { Folder, Search, Bookmark, Tags, Link2, ArrowUpRight, ListTree, Waypoints } from 'lucide-react'
import type { PaneId } from '@/store/workspace'

export interface PaneDef {
  id: PaneId
  title: string
  icon: ComponentType<{ size?: number }>
  component: LazyExoticComponent<ComponentType> | ComponentType
}

const loaders: Record<PaneId, () => Promise<{ default: ComponentType }>> = {
  files: () => import('./FileExplorer'),
  search: () => import('./SearchPane'),
  bookmarks: () => import('./BookmarksPane'),
  tags: () => import('./TagsPane'),
  backlinks: () => import('./BacklinksPane'),
  outgoing: () => import('./OutgoingLinksPane'),
  outline: () => import('./OutlinePane'),
  localgraph: () => import('@/views/graph/LocalGraphPane')
}

export const PANES: Record<PaneId, PaneDef> = {
  files: { id: 'files', title: 'Files', icon: Folder, component: lazy(loaders.files) },
  search: { id: 'search', title: 'Search', icon: Search, component: lazy(loaders.search) },
  bookmarks: { id: 'bookmarks', title: 'Bookmarks', icon: Bookmark, component: lazy(loaders.bookmarks) },
  tags: { id: 'tags', title: 'Tags', icon: Tags, component: lazy(loaders.tags) },
  backlinks: { id: 'backlinks', title: 'Backlinks', icon: Link2, component: lazy(loaders.backlinks) },
  outgoing: { id: 'outgoing', title: 'Outgoing links', icon: ArrowUpRight, component: lazy(loaders.outgoing) },
  outline: { id: 'outline', title: 'Outline', icon: ListTree, component: lazy(loaders.outline) },
  localgraph: { id: 'localgraph', title: 'Local graph', icon: Waypoints, component: lazy(loaders.localgraph) }
}

/** Warm up pane chunks in the background so switching panes is instant. */
export function preloadPanes(): void {
  for (const load of Object.values(loaders)) void load().catch(() => {})
}
