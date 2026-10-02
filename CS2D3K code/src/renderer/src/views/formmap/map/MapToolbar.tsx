// Bottom creation toolbar of the map: a plain card, the map's card presets (click = add, drag = drop where you want),
// group, kanban, pen and more.
import { useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { SquareDashed, PenLine, Plus, StickyNote, KanbanSquare } from 'lucide-react'
import { COLOR_PRESETS } from '../../canvas/model'
import { fmColor, tagColor, type FormMapMeta, type Preset } from '../schema'

export interface PenState {
  color?: string
}

interface Props {
  meta: FormMapMeta
  /** preset id, or null for a plain card */
  onCreate(preset: string | null): void
  onDrop(preset: string | null, clientX: number, clientY: number): void
  onGroup(): void
  onKanban(): void
  pen: PenState | null
  setPen(p: PenState | null): void
  onMore(e: React.MouseEvent): void
}

const presetColor = (p: Preset, meta: FormMapMeta): string | undefined => fmColor(p.color) ?? (p.tags?.length ? tagColor(meta, p.tags[0]) : undefined)

export default function MapToolbar({ meta, onCreate, onDrop, onGroup, onKanban, pen, setPen, onMore }: Props) {
  const presets = meta.presets ?? []
  const [ghost, setGhost] = useState<{ preset: Preset | null; x: number; y: number } | null>(null)
  const drag = useRef<{ preset: Preset | null; sx: number; sy: number; moved: boolean } | null>(null)

  const onPointerDown = (preset: Preset | null, e: React.PointerEvent): void => {
    if (e.button !== 0) return
    drag.current = { preset, sx: e.clientX, sy: e.clientY, moved: false }
    const move = (ev: PointerEvent): void => {
      const d = drag.current
      if (!d) return
      if (!d.moved && Math.hypot(ev.clientX - d.sx, ev.clientY - d.sy) < 6) return
      d.moved = true
      setGhost({ preset: d.preset, x: ev.clientX, y: ev.clientY })
    }
    const up = (ev: PointerEvent): void => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      const d = drag.current
      drag.current = null
      setGhost(null)
      if (!d) return
      if (d.moved) onDrop(d.preset?.id ?? null, ev.clientX, ev.clientY)
      else onCreate(d.preset?.id ?? null)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  const tool = (p: Preset | null): React.ReactNode => (
    <button
      key={p?.id ?? '@card'}
      className="fm-tool"
      aria-label={`Add ${p ? p.name.toLowerCase() : 'card'}`}
      title={`${p ? p.name : 'Card'}${p?.hint ? ` — ${p.hint}` : ' — a plain card'}\nClick to add, drag to place`}
      style={p && presetColor(p, meta) ? ({ '--fm-accent': presetColor(p, meta) } as React.CSSProperties) : undefined}
      onPointerDown={(e) => onPointerDown(p, e)}
    >
      {p?.emoji ? <span className="fm-tool-emoji">{p.emoji}</span> : <StickyNote size={17} />}
      <span className="fm-tool-label">{p ? p.name : 'Card'}</span>
    </button>
  )

  return (
    <>
      <div className="fm-toolbar" data-canvas-ui>
        {tool(null)}
        {presets.length > 0 && <span className="fm-tool-sep" />}
        {presets.map((p) => tool(p))}
        <span className="fm-tool-sep" />
        <button className="fm-tool fm-tool-icon" aria-label="Add group" title="Group — a region that gives meaning to the cards inside" onClick={onGroup}>
          <SquareDashed size={17} />
        </button>
        <button className="fm-tool fm-tool-icon" aria-label="Add kanban" title="Kanban — a self-contained board on the canvas" onClick={onKanban}>
          <KanbanSquare size={17} />
        </button>
        <button className={`fm-tool fm-tool-icon${pen ? ' is-active' : ''}`} aria-label="Pen" title="Pen — doodle and annotate (P, Esc to stop)" onClick={() => setPen(pen ? null : { color: undefined })}>
          <PenLine size={17} />
        </button>
        {pen && (
          <span className="fm-pen-colors">
            <button className={`fm-pen-swatch${!pen.color ? ' is-active' : ''}`} style={{ background: 'var(--text-normal)' }} title="Default" onClick={() => setPen({ color: undefined })} />
            {COLOR_PRESETS.map((c) => (
              <button key={c.id} className={`fm-pen-swatch${pen.color === c.id ? ' is-active' : ''}`} style={{ background: c.css }} title={c.name} onClick={() => setPen({ color: c.id })} />
            ))}
          </span>
        )}
        <span className="fm-tool-sep" />
        <button className="fm-tool fm-tool-icon" aria-label="More" title="Text card, note from vault, code cell, web page" onClick={onMore}>
          <Plus size={17} />
        </button>
      </div>
      {ghost &&
        createPortal(
          <div className="fm-ghost" style={{ left: ghost.x, top: ghost.y, ...(ghost.preset && presetColor(ghost.preset, meta) ? { '--fm-accent': presetColor(ghost.preset, meta) } : {}) } as React.CSSProperties}>
            {ghost.preset ? `${ghost.preset.emoji ?? ''} ${ghost.preset.name}` : 'Card'}
          </div>,
          document.body
        )}
    </>
  )
}
