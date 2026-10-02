import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { loadTestVault, memory } from '../../helpers/vault'
import {
  useWorkspace,
  allLeaves,
  findLeaf,
  findTab,
  tabTitle,
  getActiveTab,
  getActiveFile,
  type LayoutNode,
  type LeafNode,
  type SplitNode
} from '@/store/workspace'

const ws = () => useWorkspace.getState()
const leaves = (): LeafNode[] => allLeaves(ws().root)
const activeLeaf = (): LeafNode => findLeaf(ws().root, ws().activeLeaf)!
const tabPaths = (leaf: LeafNode): (string | undefined)[] => leaf.tabs.map((t) => t.path)
const tabByPath = (path: string) => leaves().flatMap((l) => l.tabs).find((t) => t.path === path)!
const asSplit = (n: LayoutNode): SplitNode => {
  expect(n.kind).toBe('split')
  return n as SplitNode
}

beforeEach(async () => {
  vi.useFakeTimers()
  await loadTestVault({})
})

afterEach(() => {
  vi.clearAllTimers()
  vi.useRealTimers()
})

describe('store/workspace initial state', () => {
  it('starts with a single leaf holding one New tab', () => {
    expect(leaves()).toHaveLength(1)
    const [leaf] = leaves()
    expect(leaf.tabs).toHaveLength(1)
    expect(leaf.tabs[0].type).toBe('empty')
    expect(leaf.active).toBe(leaf.tabs[0].id)
    expect(ws().activeLeaf).toBe(leaf.id)
    expect(getActiveFile()).toBeNull()
  })
})

describe('store/workspace openFile', () => {
  it('replaces the active tab in place and records history', () => {
    const before = getActiveTab()!
    ws().openFile('a.md')
    const leaf = activeLeaf()
    expect(leaf.tabs).toHaveLength(1)
    const tab = leaf.tabs[0]
    expect(tab.id).toBe(before.id)
    expect(tab).toMatchObject({ type: 'markdown', path: 'a.md', navId: before.navId + 1, historyIndex: 1 })
    expect(tab.history.map((h) => h.type)).toEqual(['empty', 'markdown'])
    expect(getActiveFile()).toBe('a.md')
  })

  it('picks the view type from the file extension', () => {
    ws().openFile('board.canvas')
    expect(getActiveTab()!.type).toBe('canvas')
    ws().openFile('src/main.ts')
    expect(getActiveTab()!.type).toBe('code')
    ws().openFile('img/pic.png')
    expect(getActiveTab()!.type).toBe('image')
    ws().openFile('doc.pdf')
    expect(getActiveTab()!.type).toBe('pdf')
  })

  it('opens a new tab right after the active one when target is tab', () => {
    ws().openFile('a.md')
    ws().openFile('c.md', { target: 'tab' })
    ws().activateTab(tabByPath('a.md').id)
    ws().openFile('b.md', { target: 'tab' })
    expect(tabPaths(activeLeaf())).toEqual(['a.md', 'b.md', 'c.md'])
    expect(getActiveFile()).toBe('b.md')
  })

  it('focuses a tab that already shows the file instead of opening a duplicate', () => {
    ws().openFile('a.md')
    ws().openFile('b.md', { target: 'tab' })
    ws().openFile('a.md')
    expect(tabPaths(activeLeaf())).toEqual(['a.md', 'b.md'])
    expect(getActiveFile()).toBe('a.md')
  })

  it('passes navigation state to an already open tab with a fresh _nav stamp', () => {
    ws().openFile('a.md')
    ws().openFile('b.md', { target: 'tab' })
    ws().openFile('a.md', { state: { line: 7 } })
    const tab = tabByPath('a.md')
    expect(tab.state).toMatchObject({ line: 7 })
    expect(typeof tab.state!._nav).toBe('number')
    expect(getActiveFile()).toBe('a.md')
  })

  it('stores navigation state on a newly opened tab', () => {
    ws().openFile('a.md', { state: { subpath: '#Head' } })
    expect(getActiveTab()!.state).toEqual({ subpath: '#Head' })
  })

  it('never navigates a pinned tab away; opens a new tab instead', () => {
    ws().openFile('a.md')
    ws().togglePin(getActiveTab()!.id)
    ws().openFile('b.md')
    expect(tabPaths(activeLeaf())).toEqual(['a.md', 'b.md'])
    expect(tabByPath('a.md').pinned).toBe(true)
  })

  it('split-right puts the file in a new leaf to the right and focuses it', () => {
    ws().openFile('a.md')
    const first = ws().activeLeaf
    ws().openFile('b.md', { target: 'split-right' })
    const root = asSplit(ws().root)
    expect(root.dir).toBe('row')
    expect(root.sizes).toEqual([1, 1])
    expect(leaves().map(tabPaths)).toEqual([['a.md'], ['b.md']])
    expect(ws().activeLeaf).not.toBe(first)
    expect(getActiveFile()).toBe('b.md')
  })

  it('split-down creates a column split', () => {
    ws().openFile('a.md')
    ws().openFile('b.md', { target: 'split-down' })
    expect(asSplit(ws().root).dir).toBe('column')
  })

  it('split-right always opens a new pane, even if the file is already open', () => {
    ws().openFile('a.md')
    ws().openFile('a.md', { target: 'split-right' })
    expect(leaves().map(tabPaths)).toEqual([['a.md'], ['a.md']])
  })

  it('flattens repeated same-direction splits into one split with proportional sizes', () => {
    ws().openFile('a.md')
    ws().openFile('b.md', { target: 'split-right' })
    ws().openFile('c.md', { target: 'split-right' })
    const root = asSplit(ws().root)
    expect(root.children.map((c) => c.kind)).toEqual(['leaf', 'leaf', 'leaf'])
    expect(root.sizes).toEqual([1, 0.5, 0.5])
  })

  it('nests a cross-direction split inside the existing one', () => {
    ws().openFile('a.md')
    ws().openFile('b.md', { target: 'split-right' })
    ws().openFile('c.md', { target: 'split-down' })
    const root = asSplit(ws().root)
    expect(root.dir).toBe('row')
    expect(root.children[0].kind).toBe('leaf')
    const inner = asSplit(root.children[1])
    expect(inner.dir).toBe('column')
    expect(allLeaves(inner).map(tabPaths)).toEqual([['b.md'], ['c.md']])
  })

  it('opens into the given leafId', () => {
    ws().openFile('a.md')
    const left = ws().activeLeaf
    ws().openFile('b.md', { target: 'split-right' })
    ws().openFile('c.md', { leafId: left, target: 'tab' })
    expect(tabPaths(findLeaf(ws().root, left)!)).toEqual(['a.md', 'c.md'])
    expect(ws().activeLeaf).toBe(left)
  })

  it('keeps the current focus when activate is false', () => {
    ws().openFile('a.md')
    const leafId = ws().activeLeaf
    ws().openFile('b.md', { target: 'tab', activate: false })
    expect(tabPaths(activeLeaf())).toEqual(['a.md', 'b.md'])
    expect(getActiveFile()).toBe('a.md')
    ws().openFile('c.md', { target: 'split-right', activate: false })
    expect(ws().activeLeaf).toBe(leafId)
  })

  it('bumps activeVersion on every open', () => {
    const v = ws().activeVersion
    ws().openFile('a.md')
    expect(ws().activeVersion).toBeGreaterThan(v)
  })
})

describe('store/workspace newTab / openView', () => {
  it('newTab adds an empty tab after the active one and focuses it', () => {
    ws().openFile('a.md')
    ws().newTab()
    const leaf = activeLeaf()
    expect(leaf.tabs.map((t) => t.type)).toEqual(['markdown', 'empty'])
    expect(getActiveTab()!.type).toBe('empty')
  })

  it('newTab(leafId) adds the tab to that leaf and focuses it', () => {
    ws().openFile('a.md')
    const left = ws().activeLeaf
    ws().openFile('b.md', { target: 'split-right' })
    ws().newTab(left)
    expect(findLeaf(ws().root, left)!.tabs).toHaveLength(2)
    expect(ws().activeLeaf).toBe(left)
  })

  it('openView opens the graph in a new tab', () => {
    ws().openFile('a.md')
    ws().openView('graph')
    expect(activeLeaf().tabs.map((t) => t.type)).toEqual(['markdown', 'graph'])
    expect(getActiveTab()!.type).toBe('graph')
  })

  it('openView focuses the existing graph anywhere instead of opening another', () => {
    ws().openView('graph')
    const graphLeaf = ws().activeLeaf
    ws().openFile('a.md', { target: 'split-right' })
    ws().openView('graph')
    expect(leaves().flatMap((l) => l.tabs).filter((t) => t.type === 'graph')).toHaveLength(1)
    expect(ws().activeLeaf).toBe(graphLeaf)
    expect(getActiveTab()!.type).toBe('graph')
  })

  it('openView with an explicit target opens a second graph', () => {
    ws().openView('graph')
    ws().openView('graph', { target: 'tab' })
    expect(activeLeaf().tabs.filter((t) => t.type === 'graph')).toHaveLength(2)
  })
})

describe('store/workspace closing tabs', () => {
  it('activates the right neighbour (or the new last tab) when the active tab closes', () => {
    ws().openFile('a.md')
    ws().openFile('b.md', { target: 'tab' })
    ws().openFile('c.md', { target: 'tab' })
    ws().activateTab(tabByPath('b.md').id)
    ws().closeTab(tabByPath('b.md').id)
    expect(tabPaths(activeLeaf())).toEqual(['a.md', 'c.md'])
    expect(getActiveFile()).toBe('c.md')
    ws().closeTab(tabByPath('c.md').id)
    expect(getActiveFile()).toBe('a.md')
  })

  it('keeps the active tab when closing a background tab', () => {
    ws().openFile('a.md')
    ws().openFile('b.md', { target: 'tab' })
    ws().closeTab(tabByPath('a.md').id)
    expect(getActiveFile()).toBe('b.md')
  })

  it('replaces the very last tab with a fresh New tab', () => {
    ws().openFile('a.md')
    const id = getActiveTab()!.id
    ws().closeTab(id)
    expect(leaves()).toHaveLength(1)
    const tab = getActiveTab()!
    expect(tab.type).toBe('empty')
    expect(tab.id).not.toBe(id)
    expect(ws().activeLeaf).toBe(leaves()[0].id)
  })

  it('removes an emptied leaf and collapses the single-child split', () => {
    ws().openFile('a.md')
    const left = ws().activeLeaf
    ws().openFile('b.md', { target: 'split-right' })
    ws().closeTab(tabByPath('b.md').id)
    expect(ws().root.kind).toBe('leaf')
    expect(ws().root.id).toBe(left)
    expect(ws().activeLeaf).toBe(left)
  })

  it('collapses nested splits level by level as leaves empty', () => {
    ws().openFile('a.md')
    ws().openFile('b.md', { target: 'split-right' })
    ws().openFile('c.md', { target: 'split-down' })
    ws().closeTab(tabByPath('c.md').id)
    const root = asSplit(ws().root)
    expect(root.dir).toBe('row')
    expect(root.children.map((c) => c.kind)).toEqual(['leaf', 'leaf'])
    ws().closeTab(tabByPath('b.md').id)
    expect(ws().root.kind).toBe('leaf')
    expect(getActiveFile()).toBe('a.md')
  })

  it('ignores unknown tab ids', () => {
    const before = ws().root
    ws().closeTab('nope')
    expect(ws().root).toBe(before)
  })

  it('closeOthers keeps only the given tab and pinned tabs', () => {
    ws().openFile('a.md')
    ws().togglePin(getActiveTab()!.id)
    ws().openFile('b.md', { target: 'tab' })
    ws().openFile('c.md', { target: 'tab' })
    ws().closeOthers(tabByPath('b.md').id)
    expect(tabPaths(activeLeaf())).toEqual(['a.md', 'b.md'])
    expect(getActiveFile()).toBe('b.md')
  })

  it('closeAllInLeaf removes the leaf from a split', () => {
    ws().openFile('a.md')
    ws().openFile('b.md', { target: 'split-right' })
    ws().openFile('c.md', { target: 'tab' })
    ws().closeAllInLeaf(ws().activeLeaf)
    expect(ws().root.kind).toBe('leaf')
    expect(getActiveFile()).toBe('a.md')
  })

  it('closeAllInLeaf on the only leaf leaves a fresh New tab', () => {
    ws().openFile('a.md')
    ws().openFile('b.md', { target: 'tab' })
    ws().closeAllInLeaf(ws().activeLeaf)
    expect(leaves()).toHaveLength(1)
    expect(activeLeaf().tabs.map((t) => t.type)).toEqual(['empty'])
    expect(activeLeaf().active).toBe(activeLeaf().tabs[0].id)
  })
})

describe('store/workspace moving and splitting tabs', () => {
  it('moves a tab to another leaf at an index and focuses it there', () => {
    ws().openFile('a.md')
    ws().openFile('b.md', { target: 'tab' })
    const left = ws().activeLeaf
    ws().openFile('c.md', { target: 'split-right' })
    const right = ws().activeLeaf
    ws().moveTab(tabByPath('b.md').id, right, 0)
    expect(tabPaths(findLeaf(ws().root, left)!)).toEqual(['a.md'])
    expect(tabPaths(findLeaf(ws().root, right)!)).toEqual(['b.md', 'c.md'])
    expect(ws().activeLeaf).toBe(right)
    expect(getActiveFile()).toBe('b.md')
  })

  it('collapses the source leaf when its last tab is moved away', () => {
    ws().openFile('a.md')
    const left = ws().activeLeaf
    ws().openFile('b.md', { target: 'split-right' })
    ws().moveTab(tabByPath('b.md').id, left)
    expect(ws().root.kind).toBe('leaf')
    expect(tabPaths(activeLeaf())).toEqual(['a.md', 'b.md'])
    expect(getActiveFile()).toBe('b.md')
  })

  it('moving the active tab out picks another tab in the source leaf', () => {
    ws().openFile('a.md')
    ws().openFile('b.md', { target: 'tab' })
    const left = ws().activeLeaf
    ws().openFile('c.md', { target: 'split-right' })
    const right = ws().activeLeaf
    ws().moveTab(tabByPath('b.md').id, right)
    expect(findLeaf(ws().root, left)!.active).toBe(tabByPath('a.md').id)
  })

  it('reorders a tab within its own leaf, clamping the index', () => {
    ws().openFile('a.md')
    ws().openFile('b.md', { target: 'tab' })
    ws().openFile('c.md', { target: 'tab' })
    const leafId = ws().activeLeaf
    ws().moveTab(tabByPath('c.md').id, leafId, 0)
    expect(tabPaths(activeLeaf())).toEqual(['c.md', 'a.md', 'b.md'])
    ws().moveTab(tabByPath('c.md').id, leafId, 99)
    expect(tabPaths(activeLeaf())).toEqual(['a.md', 'b.md', 'c.md'])
  })

  it('does not lose a tab when moved to a leaf that no longer exists', () => {
    ws().openFile('a.md')
    ws().openFile('b.md', { target: 'tab' })
    ws().moveTab(tabByPath('b.md').id, 'leaf-gone')
    expect(tabPaths(activeLeaf())).toEqual(['a.md', 'b.md'])
  })

  it('splitTab duplicates the tab into a new focused leaf', () => {
    ws().openFile('a.md', { state: { mode: 'source' } })
    const original = getActiveTab()!
    ws().splitTab(original.id, 'down')
    const root = asSplit(ws().root)
    expect(root.dir).toBe('column')
    const copy = getActiveTab()!
    expect(copy.id).not.toBe(original.id)
    expect(copy).toMatchObject({ path: 'a.md', type: 'markdown', state: { mode: 'source' } })
    expect(ws().activeLeaf).toBe(root.children[1].id)
  })

  it('setSplitSizes updates the sizes of that split only', () => {
    ws().openFile('a.md')
    ws().openFile('b.md', { target: 'split-right' })
    ws().openFile('c.md', { target: 'split-down' })
    const inner = asSplit(asSplit(ws().root).children[1])
    ws().setSplitSizes(inner.id, [3, 1])
    const root = asSplit(ws().root)
    expect(root.sizes).toEqual([1, 1])
    expect(asSplit(root.children[1]).sizes).toEqual([3, 1])
  })
})

describe('store/workspace activation', () => {
  it('activateTab focuses the tab and its leaf', () => {
    ws().openFile('a.md')
    const left = ws().activeLeaf
    ws().openFile('b.md', { target: 'split-right' })
    ws().activateTab(tabByPath('a.md').id)
    expect(ws().activeLeaf).toBe(left)
    expect(getActiveFile()).toBe('a.md')
  })

  it('setActiveLeaf ignores unknown leaves', () => {
    const leafId = ws().activeLeaf
    ws().setActiveLeaf('leaf-gone')
    expect(ws().activeLeaf).toBe(leafId)
  })

  it('getActiveTab follows the active leaf', () => {
    ws().openFile('a.md')
    const left = ws().activeLeaf
    ws().openFile('b.md', { target: 'split-right' })
    expect(getActiveFile()).toBe('b.md')
    ws().setActiveLeaf(left)
    expect(getActiveFile()).toBe('a.md')
  })
})

describe('store/workspace history', () => {
  it('goBack/goForward walk the tab history and bump navId', () => {
    ws().openFile('a.md')
    ws().openFile('b.md')
    const n = getActiveTab()!.navId
    ws().goBack()
    expect(getActiveTab()).toMatchObject({ path: 'a.md', historyIndex: 1, navId: n + 1 })
    ws().goForward()
    expect(getActiveTab()).toMatchObject({ path: 'b.md', historyIndex: 2, navId: n + 2 })
  })

  it('goBack to the first entry restores the New tab', () => {
    ws().openFile('a.md')
    ws().goBack()
    expect(getActiveTab()).toMatchObject({ type: 'empty', path: undefined })
  })

  it('stops at both ends of the history', () => {
    ws().openFile('a.md')
    ws().goForward()
    const atEnd = getActiveTab()!
    expect(atEnd.path).toBe('a.md')
    ws().goBack()
    ws().goBack()
    expect(getActiveTab()!.historyIndex).toBe(0)
    expect(getActiveTab()!.navId).toBe(atEnd.navId + 1)
  })

  it('navigating after going back drops the forward history', () => {
    ws().openFile('a.md')
    ws().openFile('b.md')
    ws().goBack()
    ws().openFile('c.md')
    const tab = getActiveTab()!
    expect(tab.history.map((h) => h.path)).toEqual([undefined, 'a.md', 'c.md'])
    ws().goForward()
    expect(getActiveFile()).toBe('c.md')
  })

  it('caps the history at 50 entries', () => {
    for (let i = 0; i < 60; i++) ws().openFile(`n${i}.md`)
    const tab = getActiveTab()!
    expect(tab.history).toHaveLength(50)
    expect(tab.historyIndex).toBe(49)
    expect(tab.history[49].path).toBe('n59.md')
  })

  it('restores per-entry view state when navigating back', () => {
    ws().openFile('a.md')
    ws().updateTabState(getActiveTab()!.id, { scroll: 120 })
    ws().openFile('b.md')
    expect(getActiveTab()!.state).toBeUndefined()
    ws().goBack()
    expect(getActiveTab()!.state).toEqual({ scroll: 120 })
  })
})

describe('store/workspace updateTabState / togglePin', () => {
  it('merges the patch into tab state without changing navId', () => {
    ws().openFile('a.md', { state: { mode: 'source' } })
    const tab = getActiveTab()!
    ws().updateTabState(tab.id, { scroll: 10 })
    const next = getActiveTab()!
    expect(next.state).toEqual({ mode: 'source', scroll: 10 })
    expect(next.history[next.historyIndex].state).toEqual({ mode: 'source', scroll: 10 })
    expect(next.navId).toBe(tab.navId)
  })

  it('togglePin flips the pinned flag', () => {
    const id = getActiveTab()!.id
    ws().togglePin(id)
    expect(getActiveTab()!.pinned).toBe(true)
    ws().togglePin(id)
    expect(getActiveTab()!.pinned).toBe(false)
  })
})

describe('store/workspace file lifecycle', () => {
  it('onRename updates open tabs and their history without remounting (navId unchanged)', () => {
    ws().openFile('a.md')
    ws().openFile('a.md', { target: 'split-right' })
    const before = getActiveTab()!
    ws().onRename('a.md', 'z.md')
    for (const leaf of leaves()) expect(tabPaths(leaf)).toEqual(['z.md'])
    const after = getActiveTab()!
    expect(after.id).toBe(before.id)
    expect(after.navId).toBe(before.navId)
    expect(after.history[after.historyIndex].path).toBe('z.md')
  })

  it('onRename switches the view type when the extension changes', () => {
    ws().openFile('script.md')
    ws().onRename('script.md', 'script.ts')
    expect(getActiveTab()).toMatchObject({ path: 'script.ts', type: 'code' })
  })

  it('onRename keeps history entries consistent with the new extension', () => {
    ws().openFile('script.md')
    ws().openFile('other.md')
    ws().onRename('script.md', 'script.ts')
    ws().goBack()
    expect(getActiveTab()).toMatchObject({ path: 'script.ts', type: 'code' })
  })

  it('onRename of a folder updates every tab inside it but not look-alike siblings', () => {
    ws().openFile('notes/a.md')
    ws().openFile('notes/sub/b.md', { target: 'tab' })
    ws().openFile('notes2/c.md', { target: 'tab' })
    ws().onRename('notes', 'archive/notes')
    expect(tabPaths(activeLeaf())).toEqual(['archive/notes/a.md', 'archive/notes/sub/b.md', 'notes2/c.md'])
  })

  it('onRename leaves path-less tabs alone', () => {
    ws().openView('graph')
    ws().onRename('a.md', 'b.md')
    expect(activeLeaf().tabs.map((t) => [t.type, t.path])).toEqual([
      ['empty', undefined],
      ['graph', undefined]
    ])
  })

  it('onDelete closes the tabs showing the file in every leaf', () => {
    ws().openFile('a.md')
    ws().openFile('b.md', { target: 'tab' })
    ws().openFile('a.md', { target: 'split-right' })
    ws().onDelete('a.md')
    expect(ws().root.kind).toBe('leaf')
    expect(tabPaths(activeLeaf())).toEqual(['b.md'])
  })

  it('onDelete of a folder closes tabs of files inside it only', () => {
    ws().openFile('dir/a.md')
    ws().openFile('dir/deep/b.md', { target: 'tab' })
    ws().openFile('dir2/c.md', { target: 'tab' })
    ws().onDelete('dir')
    expect(tabPaths(activeLeaf())).toEqual(['dir2/c.md'])
  })

  it('onDelete of the only open file leaves a New tab', () => {
    ws().openFile('a.md')
    ws().onDelete('a.md')
    expect(getActiveTab()!.type).toBe('empty')
  })
})

describe('store/workspace tabTitle / findTab', () => {
  it('uses the stem for notes/canvases and the basename for other files', () => {
    expect(tabTitle({ type: 'markdown', path: 'dir/Note.md' })).toBe('Note')
    expect(tabTitle({ type: 'canvas', path: 'Board.canvas' })).toBe('Board')
    expect(tabTitle({ type: 'code', path: 'src/x.ts' })).toBe('x.ts')
    expect(tabTitle({ type: 'graph' })).toBe('Graph view')
    expect(tabTitle({ type: 'empty' })).toBe('New tab')
  })

  it('findTab returns the tab and its leaf', () => {
    ws().openFile('a.md')
    const id = getActiveTab()!.id
    const found = findTab(ws().root, id)!
    expect(found.leaf.id).toBe(ws().activeLeaf)
    expect(found.tab.path).toBe('a.md')
    expect(findTab(ws().root, 'nope')).toBeNull()
  })
})

describe('store/workspace sidebars', () => {
  it('toggleSidebar flips or sets the open state', () => {
    expect(ws().left.open).toBe(true)
    ws().toggleSidebar('left')
    expect(ws().left.open).toBe(false)
    ws().toggleSidebar('left', false)
    expect(ws().left.open).toBe(false)
    ws().toggleSidebar('left', true)
    expect(ws().left.open).toBe(true)
    expect(ws().right.open).toBe(true)
  })

  it('setSidebarWidth clamps between 180 and 700', () => {
    ws().setSidebarWidth('right', 50)
    expect(ws().right.width).toBe(180)
    ws().setSidebarWidth('right', 5000)
    expect(ws().right.width).toBe(700)
    ws().setSidebarWidth('right', 333)
    expect(ws().right.width).toBe(333)
  })

  it('setGroupActive switches the visible pane of a group', () => {
    ws().setGroupActive('left', 'lg1', 'search')
    expect(ws().left.groups[0].active).toBe('search')
  })

  it('revealPane opens the sidebar holding the pane and activates it', () => {
    ws().toggleSidebar('right', false)
    ws().revealPane('outline')
    expect(ws().right.open).toBe(true)
    expect(ws().right.groups.find((g) => g.id === 'rg2')!.active).toBe('outline')
    ws().revealPane('localgraph')
    expect(ws().right.groups.find((g) => g.id === 'rg2')!.active).toBe('localgraph')
  })

  it('revealPane adds a pane that is placed nowhere to the right sidebar', () => {
    useWorkspace.setState({ left: { ...ws().left, groups: [{ id: 'lg1', panes: ['files'], active: 'files', size: 1 }] } })
    ws().toggleSidebar('right', false)
    ws().revealPane('search')
    expect(ws().right.open).toBe(true)
    expect(ws().right.groups[0].panes).toContain('search')
    expect(ws().right.groups[0].active).toBe('search')
  })

  it('movePane moves a pane to the other sidebar and activates it', () => {
    ws().toggleSidebar('right', false)
    ws().movePane('files', 'right')
    expect(ws().left.groups[0].panes).toEqual(['search', 'bookmarks'])
    expect(ws().left.groups[0].active).toBe('search')
    expect(ws().right.groups[0].panes).toEqual(['backlinks', 'outgoing', 'tags', 'files'])
    expect(ws().right.groups[0].active).toBe('files')
    expect(ws().right.open).toBe(true)
  })

  it('movePane inserts at an index in the requested group', () => {
    ws().movePane('search', 'right', 'rg2', 1)
    expect(ws().right.groups[1].panes).toEqual(['outline', 'search', 'localgraph'])
  })

  it('movePane falls back to the first group when the target group is unknown', () => {
    ws().movePane('search', 'right', 'nope')
    expect(ws().right.groups[0].panes).toContain('search')
  })

  it("movePane to 'new' creates a new group", () => {
    ws().movePane('outline', 'left', 'new')
    expect(ws().left.groups).toHaveLength(2)
    expect(ws().left.groups[1]).toMatchObject({ panes: ['outline'], active: 'outline', size: 1 })
  })

  it('movePane drops a group that becomes empty', () => {
    ws().movePane('outline', 'left')
    ws().movePane('localgraph', 'left')
    expect(ws().right.groups.map((g) => g.id)).toEqual(['rg1'])
  })

  it('movePane into a sidebar with no groups creates one', () => {
    for (const p of ['files', 'search', 'bookmarks'] as const) ws().movePane(p, 'right')
    expect(ws().left.groups).toEqual([])
    ws().movePane('files', 'left')
    expect(ws().left.groups).toHaveLength(1)
    expect(ws().left.groups[0].panes).toEqual(['files'])
  })

  it('setGroupSizes stores the sizes per group', () => {
    ws().setGroupSizes('right', [2, 3])
    expect(ws().right.groups.map((g) => g.size)).toEqual([2, 3])
  })
})

describe('store/workspace bottom panel', () => {
  it('opening an empty panel creates Terminal 1; toggling again hides it but keeps tabs', () => {
    expect(ws().bottom.open).toBe(false)
    ws().toggleBottom()
    expect(ws().bottom.open).toBe(true)
    expect(ws().bottom.tabs.map((t) => t.title)).toEqual(['Terminal 1'])
    expect(ws().bottom.active).toBe(ws().bottom.tabs[0].id)
    ws().toggleBottom()
    expect(ws().bottom.open).toBe(false)
    expect(ws().bottom.tabs).toHaveLength(1)
    ws().toggleBottom(true)
    expect(ws().bottom.open).toBe(true)
    expect(ws().bottom.tabs).toHaveLength(1)
  })

  it('toggleBottom(false) on an empty panel does not create a terminal', () => {
    ws().toggleBottom(false)
    expect(ws().bottom).toMatchObject({ open: false, tabs: [] })
  })

  it('addBottomTab numbers terminals, names output tabs and focuses the new tab', () => {
    const t1 = ws().addBottomTab('terminal')
    const t2 = ws().addBottomTab('terminal')
    const out = ws().addBottomTab('output')
    const custom = ws().addBottomTab('terminal', 'Build')
    expect(ws().bottom.tabs.map((t) => [t.id, t.title])).toEqual([
      [t1, 'Terminal 1'],
      [t2, 'Terminal 2'],
      [out, 'Output'],
      [custom, 'Build']
    ])
    expect(ws().bottom.active).toBe(custom)
    expect(ws().bottom.open).toBe(true)
  })

  it('closeBottomTab activates a neighbour and closes the panel with the last tab', () => {
    const a = ws().addBottomTab('terminal')
    const b = ws().addBottomTab('terminal')
    const c = ws().addBottomTab('terminal')
    ws().setBottomActive(b)
    ws().closeBottomTab(b)
    expect(ws().bottom.active).toBe(c)
    ws().closeBottomTab(c)
    expect(ws().bottom.active).toBe(a)
    expect(ws().bottom.open).toBe(true)
    ws().closeBottomTab(a)
    expect(ws().bottom).toMatchObject({ open: false, tabs: [], active: null })
  })

  it('setBottomActive opens the panel; renameBottomTab renames', () => {
    const a = ws().addBottomTab('terminal')
    ws().toggleBottom(false)
    ws().setBottomActive(a)
    expect(ws().bottom.open).toBe(true)
    ws().renameBottomTab(a, 'zsh')
    expect(ws().bottom.tabs[0].title).toBe('zsh')
  })

  it('setBottomHeight clamps to [100, window height - 150]', () => {
    ws().setBottomHeight(10)
    expect(ws().bottom.height).toBe(100)
    ws().setBottomHeight(100000)
    expect(ws().bottom.height).toBe(window.innerHeight - 150)
    ws().setBottomHeight(300)
    expect(ws().bottom.height).toBe(300)
  })
})

describe('store/workspace persistence', () => {
  const saved = () => memory().config.get('workspace') as Record<string, any> | undefined

  it('writes the layout to config 500ms after the last change (debounced)', () => {
    ws().toggleSidebar('left')
    vi.advanceTimersByTime(400)
    ws().setSidebarWidth('left', 400)
    vi.advanceTimersByTime(400)
    expect(saved()).toBeUndefined()
    vi.advanceTimersByTime(100)
    expect(saved()!.left).toMatchObject({ open: false, width: 400 })
    expect(Object.keys(saved()!).sort()).toEqual(['activeLeaf', 'bottom', 'left', 'right', 'root'])
  })

  it('does not persist before the workspace has been restored', () => {
    ws().reset()
    ws().toggleSidebar('left')
    vi.advanceTimersByTime(1000)
    expect(saved()).toBeUndefined()
  })

  it('updateTabState persists view state', () => {
    ws().openFile('a.md')
    ws().updateTabState(getActiveTab()!.id, { scroll: 42 })
    vi.advanceTimersByTime(500)
    expect(allLeaves(saved()!.root)[0].tabs[0].state).toEqual({ scroll: 42 })
  })

  it('restore round-trips the saved layout', async () => {
    ws().openFile('a.md')
    ws().openFile('b.md', { target: 'tab' })
    ws().openFile('c.ts', { target: 'split-down' })
    ws().setSidebarWidth('right', 420)
    ws().movePane('outline', 'left', 'new')
    ws().setBottomHeight(321)
    ws().addBottomTab('terminal')
    vi.advanceTimersByTime(500)
    const snapshot = structuredClone({ root: ws().root, activeLeaf: ws().activeLeaf, left: ws().left, right: ws().right })

    ws().reset()
    expect(getActiveFile()).toBeNull()
    await ws().restore()
    expect(ws().restored).toBe(true)
    expect(ws().root).toEqual(snapshot.root)
    expect(ws().activeLeaf).toBe(snapshot.activeLeaf)
    expect(ws().left).toEqual(snapshot.left)
    expect(ws().right).toEqual(snapshot.right)
    expect(getActiveFile()).toBe('c.ts')
  })

  it('restore keeps the bottom panel height but not its (dead) terminals', async () => {
    ws().setBottomHeight(321)
    ws().addBottomTab('terminal')
    vi.advanceTimersByTime(500)
    ws().reset()
    await ws().restore()
    expect(ws().bottom).toEqual({ open: false, height: 321, tabs: [], active: null })
  })

  it('restore falls back to the default layout when nothing was saved', async () => {
    ws().openFile('a.md')
    ws().reset()
    await ws().restore()
    expect(leaves()).toHaveLength(1)
    expect(getActiveTab()!.type).toBe('empty')
    expect(ws().left.groups[0].panes).toEqual(['files', 'search', 'bookmarks'])
  })

  it('restore adds panes that are missing from an old saved layout', async () => {
    ws().movePane('localgraph', 'left')
    vi.advanceTimersByTime(500)
    const data = saved()!
    data.left.groups[0].panes = data.left.groups[0].panes.filter((p: string) => p !== 'localgraph' && p !== 'search')
    memory().config.set('workspace', data)
    await ws().restore()
    const placed = [...ws().left.groups, ...ws().right.groups].flatMap((g) => g.panes)
    expect(placed.sort()).toEqual(['backlinks', 'bookmarks', 'files', 'localgraph', 'outgoing', 'outline', 'search', 'tags'])
    expect(ws().right.groups[0].panes.slice(-2)).toEqual(['search', 'localgraph'])
  })

  it('restore creates a right sidebar group for missing panes when it has none', async () => {
    memory().config.set('workspace', {
      root: { kind: 'leaf', id: 'L', tabs: [], active: null },
      activeLeaf: 'L',
      left: { open: true, width: 250, groups: [{ id: 'g', panes: ['files'], active: 'files', size: 1 }] },
      right: { open: true, width: 250, groups: [] },
      bottom: { open: true, height: 200, tabs: [], active: null }
    })
    await ws().restore()
    expect(ws().right.groups).toHaveLength(1)
    expect(ws().right.groups[0].panes).toHaveLength(7)
    expect(ws().right.groups[0].active).toBe('search')
  })

  it('restore normalizes the saved tree and repairs a dangling activeLeaf', async () => {
    const tab = { id: 't1', type: 'markdown', path: 'a.md', history: [{ type: 'markdown', path: 'a.md' }], historyIndex: 0, navId: 0 }
    memory().config.set('workspace', {
      root: {
        kind: 'split',
        id: 's1',
        dir: 'row',
        sizes: [1, 1],
        children: [
          { kind: 'leaf', id: 'L1', tabs: [tab], active: 't1' },
          { kind: 'leaf', id: 'L2', tabs: [], active: null }
        ]
      },
      activeLeaf: 'L-gone',
      left: ws().left,
      right: ws().right,
      bottom: ws().bottom
    })
    await ws().restore()
    expect(ws().root).toMatchObject({ kind: 'leaf', id: 'L1' })
    expect(ws().activeLeaf).toBe('L1')
    expect(getActiveFile()).toBe('a.md')
  })

  it.each([
    ['a string', 'garbage'],
    ['an array', []],
    ['a root without sidebars', { root: { kind: 'leaf', id: 'L', tabs: [], active: null }, activeLeaf: 'L' }],
    ['a malformed root', { root: { kind: 'split' }, activeLeaf: 'x', left: { groups: [] }, right: { groups: [] } }]
  ])('restore falls back to the default layout when the saved config is %s', async (_name, data) => {
    memory().config.set('workspace', data)
    await expect(ws().restore()).resolves.toBeUndefined()
    expect(ws().restored).toBe(true)
    expect(leaves().length).toBeGreaterThan(0)
    expect(findLeaf(ws().root, ws().activeLeaf)).not.toBeNull()
    expect(ws().left.groups.length + ws().right.groups.length).toBeGreaterThan(0)
  })
})
