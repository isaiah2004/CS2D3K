import { Suspense, useRef, useState, useEffect, useCallback, useContext } from 'react'
import {
  X, Plus, Pin, ChevronLeft, ChevronRight, MoreHorizontal, SplitSquareHorizontal, SplitSquareVertical, Copy, FolderOpen,
  ExternalLink, Bookmark, Pencil, Trash2, PinOff
} from 'lucide-react'
import { useWorkspace, tabTitle, type LayoutNode, type LeafNode, type TabState } from '@/store/workspace'
import { showContextMenu, promptText, type MenuItem } from '@/store/ui'
import { useBookmarks } from '@/store/bookmarks'
import { VIEWS } from '@/views/registry'
import { HeaderActionsContext } from './Slots'
import { ViewIcon } from './FileIcon'
import { extname, dirname, basename, join, validateName, stem } from '@/lib/path'
import { renamePath, deletePath } from '@/lib/fileops'
import { executeCommand } from '@/store/commands'
import { startDrag } from './Sidebar'
import ErrorBoundary from './ErrorBoundary'

export const TAB_MIME = 'application/x-cs2d3k-tab'
export const FILE_MIME = 'application/x-cs2d3k-file'

// ------------------------------------------------------------------ split tree

function SplitView({ node }: { node: LayoutNode }) {
  const ref = useRef<HTMLDivElement>(null)
  if (node.kind === 'leaf') return <Leaf leaf={node} />
  const total = node.sizes.reduce((a, b) => a + b, 0) || 1
  const onDivider = (i: number, e: React.MouseEvent): void => {
    const el = ref.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const px = node.dir === 'row' ? rect.width : rect.height
    const s0 = [...node.sizes]
    startDrag(
      e,
      (dx, dy) => {
        const d = ((node.dir === 'row' ? dx : dy) / px) * total
        const min = total * 0.08
        const a = s0[i] + d
        const b = s0[i + 1] - d
        if (a < min || b < min) return
        const sizes = [...s0]
        sizes[i] = a
        sizes[i + 1] = b
        useWorkspace.getState().setSplitSizes(node.id, sizes)
      },
      undefined,
      node.dir === 'row' ? 'col-resize' : 'row-resize'
    )
  }
  return (
    <div ref={ref} className={`ws-split ${node.dir}`}>
      {node.children.map((c, i) => (
        <div key={c.id} style={{ display: 'contents' }}>
          {i > 0 && <div className="ws-divider" onMouseDown={(e) => onDivider(i - 1, e)} />}
          <div className="ws-split-child" style={{ flex: `${node.sizes[i] ?? 1} 1 0` }}>
            <SplitView node={c} />
          </div>
        </div>
      ))}
    </div>
  )
}

export default function LayoutView() {
  const root = useWorkspace((s) => s.root)
  return <SplitView node={root} />
}

// ------------------------------------------------------------------ leaf (tab group)

type DropZone = 'center' | 'left' | 'right' | 'top' | 'bottom'

function tabMenu(tab: TabState, leaf: LeafNode): MenuItem[] {
  const ws = useWorkspace.getState()
  const items: MenuItem[] = [
    { label: 'Close', icon: <X />, hint: 'Ctrl+W', onClick: () => ws.closeTab(tab.id) },
    { label: 'Close others', disabled: leaf.tabs.length < 2, onClick: () => ws.closeOthers(tab.id) },
    { label: 'Close all', onClick: () => ws.closeAllInLeaf(leaf.id) },
    { separator: true },
    { label: tab.pinned ? 'Unpin' : 'Pin', icon: tab.pinned ? <PinOff /> : <Pin />, onClick: () => ws.togglePin(tab.id) },
    { label: 'Split right', icon: <SplitSquareHorizontal />, onClick: () => ws.splitTab(tab.id, 'right') },
    { label: 'Split down', icon: <SplitSquareVertical />, onClick: () => ws.splitTab(tab.id, 'down') }
  ]
  if (tab.path) items.push(...fileMenuItems(tab.path))
  return items
}

export function fileMenuItems(path: string): MenuItem[] {
  const bm = useBookmarks.getState()
  return [
    { separator: true },
    {
      label: 'Rename...',
      icon: <Pencil />,
      onClick: async () => {
        const name = await promptText({ title: 'Rename file', initial: basename(path), selectStem: true, validate: validateName })
        if (name && name !== basename(path)) await renamePath(path, join(dirname(path), name))
      }
    },
    { label: bm.isBookmarked(path) ? 'Remove bookmark' : 'Bookmark', icon: <Bookmark />, onClick: () => bm.toggleFile(path) },
    { label: 'Reveal file in navigation', icon: <FolderOpen />, onClick: () => executeCommand('file-explorer:reveal-active-file') },
    { label: 'Copy path', icon: <Copy />, onClick: () => void navigator.clipboard.writeText(path) },
    {
      label: 'Copy absolute path',
      icon: <Copy />,
      onClick: async () => void navigator.clipboard.writeText(await window.api.fs.absPath(path))
    },
    { label: 'Show in system explorer', icon: <FolderOpen />, onClick: () => void window.api.fs.showInFolder(path) },
    { label: 'Open in default app', icon: <ExternalLink />, onClick: () => void window.api.fs.openWithDefaultApp(path) },
    { separator: true },
    { label: 'Delete file', icon: <Trash2 />, danger: true, onClick: () => void deletePath(path) }
  ]
}

function Leaf({ leaf }: { leaf: LeafNode }) {
  const activeLeaf = useWorkspace((s) => s.activeLeaf)
  const focused = activeLeaf === leaf.id
  const ws = useWorkspace.getState()
  const [dropTab, setDropTab] = useState<number | null>(null)
  const [zone, setZone] = useState<DropZone | null>(null)
  const [headerEl, setHeaderEl] = useState<HTMLElement | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  // tabs that have been shown at least once stay mounted (keeps editor state)
  const [mounted, setMounted] = useState<Set<string>>(() => new Set(leaf.active ? [leaf.active] : []))
  useEffect(() => {
    if (leaf.active && !mounted.has(leaf.active)) setMounted((m) => new Set(m).add(leaf.active!))
  }, [leaf.active, mounted])

  const activeTab = leaf.tabs.find((t) => t.id === leaf.active) ?? null

  const onTabDrop = (e: React.DragEvent, index: number): void => {
    const tabId = e.dataTransfer.getData(TAB_MIME)
    const file = e.dataTransfer.getData(FILE_MIME)
    setDropTab(null)
    e.preventDefault()
    e.stopPropagation()
    if (tabId) ws.moveTab(tabId, leaf.id, index)
    else if (file) ws.openFile(file, { leafId: leaf.id, target: 'tab' })
  }

  const zoneFor = (e: React.DragEvent): DropZone => {
    const r = containerRef.current!.getBoundingClientRect()
    const x = (e.clientX - r.left) / r.width
    const y = (e.clientY - r.top) / r.height
    if (x < 0.2) return 'left'
    if (x > 0.8) return 'right'
    if (y < 0.2) return 'top'
    if (y > 0.8) return 'bottom'
    return 'center'
  }

  const onViewDrop = (e: React.DragEvent): void => {
    const tabId = e.dataTransfer.getData(TAB_MIME)
    const file = e.dataTransfer.getData(FILE_MIME)
    const z = zoneFor(e)
    setZone(null)
    if (!tabId && !file) return
    e.preventDefault()
    const s = useWorkspace.getState()
    if (z === 'center') {
      if (tabId) s.moveTab(tabId, leaf.id)
      else s.openFile(file, { leafId: leaf.id })
      return
    }
    const target = z === 'right' || z === 'left' ? 'split-right' : 'split-down'
    if (tabId) {
      // open copy in split, then close original
      const found = leaf.tabs.find((t) => t.id === tabId)
      const all = useWorkspace.getState()
      const src = found ?? (() => {
        for (const l of allLeavesOf(all.root)) {
          const t = l.tabs.find((x) => x.id === tabId)
          if (t) return t
        }
        return null
      })()
      if (!src) return
      if (src.path) s.openFile(src.path, { leafId: leaf.id, target, state: src.state })
      else s.openView(src.type, { leafId: leaf.id, target, state: src.state })
      if (!(found && leaf.tabs.length === 1)) s.closeTab(tabId)
    } else s.openFile(file, { leafId: leaf.id, target })
  }

  const overlayStyle = (z: DropZone): React.CSSProperties => {
    switch (z) {
      case 'left':
        return { left: 4, top: 4, bottom: 4, width: '48%' }
      case 'right':
        return { right: 4, top: 4, bottom: 4, width: '48%' }
      case 'top':
        return { left: 4, right: 4, top: 4, height: '48%' }
      case 'bottom':
        return { left: 4, right: 4, bottom: 4, height: '48%' }
      default:
        return { inset: 4 }
    }
  }

  return (
    <div className={`leaf${focused ? ' is-focused' : ''}`} onMouseDownCapture={() => ws.setActiveLeaf(leaf.id)}>
      <div className="tab-bar">
        <div
          className="tab-list"
          onDragOver={(e) => {
            if (e.dataTransfer.types.includes(TAB_MIME) || e.dataTransfer.types.includes(FILE_MIME)) {
              e.preventDefault()
              if (dropTab === null) setDropTab(leaf.tabs.length)
            }
          }}
          onDragLeave={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node)) setDropTab(null)
          }}
          onDrop={(e) => onTabDrop(e, dropTab ?? leaf.tabs.length)}
          onDoubleClick={(e) => {
            if (e.target === e.currentTarget) ws.newTab(leaf.id)
          }}
        >
          {leaf.tabs.map((t, i) => (
            <div
              key={t.id}
              className={`tab${t.id === leaf.active ? ' is-active' : ''}${dropTab === i ? ' drop-before' : ''}`}
              draggable
              title={t.path ?? tabTitle(t)}
              onDragStart={(e) => {
                e.dataTransfer.setData(TAB_MIME, t.id)
                if (t.path) e.dataTransfer.setData(FILE_MIME, t.path)
                e.dataTransfer.effectAllowed = 'move'
              }}
              onDragOver={(e) => {
                if (e.dataTransfer.types.includes(TAB_MIME) || e.dataTransfer.types.includes(FILE_MIME)) {
                  e.preventDefault()
                  e.stopPropagation()
                  setDropTab(i)
                }
              }}
              onDrop={(e) => onTabDrop(e, i)}
              onMouseDown={(e) => {
                if (e.button === 1) {
                  e.preventDefault()
                  ws.closeTab(t.id)
                } else if (e.button === 0) ws.activateTab(t.id)
              }}
              onContextMenu={(e) => showContextMenu(e, tabMenu(t, leaf))}
            >
              <ViewIcon type={t.type} ext={t.path ? extname(t.path) : undefined} className="tab-icon" />
              <span className="tab-title">{tabTitle(t)}</span>
              {t.pinned ? (
                <button className="clickable-icon tab-close" onClick={() => ws.togglePin(t.id)} title="Unpin">
                  <Pin />
                </button>
              ) : (
                <button
                  className="clickable-icon tab-close"
                  onMouseDown={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.stopPropagation()
                    ws.closeTab(t.id)
                  }}
                  title="Close"
                >
                  <X />
                </button>
              )}
            </div>
          ))}
        </div>
        <div className="tab-bar-actions">
          <button className="clickable-icon small" title="New tab (Ctrl+T)" onClick={() => ws.newTab(leaf.id)}>
            <Plus />
          </button>
        </div>
      </div>

      {activeTab && activeTab.type !== 'empty' && <ViewHeader tab={activeTab} leaf={leaf} setActionsEl={setHeaderEl} />}

      <div
        className="view-container"
        ref={containerRef}
        onDragOver={(e) => {
          if (e.dataTransfer.types.includes(TAB_MIME) || (e.dataTransfer.types.includes(FILE_MIME) && !e.defaultPrevented)) {
            // let views (e.g. canvas, editor) handle file drops themselves if they want
            if (e.dataTransfer.types.includes(FILE_MIME) && (e.target as HTMLElement).closest('[data-accepts-file-drop]')) return
            e.preventDefault()
            const z = zoneFor(e)
            if (z !== zone) setZone(z)
          }
        }}
        onDragOverCapture={(e) => {
          if (!e.dataTransfer.types.includes(TAB_MIME)) return
          e.preventDefault()
          e.stopPropagation()
          const z = zoneFor(e)
          if (z !== zone) setZone(z)
        }}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node)) setZone(null)
        }}
        onDropCapture={(e) => {
          if (!e.dataTransfer.types.includes(TAB_MIME)) return
          e.stopPropagation()
          onViewDrop(e)
        }}
        onDrop={onViewDrop}
      >
        <HeaderActionsContext.Provider value={headerEl}>
          {leaf.tabs
            .filter((t) => mounted.has(t.id) || t.id === leaf.active)
            .map((t) => (
              <TabContent key={`${t.id}:${t.navId ?? 0}`} tab={t} leafId={leaf.id} visible={t.id === leaf.active} focused={focused && t.id === leaf.active} />
            ))}
        </HeaderActionsContext.Provider>
        {zone && <div className="leaf-drop-overlay" style={overlayStyle(zone)} />}
      </div>
    </div>
  )
}

function allLeavesOf(node: LayoutNode, out: LeafNode[] = []): LeafNode[] {
  if (node.kind === 'leaf') out.push(node)
  else node.children.forEach((c) => allLeavesOf(c, out))
  return out
}

function TabContent({ tab, leafId, visible, focused }: { tab: TabState; leafId: string; visible: boolean; focused: boolean }) {
  const View = VIEWS[tab.type]
  // only the visible tab gets the header actions context
  return (
    <div className={`view view-${tab.type}${visible ? '' : ' hidden'}`} data-tab-id={tab.id}>
      <MaybeHeader visible={visible}>
        {View ? (
          <ErrorBoundary label="this view">
            <Suspense fallback={<div className="empty-state">Loading…</div>}>
              <View tab={tab} leafId={leafId} visible={visible} focused={focused} />
            </Suspense>
          </ErrorBoundary>
        ) : (
          <div className="empty-state">No view for type “{tab.type}”</div>
        )}
      </MaybeHeader>
    </div>
  )
}

/**
 * Hidden tabs must not render into the shared header actions slot. Always render the same Provider
 * element (only its value changes) so React keeps the view mounted when the tab is hidden/shown.
 */
function MaybeHeader({ visible, children }: { visible: boolean; children: React.ReactNode }) {
  const outer = useContext(HeaderActionsContext)
  return <HeaderActionsContext.Provider value={visible ? outer : null}>{children}</HeaderActionsContext.Provider>
}

function ViewHeader({ tab, leaf, setActionsEl }: { tab: TabState; leaf: LeafNode; setActionsEl: (el: HTMLElement | null) => void }) {
  const ws = useWorkspace.getState()
  const ref = useCallback((el: HTMLDivElement | null) => setActionsEl(el), [setActionsEl])
  const crumbs = tab.path ? dirname(tab.path).split('/').filter(Boolean) : []
  const rename = async (): Promise<void> => {
    if (!tab.path) return
    const ext = extname(tab.path)
    const isNote = ext === 'md' || ext === 'canvas' || ext === 'formmap'
    const cur = isNote ? stem(tab.path) : basename(tab.path)
    const name = await promptText({ title: 'Rename', initial: cur, selectStem: !isNote, validate: validateName })
    if (name && name !== cur) await renamePath(tab.path, join(dirname(tab.path), isNote ? `${name}.${ext}` : name))
  }
  return (
    <div className="view-header">
      <button className="clickable-icon small" disabled={tab.historyIndex <= 0} onClick={() => ws.goBack()} title="Navigate back">
        <ChevronLeft />
      </button>
      <button className="clickable-icon small" disabled={tab.historyIndex >= tab.history.length - 1} onClick={() => ws.goForward()} title="Navigate forward">
        <ChevronRight />
      </button>
      <div className="view-header-title">
        {crumbs.map((c, i) => (
          <span key={i}>
            <span className="crumb">{c}</span>
            <span className="crumb-sep">/</span>
          </span>
        ))}
        <span className="crumb-current" onClick={() => void rename()} style={{ cursor: tab.path ? 'text' : 'default' }}>
          {tabTitle(tab)}
        </span>
      </div>
      <div className="view-header-actions" ref={ref} />
      <button className="clickable-icon small" title="More options" onClick={(e) => showContextMenu(e, tabMenu(tab, leaf))}>
        <MoreHorizontal />
      </button>
    </div>
  )
}
