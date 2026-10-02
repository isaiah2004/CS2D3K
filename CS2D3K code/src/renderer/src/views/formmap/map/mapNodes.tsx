// Map node bodies: plain form cards, groups and freehand drawings (plugged into the canvas engine as node types).
// The kanban node lives in KanbanNode.tsx.
import { memo, useCallback, useEffect, useRef, useState } from 'react'
import { Lock, LockOpen, Check, Star, Plus, ExternalLink } from 'lucide-react'
import MarkdownPreview from '@/lib/markdown/MarkdownPreview'
import CmEditor from '../../canvas/CmEditor'
import type { NodeBodyProps, NodeTypeDef } from '../../canvas/engine'
import { colorCss } from '../../canvas/model'
import {
  cardAccent,
  cardState,
  cardTitle,
  fieldLabel,
  fieldText,
  isEmptyValue,
  optionLabel,
  optionOf,
  presetById,
  tagColor,
  type ChecklistItem,
  type DrawingNode,
  type FieldDef,
  type FieldRegistry,
  type FormNode,
  type GroupNode
} from '../schema'
import { fmColor } from '../schema'
import { useMap, useMapActions, useMeta } from './mapContext'
import { smoothPath } from './logic'
import { KANBAN_NODE } from './KanbanNode'

type CssVars = React.CSSProperties & Record<`--${string}`, string>

// ---------------------------------------------------------------- form card

const MAX_TAGS = 4

const FormCardBody = memo(function FormCardBody({ node, selected, editing, api, lod }: NodeBodyProps) {
  const n = node as FormNode
  const meta = useMeta()
  const actions = useMapActions()
  const reg = meta.fields ?? {}
  const state = cardState(n, reg)
  const accent = cardAccent(n, meta)
  const votes = n.votes ?? 0
  const tags = n.tags ?? []
  const head = tags.length > 0 || votes > 0 || state === 'win' || (selected && !lod)
  return (
    <div className={`fm-card${state ? ` is-${state}` : ''}${accent ? ' has-accent' : ''}`} style={accent ? ({ '--fm-accent': accent } as CssVars) : undefined}>
      {head && (
        <div className="fm-card-head">
          {tags.slice(0, MAX_TAGS).map((t) => (
            <span key={t} className="fm-ctag" style={{ '--fm-chip-color': tagColor(meta, t) } as CssVars}>
              #{t}
            </span>
          ))}
          {tags.length > MAX_TAGS && <span className="fm-ctag is-more">+{tags.length - MAX_TAGS}</span>}
          {selected && !lod && (
            <button className="fm-ctag-add" data-interactive title="Tags" aria-label="Edit tags" onClick={(e) => actions.tagMenu(n.id, e)}>
              {tags.length ? <Plus size={11} /> : '+ tag'}
            </button>
          )}
          {state === 'win' && (
            <span className="fm-win-badge" title="Done">
              <Check size={11} strokeWidth={3} />
            </span>
          )}
          <span className="fm-spacer" />
          {(votes > 0 || (selected && !lod)) && (
            <button className={`fm-votes${votes ? '' : ' is-zero'}`} data-interactive title="Dot votes — click to add, right-click the card for more" onClick={(e) => actions.vote(n.id, 1, e)}>
              <span className="fm-votes-dot" />
              {votes || '+'}
            </button>
          )}
        </div>
      )}
      {editing ? <CardEditor n={n} api={api} /> : <CardFace n={n} canvasPath={api.canvasPath} lod={!!lod} />}
      {!lod && !editing && <CardFields n={n} reg={reg} selected={selected} />}
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
        placeholder="Title"
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
        <CmEditor value={n.text ?? ''} onChange={(v) => api.updateNode(n.id, { text: v }, `text:${n.id}`)} lang="markdown" mode="text" placeholder="Details (markdown)…" onOverflow={grow} onEscape={finish} />
      </div>
    </div>
  )
}

/** field keys in registry order, then unregistered ones */
function orderedKeys(fields: Record<string, unknown>, reg: FieldRegistry): string[] {
  const keys = Object.keys(reg).filter((k) => k in fields)
  for (const k of Object.keys(fields)) if (!(k in reg)) keys.push(k)
  return keys
}

const shortLabel = (key: string, def?: FieldDef): string => fieldLabel(key, def).split(/\s+/)[0]

function CardFields({ n, reg, selected }: { n: FormNode; reg: FieldRegistry; selected: boolean }) {
  const actions = useMapActions()
  const chips: React.ReactNode[] = []
  const lines: React.ReactNode[] = []
  const fields = n.fields ?? {}
  for (const key of orderedKeys(fields, reg)) {
    const v = fields[key]
    const def = reg[key]
    if (def?.hidden || isEmptyValue(v)) continue
    const label = fieldLabel(key, def)
    switch (def?.type) {
      case 'select': {
        const o = optionOf(def, v)
        chips.push(
          <button key={key} className="fm-chip" data-interactive title={`${label}: ${o ? optionLabel(o) : String(v)} — click to change`} style={{ '--chip': fmColor(o?.color) ?? 'var(--text-faint)' } as CssVars} onClick={(e) => actions.fieldMenu(n.id, key, e)}>
            <span className="fm-chip-dot" />
            {o ? optionLabel(o) : String(v)}
          </button>
        )
        break
      }
      case 'multiselect':
        for (const x of Array.isArray(v) ? v : [v]) {
          const o = optionOf(def, x)
          chips.push(
            <button key={`${key}:${String(x)}`} className="fm-chip" data-interactive title={`${label} — click to change`} style={{ '--chip': fmColor(o?.color) ?? 'var(--text-faint)' } as CssVars} onClick={(e) => actions.fieldMenu(n.id, key, e)}>
              <span className="fm-chip-dot" />
              {o ? optionLabel(o) : String(x)}
            </button>
          )
        }
        break
      case 'rating':
        chips.push(<CardStars key={key} n={n} k={key} def={def} value={Number(v) || 0} />)
        break
      case 'checkbox':
        chips.push(
          <button key={key} className="fm-chip is-check" data-interactive title={`${label} — click to untick`} onClick={(e) => actions.setField(n.id, key, undefined, e)}>
            <Check size={11} strokeWidth={3} />
            {label}
          </button>
        )
        break
      case 'checklist': {
        const list = Array.isArray(v) ? (v as ChecklistItem[]) : []
        const done = list.filter((i) => i?.done).length
        chips.push(
          <span key={key} className={`fm-chip is-static${done === list.length ? ' is-complete' : ''}`} title={`${label}: ${done} of ${list.length} done`}>
            <span className="fm-chip-bar">
              <span style={{ width: `${(done / Math.max(1, list.length)) * 100}%` }} />
            </span>
            {done}/{list.length}
          </span>
        )
        break
      }
      case 'longtext':
        lines.push(
          <div key={key} className="fm-card-line" title={`${label}: ${String(v)}`}>
            <span className="fm-card-line-label">{label}</span> {String(v)}
          </div>
        )
        break
      case 'link':
        chips.push(
          <button key={key} className="fm-chip is-link" data-interactive title={`Open ${String(v)} (Ctrl: new tab)`} onClick={(e) => actions.openLink(String(v), e.ctrlKey || e.metaKey)}>
            <ExternalLink size={10} />
            {String(v).replace(/^\[\[|\]\]$/g, '')}
          </button>
        )
        break
      default:
        chips.push(
          <span key={key} className="fm-chip is-static" title={`${label}: ${fieldText(def, v)}`} style={def?.color ? ({ '--chip': fmColor(def.color)! } as CssVars) : undefined}>
            <span className="fm-chip-key">{label}</span>
            <span className="fm-chip-val">{fieldText(def, v)}</span>
          </span>
        )
    }
  }
  if (selected)
    chips.push(
      <button key="@add" className="fm-chip is-empty" data-interactive title="Add a field" onClick={(e) => actions.addFieldMenu(n.id, e)}>
        <Plus size={10} /> Field
      </button>
    )
  if (!chips.length && !lines.length) return null
  return (
    <div className="fm-fields">
      {lines}
      {chips.length > 0 && <div className="fm-chips">{chips}</div>}
    </div>
  )
}

function CardStars({ n, k, def, value }: { n: FormNode; k: string; def?: FieldDef; value: number }) {
  const actions = useMapActions()
  const [hover, setHover] = useState(0)
  const max = def?.max ?? 5
  const shown = hover || value
  return (
    <span className="fm-stars" title={`${fieldLabel(k, def)}: ${value}/${max}`} data-interactive onMouseLeave={() => setHover(0)}>
      <span className="fm-stars-label">{shortLabel(k, def)}</span>
      {Array.from({ length: max }, (_, i) => (
        <button key={i} className={`fm-star${i < shown ? ' is-on' : ''}`} onMouseEnter={() => setHover(i + 1)} onClick={(e) => actions.setField(n.id, k, value === i + 1 ? undefined : i + 1, e)}>
          <Star size={11} fill={i < shown ? 'currentColor' : 'none'} />
        </button>
      ))}
    </span>
  )
}

// ---------------------------------------------------------------- group

const GroupBody = memo(function GroupBody({ node, editing, api }: NodeBodyProps) {
  const g = node as GroupNode
  const { groupCounts, parentGroups } = useMap()
  const meta = useMeta()
  const actions = useMapActions()
  const count = groupCounts.get(g.id) ?? 0
  const locked = g.locked === true
  const preset = presetById(meta, g.preset)
  const reg = meta.fields ?? {}
  const assign = Object.entries(g.assign ?? {})
  return (
    <div className={`fm-group${locked ? ' is-locked' : ''}`}>
      <div className="fm-group-head" data-group-head>
        {g.emoji && <span className="fm-group-emoji">{g.emoji}</span>}
        {editing ? <GroupLabelInput g={g} api={api} /> : <span className={`fm-group-label${g.label?.trim() ? '' : ' is-empty'}`}>{g.label?.trim() || 'Group'}</span>}
        <span className="fm-group-count" title={`${count} card${count === 1 ? '' : 's'}`}>
          {count}
        </span>
        {assign.length > 0 && (
          <span className="fm-group-assign" title="Cards dropped here get these fields">
            {assign.map(([k, v]) => `${fieldLabel(k, reg[k])} → ${fieldText(reg[k], v) || String(v)}`).join(', ')}
          </span>
        )}
        <button
          className="fm-group-lock"
          data-interactive
          title={locked ? 'Locked — click to unlock (move / resize the group)' : 'Unlocked — click to lock'}
          onClick={(e) => {
            e.stopPropagation()
            actions.toggleGroupLock(g.id)
          }}
        >
          {locked ? <Lock size={12} /> : <LockOpen size={12} />}
        </button>
      </div>
      <div className="fm-group-body" data-canvas-bg={locked ? '' : undefined}>
        {count === 0 && !parentGroups.has(g.id) && (
          <div className="fm-group-empty">
            {g.prompt && <div className="fm-group-prompt">{g.prompt}</div>}
            <div className="fm-group-hint">Double-click to add {preset ? `${/^[aeiou]/i.test(preset.name) ? 'an' : 'a'} ${preset.emoji ?? ''} ${preset.name.toLowerCase()}` : 'a card'}</div>
          </div>
        )}
      </div>
    </div>
  )
})

function GroupLabelInput({ g, api }: { g: GroupNode; api: NodeBodyProps['api'] }) {
  const [v, setV] = useState(g.label ?? '')
  const done = useRef(false)
  const finish = (save: boolean): void => {
    if (done.current) return
    done.current = true
    if (save && v.trim() !== (g.label ?? '')) api.updateNode(g.id, { label: v.trim() || g.label || 'Group' })
    api.setEditing(null)
    api.focusCanvas()
  }
  return (
    <input
      className="fm-group-input"
      data-interactive
      autoFocus
      value={v}
      placeholder="Group name"
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
  group: {
    Body: GroupBody,
    bare: true,
    layer: 'back',
    container: true,
    connectable: false,
    editable: true,
    canMove: (n) => (n as GroupNode).locked !== true,
    canResize: (n) => (n as GroupNode).locked !== true,
    className: (n) => `fm-node-group${(n as GroupNode).locked === true ? ' is-locked' : ' is-unlocked'}`
  },
  kanban: KANBAN_NODE,
  drawing: { Body: DrawingBody, bare: true, layer: 'front', connectable: false, canResize: () => false, className: () => 'fm-node-drawing' }
}
