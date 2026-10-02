// Bottom creation toolbar of the map: the 7 card kinds (click = add, drag = drop where you want), zone, pen, more.
import { useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { SquareDashed, PenLine, Plus } from 'lucide-react'
import { COLOR_PRESETS } from '../../canvas/model'
import { KINDS, KIND_ORDER, type FormKind } from '../schema'

export interface PenState {
  color?: string
}

interface Props {
  onCreate(kind: FormKind): void
  onDrop(kind: FormKind, clientX: number, clientY: number): void
  onZone(): void
  pen: PenState | null
  setPen(p: PenState | null): void
  onMore(e: React.MouseEvent): void
}

export default function MapToolbar({ onCreate, onDrop, onZone, pen, setPen, onMore }: Props) {
  const [ghost, setGhost] = useState<{ kind: FormKind; x: number; y: number } | null>(null)
  const drag = useRef<{ kind: FormKind; sx: number; sy: number; moved: boolean } | null>(null)

  const onPointerDown = (kind: FormKind, e: React.PointerEvent): void => {
    if (e.button !== 0) return
    drag.current = { kind, sx: e.clientX, sy: e.clientY, moved: false }
    const move = (ev: PointerEvent): void => {
      const d = drag.current
      if (!d) return
      if (!d.moved && Math.hypot(ev.clientX - d.sx, ev.clientY - d.sy) < 6) return
      d.moved = true
      setGhost({ kind: d.kind, x: ev.clientX, y: ev.clientY })
    }
    const up = (ev: PointerEvent): void => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      const d = drag.current
      drag.current = null
      setGhost(null)
      if (!d) return
      if (d.moved) onDrop(d.kind, ev.clientX, ev.clientY)
      else onCreate(d.kind)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  return (
    <>
      <div className="fm-toolbar" data-canvas-ui>
        {KIND_ORDER.map((k) => (
          <button
            key={k}
            className="fm-tool"
            aria-label={`Add ${KINDS[k].label.toLowerCase()}`}
            title={`${KINDS[k].label} — ${KINDS[k].hint}\nClick to add, drag to place`}
            style={{ '--fm-kind': KINDS[k].color } as React.CSSProperties}
            onPointerDown={(e) => onPointerDown(k, e)}
          >
            <span className="fm-tool-emoji">{KINDS[k].emoji}</span>
            <span className="fm-tool-label">{KINDS[k].label}</span>
          </button>
        ))}
        <span className="fm-tool-sep" />
        <button className="fm-tool fm-tool-icon" aria-label="Add zone" title="Add zone — a region that gives meaning to the cards inside" onClick={onZone}>
          <SquareDashed size={17} />
        </button>
        <button
          className={`fm-tool fm-tool-icon${pen ? ' is-active' : ''}`}
          aria-label="Pen"
          title="Pen — doodle and annotate (P, Esc to stop)"
          onClick={() => setPen(pen ? null : { color: undefined })}
        >
          <PenLine size={17} />
        </button>
        {pen && (
          <span className="fm-pen-colors">
            <button className={`fm-pen-swatch${!pen.color ? ' is-active' : ''}`} style={{ background: 'var(--text-normal)' }} title="Default" onClick={() => setPen({ color: undefined })} />
            {COLOR_PRESETS.map((c) => (
              <button
                key={c.id}
                className={`fm-pen-swatch${pen.color === c.id ? ' is-active' : ''}`}
                style={{ background: c.css }}
                title={c.name}
                onClick={() => setPen({ color: c.id })}
              />
            ))}
          </span>
        )}
        <span className="fm-tool-sep" />
        <button className="fm-tool fm-tool-icon" aria-label="More" title="Text card, note from vault, code cell, web page, group" onClick={onMore}>
          <Plus size={17} />
        </button>
      </div>
      {ghost &&
        createPortal(
          <div className="fm-ghost" style={{ left: ghost.x, top: ghost.y, '--fm-kind': KINDS[ghost.kind].color } as React.CSSProperties}>
            {KINDS[ghost.kind].emoji} {KINDS[ghost.kind].label}
          </div>,
          document.body
        )}
    </>
  )
}
