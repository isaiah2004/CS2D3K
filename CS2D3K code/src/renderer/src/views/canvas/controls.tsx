// Floating canvas UI: zoom controls, creation toolbar, selection toolbar, file picker.
import { useCallback } from 'react'
import { createPortal } from 'react-dom'
import {
  ZoomIn,
  ZoomOut,
  Maximize,
  Scan,
  Undo2,
  Redo2,
  StickyNote,
  FileText,
  SquareCode,
  Globe,
  Group,
  Palette,
  Pencil,
  Trash2,
  Ban
} from 'lucide-react'
import SuggestModal, { Highlighted } from '@/components/SuggestModal'
import { allFiles } from '@/store/vault'
import { fuzzyMatch } from '@/lib/util'
import { extname, stem } from '@/lib/path'
import { FileIcon } from '@/components/FileIcon'
import type { MenuItem } from '@/store/ui'
import { COLOR_PRESETS, colorCss } from './model'

export function ZoomControls(p: {
  zoom: number
  onZoomIn: () => void
  onZoomOut: () => void
  onReset: () => void
  onFit: () => void
  onFitSelection: () => void
  hasSelection: boolean
  onUndo: () => void
  onRedo: () => void
  canUndo: boolean
  canRedo: boolean
}) {
  return (
    <div className="canvas-controls" data-canvas-ui>
      <div className="canvas-control-group">
        <button className="canvas-control-item" title="Zoom in" onClick={p.onZoomIn}>
          <ZoomIn />
        </button>
        <button className="canvas-control-item canvas-zoom-label" title="Reset zoom (100%)" onClick={p.onReset}>
          {Math.round(p.zoom * 100)}%
        </button>
        <button className="canvas-control-item" title="Zoom out" onClick={p.onZoomOut}>
          <ZoomOut />
        </button>
        <button className="canvas-control-item" title="Zoom to fit (Shift+1)" onClick={p.onFit}>
          <Maximize />
        </button>
        <button className="canvas-control-item" title="Zoom to selection (Shift+2)" disabled={!p.hasSelection} onClick={p.onFitSelection}>
          <Scan />
        </button>
      </div>
      <div className="canvas-control-group">
        <button className="canvas-control-item" title="Undo (Ctrl+Z)" disabled={!p.canUndo} onClick={p.onUndo}>
          <Undo2 />
        </button>
        <button className="canvas-control-item" title="Redo (Ctrl+Shift+Z)" disabled={!p.canRedo} onClick={p.onRedo}>
          <Redo2 />
        </button>
      </div>
    </div>
  )
}

export type CreateKind = 'text' | 'note' | 'code' | 'link' | 'group'

export const CREATE_ITEMS: { kind: CreateKind; label: string; icon: React.ReactNode }[] = [
  { kind: 'text', label: 'Add card', icon: <StickyNote /> },
  { kind: 'note', label: 'Add note from vault', icon: <FileText /> },
  { kind: 'code', label: 'Add code cell', icon: <SquareCode /> },
  { kind: 'link', label: 'Add web page', icon: <Globe /> },
  { kind: 'group', label: 'Add group', icon: <Group /> }
]

export function CreateToolbar({ onCreate }: { onCreate: (kind: CreateKind) => void }) {
  return (
    <div className="canvas-card-menu" data-canvas-ui>
      {CREATE_ITEMS.map((it) => (
        <button key={it.kind} className="canvas-card-menu-button" title={it.label} aria-label={it.label} onClick={() => onCreate(it.kind)}>
          {it.icon}
        </button>
      ))}
    </div>
  )
}

export function SelectionToolbar(p: {
  /** the engine moves the toolbar with the camera through this ref */
  elRef?: React.Ref<HTMLDivElement>
  x: number
  y: number
  canEdit: boolean
  onColor: (e: React.MouseEvent) => void
  onFit: () => void
  onEdit: () => void
  onDelete: () => void
}) {
  return (
    <div ref={p.elRef} className="canvas-selection-toolbar" data-canvas-ui style={{ left: p.x, top: p.y }}>
      <button className="canvas-control-item" title="Set color" onClick={p.onColor}>
        <Palette />
      </button>
      <button className="canvas-control-item" title="Zoom to selection" onClick={p.onFit}>
        <Scan />
      </button>
      {p.canEdit && (
        <button className="canvas-control-item" title="Edit" onClick={p.onEdit}>
          <Pencil />
        </button>
      )}
      <button className="canvas-control-item is-danger" title="Remove" onClick={p.onDelete}>
        <Trash2 />
      </button>
    </div>
  )
}

/** Menu items for picking a canvas color. `current` marks the active one. */
export function colorMenu(current: string | undefined, apply: (c: string | undefined) => void, custom?: () => void): MenuItem[] {
  const items: MenuItem[] = [
    { label: 'No color', icon: <Ban />, checked: !current, onClick: () => apply(undefined) },
    ...COLOR_PRESETS.map((p) => ({ label: p.name, icon: <Swatch color={p.css} />, checked: current === p.id, onClick: () => apply(p.id) }))
  ]
  if (custom) items.push({ separator: true }, { label: 'Custom…', icon: current?.startsWith('#') ? <Swatch color={colorCss(current)!} /> : <Palette />, checked: !!current?.startsWith('#'), onClick: custom })
  return items
}

function Swatch({ color }: { color: string }) {
  return <span className="canvas-swatch" style={{ background: color }} />
}

interface FileItem {
  path: string
  indices: number[]
}

export function FilePicker({ exclude, onPick, onClose }: { exclude: string; onPick: (path: string) => void; onClose: () => void }) {
  const getItems = useCallback(
    (q: string): FileItem[] => {
      const files = allFiles()
        .filter((f) => f.path !== exclude)
        .sort((a, b) => b.mtime - a.mtime)
      if (!q.trim()) return files.slice(0, 60).map((f) => ({ path: f.path, indices: [] }))
      return files
        .map((f) => {
          const m = fuzzyMatch(q, f.path)
          const mn = fuzzyMatch(q, stem(f.path))
          if (!m && !mn) return null
          const useName = !!mn && (!m || mn.score + 5 >= m.score)
          const offset = f.path.lastIndexOf('/') + 1
          return {
            path: f.path,
            indices: useName ? mn!.indices.map((i) => i + offset) : m!.indices,
            score: (useName ? mn!.score + 5 : m!.score) + (extname(f.path) === 'md' ? 2 : 0)
          }
        })
        .filter((x): x is FileItem & { score: number } => !!x)
        .sort((a, b) => b.score - a.score)
        .slice(0, 100)
    },
    [exclude]
  )
  return createPortal(
    <SuggestModal<FileItem>
      placeholder="Add a file from your vault…"
      getItems={getItems}
      onClose={onClose}
      onChoose={(it) => it && onPick(it.path)}
      emptyText="No matching files"
      instructions={[
        { keys: '↑↓', label: 'to navigate' },
        { keys: '↵', label: 'to add' },
        { keys: 'esc', label: 'to dismiss' }
      ]}
      render={(it) => (
        <>
          <FileIcon ext={extname(it.path)} size={15} className="canvas-picker-icon" />
          <div className="suggestion-main">
            <Highlighted text={it.path} indices={it.indices} />
          </div>
        </>
      )}
    />,
    document.body
  )
}
