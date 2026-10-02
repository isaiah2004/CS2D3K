// Map node bodies: form cards, zones and freehand drawings (plugged into the canvas engine as node types).
import { memo, useCallback, useEffect, useRef, useState } from 'react'
import { Lock, LockOpen, Check, Star } from 'lucide-react'
import MarkdownPreview from '@/lib/markdown/MarkdownPreview'
import CmEditor from '../../canvas/CmEditor'
import type { NodeBodyProps, NodeTypeDef } from '../../canvas/engine'
import { colorCss } from '../../canvas/model'
import { KINDS, cardTitle, optionOf, type DrawingNode, type FieldDef, type FormNode, type ZoneNode } from '../schema'
import { useMap, useMapActions } from './mapContext'
import { smoothPath } from './logic'

// ---------------------------------------------------------------- form card

/** 'win' = done/decided/accepted/merged, 'muted' = cut/parked/superseded/dropped */
export function cardState(n: FormNode): 'win' | 'muted' | null {
  const s = n.fields?.status
  switch (n.kind) {
    case 'feature':
      return s === 'done' ? 'win' : s === 'cut' ? 'muted' : null
    case 'question':
      return s === 'decided' ? 'win' : s === 'parked' ? 'muted' : null
    case 'approach':
      return s === 'accepted' ? 'win' : s === 'superseded' ? 'muted' : null
    case 'idea':
      return s === 'merged' ? 'win' : s === 'dropped' ? 'muted' : null
    default:
      return null
  }
}

const FormCardBody = memo(function FormCardBody({ node, selected, editing, api, lod }: NodeBodyProps) {
  const n = node as FormNode
  const def = KINDS[n.kind] ?? KINDS.note
  const actions = useMapActions()
  const state = cardState(n)
  const votes = n.votes ?? 0
  return (
    <div className={`fm-card fm-kind-${def.kind}${state ? ` is-${state}` : ''}`} style={{ '--fm-kind': def.color } as React.CSSProperties}>
      <div className="fm-card-head">
        <span className="fm-kind-chip" title={def.hint}>
          <span className="fm-kind-emoji">{def.emoji}</span>
          {def.label}
        </span>
        {state === 'win' && (
          <span className="fm-win-badge" title="Decided">
            <Check size={11} strokeWidth={3} />
          </span>
        )}
        <span className="fm-spacer" />
        {(votes > 0 || selected) && (
          <button
            className={`fm-votes${votes ? '' : ' is-zero'}`}
            data-interactive
            title="Dot votes — click to add, right-click card for more"
            onClick={(e) => actions.vote(n.id, 1, e)}
          >
            <span className="fm-votes-dot" />
            {votes || '+'}
          </button>
        )}
      </div>
      {editing ? <CardEditor n={n} api={api} /> : <CardFace n={n} canvasPath={api.canvasPath} lod={!!lod} />}
      {!lod && <FieldChips n={n} selected={selected} />}
    </div>
  )
})

/** title + markdown body; zoomed out (lod) just the title — no markdown rendering */
function CardFace({ n, canvasPath, lod }: { n: FormNode; canvasPath: string; lod: boolean }) {
  const title = cardTitle(n)
  const untitled = !n.title?.trim() && !(n.text ?? '').trim()
  // the first text line doubles as the title when there is none — don't repeat it
  const body = n.title?.trim() ? (n.text ?? '').trim() : (n.text ?? '').split('\n').slice(1).join('\n').trim()
  return (
    <>
      <div className={`fm-card-title${untitled ? ' is-untitled' : ''}`}>{untitled ? 'Double-click to write…' : title}</div>
      {body && !lod && (
        <div className="fm-card-body">
          <MarkdownPreview source={body} sourcePath={canvasPath} className="fm-card-md" />
        </div>
      )}
    </>
  )
}

function CardEditor({ n, api }: { n: FormNode; api: NodeBodyProps['api'] }) {
  const actions = useMapActions()
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const heightRef = useRef(n.height)
  heightRef.current = n.height
  useEffect(() => {
    const el = inputRef.current
    if (!el) return
    el.focus()
    el.setSelectionRange(el.value.length, el.value.length)
  }, [])
  const finish = (): void => {
    api.setEditing(null)
    api.focusCanvas()
  }
  const grow = useCallback((px: number) => api.updateNode(n.id, { height: Math.ceil(heightRef.current + px) }, `text:${n.id}`), [api, n.id])
  // auto-size the title textarea
  useEffect(() => {
    const el = inputRef.current
    if (!el) return
    el.style.height = '0px'
    el.style.height = `${el.scrollHeight}px`
  }, [n.title])
  return (
    <div className="fm-card-editor" data-interactive>
      <textarea
        ref={inputRef}
        className="fm-title-input"
        rows={1}
        value={n.title ?? ''}
        placeholder={`${KINDS[n.kind].label} title`}
        onChange={(e) => api.updateNode(n.id, { title: e.target.value.replace(/\n/g, ' ') }, `title:${n.id}`)}
        onKeyDown={(e) => {
          e.stopPropagation()
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault()
            finish()
          } else if (e.key === 'Tab' && !e.shiftKey) {
            e.preventDefault()
            finish()
            actions.mindmap('child', n.id)
          } else if (e.key === 'Escape') {
            e.preventDefault()
            finish()
          }
        }}
      />
      <div className="fm-body-editor">
        <CmEditor
          value={n.text ?? ''}
          onChange={(v) => api.updateNode(n.id, { text: v }, `text:${n.id}`)}
          lang="markdown"
          mode="text"
          placeholder="Details (markdown)…"
          onOverflow={grow}
          onEscape={finish}
        />
      </div>
    </div>
  )
}

function FieldChips({ n, selected }: { n: FormNode; selected: boolean }) {
  const def = KINDS[n.kind] ?? KINDS.note
  const fields = def.fields.filter((f) => f.onCard)
  if (!fields.length) return null
  const chips: React.ReactNode[] = []
  const lines: React.ReactNode[] = []
  for (const f of fields) {
    const v = n.fields?.[f.key]
    if (f.type === 'select') {
      const opt = optionOf(f, v)
      if (opt || selected) chips.push(<SelectChip key={f.key} n={n} f={f} label={opt?.label} color={opt?.color} />)
    } else if (f.type === 'rating') {
      const val = typeof v === 'number' ? v : 0
      if (val || selected) chips.push(<Stars key={f.key} n={n} f={f} value={val} />)
    } else if ((f.type === 'text' || f.type === 'longtext') && typeof v === 'string' && v.trim()) {
      lines.push(
        <div key={f.key} className="fm-card-line" title={`${f.label}: ${v}`}>
          <span className="fm-card-line-label">{f.label}</span> {v}
        </div>
      )
    }
  }
  if (!chips.length && !lines.length) return null
  return (
    <div className="fm-fields">
      {lines}
      {chips.length > 0 && <div className="fm-chips">{chips}</div>}
    </div>
  )
}

function SelectChip({ n, f, label, color }: { n: FormNode; f: FieldDef; label?: string; color?: string }) {
  const actions = useMapActions()
  return (
    <button
      className={`fm-chip${label ? '' : ' is-empty'}`}
      data-interactive
      title={`${f.label}${label ? `: ${label}` : ''} — click to change`}
      style={color ? ({ '--chip': color } as React.CSSProperties) : undefined}
      onClick={(e) => actions.fieldMenu(n.id, f.key, e)}
    >
      {label ? (
        color ? (
          <>
            <span className="fm-chip-dot" />
            {label}
          </>
        ) : (
          <>
            <span className="fm-chip-key">{f.label}</span>
            {label}
          </>
        )
      ) : (
        `+ ${f.label}`
      )}
    </button>
  )
}

function Stars({ n, f, value }: { n: FormNode; f: FieldDef; value: number }) {
  const actions = useMapActions()
  const [hover, setHover] = useState(0)
  const max = f.max ?? 5
  const shown = hover || value
  return (
    <span className="fm-stars" title={`${f.label}: ${value}/${max}`} data-interactive onMouseLeave={() => setHover(0)}>
      <span className="fm-stars-label">{f.label === 'Fun factor' ? 'Fun' : f.label}</span>
      {Array.from({ length: max }, (_, i) => (
        <button
          key={i}
          className={`fm-star${i < shown ? ' is-on' : ''}`}
          onMouseEnter={() => setHover(i + 1)}
          onClick={(e) => actions.setField(n.id, f.key, value === i + 1 ? 0 : i + 1, e)}
        >
          <Star size={11} fill={i < shown ? 'currentColor' : 'none'} />
        </button>
      ))}
    </span>
  )
}

// ---------------------------------------------------------------- zone

const ZoneBody = memo(function ZoneBody({ node, editing, api }: NodeBodyProps) {
  const z = node as ZoneNode
  const { actions, zoneCounts } = useMap()
  const count = zoneCounts.get(z.id) ?? 0
  const locked = z.locked !== false
  const kind = z.defaultKind ? KINDS[z.defaultKind] : KINDS.idea
  const assign = Object.entries(z.assign ?? {})
  return (
    <div className={`fm-zone${locked ? ' is-locked' : ''}`}>
      <div className="fm-zone-head" data-zone-head>
        {z.emoji && <span className="fm-zone-emoji">{z.emoji}</span>}
        {editing ? <ZoneLabelInput z={z} api={api} /> : <span className="fm-zone-label">{z.label || 'Zone'}</span>}
        <span className="fm-zone-count" title={`${count} card${count === 1 ? '' : 's'}`}>
          {count}
        </span>
        {assign.length > 0 && (
          <span className="fm-zone-assign" title="Cards dropped here get these fields">
            {assign.map(([k, v]) => `${k} → ${String(v)}`).join(', ')}
          </span>
        )}
        <button
          className="fm-zone-lock"
          data-interactive
          title={locked ? 'Locked — click to unlock (move / resize the zone)' : 'Unlocked — click to lock'}
          onClick={(e) => {
            e.stopPropagation()
            actions.toggleZoneLock(z.id)
          }}
        >
          {locked ? <Lock size={12} /> : <LockOpen size={12} />}
        </button>
      </div>
      <div className="fm-zone-body" data-canvas-bg={locked ? '' : undefined}>
        {count === 0 && (
          <div className="fm-zone-empty">
            {z.prompt && <div className="fm-zone-prompt">{z.prompt}</div>}
            <div className="fm-zone-hint">
              Double-click to add {/^[aeiou]/i.test(kind.label) ? 'an' : 'a'} {kind.emoji} {kind.label.toLowerCase()}
            </div>
          </div>
        )}
      </div>
    </div>
  )
})

function ZoneLabelInput({ z, api }: { z: ZoneNode; api: NodeBodyProps['api'] }) {
  const [v, setV] = useState(z.label ?? '')
  const done = useRef(false)
  const finish = (save: boolean): void => {
    if (done.current) return
    done.current = true
    if (save && v.trim() !== z.label) api.updateNode(z.id, { label: v.trim() || z.label })
    api.setEditing(null)
    api.focusCanvas()
  }
  return (
    <input
      className="fm-zone-input"
      data-interactive
      autoFocus
      value={v}
      onChange={(e) => setV(e.target.value)}
      onFocus={(e) => e.currentTarget.select()}
      onBlur={() => finish(true)}
      onKeyDown={(e) => {
        e.stopPropagation()
        if (e.key === 'Enter') finish(true)
        else if (e.key === 'Escape') finish(false)
      }}
    />
  )
}

// ---------------------------------------------------------------- drawing

const DrawingBody = memo(function DrawingBody({ node }: NodeBodyProps) {
  const d = node as DrawingNode
  const path = smoothPath(d.points ?? [])
  const color = colorCss(d.stroke) ?? d.stroke ?? 'var(--text-normal)'
  return (
    <svg className="fm-drawing" width="100%" height="100%">
      <path className="fm-drawing-hit" d={path} />
      <path className="fm-drawing-stroke" d={path} style={{ stroke: color, strokeWidth: d.strokeWidth ?? 3 }} />
    </svg>
  )
})

// ---------------------------------------------------------------- node type registry

export const MAP_NODE_TYPES: Record<string, NodeTypeDef> = {
  form: { Body: FormCardBody, bare: true, editable: true, className: () => 'fm-node-form' },
  zone: {
    Body: ZoneBody,
    bare: true,
    layer: 'back',
    container: true,
    connectable: false,
    editable: true,
    canMove: (n) => (n as ZoneNode).locked === false,
    canResize: (n) => (n as ZoneNode).locked === false,
    className: (n) => `fm-node-zone${(n as ZoneNode).locked === false ? ' is-unlocked' : ''}`
  },
  drawing: { Body: DrawingBody, bare: true, layer: 'front', connectable: false, canResize: () => false, className: () => 'fm-node-drawing' }
}
