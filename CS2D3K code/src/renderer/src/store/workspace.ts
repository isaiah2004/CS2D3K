import { create } from 'zustand'
import { uid, debounce } from '@/lib/util'
import { viewTypeForExt, type ViewType } from '@/lib/filetypes'
import { extname, isChildOf, stem, basename } from '@/lib/path'

// ---------------------------------------------------------------- types

export interface HistoryEntry {
  type: ViewType
  path?: string
  state?: Record<string, unknown>
}

export interface TabState {
  id: string
  type: ViewType
  path?: string
  /** view specific state (e.g. markdown mode, scroll, canvas viewport) */
  state?: Record<string, unknown>
  pinned?: boolean
  history: HistoryEntry[]
  historyIndex: number
  /** increments on every navigation (not on rename) — views are keyed by it */
  navId: number
}

export interface LeafNode {
  kind: 'leaf'
  id: string
  tabs: TabState[]
  active: string | null
}

export interface SplitNode {
  kind: 'split'
  id: string
  dir: 'row' | 'column'
  children: LayoutNode[]
  /** flex weights, same length as children */
  sizes: number[]
}

export type LayoutNode = LeafNode | SplitNode

export type PaneId = 'files' | 'search' | 'bookmarks' | 'tags' | 'backlinks' | 'outgoing' | 'outline' | 'localgraph'
export type Side = 'left' | 'right'

export interface SidebarGroup {
  id: string
  panes: PaneId[]
  active: PaneId
  size: number
}

export interface SidebarState {
  open: boolean
  width: number
  groups: SidebarGroup[]
}

export interface BottomTab {
  id: string
  kind: 'terminal' | 'output'
  title: string
}

export interface BottomState {
  open: boolean
  height: number
  tabs: BottomTab[]
  active: string | null
}

export interface OpenOptions {
  /** 'tab' = new tab, 'split-right'/'split-down' = new split, undefined = reuse active tab */
  target?: 'tab' | 'split-right' | 'split-down' | 'replace'
  leafId?: string
  state?: Record<string, unknown>
  /** focus editor / make active (default true) */
  activate?: boolean
}

interface WorkspaceData {
  root: LayoutNode
  activeLeaf: string
  left: SidebarState
  right: SidebarState
  bottom: BottomState
}

interface WorkspaceStore extends WorkspaceData {
  /** incremented when the active file changes; useful for subscriptions */
  activeVersion: number
  restored: boolean

  // tabs
  openFile(path: string, opts?: OpenOptions): void
  openView(type: ViewType, opts?: OpenOptions & { path?: string }): void
  newTab(leafId?: string): void
  closeTab(tabId: string): void
  closeOthers(tabId: string): void
  closeAllInLeaf(leafId: string): void
  activateTab(tabId: string): void
  setActiveLeaf(leafId: string): void
  updateTabState(tabId: string, patch: Record<string, unknown>): void
  togglePin(tabId: string): void
  moveTab(tabId: string, toLeafId: string, index?: number): void
  splitTab(tabId: string, dir: 'right' | 'down'): void
  setSplitSizes(splitId: string, sizes: number[]): void
  goBack(): void
  goForward(): void

  // file lifecycle
  onRename(from: string, to: string): void
  onDelete(path: string): void

  // sidebars
  toggleSidebar(side: Side, open?: boolean): void
  setSidebarWidth(side: Side, width: number): void
  revealPane(pane: PaneId): void
  setGroupActive(side: Side, groupId: string, pane: PaneId): void
  movePane(pane: PaneId, toSide: Side, toGroupId?: string | 'new', index?: number): void
  setGroupSizes(side: Side, sizes: number[]): void

  // bottom panel
  toggleBottom(open?: boolean): void
  setBottomHeight(h: number): void
  addBottomTab(kind: BottomTab['kind'], title?: string): string
  closeBottomTab(id: string): void
  setBottomActive(id: string): void
  renameBottomTab(id: string, title: string): void

  // persistence
  restore(): Promise<void>
  reset(): void
}

// ---------------------------------------------------------------- helpers

function newLeaf(tabs: TabState[] = []): LeafNode {
  const id = uid('leaf-')
  return { kind: 'leaf', id, tabs, active: tabs[0]?.id ?? null }
}

function makeTab(type: ViewType, path?: string, state?: Record<string, unknown>): TabState {
  const entry: HistoryEntry = { type, path, state }
  return { id: uid('tab-'), type, path, state, history: [entry], historyIndex: 0, navId: 0 }
}

function emptyTab(): TabState {
  return makeTab('empty')
}

export function findLeaf(node: LayoutNode, id: string): LeafNode | null {
  if (node.kind === 'leaf') return node.id === id ? node : null
  for (const c of node.children) {
    const r = findLeaf(c, id)
    if (r) return r
  }
  return null
}

export function allLeaves(node: LayoutNode, out: LeafNode[] = []): LeafNode[] {
  if (node.kind === 'leaf') out.push(node)
  else for (const c of node.children) allLeaves(c, out)
  return out
}

export function findTab(root: LayoutNode, tabId: string): { leaf: LeafNode; tab: TabState } | null {
  for (const leaf of allLeaves(root)) {
    const tab = leaf.tabs.find((t) => t.id === tabId)
    if (tab) return { leaf, tab }
  }
  return null
}

/** Immutable map over the layout tree. */
function mapLeaves(node: LayoutNode, fn: (l: LeafNode) => LeafNode): LayoutNode {
  if (node.kind === 'leaf') return fn(node)
  return { ...node, children: node.children.map((c) => mapLeaves(c, fn)) }
}

/** Removes empty leaves (except if it is the only one) and collapses single-child splits. */
function normalize(node: LayoutNode): LayoutNode {
  if (node.kind === 'leaf') return node
  const kids: LayoutNode[] = []
  const sizes: number[] = []
  node.children.forEach((c, i) => {
    const n = normalize(c)
    if (n.kind === 'leaf' && n.tabs.length === 0) return
    // flatten same-direction nested splits
    if (n.kind === 'split' && n.dir === node.dir) {
      const total = n.sizes.reduce((a, b) => a + b, 0) || 1
      n.children.forEach((cc, j) => {
        kids.push(cc)
        sizes.push((node.sizes[i] ?? 1) * (n.sizes[j] / total))
      })
      return
    }
    kids.push(n)
    sizes.push(node.sizes[i] ?? 1)
  })
  if (kids.length === 0) return newLeaf([emptyTab()])
  if (kids.length === 1) return kids[0]
  return { ...node, children: kids, sizes }
}

/** Replace leaf `id` with `replacement` */
function replaceNode(node: LayoutNode, id: string, replacement: LayoutNode): LayoutNode {
  if (node.id === id) return replacement
  if (node.kind === 'leaf') return node
  return { ...node, children: node.children.map((c) => replaceNode(c, id, replacement)) }
}

function typeForPath(path: string): ViewType {
  return viewTypeForExt(extname(path))
}

export function tabTitle(tab: { type: ViewType; path?: string }): string {
  if (tab.path) {
    const ext = extname(tab.path)
    return ext === 'md' || ext === 'canvas' || ext === 'formmap' ? stem(tab.path) : basename(tab.path)
  }
  switch (tab.type) {
    case 'graph':
      return 'Graph view'
    case 'empty':
      return 'New tab'
    default:
      return tab.type
  }
}

const DEFAULT_LEFT: SidebarState = {
  open: true,
  width: 280,
  groups: [{ id: 'lg1', panes: ['files', 'search', 'bookmarks'], active: 'files', size: 1 }]
}
const DEFAULT_RIGHT: SidebarState = {
  open: true,
  width: 300,
  groups: [
    { id: 'rg1', panes: ['backlinks', 'outgoing', 'tags'], active: 'backlinks', size: 1 },
    { id: 'rg2', panes: ['outline', 'localgraph'], active: 'outline', size: 1 }
  ]
}
const DEFAULT_BOTTOM: BottomState = { open: false, height: 260, tabs: [], active: null }

function defaultData(): WorkspaceData {
  const leaf = newLeaf([emptyTab()])
  return {
    root: leaf,
    activeLeaf: leaf.id,
    left: structuredClone(DEFAULT_LEFT),
    right: structuredClone(DEFAULT_RIGHT),
    bottom: structuredClone(DEFAULT_BOTTOM)
  }
}

const ALL_PANES: PaneId[] = ['files', 'search', 'bookmarks', 'tags', 'backlinks', 'outgoing', 'outline', 'localgraph']

// ---------------------------------------------------------------- store

const persist = debounce((data: WorkspaceData) => {
  window.api.config.write('workspace', data).catch((e) => console.warn('could not save the workspace', e))
}, 500)

/** Write a pending layout save now (before the vault closes / the window unloads). */
export function flushWorkspace(): void {
  persist.flush()
}

export const useWorkspace = create<WorkspaceStore>((set, get) => {
  /** set + persist */
  const commit = (patch: Partial<WorkspaceData> & { activeVersion?: number }): void => {
    set(patch as Partial<WorkspaceStore>)
    const s = get()
    if (s.restored) persist({ root: s.root, activeLeaf: s.activeLeaf, left: s.left, right: s.right, bottom: s.bottom })
  }

  const ensureActiveLeaf = (root: LayoutNode, preferred: string): string => {
    if (findLeaf(root, preferred)) return preferred
    return allLeaves(root)[0].id
  }

  /** navigate a tab to a new location, recording history */
  const navigateTab = (tab: TabState, entry: HistoryEntry): TabState => {
    const history = tab.history.slice(0, tab.historyIndex + 1)
    history.push(entry)
    while (history.length > 50) history.shift()
    return { ...tab, type: entry.type, path: entry.path, state: entry.state, history, historyIndex: history.length - 1, navId: (tab.navId ?? 0) + 1 }
  }

  const open = (entry: HistoryEntry, opts: OpenOptions = {}): void => {
    const s = get()
    const leafId = opts.leafId ?? s.activeLeaf
    const leaf = findLeaf(s.root, leafId) ?? allLeaves(s.root)[0]
    const activate = opts.activate !== false

    // already open in this leaf? just activate (unless explicitly new tab/split)
    if (!opts.target || opts.target === 'replace') {
      if (entry.path) {
        const existing = leaf.tabs.find((t) => t.path === entry.path && t.type === entry.type)
        if (existing) {
          let root = s.root
          if (opts.state)
            root = mapLeaves(root, (l) =>
              l.id === leaf.id ? { ...l, tabs: l.tabs.map((t) => (t.id === existing.id ? { ...t, state: { ...t.state, ...opts.state, _nav: Date.now() } } : t)) } : l
            )
          commit({ root, ...(activate ? { activeLeaf: leaf.id } : {}), activeVersion: s.activeVersion + 1 })
          if (activate) get().activateTab(existing.id)
          return
        }
      }
    }

    if (opts.target === 'split-right' || opts.target === 'split-down') {
      const tab = makeTab(entry.type, entry.path, entry.state)
      const nl = newLeaf([tab])
      const split: SplitNode = {
        kind: 'split',
        id: uid('split-'),
        dir: opts.target === 'split-right' ? 'row' : 'column',
        children: [leaf, nl],
        sizes: [1, 1]
      }
      const root = normalize(replaceNode(s.root, leaf.id, split))
      commit({ root, activeLeaf: activate ? nl.id : s.activeLeaf, activeVersion: s.activeVersion + 1 })
      return
    }

    const activeTab = leaf.tabs.find((t) => t.id === leaf.active)
    const reuse = opts.target !== 'tab' && activeTab && !activeTab.pinned
    let tabs: TabState[]
    let activeId: string
    if (reuse && activeTab) {
      const updated = navigateTab(activeTab, entry)
      tabs = leaf.tabs.map((t) => (t.id === activeTab.id ? updated : t))
      activeId = updated.id
    } else {
      const tab = makeTab(entry.type, entry.path, entry.state)
      const idx = activeTab ? leaf.tabs.indexOf(activeTab) + 1 : leaf.tabs.length
      tabs = [...leaf.tabs.slice(0, idx), tab, ...leaf.tabs.slice(idx)]
      activeId = tab.id
    }
    const root = mapLeaves(s.root, (l) => (l.id === leaf.id ? { ...l, tabs, active: activate || !l.active ? activeId : l.active } : l))
    commit({ root, activeLeaf: activate ? leaf.id : s.activeLeaf, activeVersion: s.activeVersion + 1 })
  }

  const updateSide = (side: Side, fn: (s: SidebarState) => SidebarState): void => {
    commit({ [side]: fn(get()[side]) } as Partial<WorkspaceData>)
  }

  return {
    ...defaultData(),
    activeVersion: 0,
    restored: false,

    openFile(path, opts) {
      open({ type: typeForPath(path), path, state: opts?.state }, opts)
    },
    openView(type, opts) {
      // singleton views like graph: focus existing anywhere
      if (type === 'graph' && !opts?.target) {
        for (const leaf of allLeaves(get().root)) {
          const t = leaf.tabs.find((x) => x.type === 'graph')
          if (t) {
            get().activateTab(t.id)
            return
          }
        }
      }
      open({ type, path: opts?.path, state: opts?.state }, opts ?? { target: 'tab' })
    },
    newTab(leafId) {
      open({ type: 'empty' }, { target: 'tab', leafId })
    },
    closeTab(tabId) {
      const s = get()
      const found = findTab(s.root, tabId)
      if (!found) return
      const { leaf } = found
      const idx = leaf.tabs.findIndex((t) => t.id === tabId)
      const tabs = leaf.tabs.filter((t) => t.id !== tabId)
      const active = leaf.active === tabId ? (tabs[Math.min(idx, tabs.length - 1)]?.id ?? null) : leaf.active
      let root = mapLeaves(s.root, (l) => (l.id === leaf.id ? { ...l, tabs, active } : l))
      // a single remaining empty leaf gets a fresh "new tab"
      const leaves = allLeaves(root)
      if (leaves.length === 1 && leaves[0].tabs.length === 0) {
        const t = emptyTab()
        root = { ...leaves[0], tabs: [t], active: t.id }
      }
      root = normalize(root)
      commit({ root, activeLeaf: ensureActiveLeaf(root, s.activeLeaf), activeVersion: s.activeVersion + 1 })
    },
    closeOthers(tabId) {
      const s = get()
      const found = findTab(s.root, tabId)
      if (!found) return
      const root = mapLeaves(s.root, (l) =>
        l.id === found.leaf.id ? { ...l, tabs: l.tabs.filter((t) => t.id === tabId || t.pinned), active: tabId } : l
      )
      commit({ root, activeVersion: s.activeVersion + 1 })
    },
    closeAllInLeaf(leafId) {
      const s = get()
      let root = mapLeaves(s.root, (l) => (l.id === leafId ? { ...l, tabs: [], active: null } : l))
      const leaves = allLeaves(root)
      if (leaves.every((l) => l.tabs.length === 0)) {
        const t = emptyTab()
        root = { ...leaves[0], tabs: [t], active: t.id }
      }
      root = normalize(root)
      commit({ root, activeLeaf: ensureActiveLeaf(root, s.activeLeaf), activeVersion: s.activeVersion + 1 })
    },
    activateTab(tabId) {
      const s = get()
      const found = findTab(s.root, tabId)
      if (!found) return
      if (found.leaf.active === tabId && s.activeLeaf === found.leaf.id) return
      const root = mapLeaves(s.root, (l) => (l.id === found.leaf.id ? { ...l, active: tabId } : l))
      commit({ root, activeLeaf: found.leaf.id, activeVersion: s.activeVersion + 1 })
    },
    setActiveLeaf(leafId) {
      const s = get()
      if (s.activeLeaf !== leafId && findLeaf(s.root, leafId)) commit({ activeLeaf: leafId, activeVersion: s.activeVersion + 1 })
    },
    updateTabState(tabId, patch) {
      const s = get()
      const root = mapLeaves(s.root, (l) =>
        l.tabs.some((t) => t.id === tabId)
          ? {
              ...l,
              tabs: l.tabs.map((t) => {
                if (t.id !== tabId) return t
                const state = { ...t.state, ...patch }
                const history = t.history.map((h, i) => (i === t.historyIndex ? { ...h, state } : h))
                return { ...t, state, history }
              })
            }
          : l
      )
      commit({ root })
    },
    togglePin(tabId) {
      const s = get()
      const root = mapLeaves(s.root, (l) => ({ ...l, tabs: l.tabs.map((t) => (t.id === tabId ? { ...t, pinned: !t.pinned } : t)) }))
      commit({ root })
    },
    moveTab(tabId, toLeafId, index) {
      const s = get()
      const found = findTab(s.root, tabId)
      if (!found || !findLeaf(s.root, toLeafId)) return
      const tab = found.tab
      let root = mapLeaves(s.root, (l) => {
        let tabs = l.tabs
        if (l.id === found.leaf.id) tabs = tabs.filter((t) => t.id !== tabId)
        if (l.id === toLeafId) {
          const i = index === undefined ? tabs.length : Math.max(0, Math.min(index, tabs.length))
          tabs = [...tabs.slice(0, i), tab, ...tabs.slice(i)]
          return { ...l, tabs, active: tabId }
        }
        const active = l.active === tabId ? (tabs[0]?.id ?? null) : l.active
        return { ...l, tabs, active }
      })
      root = normalize(root)
      commit({ root, activeLeaf: ensureActiveLeaf(root, toLeafId), activeVersion: s.activeVersion + 1 })
    },
    splitTab(tabId, dir) {
      const s = get()
      const found = findTab(s.root, tabId)
      if (!found) return
      const { leaf, tab } = found
      const copy = makeTab(tab.type, tab.path, tab.state)
      const nl = newLeaf([copy])
      const split: SplitNode = { kind: 'split', id: uid('split-'), dir: dir === 'right' ? 'row' : 'column', children: [leaf, nl], sizes: [1, 1] }
      const root = normalize(replaceNode(s.root, leaf.id, split))
      commit({ root, activeLeaf: nl.id, activeVersion: s.activeVersion + 1 })
    },
    setSplitSizes(splitId, sizes) {
      const upd = (n: LayoutNode): LayoutNode =>
        n.kind === 'leaf' ? n : n.id === splitId ? { ...n, sizes } : { ...n, children: n.children.map(upd) }
      commit({ root: upd(get().root) })
    },
    goBack() {
      const s = get()
      const leaf = findLeaf(s.root, s.activeLeaf)
      const tab = leaf?.tabs.find((t) => t.id === leaf.active)
      if (!leaf || !tab || tab.historyIndex <= 0) return
      const i = tab.historyIndex - 1
      const h = tab.history[i]
      const root = mapLeaves(s.root, (l) =>
        l.id === leaf.id ? { ...l, tabs: l.tabs.map((t) => (t.id === tab.id ? { ...t, ...h, historyIndex: i, navId: (t.navId ?? 0) + 1 } : t)) } : l
      )
      commit({ root, activeVersion: s.activeVersion + 1 })
    },
    goForward() {
      const s = get()
      const leaf = findLeaf(s.root, s.activeLeaf)
      const tab = leaf?.tabs.find((t) => t.id === leaf.active)
      if (!leaf || !tab || tab.historyIndex >= tab.history.length - 1) return
      const i = tab.historyIndex + 1
      const h = tab.history[i]
      const root = mapLeaves(s.root, (l) =>
        l.id === leaf.id ? { ...l, tabs: l.tabs.map((t) => (t.id === tab.id ? { ...t, ...h, historyIndex: i, navId: (t.navId ?? 0) + 1 } : t)) } : l
      )
      commit({ root, activeVersion: s.activeVersion + 1 })
    },

    onRename(from, to) {
      const s = get()
      const fix = (p?: string): string | undefined => (p && isChildOf(p, from) ? to + p.slice(from.length) : p)
      const root = mapLeaves(s.root, (l) => ({
        ...l,
        tabs: l.tabs.map((t) => {
          const np = fix(t.path)
          const type = np && np !== t.path ? typeForPath(np) : t.type
          const history = t.history.map((h) => {
            const hp = fix(h.path)
            return { ...h, path: hp, type: hp && hp !== h.path ? typeForPath(hp) : h.type }
          })
          return { ...t, path: np, type: t.path ? type : t.type, history }
        })
      }))
      commit({ root, activeVersion: s.activeVersion + 1 })
    },
    onDelete(path) {
      const s = get()
      for (const leaf of allLeaves(s.root))
        for (const t of leaf.tabs) if (t.path && isChildOf(t.path, path)) get().closeTab(t.id)
    },

    toggleSidebar(side, openState) {
      updateSide(side, (sb) => ({ ...sb, open: openState ?? !sb.open }))
    },
    setSidebarWidth(side, width) {
      updateSide(side, (sb) => ({ ...sb, width: Math.max(180, Math.min(700, width)) }))
    },
    revealPane(pane) {
      for (const side of ['left', 'right'] as Side[]) {
        const sb = get()[side]
        const g = sb.groups.find((x) => x.panes.includes(pane))
        if (g) {
          updateSide(side, (st) => ({ ...st, open: true, groups: st.groups.map((x) => (x.id === g.id ? { ...x, active: pane } : x)) }))
          return
        }
      }
      // pane not placed anywhere — add to right sidebar first group
      get().movePane(pane, 'right')
      get().toggleSidebar('right', true)
    },
    setGroupActive(side, groupId, pane) {
      updateSide(side, (sb) => ({ ...sb, groups: sb.groups.map((g) => (g.id === groupId ? { ...g, active: pane } : g)) }))
    },
    movePane(pane, toSide, toGroupId, index) {
      const s = get()
      const strip = (sb: SidebarState): SidebarState => {
        const groups = sb.groups
          .map((g) => {
            const panes = g.panes.filter((p) => p !== pane)
            return { ...g, panes, active: g.active === pane ? panes[0] : g.active }
          })
          .filter((g) => g.panes.length > 0)
        return { ...sb, groups }
      }
      let left = strip(s.left)
      let right = strip(s.right)
      const target = toSide === 'left' ? left : right
      let groups = target.groups
      if (toGroupId === 'new' || groups.length === 0) {
        groups = [...groups, { id: uid('g-'), panes: [pane], active: pane, size: 1 }]
      } else {
        const gid = toGroupId && groups.some((g) => g.id === toGroupId) ? toGroupId : groups[0].id
        groups = groups.map((g) => {
          if (g.id !== gid) return g
          const i = index === undefined ? g.panes.length : Math.max(0, Math.min(index, g.panes.length))
          const panes = [...g.panes.slice(0, i), pane, ...g.panes.slice(i)]
          return { ...g, panes, active: pane }
        })
      }
      if (toSide === 'left') left = { ...left, groups, open: true }
      else right = { ...right, groups, open: true }
      commit({ left, right })
    },
    setGroupSizes(side, sizes) {
      updateSide(side, (sb) => ({ ...sb, groups: sb.groups.map((g, i) => ({ ...g, size: sizes[i] ?? g.size })) }))
    },

    toggleBottom(openState) {
      const s = get()
      const willOpen = openState ?? !s.bottom.open
      if (willOpen && s.bottom.tabs.length === 0) {
        get().addBottomTab('terminal')
        return
      }
      commit({ bottom: { ...s.bottom, open: willOpen } })
    },
    setBottomHeight(h) {
      commit({ bottom: { ...get().bottom, height: Math.max(100, Math.min(window.innerHeight - 150, h)) } })
    },
    addBottomTab(kind, title) {
      const s = get()
      const id = uid('bt-')
      const n = s.bottom.tabs.filter((t) => t.kind === kind).length + 1
      const tab: BottomTab = { id, kind, title: title ?? (kind === 'terminal' ? `Terminal ${n}` : 'Output') }
      commit({ bottom: { ...s.bottom, open: true, tabs: [...s.bottom.tabs, tab], active: id } })
      return id
    },
    closeBottomTab(id) {
      const s = get()
      const idx = s.bottom.tabs.findIndex((t) => t.id === id)
      const tabs = s.bottom.tabs.filter((t) => t.id !== id)
      const active = s.bottom.active === id ? (tabs[Math.min(idx, tabs.length - 1)]?.id ?? null) : s.bottom.active
      commit({ bottom: { ...s.bottom, tabs, active, open: tabs.length > 0 && s.bottom.open } })
    },
    setBottomActive(id) {
      commit({ bottom: { ...get().bottom, active: id, open: true } })
    },
    renameBottomTab(id, title) {
      const b = get().bottom
      commit({ bottom: { ...b, tabs: b.tabs.map((t) => (t.id === id ? { ...t, title } : t)) } })
    },

    async restore() {
      const saved = await window.api.config.read<WorkspaceData>('workspace')
      const base = defaultData()
      if (saved && saved.root) {
        try {
          // terminals can't be restored (processes are gone) — keep the panel closed
          const placed = new Set([...saved.left.groups, ...saved.right.groups].flatMap((g) => g.panes))
          const left = { ...saved.left }
          // add panes that didn't exist when the layout was saved
          const missing = ALL_PANES.filter((p) => !placed.has(p))
          const right = missing.length
            ? { ...saved.right, groups: saved.right.groups.length ? saved.right.groups.map((g, i) => (i === 0 ? { ...g, panes: [...g.panes, ...missing] } : g)) : [{ id: uid('g-'), panes: missing, active: missing[0], size: 1 }] }
            : saved.right
          const root = normalize(saved.root)
          if (!allLeaves(root).every((l) => Array.isArray(l.tabs))) throw new Error('invalid layout')
          set({
            root,
            activeLeaf: ensureActiveLeaf(root, saved.activeLeaf),
            left,
            right,
            bottom: { ...base.bottom, height: saved.bottom?.height ?? base.bottom.height },
            restored: true,
            activeVersion: get().activeVersion + 1
          })
          return
        } catch {
          // corrupt saved layout — fall back to the default below
        }
      }
      set({ ...base, restored: true, activeVersion: get().activeVersion + 1 })
    },
    reset() {
      // a pending save of this layout must not land in the next vault
      persist.cancel()
      set({ ...defaultData(), restored: false, activeVersion: get().activeVersion + 1 })
    }
  }
})

// ---------------------------------------------------------------- selectors

export function getActiveTab(): TabState | null {
  const s = useWorkspace.getState()
  const leaf = findLeaf(s.root, s.activeLeaf)
  return leaf?.tabs.find((t) => t.id === leaf.active) ?? null
}

/** Path of the active file (markdown/code/canvas...) or null */
export function getActiveFile(): string | null {
  return getActiveTab()?.path ?? null
}

/** React hook: active file path */
export function useActiveFile(): string | null {
  return useWorkspace((s) => {
    const leaf = findLeaf(s.root, s.activeLeaf)
    return leaf?.tabs.find((t) => t.id === leaf.active)?.path ?? null
  })
}

export function useActiveTab(): TabState | null {
  return useWorkspace((s) => {
    const leaf = findLeaf(s.root, s.activeLeaf)
    return leaf?.tabs.find((t) => t.id === leaf.active) ?? null
  })
}
