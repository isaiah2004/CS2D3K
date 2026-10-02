// Board lens: kanban columns grouped by phase / status / priority / kind / zone. Drag cards between columns to re-file them.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Plus, MapPin, Trash2, ThumbsUp, ThumbsDown, ArrowRightLeft } from 'lucide-react'
import type { FormMapCtl, LensProps } from '../context'
import {
  cardTitle,
  EFFORTS,
  effortPoints,
  fieldDef,
  forms,
  KIND_ORDER,
  KINDS,
  optionOf,
  PHASES,
  PRIORITIES,
  type ChecklistItem,
  type FieldOption,
  type FormKind,
  type FormNode
} from '../schema'
import { mvpStats } from '../analysis'
import { addCard, deleteNodes, moveToZone, setField, setKind, vote, zoneIndex, zonesInOrder } from './ops'
import { KindChip, OptionChip, Stars, VoteBadge } from './widgets'
import { useWorkspace } from '@/store/workspace'
import { showContextMenu, type MenuItem } from '@/store/ui'
import './lenses.css'

type GroupBy = 'phase' | 'status' | 'priority' | 'kind' | 'zone'
type SortBy = 'map' | 'votes' | 'fun' | 'priority'

interface BoardState {
  group: GroupBy
  statusKind: FormKind
  sort: SortBy
}

const GROUPS: { id: GroupBy; label: string }[] = [
  { id: 'phase', label: 'Phase' },
  { id: 'status', label: 'Status' },
  { id: 'priority', label: 'Priority' },
  { id: 'kind', label: 'Kind' },
  { id: 'zone', label: 'Zone' }
]
const SORTS: { id: SortBy; label: string }[] = [
  { id: 'map', label: 'Map order' },
  { id: 'votes', label: 'Votes' },
  { id: 'fun', label: 'Fun' },
  { id: 'priority', label: 'Priority' }
]
const STATUS_KINDS: FormKind[] = ['feature', 'approach', 'question', 'idea']
const NONE = '__none'

interface Column {
  key: string
  label: string
  emoji?: string
  color?: string
  hint?: string
  /** what a card dropped here gets */
  drop: { field: string; value: unknown } | { kind: FormKind } | { zone: string | null }
  /** kind of cards created with quick-add */
  newKind: FormKind
  cards: FormNode[]
}

const byPos = (a: FormNode, b: FormNode): number => a.y - b.y || a.x - b.x
const prioRank = (f: FormNode): number => {
  const i = PRIORITIES.findIndex((p) => p.value === f.fields.priority)
  return i < 0 ? PRIORITIES.length : i
}
const SORTERS: Record<SortBy, (a: FormNode, b: FormNode) => number> = {
  map: byPos,
  votes: (a, b) => (b.votes ?? 0) - (a.votes ?? 0) || byPos(a, b),
  fun: (a, b) => (Number(b.fields.fun) || 0) - (Number(a.fields.fun) || 0) || byPos(a, b),
  priority: (a, b) => prioRank(a) - prioRank(b) || (b.votes ?? 0) - (a.votes ?? 0) || byPos(a, b)
}

function readState(ctl: FormMapCtl): BoardState {
  const s = (ctl.tab.state?.board ?? {}) as Partial<BoardState>
  return {
    group: GROUPS.some((g) => g.id === s.group) ? s.group! : 'phase',
    statusKind: s.statusKind && STATUS_KINDS.includes(s.statusKind) ? s.statusKind : 'feature',
    sort: SORTS.some((x) => x.id === s.sort) ? s.sort! : 'map'
  }
}

function buildColumns(ctl: FormMapCtl, st: BoardState): Column[] {
  const all = forms(ctl.data)
  const fieldColumns = (kind: FormKind, key: string, options: FieldOption[], noneLabel: string): Column[] => {
    const cards = all.filter((f) => f.kind === kind)
    const cols: Column[] = options.map((o) => ({
      key: o.value,
      label: o.label,
      color: o.color,
      drop: { field: key, value: o.value },
      newKind: kind,
      cards: cards.filter((f) => f.fields[key] === o.value)
    }))
    const none = cards.filter((f) => !options.some((o) => o.value === f.fields[key]))
    if (none.length) cols.push({ key: NONE, label: noneLabel, color: 'var(--text-faint)', drop: { field: key, value: undefined }, newKind: kind, cards: none })
    return cols
  }
  switch (st.group) {
    case 'phase':
      return fieldColumns('feature', 'phase', PHASES, 'No phase')
    case 'priority':
      return fieldColumns('feature', 'priority', PRIORITIES, 'No priority')
    case 'status':
      return fieldColumns(st.statusKind, 'status', fieldDef(st.statusKind, 'status')?.options ?? [], 'No status')
    case 'kind':
      return KIND_ORDER.map((k) => ({
        key: k,
        label: KINDS[k].plural,
        emoji: KINDS[k].emoji,
        color: KINDS[k].color,
        hint: KINDS[k].hint,
        drop: { kind: k },
        newKind: k,
        cards: all.filter((f) => f.kind === k)
      }))
    case 'zone': {
      const idx = zoneIndex(ctl.data)
      const cols: Column[] = zonesInOrder(ctl.data).map((z) => ({
        key: z.id,
        label: z.label || 'Zone',
        emoji: z.emoji,
        hint: z.prompt,
        drop: { zone: z.id },
        newKind: z.defaultKind ?? 'idea',
        cards: all.filter((f) => idx.get(f.id) === z.id)
      }))
      cols.push({ key: NONE, label: 'Outside zones', emoji: '🌌', hint: 'Cards that float freely on the map.', drop: { zone: null }, newKind: 'idea', cards: all.filter((f) => !idx.get(f.id)) })
      return cols
    }
  }
}

interface DragState {
  id: string
  from: string
  x: number
  y: number
  offX: number
  offY: number
  width: number
  over: string | null
}

export default function BoardLens({ ctl }: LensProps) {
  const [st, setSt] = useState<BoardState>(() => readState(ctl))
  const update = (patch: Partial<BoardState>): void => {
    const next = { ...st, ...patch }
    setSt(next)
    useWorkspace.getState().updateTabState(ctl.tab.id, { board: next })
  }

  const columns = useMemo(() => {
    const cols = buildColumns(ctl, st)
    for (const c of cols) c.cards.sort(SORTERS[st.sort])
    return cols
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctl.data, st])
  const total = columns.reduce((s, c) => s + c.cards.length, 0)
  const mvp = useMemo(() => mvpStats(ctl.data), [ctl.data])

  const selected = useMemo(() => new Set(ctl.selection), [ctl.selection])
  const dimmed = useMemo(() => {
    const f = ctl.focusFilter
    if (!ctl.highlight && !f) return null
    const hl = ctl.highlight ? new Set(ctl.highlight) : null
    return (c: FormNode): boolean =>
      (!!hl && !hl.has(c.id)) || (!!f?.kinds?.length && !f.kinds.includes(c.kind)) || (!!f?.phase && c.fields.phase !== f.phase)
  }, [ctl.highlight, ctl.focusFilter])

  // ------------------------------------------------ drop
  const ctlRef = useRef(ctl)
  ctlRef.current = ctl
  const [dropped, setDropped] = useState<string | null>(null)
  const [adding, setAdding] = useState<string | null>(null)
  const applyDrop = useCallback((id: string, col: Column, at?: { clientX: number; clientY: number }) => {
    const c = ctlRef.current
    const d = col.drop
    if ('field' in d) setField(c, id, d.field, d.value, at)
    else if ('kind' in d) setKind(c, id, d.kind)
    else moveToZone(c, id, d.zone)
    setDropped(id)
    setTimeout(() => setDropped((x) => (x === id ? null : x)), 450)
  }, [])

  // ------------------------------------------------ pointer drag
  const [drag, setDrag] = useState<DragState | null>(null)
  const dragRef = useRef<DragState | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const suppressClick = useRef(false)
  const colsRef = useRef(columns)
  colsRef.current = columns

  /** focus caused by a pointer press shouldn't select (the click handles that, incl. Ctrl/Shift) */
  const pointerFocus = useRef(false)
  const onCardPointerDown = (e: React.PointerEvent, card: FormNode, colKey: string): void => {
    pointerFocus.current = true
    setTimeout(() => (pointerFocus.current = false), 0)
    if (e.button !== 0 || (e.target as HTMLElement).closest('button, input, textarea')) return
    const el = e.currentTarget as HTMLElement
    const rect = el.getBoundingClientRect()
    const sx = e.clientX
    const sy = e.clientY
    let started = false
    const move = (ev: PointerEvent): void => {
      if (!started) {
        if (Math.hypot(ev.clientX - sx, ev.clientY - sy) < 5) return
        started = true
        document.body.classList.add('fm-board-dragging')
      }
      const over = (document.elementFromPoint(ev.clientX, ev.clientY) as HTMLElement | null)?.closest<HTMLElement>('[data-col]')?.dataset.col ?? null
      const next: DragState = { id: card.id, from: colKey, x: ev.clientX, y: ev.clientY, offX: sx - rect.left, offY: sy - rect.top, width: rect.width, over }
      dragRef.current = next
      setDrag(next)
      // auto-scroll the board near its left/right edges
      const sc = scrollRef.current
      if (sc) {
        const r = sc.getBoundingClientRect()
        if (ev.clientX < r.left + 60) sc.scrollLeft -= 14
        else if (ev.clientX > r.right - 60) sc.scrollLeft += 14
      }
    }
    const up = (ev: PointerEvent): void => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('keydown', esc, true)
      document.body.classList.remove('fm-board-dragging')
      const d = dragRef.current
      dragRef.current = null
      setDrag(null)
      if (!started || !d) return
      suppressClick.current = true
      setTimeout(() => (suppressClick.current = false), 0)
      if (d.over && d.over !== d.from) {
        const col = colsRef.current.find((c) => c.key === d.over)
        if (col) applyDrop(d.id, col, { clientX: ev.clientX, clientY: ev.clientY })
      }
    }
    const esc = (ev: KeyboardEvent): void => {
      if (ev.key !== 'Escape') return
      ev.stopPropagation()
      dragRef.current = null
      setDrag(null)
      started = false
      document.body.classList.remove('fm-board-dragging')
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('keydown', esc, true)
  }

  // ------------------------------------------------ selection + keyboard
  const select = (e: React.MouseEvent | React.KeyboardEvent, id: string): void => {
    if (suppressClick.current) return
    if (e.ctrlKey || e.metaKey || e.shiftKey) ctl.setSelection(selected.has(id) ? ctl.selection.filter((s) => s !== id) : [...ctl.selection, id])
    else ctl.setSelection([id])
  }
  const rootRef = useRef<HTMLDivElement>(null)
  const focusCard = (id: string): void => {
    requestAnimationFrame(() => rootRef.current?.querySelector<HTMLElement>(`[data-card="${id}"]`)?.focus())
  }
  const onCardKey = (e: React.KeyboardEvent, card: FormNode, ci: number, ri: number): void => {
    const col = columns[ci]
    const nav = (c: number, r: number): void => {
      const target = columns[c]?.cards[Math.max(0, Math.min(r, columns[c].cards.length - 1))]
      if (target) {
        ctl.setSelection([target.id])
        focusCard(target.id)
      }
    }
    if (e.key === 'Escape') {
      e.preventDefault()
      if (ctl.highlight) ctl.setHighlight(null)
      else ctl.setSelection([])
    } else if (e.key === 'Enter') {
      e.preventDefault()
      ctl.reveal([card.id], { select: true })
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      nav(ci, ri + 1)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      nav(ci, ri - 1)
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault()
      const dir = e.key === 'ArrowLeft' ? -1 : 1
      if (e.altKey || e.shiftKey) {
        // move the card to the next column
        const target = columns[ci + dir]
        if (target && target.key !== col.key) {
          const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
          applyDrop(card.id, target, { clientX: r.left + r.width / 2, clientY: r.top + 20 })
          focusCard(card.id)
        }
      } else {
        for (let c = ci + dir; c >= 0 && c < columns.length; c += dir)
          if (columns[c].cards.length) {
            nav(c, ri)
            break
          }
      }
    } else if (e.key === 'Delete') {
      e.preventDefault()
      deleteNodes(ctl, [card.id])
    } else if (e.key === '+' || e.key === '=') vote(ctl, card.id, 1)
    else if (e.key === '-') vote(ctl, card.id, -1)
  }

  const cardMenu = (e: React.MouseEvent, card: FormNode, col: Column): void => {
    if (!selected.has(card.id)) ctl.setSelection([card.id])
    const items: MenuItem[] = [
      { label: 'Reveal in map', icon: <MapPin size={14} />, onClick: () => ctl.reveal([card.id], { select: true }) },
      {
        label: 'Move to',
        icon: <ArrowRightLeft size={14} />,
        submenu: columns.filter((c) => c.key !== col.key && !(c.key === NONE && 'field' in c.drop)).map((c) => ({ label: `${c.emoji ? c.emoji + ' ' : ''}${c.label}`, onClick: () => applyDrop(card.id, c, e) }))
      },
      { separator: true },
      { label: 'Vote', icon: <ThumbsUp size={14} />, onClick: () => vote(ctl, card.id, 1) },
      { label: 'Remove vote', icon: <ThumbsDown size={14} />, disabled: !card.votes, onClick: () => vote(ctl, card.id, -1) },
      { separator: true },
      { label: 'Delete', icon: <Trash2 size={14} />, danger: true, onClick: () => deleteNodes(ctl, [card.id]) }
    ]
    showContextMenu(e, items)
  }

  const dragCard = drag ? forms(ctl.data).find((f) => f.id === drag.id) : null
  const groupKey = st.group === 'kind' || st.group === 'zone' ? null : st.group === 'status' ? 'status' : st.group

  return (
    <div className={`fm-board${drag ? ' is-dragging' : ''}`} ref={rootRef}>
      <div className="fm-lens-toolbar">
        <span className="fm-toolbar-label">Group</span>
        <div className="fm-seg" role="tablist" aria-label="Group by">
          {GROUPS.map((g) => (
            <button key={g.id} role="tab" aria-selected={st.group === g.id} className={st.group === g.id ? 'is-active' : ''} onClick={() => update({ group: g.id })}>
              {g.label}
            </button>
          ))}
        </div>
        {st.group === 'status' && (
          <div className="fm-seg" aria-label="Kind">
            {STATUS_KINDS.map((k) => (
              <button key={k} className={st.statusKind === k ? 'is-active' : ''} onClick={() => update({ statusKind: k })} title={KINDS[k].plural}>
                {KINDS[k].emoji} {KINDS[k].plural}
              </button>
            ))}
          </div>
        )}
        <span className="fm-toolbar-spacer" />
        <span className="fm-toolbar-label">Sort</span>
        <div className="fm-seg" aria-label="Sort by">
          {SORTS.map((s) => (
            <button key={s.id} className={st.sort === s.id ? 'is-active' : ''} onClick={() => update({ sort: s.id })}>
              {s.label}
            </button>
          ))}
        </div>
        <span className="fm-toolbar-count">{total} cards</span>
      </div>
      <div className="fm-board-scroll" ref={scrollRef}>
        {columns.map((col, ci) => {
          const pts = col.cards.some((c) => c.kind === 'feature') ? col.cards.reduce((s, c) => s + (c.fields.status === 'cut' ? 0 : effortPoints(c.fields.effort)), 0) : 0
          const isMvp = st.group === 'phase' && col.key === 'mvp'
          const over = drag && drag.over === col.key && drag.from !== col.key
          return (
            <section key={col.key} className={`fm-col${over ? ' is-drop-target' : ''}`} data-col={col.key} style={{ '--fm-col-color': col.color ?? 'var(--background-modifier-border-focus)' } as React.CSSProperties}>
              <header className="fm-col-head">
                {col.emoji ? <span className="fm-col-emoji">{col.emoji}</span> : <span className="fm-col-dot" />}
                <span className="fm-col-label">{col.label}</span>
                <span className="fm-col-count">{col.cards.length}</span>
                {pts > 0 && (
                  <span className={`fm-col-pts${isMvp && mvp.budget !== null && mvp.points > mvp.budget ? ' is-over' : ''}`} title="Effort points">
                    {isMvp && mvp.budget !== null ? `${pts}/${mvp.budget}` : pts} pts
                  </span>
                )}
                <button className="clickable-icon small fm-col-add" title={`Add ${KINDS[col.newKind].label.toLowerCase()} to “${col.label}”`} onClick={() => setAdding(col.key)}>
                  <Plus />
                </button>
              </header>
              <div className="fm-col-body">
                {col.cards.map((card, ri) => (
                  <BoardCard
                    key={card.id}
                    card={card}
                    groupKey={groupKey}
                    showKind={st.group === 'kind' ? false : true}
                    selected={selected.has(card.id)}
                    dim={!selected.has(card.id) && (dimmed?.(card) ?? false)}
                    dragging={drag?.id === card.id}
                    dropped={dropped === card.id}
                    onPointerDown={(e) => onCardPointerDown(e, card, col.key)}
                    onClick={(e) => select(e, card.id)}
                    onDoubleClick={() => ctl.reveal([card.id], { select: true })}
                    onKeyDown={(e) => onCardKey(e, card, ci, ri)}
                    onFocus={() => {
                      if (!pointerFocus.current && !selected.has(card.id)) ctl.setSelection([card.id])
                    }}
                    onContextMenu={(e) => cardMenu(e, card, col)}
                    onField={(k, v, e) => setField(ctl, card.id, k, v, e)}
                  />
                ))}
                {over && <div className="fm-col-placeholder">Drop to move here</div>}
                {!col.cards.length && !over && (
                  <div className="fm-col-empty">
                    <div className="fm-col-empty-emoji">{col.emoji ?? '🫙'}</div>
                    <div>{col.hint ?? 'Nothing here yet.'}</div>
                    <div className="fm-col-empty-sub">Drag a card here or add one.</div>
                  </div>
                )}
                <QuickAdd ctl={ctl} col={col} open={adding === col.key} setOpen={(o) => setAdding(o ? col.key : null)} />
              </div>
            </section>
          )
        })}
      </div>
      {drag && dragCard && (
        <div className="fm-board-ghost" style={{ left: drag.x - drag.offX, top: drag.y - drag.offY, width: drag.width }}>
          <BoardCardBody card={dragCard} groupKey={groupKey} showKind />
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------- cards

interface BoardCardProps {
  card: FormNode
  groupKey: string | null
  showKind: boolean
  selected: boolean
  dim: boolean
  dragging: boolean
  dropped: boolean
  onPointerDown: (e: React.PointerEvent) => void
  onClick: (e: React.MouseEvent) => void
  onDoubleClick: () => void
  onKeyDown: (e: React.KeyboardEvent) => void
  onFocus: () => void
  onContextMenu: (e: React.MouseEvent) => void
  onField: (key: string, v: unknown, e: React.MouseEvent) => void
}

function BoardCard(p: BoardCardProps) {
  const cls = ['fm-bcard', p.selected && 'is-selected', p.dim && 'is-dim', p.dragging && 'is-dragging', p.dropped && 'is-dropped', isDone(p.card) && 'is-done']
    .filter(Boolean)
    .join(' ')
  return (
    <div
      className={cls}
      data-card={p.card.id}
      tabIndex={0}
      role="button"
      aria-label={cardTitle(p.card)}
      aria-pressed={p.selected}
      style={{ '--fm-card-color': KINDS[p.card.kind].color } as React.CSSProperties}
      onPointerDown={p.onPointerDown}
      onClick={p.onClick}
      onDoubleClick={p.onDoubleClick}
      onKeyDown={p.onKeyDown}
      onFocus={p.onFocus}
      onContextMenu={p.onContextMenu}
    >
      <BoardCardBody card={p.card} groupKey={p.groupKey} showKind={p.showKind} onField={p.onField} />
    </div>
  )
}

const isDone = (c: FormNode): boolean =>
  (c.kind === 'feature' && c.fields.status === 'done') || (c.kind === 'question' && c.fields.status === 'decided') || (c.kind === 'approach' && c.fields.status === 'accepted')

function BoardCardBody({ card, groupKey, showKind, onField }: { card: FormNode; groupKey: string | null; showKind: boolean; onField?: (key: string, v: unknown, e: React.MouseEvent) => void }) {
  const def = KINDS[card.kind]
  const chips = def.fields.filter((f) => f.type === 'select' && f.onCard && f.key !== groupKey && card.fields[f.key] !== undefined)
  const fun = def.fields.find((f) => f.type === 'rating' && f.onCard)
  const ac = Array.isArray(card.fields.acceptance) ? (card.fields.acceptance as ChecklistItem[]) : null
  const excerpt = (card.text ?? '').replace(/[#*_`>[\]]/g, '').trim()
  const showExcerpt = excerpt && excerpt !== card.title?.trim()
  return (
    <>
      <div className="fm-bcard-top">
        {showKind && <KindChip kind={card.kind} label={false} />}
        <div className="fm-bcard-title">{cardTitle(card)}</div>
        <VoteBadge votes={card.votes} />
      </div>
      {showExcerpt && <div className="fm-bcard-text">{excerpt}</div>}
      {(chips.length > 0 || (fun && Number(card.fields[fun.key])) || (ac && ac.length > 0)) && (
        <div className="fm-bcard-chips">
          {chips.map((f) => {
            const o = optionOf(f, card.fields[f.key])
            if (!o) return null
            const isEffort = f.key === 'effort'
            return <OptionChip key={f.key} option={isEffort ? { ...o, label: `${o.label} · ${EFFORTS.find((x) => x.value === o.value)?.points}pt` } : o} compact title={f.label} />
          })}
          {ac && ac.length > 0 && (
            <span className="fm-bcard-ac" title="Acceptance criteria">
              ✓ {ac.filter((i) => i.done).length}/{ac.length}
            </span>
          )}
          {fun && Number(card.fields[fun.key]) > 0 && (
            <span className="fm-bcard-fun" title={fun.label}>
              <Stars value={Number(card.fields[fun.key])} max={fun.max ?? 5} size={11} onChange={onField ? (v, e) => onField(fun.key, v || undefined, e) : undefined} />
            </span>
          )}
        </div>
      )}
    </>
  )
}

// ---------------------------------------------------------------- quick add

function QuickAdd({ ctl, col, open, setOpen }: { ctl: FormMapCtl; col: Column; open: boolean; setOpen: (open: boolean) => void }) {
  const [text, setText] = useState('')
  const ref = useRef<HTMLTextAreaElement>(null)
  useEffect(() => {
    if (open) ref.current?.focus()
  }, [open])

  const close = (): void => {
    setText('')
    setOpen(false)
  }
  const create = (): void => {
    const title = text.trim()
    if (!title) return close()
    const d = col.drop
    const opts = 'field' in d ? (d.value === undefined ? { avoidKey: d.field } : { fields: { [d.field]: d.value } }) : 'zone' in d ? { zoneId: d.zone } : {}
    const id = addCard(ctl, col.newKind, { title, ...opts })
    ctl.setSelection([id])
    // keep the input open for rapid capture
    setText('')
  }

  if (!open)
    return (
      <button className="fm-col-addrow" onClick={() => setOpen(true)}>
        <Plus size={13} /> Add {KINDS[col.newKind].label.toLowerCase()}
      </button>
    )
  return (
    <div className="fm-quickadd">
      <textarea
        ref={ref}
        className="fm-quickadd-input"
        rows={2}
        value={text}
        placeholder={`${KINDS[col.newKind].emoji} Title… (Enter to add, Esc to close)`}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault()
            create()
          } else if (e.key === 'Escape') {
            e.preventDefault()
            e.stopPropagation()
            close()
          }
        }}
        onBlur={() => {
          if (!text.trim()) close()
        }}
      />
      <div className="fm-quickadd-actions">
        <button className="btn mod-cta" onMouseDown={(e) => e.preventDefault()} onClick={create}>
          Add
        </button>
        <button className="btn" onMouseDown={(e) => e.preventDefault()} onClick={close}>
          Cancel
        </button>
      </div>
    </div>
  )
}
