// Shared React glue for the graph view and the local graph pane: engine hook, node actions, context menu.
import { useEffect, useRef, useState, type RefObject } from 'react'
import { Copy, ExternalLink, FilePlus2, FolderOpen, PanelTop, Search, SplitSquareHorizontal } from 'lucide-react'
import { GraphEngine, type EngineOptions, type GNode } from './engine'
import { onThemeChange } from '@/theme/theme'
import { useWorkspace, allLeaves, findLeaf } from '@/store/workspace'
import { showContextMenu, type MenuItem } from '@/store/ui'
import { openLinkText } from '@/lib/fileops'
import { emit } from '@/lib/events'
import { isMac } from '@/lib/util'

export interface NodeHandlers {
  onClick?(node: GNode, e: MouseEvent): void
  onContextMenu?(node: GNode, e: MouseEvent): void
}

/** Creates a GraphEngine inside `hostRef` for the lifetime of the component. */
export function useGraphEngine(hostRef: RefObject<HTMLDivElement | null>, handlers: NodeHandlers, opts?: EngineOptions): GraphEngine | null {
  const handlersRef = useRef(handlers)
  handlersRef.current = handlers
  const optsRef = useRef(opts)
  const [engine, setEngine] = useState<GraphEngine | null>(null)
  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const e = new GraphEngine(
      host,
      {
        onClick: (n, ev) => handlersRef.current.onClick?.(n, ev),
        onContextMenu: (n, ev) => handlersRef.current.onContextMenu?.(n, ev)
      },
      optsRef.current
    )
    const off = onThemeChange(() => e.refreshTheme())
    setEngine(e)
    return () => {
      off()
      e.destroy()
      setEngine(null)
    }
  }, [hostRef])
  return engine
}

export function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value)
  useEffect(() => {
    if (Object.is(v, value)) return
    const t = setTimeout(() => setV(value), ms)
    return () => clearTimeout(t)
  }, [value, ms, v])
  return v
}

let lastFile: string | null = null
useWorkspace.subscribe((s) => {
  const leaf = findLeaf(s.root, s.activeLeaf)
  const p = leaf?.tabs.find((t) => t.id === leaf.active)?.path
  if (p) lastFile = p
})

/**
 * The file the global graph should highlight: the active file, or — while a path-less tab such as the graph
 * itself is active — the active file of another leaf / the most recently used file tab.
 */
export function useFocusFile(): string | null {
  return useWorkspace((s) => {
    const leaf = findLeaf(s.root, s.activeLeaf)
    const idx = leaf ? leaf.tabs.findIndex((t) => t.id === leaf.active) : -1
    const cur = leaf?.tabs[idx]?.path
    if (cur) return cur
    for (const l of allLeaves(s.root)) {
      const p = l.tabs.find((t) => t.id === l.active)?.path
      if (p) return p
    }
    if (lastFile && allLeaves(s.root).some((l) => l.tabs.some((t) => t.path === lastFile))) return lastFile
    // the tab opened right before the current one is usually the previously active file
    for (let i = idx - 1; i >= 0; i--) if (leaf!.tabs[i].path) return leaf!.tabs[i].path!
    return null
  })
}

export type OpenHow = 'default' | 'tab' | 'split'

export function isModClick(e: MouseEvent): boolean {
  return e.button === 1 || (isMac() ? e.metaKey : e.ctrlKey)
}

/**
 * Open a node. `avoidLeaf`: when the click happens in a main-area view (the global graph), open files in another
 * leaf if there is one so the graph stays visible.
 */
export function openNode(n: GNode, how: OpenHow, avoidLeaf?: string): void {
  const ws = useWorkspace.getState()
  if (n.kind === 'tag') {
    ws.revealPane('search')
    setTimeout(() => emit('focus-search', { query: `#${n.tag}` }), 30)
    return
  }
  if (how === 'default' && avoidLeaf && ws.activeLeaf === avoidLeaf) {
    const other = allLeaves(ws.root).find((l) => l.id !== avoidLeaf)
    if (other) ws.setActiveLeaf(other.id)
  }
  if (n.kind === 'unresolved') {
    // creates the note (unresolved link) and opens it
    void openLinkText(n.link!, '', how === 'tab')
    return
  }
  ws.openFile(n.path!, { target: how === 'tab' ? 'tab' : how === 'split' ? 'split-right' : undefined })
}

export function revealInExplorer(path: string): void {
  useWorkspace.getState().revealPane('files')
  setTimeout(() => emit('reveal-file', { path }), 30)
}

export function nodeMenuItems(n: GNode, avoidLeaf?: string): MenuItem[] {
  if (n.kind === 'tag')
    return [
      { label: `Search for #${n.tag}`, icon: <Search />, onClick: () => openNode(n, 'default') },
      { label: 'Copy tag', icon: <Copy />, onClick: () => void navigator.clipboard.writeText(`#${n.tag}`) }
    ]
  if (n.kind === 'unresolved')
    return [
      { label: `Create note "${n.label}"`, icon: <FilePlus2 />, onClick: () => openNode(n, 'default', avoidLeaf) },
      { label: 'Create in new tab', icon: <PanelTop />, onClick: () => openNode(n, 'tab') }
    ]
  const path = n.path!
  return [
    { label: 'Open', icon: <ExternalLink />, onClick: () => openNode(n, 'default', avoidLeaf) },
    { label: 'Open in new tab', icon: <PanelTop />, onClick: () => openNode(n, 'tab') },
    { label: 'Open to the right', icon: <SplitSquareHorizontal />, onClick: () => openNode(n, 'split') },
    { separator: true },
    { label: 'Reveal in file explorer', icon: <FolderOpen />, onClick: () => revealInExplorer(path) },
    { label: 'Copy path', icon: <Copy />, onClick: () => void navigator.clipboard.writeText(path) }
  ]
}

export function showNodeMenu(n: GNode, e: MouseEvent, avoidLeaf?: string): void {
  showContextMenu(e, nodeMenuItems(n, avoidLeaf))
}
