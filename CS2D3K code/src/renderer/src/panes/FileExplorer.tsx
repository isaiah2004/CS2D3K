import { memo, useEffect, useMemo, useRef, useState } from 'react'
import {
  Map as MapIcon, ChevronDown, Folder, FolderOpen, FilePlus2, FolderPlus, ArrowDownUp, ChevronsDownUp, ChevronsUpDown, LayoutDashboard,
  Pencil, Trash2, Copy, FolderInput, SquareTerminal, FileCode2, Crosshair, ExternalLink, Bookmark, SplitSquareHorizontal, Files
} from 'lucide-react'
import type { FileEntry } from '@shared/types'
import { useVault, childrenMap } from '@/store/vault'
import { useWorkspace, useActiveFile } from '@/store/workspace'
import { useSettings, type Settings } from '@/store/settings'
import { useUi, showContextMenu, promptText, notice, type MenuItem } from '@/store/ui'
import { useBookmarks } from '@/store/bookmarks'
import { FILE_MIME } from '@/components/Layout'
import { createFormMap, createNote, createCanvas, createFolder, createFile, deletePath, deletePaths, renamePath, moveToFolder, duplicatePath } from '@/lib/fileops'
import { dirname, join, stem, extname, validateName, basename } from '@/lib/path'
import { on, takeUnhandled } from '@/lib/events'
import { nextTerminalCwd } from '@/lib/terminalCwd'
import { executeCommand } from '@/store/commands'

const EXPANDED_KEY = 'explorer-expanded'

function sortEntries(list: FileEntry[], order: Settings['fileSortOrder']): FileEntry[] {
  const dirs = list.filter((f) => f.isDir)
  const files = list.filter((f) => !f.isDir)
  const cmpName = (a: FileEntry, b: FileEntry): number => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })
  const cmp: Record<Settings['fileSortOrder'], (a: FileEntry, b: FileEntry) => number> = {
    'name-asc': cmpName,
    'name-desc': (a, b) => -cmpName(a, b),
    'mtime-desc': (a, b) => b.mtime - a.mtime,
    'mtime-asc': (a, b) => a.mtime - b.mtime,
    'ctime-desc': (a, b) => b.ctime - a.ctime,
    'ctime-asc': (a, b) => a.ctime - b.ctime
  }
  dirs.sort(order.startsWith('name') ? cmp[order] : cmpName)
  files.sort(cmp[order])
  return [...dirs, ...files]
}

/** Display name: hide .md extension like Obsidian */
function displayName(f: FileEntry): string {
  if (f.isDir) return f.name
  if (f.ext === 'md' || f.ext === 'canvas' || f.ext === 'formmap') return stem(f.name)
  return f.name
}

interface RowProps {
  entry: FileEntry
  depth: number
  expanded: Set<string>
  toggle: (p: string, open?: boolean) => void
  selected: Set<string>
  onSelect: (p: string, e: React.MouseEvent) => void
}

const Row = memo(function Row({ entry, depth, expanded, toggle, selected, onSelect }: RowProps) {
  const active = useActiveFile()
  const renaming = useUi((s) => s.renaming)
  const order = useSettings((s) => s.settings.fileSortOrder)
  const showAll = useSettings((s) => s.settings.showAllFileTypes)
  useVault((s) => s.version)
  const [dropping, setDropping] = useState(false)
  const isOpen = entry.isDir && expanded.has(entry.path)
  const children = useMemo(
    () => (isOpen ? sortEntries((childrenMap().get(entry.path) ?? []).filter((c) => showAll || c.isDir || ['md', 'canvas', 'formmap'].includes(c.ext)), order) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [isOpen, entry.path, order, showAll, useVault.getState().version]
  )
  const pad = 8 + depth * 16

  const open = (e: React.MouseEvent): void => {
    if (entry.isDir) {
      toggle(entry.path)
      return
    }
    const ws = useWorkspace.getState()
    if (e.ctrlKey || e.metaKey) ws.openFile(entry.path, { target: e.altKey ? 'split-right' : 'tab' })
    else ws.openFile(entry.path)
  }

  const onDrop = async (e: React.DragEvent): Promise<void> => {
    setDropping(false)
    const data = e.dataTransfer.getData(FILE_MIME)
    if (!data) return
    e.preventDefault()
    e.stopPropagation()
    const folder = entry.isDir ? entry.path : dirname(entry.path)
    const paths = data.split('\n').filter(Boolean)
    for (const p of paths) await moveToFolder(p, folder)
    if (entry.isDir) toggle(entry.path, true)
  }

  return (
    <>
      <div
        className={`tree-item${!entry.isDir && active === entry.path ? ' is-active' : ''}${selected.has(entry.path) ? ' is-selected' : ''}${dropping ? ' drop-target' : ''}`}
        style={{ paddingLeft: pad }}
        data-path={entry.path}
        draggable={renaming !== entry.path}
        onClick={(e) => {
          if (e.shiftKey || ((e.ctrlKey || e.metaKey) && entry.isDir)) {
            onSelect(entry.path, e)
            return
          }
          onSelect(entry.path, e)
          open(e)
        }}
        onAuxClick={(e) => {
          if (e.button === 1 && !entry.isDir) useWorkspace.getState().openFile(entry.path, { target: 'tab' })
        }}
        onContextMenu={(e) => showContextMenu(e, entryMenu(entry, selected))}
        onDragStart={(e) => {
          const paths = selected.has(entry.path) ? [...selected] : [entry.path]
          e.dataTransfer.setData(FILE_MIME, paths.join('\n'))
          e.dataTransfer.setData('text/plain', paths.map((p) => (extname(p) === 'md' ? `[[${stem(p)}]]` : `[[${basename(p)}]]`)).join('\n'))
          e.dataTransfer.effectAllowed = 'copyMove'
        }}
        onDragOver={(e) => {
          if (e.dataTransfer.types.includes(FILE_MIME)) {
            e.preventDefault()
            e.stopPropagation()
            if (entry.isDir) setDropping(true)
          }
        }}
        onDragLeave={() => setDropping(false)}
        onDrop={(e) => void onDrop(e)}
      >
        {entry.isDir ? (
          <span className={`chevron${isOpen ? '' : ' collapsed'}`}>
            <ChevronDown />
          </span>
        ) : (
          <span className="chevron" />
        )}
        {renaming === entry.path ? (
          <RenameInput entry={entry} />
        ) : (
          <>
            <span className="item-name">{displayName(entry)}</span>
            {!entry.isDir && entry.ext && entry.ext !== 'md' && <span className="item-tag">{entry.ext}</span>}
          </>
        )}
      </div>
      {isOpen && children.length > 0 && (
        <div className="tree-children" style={{ ['--guide-left' as string]: `${pad + 7}px` }}>
          {children.map((c) => (
            <Row key={c.path} entry={c} depth={depth + 1} expanded={expanded} toggle={toggle} selected={selected} onSelect={onSelect} />
          ))}
        </div>
      )}
    </>
  )
})

function RenameInput({ entry }: { entry: FileEntry }) {
  const isNote = entry.ext === 'md' || entry.ext === 'canvas' || entry.ext === 'formmap'
  const initial = isNote ? stem(entry.name) : entry.name
  const [value, setValue] = useState(initial)
  const ref = useRef<HTMLInputElement>(null)
  const done = useRef(false)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.focus()
    const dot = !entry.isDir && !isNote ? initial.lastIndexOf('.') : -1
    el.setSelectionRange(0, dot > 0 ? dot : initial.length)
  }, [entry, initial, isNote])
  const commit = async (): Promise<void> => {
    if (done.current) return
    done.current = true
    useUi.getState().setRenaming(null)
    const v = value.trim()
    if (!v || v === initial) return
    const err = validateName(v)
    if (err) {
      notice(err, 'error')
      return
    }
    const newName = isNote ? `${v}.${entry.ext}` : v
    await renamePath(entry.path, join(dirname(entry.path), newName))
  }
  return (
    <input
      ref={ref}
      className="rename-input"
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onClick={(e) => e.stopPropagation()}
      onBlur={() => void commit()}
      onKeyDown={(e) => {
        e.stopPropagation()
        if (e.key === 'Enter') void commit()
        if (e.key === 'Escape') {
          done.current = true
          useUi.getState().setRenaming(null)
        }
      }}
    />
  )
}

function entryMenu(entry: FileEntry, selected: Set<string>): MenuItem[] {
  const ws = useWorkspace.getState()
  const folder = entry.isDir ? entry.path : dirname(entry.path)
  const multi = selected.size > 1 && selected.has(entry.path)
  if (multi) {
    return [
      {
        label: `Delete ${selected.size} items`,
        icon: <Trash2 />,
        danger: true,
        onClick: () => void deletePaths([...selected])
      },
      {
        label: `Move ${selected.size} items to...`,
        icon: <FolderInput />,
        onClick: async () => {
          const dest = await promptText({ title: 'Move to folder', message: 'Folder path (empty for vault root)', initial: folder })
          if (dest === null) return
          for (const p of [...selected]) await moveToFolder(p, dest.trim().replace(/^\/|\/$/g, ''))
        }
      }
    ]
  }
  const items: MenuItem[] = []
  if (!entry.isDir) {
    items.push(
      { label: 'Open in new tab', icon: <Files />, onClick: () => ws.openFile(entry.path, { target: 'tab' }) },
      { label: 'Open to the right', icon: <SplitSquareHorizontal />, onClick: () => ws.openFile(entry.path, { target: 'split-right' }) },
      { separator: true }
    )
  }
  items.push(
    { label: 'New note', icon: <FilePlus2 />, onClick: () => void createNote(folder) },
    { label: 'New folder', icon: <FolderPlus />, onClick: () => void newFolder(folder) },
    { label: 'New canvas', icon: <LayoutDashboard />, onClick: () => void createCanvas(folder) },
    { label: 'New form-map', icon: <MapIcon />, onClick: () => void createFormMap(folder) },
    {
      label: 'New file...',
      icon: <FileCode2 />,
      onClick: async () => {
        const name = await promptText({ title: 'New file', message: 'File name with extension', placeholder: 'main.py', validate: validateName })
        if (name) await createFile(folder, name)
      }
    },
    { separator: true },
    {
      label: 'Duplicate',
      icon: <Copy />,
      disabled: entry.isDir,
      onClick: async () => {
        await duplicatePath(entry.path)
      }
    },
    {
      label: 'Move to...',
      icon: <FolderInput />,
      onClick: async () => {
        const dest = await promptText({ title: 'Move to folder', message: 'Folder path (empty for vault root)', initial: dirname(entry.path) })
        if (dest !== null) await moveToFolder(entry.path, dest.trim().replace(/^\/|\/$/g, ''))
      }
    },
    { label: useBookmarks.getState().isBookmarked(entry.path) ? 'Remove bookmark' : 'Bookmark', icon: <Bookmark />, onClick: () => useBookmarks.getState().toggleFile(entry.path) },
    { separator: true },
    { label: 'Copy path', icon: <Copy />, onClick: () => void navigator.clipboard.writeText(entry.path) },
    { label: 'Show in system explorer', icon: <FolderOpen />, onClick: () => void window.api.fs.showInFolder(entry.path) },
    { label: 'Open in default app', icon: <ExternalLink />, onClick: () => void window.api.fs.openWithDefaultApp(entry.path) },
    {
      label: 'Open terminal here',
      icon: <SquareTerminal />,
      onClick: async () => {
        const abs = await window.api.fs.absPath(folder)
        nextTerminalCwd.set(abs)
        useWorkspace.getState().addBottomTab('terminal')
      }
    },
    { separator: true },
    { label: 'Rename...', icon: <Pencil />, onClick: () => useUi.getState().setRenaming(entry.path) },
    { label: 'Delete', icon: <Trash2 />, danger: true, onClick: () => void deletePath(entry.path) }
  )
  return items
}

async function newFolder(parent: string): Promise<void> {
  const p = await createFolder(parent)
  useUi.getState().setRenaming(p)
}

export default function FileExplorer() {
  useVault((s) => s.version)
  const order = useSettings((s) => s.settings.fileSortOrder)
  const showAll = useSettings((s) => s.settings.showAllFileTypes)
  const vaultName = useVault((s) => s.info?.name ?? '')
  const [expanded, setExpanded] = useState<Set<string>>(() => {
    try {
      return new Set(JSON.parse(localStorage.getItem(`${EXPANDED_KEY}:${useVault.getState().info?.path}`) ?? '[]'))
    } catch {
      return new Set()
    }
  })
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [rootDrop, setRootDrop] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const lastClicked = useRef<string | null>(null)

  useEffect(() => {
    localStorage.setItem(`${EXPANDED_KEY}:${useVault.getState().info?.path}`, JSON.stringify([...expanded]))
  }, [expanded])

  const toggle = (p: string, open?: boolean): void => {
    setExpanded((s) => {
      const n = new Set(s)
      const want = open ?? !n.has(p)
      if (want) n.add(p)
      else n.delete(p)
      return n
    })
  }

  const rootChildren = sortEntries(
    (childrenMap().get('') ?? []).filter((c) => showAll || c.isDir || ['md', 'canvas', 'formmap'].includes(c.ext)),
    order
  )

  // flat visible list for shift-select
  const visibleList = (): string[] => {
    return [...(scrollRef.current?.querySelectorAll<HTMLElement>('[data-path]') ?? [])].map((el) => el.dataset.path!)
  }

  const onSelect = (p: string, e: React.MouseEvent): void => {
    if (e.shiftKey && lastClicked.current) {
      const list = visibleList()
      const a = list.indexOf(lastClicked.current)
      const b = list.indexOf(p)
      if (a >= 0 && b >= 0) {
        const [from, to] = a < b ? [a, b] : [b, a]
        setSelected(new Set(list.slice(from, to + 1)))
        return
      }
    }
    if (e.ctrlKey || e.metaKey) {
      setSelected((s) => {
        const n = new Set(s)
        if (n.has(p)) n.delete(p)
        else n.add(p)
        return n
      })
    } else setSelected(new Set())
    lastClicked.current = p
  }

  // reveal file: expand parents and scroll into view
  useEffect(() => {
    const reveal = (path: string): void => {
      setExpanded((s) => {
        const n = new Set(s)
        let d = dirname(path)
        while (d) {
          n.add(d)
          d = dirname(d)
        }
        return n
      })
      setTimeout(() => {
        const el = scrollRef.current?.querySelector<HTMLElement>(`[data-path="${CSS.escape(path)}"]`)
        el?.scrollIntoView({ block: 'center' })
        if (el) {
          el.classList.add('is-selected')
          setTimeout(() => el.classList.remove('is-selected'), 1200)
        }
      }, 50)
    }
    const pendingReveal = takeUnhandled('reveal-file')
    if (pendingReveal) reveal(pendingReveal.path)
    const pendingRename = takeUnhandled('rename-file')
    if (pendingRename) {
      reveal(pendingRename.path)
      useUi.getState().setRenaming(pendingRename.path)
    }
    const offs = [
      on('reveal-file', ({ path }) => reveal(path)),
      on('rename-file', ({ path }) => {
        reveal(path)
        useUi.getState().setRenaming(path)
      })
    ]
    return () => offs.forEach((f) => f())
  }, [])

  // keyboard: Delete / F2 on selection
  const onKeyDown = (e: React.KeyboardEvent): void => {
    if (useUi.getState().renaming) return
    const target = [...selected][0]
    if (e.key === 'Delete' && selected.size) {
      e.preventDefault()
      void (async () => {
        await deletePaths([...selected])
        setSelected(new Set())
      })()
    } else if (e.key === 'F2' && target) {
      e.preventDefault()
      e.stopPropagation()
      useUi.getState().setRenaming(target)
    } else if (e.key === 'Escape') setSelected(new Set())
  }

  const sortMenu = (e: React.MouseEvent): void => {
    const set = (v: Settings['fileSortOrder']) => () => useSettings.getState().set('fileSortOrder', v)
    showContextMenu(e, [
      { label: 'File name (A to Z)', checked: order === 'name-asc', onClick: set('name-asc') },
      { label: 'File name (Z to A)', checked: order === 'name-desc', onClick: set('name-desc') },
      { separator: true },
      { label: 'Modified time (new to old)', checked: order === 'mtime-desc', onClick: set('mtime-desc') },
      { label: 'Modified time (old to new)', checked: order === 'mtime-asc', onClick: set('mtime-asc') },
      { separator: true },
      { label: 'Created time (new to old)', checked: order === 'ctime-desc', onClick: set('ctime-desc') },
      { label: 'Created time (old to new)', checked: order === 'ctime-asc', onClick: set('ctime-asc') },
      { separator: true },
      { label: 'Show all file types', checked: showAll, onClick: () => useSettings.getState().set('showAllFileTypes', !showAll) }
    ])
  }

  const allCollapsed = expanded.size === 0

  return (
    <>
      <div className="pane-header">
        <button className="clickable-icon small" title="New note" onClick={() => void createNote()}>
          <FilePlus2 />
        </button>
        <button className="clickable-icon small" title="New folder" onClick={() => void newFolder('')}>
          <FolderPlus />
        </button>
        <button className="clickable-icon small" title="New canvas" onClick={() => void createCanvas()}>
          <LayoutDashboard />
        </button>
        <button className="clickable-icon small" title="Change sort order" onClick={sortMenu}>
          <ArrowDownUp />
        </button>
        <button
          className="clickable-icon small"
          title={allCollapsed ? 'Expand all' : 'Collapse all'}
          onClick={() => {
            if (allCollapsed) setExpanded(new Set(Object.values(useVault.getState().files).filter((f) => f.isDir).map((f) => f.path)))
            else setExpanded(new Set())
          }}
        >
          {allCollapsed ? <ChevronsUpDown /> : <ChevronsDownUp />}
        </button>
        <button
          className="clickable-icon small"
          title="Reveal active file"
          onClick={() => executeCommand('file-explorer:reveal-active-file')}
        >
          <Crosshair />
        </button>
      </div>
      <div
        className="pane-body"
        ref={scrollRef}
        tabIndex={0}
        style={{ outline: 'none', background: rootDrop ? 'var(--background-modifier-active-hover)' : undefined }}
        onKeyDown={onKeyDown}
        onContextMenu={(e) => {
          if (e.target === e.currentTarget)
            showContextMenu(e, [
              { label: 'New note', icon: <FilePlus2 />, onClick: () => void createNote('') },
              { label: 'New folder', icon: <FolderPlus />, onClick: () => void newFolder('') },
              { label: 'New canvas', icon: <LayoutDashboard />, onClick: () => void createCanvas('') },
              { label: 'New form-map', icon: <MapIcon />, onClick: () => void createFormMap('') },
              {
                label: 'New file...',
                icon: <FileCode2 />,
                onClick: async () => {
                  const name = await promptText({ title: 'New file', message: 'File name with extension', placeholder: 'main.py', validate: validateName })
                  if (name) await createFile('', name)
                }
              }
            ])
        }}
        onDragOver={(e) => {
          if (e.dataTransfer.types.includes(FILE_MIME) && e.target === e.currentTarget) {
            e.preventDefault()
            setRootDrop(true)
          }
        }}
        onDragLeave={() => setRootDrop(false)}
        onDrop={async (e) => {
          setRootDrop(false)
          const data = e.dataTransfer.getData(FILE_MIME)
          if (!data || e.target !== e.currentTarget) return
          e.preventDefault()
          for (const p of data.split('\n').filter(Boolean)) await moveToFolder(p, '')
        }}
        onMouseDown={(e) => {
          if (e.target === e.currentTarget) setSelected(new Set())
        }}
      >
        <div className="tree-item" style={{ paddingLeft: 8, fontWeight: 600, color: 'var(--text-normal)', cursor: 'default' }}>
          <Folder size={14} className="item-icon" />
          <span className="item-name">{vaultName}</span>
        </div>
        {rootChildren.map((c) => (
          <Row key={c.path} entry={c} depth={0} expanded={expanded} toggle={toggle} selected={selected} onSelect={onSelect} />
        ))}
        {rootChildren.length === 0 && <div className="empty-state">This vault is empty. Create a note to get started.</div>}
      </div>
    </>
  )
}
