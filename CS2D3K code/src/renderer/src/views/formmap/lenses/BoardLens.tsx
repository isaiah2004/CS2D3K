// Board lens: saved kanban boards over the map's cards.
//  - groups boards: each group is a column; moving a card moves it into that group on the canvas (applying its fields)
//  - field boards: one group (or the whole map) split by a field; moving a card sets the field
// Per-column order is saved on the board. Boards are live: they are derived from the map on every change.
import { useEffect, useMemo, useRef, useState } from 'react'
import { Plus, MapPin, Trash2, ThumbsUp, ThumbsDown, ArrowRightLeft, MoreHorizontal, Filter, Columns3, KanbanSquare, Pencil, Gauge, Tag, X, Check } from 'lucide-react'
import type { FormMapCtl, LensProps } from '../context'
import {
  cardAccent,
  cardState,
  cardTitle,
  fieldLabel,
  forms,
  groupTitle,
  optionLabel,
  optionsFor,
  type Board,
  type ChecklistItem,
  type FormMapMeta,
  type FormNode
} from '../schema'
import { BOARD_FIELD_TYPES, boardColumns, newFieldBoard, newGroupsBoard, type BoardColumn } from '../boards'
import { addCardToColumn, addField, createBoard, deleteBoard, deleteNodes, groupsInOrder, moveOnBoard, setMeta, setTags, updateBoard, vote } from './ops'
import { FieldChips, TagChip, tagMenuItems, VoteBadge } from './widgets'
import { confirmDialog, promptText, showContextMenu, type MenuItem } from '@/store/ui'
import './lenses.css'
import './board.css'

/** columns render at most this many cards until "show more" (keeps huge maps fast) */
const PAGE = 150

interface DragState {
  id: string
  from: string
  x: number
  y: number
  offX: number
  offY: number
  width: number
  over: string | null
  index: number
}

export default function BoardLens({ ctl }: LensProps) {
  const meta = ctl.meta
  const boards = meta.boards ?? []
  const board = boards.find((b) => b.id === ctl.activeBoard) ?? boards[0] ?? null
  const [setup, setSetup] = useState<'groups' | 'field' | null>(null)
  const showSetup = setup !== null || !board

  return (
    <div className="fm-board">
      <div className="fm-lens-toolbar fm-board-bar">
        <div className="fm-board-tabs" role="tablist" aria-label="Boards">
          {boards.map((b) => (
            <button
              key={b.id}
              role="tab"
              aria-selected={board?.id === b.id && !setup}
              className={`fm-board-tab${board?.id === b.id && !setup ? ' is-active' : ''}`}
              title={`${b.name} — ${b.source.mode === 'groups' ? 'columns are groups' : `by ${fieldLabel(b.source.field, meta.fields?.[b.source.field]).toLowerCase()}`}`}
              onClick={() => {
                setSetup(null)
                ctl.openBoard(b.id)
              }}
              onContextMenu={(e) => boardMenu(e, ctl, b)}
            >
              {b.source.mode === 'groups' ? <Columns3 size={13} /> : <KanbanSquare size={13} />}
              <span>{b.name}</span>
            </button>
          ))}
          <button className={`fm-board-tab is-new${setup ? ' is-active' : ''}`} onClick={() => setSetup(setup ? null : 'groups')} title="Create a board">
            <Plus size={13} />
            <span>New board</span>
          </button>
        </div>
        <span className="fm-toolbar-spacer" />
        {board && !showSetup && <BoardTools ctl={ctl} board={board} />}
      </div>
      {showSetup ? (
        <BoardSetup
          ctl={ctl}
          mode={setup ?? 'groups'}
          setMode={setSetup}
          first={!boards.length}
          onDone={(id) => {
            setSetup(null)
            if (id) ctl.openBoard(id)
          }}
        />
      ) : (
        <BoardView key={board!.id} ctl={ctl} board={board!} />
      )}
    </div>
  )
}

// ---------------------------------------------------------------- toolbar

function boardMenu(e: React.MouseEvent, ctl: FormMapCtl, b: Board): void {
  const meta = ctl.meta
  const items: MenuItem[] = [
    {
      label: 'Rename…',
      icon: <Pencil />,
      onClick: () =>
        void promptText({ title: 'Rename board', initial: b.name, okLabel: 'Rename' }).then((v) => {
          if (v?.trim()) updateBoard(ctl, b.id, { name: v.trim() })
        })
    },
    { label: 'Show progress in the HUD', icon: <Gauge />, checked: (meta.hudBoard ?? meta.boards?.[0]?.id) === b.id, onClick: () => setMeta(ctl, { hudBoard: b.id }) }
  ]
  if (b.source.mode === 'field') {
    const def = meta.fields?.[b.source.field]
    if (def?.type === 'select') {
      const src = b.source
      const shown = src.values?.length ? src.values : optionsFor(def, b.filter?.tags).map((o) => o.value)
      items.push({
        label: 'Columns',
        icon: <Columns3 />,
        submenu: (def.options ?? []).map((o) => ({
          label: optionLabel(o),
          checked: shown.includes(o.value),
          onClick: () => {
            const next = shown.includes(o.value) ? shown.filter((v) => v !== o.value) : (def.options ?? []).map((x) => x.value).filter((v) => v === o.value || shown.includes(v))
            updateBoard(ctl, b.id, { source: { ...src, values: next } })
          }
        }))
      })
    }
  }
  items.push(
    { separator: true },
    {
      label: 'Delete board',
      icon: <Trash2 />,
      danger: true,
      onClick: () =>
        void confirmDialog({ title: 'Delete board?', message: `“${b.name}” will be removed. Its cards and groups stay on the map.`, okLabel: 'Delete', danger: true }).then((ok) => {
          if (ok) deleteBoard(ctl, b.id)
        })
    }
  )
  showContextMenu(e, items)
}

/** a board filter without empty parts (undefined when nothing is left) */
function cleanFilter(f: Board['filter']): Board['filter'] {
  if (!f) return undefined
  const next = { ...f }
  if (!next.tags?.length) delete next.tags
  if (!next.fields || !Object.keys(next.fields).length) delete next.fields
  return Object.keys(next).length ? next : undefined
}

function BoardTools({ ctl, board }: { ctl: FormMapCtl; board: Board }) {
  const meta = ctl.meta
  const tags = board.filter?.tags ?? []
  const fieldFilter = board.filter?.fields ?? {}
  const allTags = Object.keys(meta.tags ?? {}).sort((a, b) => a.localeCompare(b))
  const selects = Object.entries(meta.fields ?? {}).filter(([k, f]) => f.type === 'select' && !(board.source.mode === 'field' && board.source.field === k))
  const setFilter = (patch: Partial<NonNullable<Board['filter']>>): void => updateBoard(ctl, board.id, { filter: cleanFilter({ ...board.filter, ...patch }) })
  const filterMenu = (e: React.MouseEvent): void => {
    const toggle = (t: string): void => setFilter({ tags: tags.includes(t) ? tags.filter((x) => x !== t) : [...tags, t] })
    const setValue = (k: string, v: string): void => {
      const next = { ...fieldFilter }
      if (next[k] === v) delete next[k]
      else next[k] = v
      setFilter({ fields: next })
    }
    const active = tags.length > 0 || Object.keys(fieldFilter).length > 0
    showContextMenu(e, [
      ...allTags.map((t) => ({ label: `#${t}`, checked: tags.includes(t), onClick: () => toggle(t) })),
      ...(!allTags.length ? [{ label: 'No tags on this map yet', disabled: true }] : []),
      ...(selects.length ? [{ separator: true } as MenuItem] : []),
      ...selects.map(([k, f]) => ({
        label: fieldLabel(k, f),
        checked: k in fieldFilter,
        submenu: (f.options ?? []).map((o) => ({ label: optionLabel(o), checked: fieldFilter[k] === o.value, onClick: () => setValue(k, o.value) }))
      })),
      ...(active ? [{ separator: true }, { label: 'Clear filter', icon: <X />, onClick: () => updateBoard(ctl, board.id, { filter: undefined }) }] : [])
    ])
  }
  const reg = meta.fields ?? {}
  return (
    <>
      {tags.map((t) => (
        <TagChip key={t} tag={t} meta={meta} compact onRemove={() => setFilter({ tags: tags.filter((x) => x !== t) })} />
      ))}
      {Object.entries(fieldFilter).map(([k, v]) => (
        <span key={k} className="fm-board-ffilter" title="Field filter">
          {fieldLabel(k, reg[k])}: {optionLabel(reg[k]?.options?.find((o) => o.value === v) ?? { value: String(v) })}
          <button
            className="fm-tag-x"
            aria-label={`Remove the ${k} filter`}
            onClick={() => {
              const { [k]: _drop, ...rest } = fieldFilter
              setFilter({ fields: rest })
            }}
          >
            ×
          </button>
        </span>
      ))}
      <button className={`btn fm-board-filter${tags.length || Object.keys(fieldFilter).length ? ' is-active' : ''}`} onClick={filterMenu} title="Only show cards with these tags / field values">
        <Filter size={13} /> Filter
      </button>
      <button className="clickable-icon small" title="Board menu" aria-label="Board menu" onClick={(e) => boardMenu(e, ctl, board)}>
        <MoreHorizontal />
      </button>
    </>
  )
}

// ---------------------------------------------------------------- setup

function BoardSetup({ ctl, mode, setMode, first, onDone }: { ctl: FormMapCtl; mode: 'groups' | 'field'; setMode: (m: 'groups' | 'field') => void; first: boolean; onDone: (id: string | null) => void }) {
  const gs = useMemo(() => groupsInOrder(ctl.data), [ctl.data])
  const fields = Object.entries(ctl.meta.fields ?? {}).filter(([, f]) => BOARD_FIELD_TYPES.includes(f.type))
  const [picked, setPicked] = useState<string[]>([])
  const [field, setField] = useState<string>(fields.find(([, f]) => f.type === 'select')?.[0] ?? fields[0]?.[0] ?? '')
  const [scope, setScope] = useState<string>('')
  const [name, setName] = useState('')
  const counts = useMemo(() => {
    const m = new Map<string, number>()
    const all = forms(ctl.data)
    for (const g of gs) m.set(g.id, all.filter((c) => c.x + c.width / 2 >= g.x && c.x + c.width / 2 <= g.x + g.width && c.y + c.height / 2 >= g.y && c.y + c.height / 2 <= g.y + g.height).length)
    return m
  }, [ctl.data, gs])

  const create = (): void => {
    if (mode === 'groups') {
      if (!picked.length) return
      const b = newGroupsBoard(ctl.data, picked, name.trim() || undefined)
      onDone(createBoard(ctl, b))
    } else {
      if (!field) return
      const b = newFieldBoard(ctl.data, field, scope || undefined, name.trim() || undefined)
      onDone(createBoard(ctl, b))
    }
  }
  const addStatus = (): void => {
    const key = ctl.meta.fields?.Status ? `Status ${Object.keys(ctl.meta.fields).length}` : 'Status'
    addField(ctl, key, { type: 'select', options: [{ value: 'To do', color: 'gray' }, { value: 'Doing', color: 'blue' }, { value: 'Done', color: 'green' }] })
    setField(key)
  }

  return (
    <div className="fm-board-setup">
      <div className="fm-board-setup-card">
        <div className="fm-board-setup-title">{first ? '📋 Make a board from this map' : '📋 New board'}</div>
        <div className="fm-board-setup-sub">Boards are live views of the canvas: move a card here and it moves there too.</div>
        <div className="fm-seg fm-board-setup-modes" role="tablist">
          <button role="tab" aria-selected={mode === 'groups'} className={mode === 'groups' ? 'is-active' : ''} onClick={() => setMode('groups')}>
            <Columns3 size={13} /> Groups as columns
          </button>
          <button role="tab" aria-selected={mode === 'field'} className={mode === 'field' ? 'is-active' : ''} onClick={() => setMode('field')}>
            <KanbanSquare size={13} /> Split by a field
          </button>
        </div>
        {mode === 'groups' ? (
          gs.length ? (
            <>
              <div className="fm-board-setup-hint">Pick the groups that become columns (left to right as on the canvas). Moving a card between columns moves it between the groups.</div>
              <div className="fm-board-setup-groups">
                {gs.map((g) => (
                  <label key={g.id} className={`fm-board-setup-group${picked.includes(g.id) ? ' is-on' : ''}`}>
                    <input type="checkbox" checked={picked.includes(g.id)} onChange={() => setPicked(picked.includes(g.id) ? picked.filter((x) => x !== g.id) : [...picked, g.id])} />
                    <span className="fm-board-setup-emoji">{g.emoji ?? '▢'}</span>
                    <span className="fm-board-setup-label">{groupTitle(g)}</span>
                    <span className="fm-board-setup-count">{counts.get(g.id) ?? 0}</span>
                  </label>
                ))}
              </div>
            </>
          ) : (
            <div className="fm-board-setup-empty">This map has no groups yet. Add groups on the canvas (or select them and right-click → “Create board from groups”).</div>
          )
        ) : fields.length ? (
          <>
            <div className="fm-board-setup-hint">Columns are the field’s values; moving a card sets the field.</div>
            <div className="fm-board-setup-row">
              <span>Field</span>
              <select className="dropdown" value={field} onChange={(e) => setField(e.target.value)} aria-label="Field">
                {fields.map(([k, f]) => (
                  <option key={k} value={k}>
                    {fieldLabel(k, f)}
                  </option>
                ))}
              </select>
            </div>
            <div className="fm-board-setup-row">
              <span>Cards</span>
              <select className="dropdown" value={scope} onChange={(e) => setScope(e.target.value)} aria-label="Scope">
                <option value="">The whole map</option>
                {gs.map((g) => (
                  <option key={g.id} value={g.id}>
                    In “{groupTitle(g)}”
                  </option>
                ))}
              </select>
            </div>
          </>
        ) : (
          <div className="fm-board-setup-empty">
            No fields a board can split by yet.
            <button className="btn" onClick={addStatus}>
              Add a Status field (To do / Doing / Done)
            </button>
          </div>
        )}
        <div className="fm-board-setup-row">
          <span>Name</span>
          <input className="input" value={name} placeholder="Optional" onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && create()} aria-label="Board name" />
        </div>
        <div className="fm-board-setup-actions">
          {!first && (
            <button className="btn" onClick={() => onDone(null)}>
              Cancel
            </button>
          )}
          <button className="btn mod-cta" disabled={mode === 'groups' ? !picked.length : !field} onClick={create}>
            Create board
          </button>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------- the board

function BoardView({ ctl, board }: { ctl: FormMapCtl; board: Board }) {
  const meta = ctl.meta
  const columns = useMemo(() => boardColumns(ctl.data, board), [ctl.data, board])
  const total = columns.reduce((s, c) => s + c.cards.length, 0)
  const skip = board.source.mode === 'field' ? board.source.field : undefined
  const [limit, setLimit] = useState<Record<string, number>>({})

  const selected = useMemo(() => new Set(ctl.selection), [ctl.selection])
  const dimmed = useMemo(() => {
    const f = ctl.focusFilter
    if (!ctl.highlight && !f?.tags?.length) return null
    const hl = ctl.highlight ? new Set(ctl.highlight) : null
    return (c: FormNode): boolean => (!!hl && !hl.has(c.id)) || (!!f?.tags?.length && !f.tags.some((t) => c.tags?.includes(t)))
  }, [ctl.highlight, ctl.focusFilter])

  // ------------------------------------------------ moves
  const ctlRef = useRef(ctl)
  ctlRef.current = ctl
  const [dropped, setDropped] = useState<string | null>(null)
  const [adding, setAdding] = useState<string | null>(null)
  const move = (id: string, col: BoardColumn, index: number, at?: { clientX: number; clientY: number }): void => {
    if (col.locked) return
    moveOnBoard(ctlRef.current, board.id, id, col.key, index, at)
    setDropped(id)
    setTimeout(() => setDropped((x) => (x === id ? null : x)), 450)
  }

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
    const at = (ev: PointerEvent): { over: string | null; index: number } => {
      const colEl = (document.elementFromPoint(ev.clientX, ev.clientY) as HTMLElement | null)?.closest<HTMLElement>('[data-col]')
      if (!colEl) return { over: null, index: 0 }
      const cards = [...colEl.querySelectorAll<HTMLElement>('[data-card]')].filter((x) => x.dataset.card !== card.id)
      let index = cards.findIndex((x) => {
        const r = x.getBoundingClientRect()
        return ev.clientY < r.top + r.height / 2
      })
      if (index < 0) index = cards.length
      return { over: colEl.dataset.col ?? null, index }
    }
    const moveFn = (ev: PointerEvent): void => {
      if (!started) {
        if (Math.hypot(ev.clientX - sx, ev.clientY - sy) < 5) return
        started = true
        document.body.classList.add('fm-board-dragging')
      }
      const next: DragState = { id: card.id, from: colKey, x: ev.clientX, y: ev.clientY, offX: sx - rect.left, offY: sy - rect.top, width: rect.width, ...at(ev) }
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
    const end = (ev: PointerEvent | null): void => {
      window.removeEventListener('pointermove', moveFn)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('keydown', esc, true)
      document.body.classList.remove('fm-board-dragging')
      const d = dragRef.current
      dragRef.current = null
      setDrag(null)
      if (!ev || !started || !d) return
      suppressClick.current = true
      setTimeout(() => (suppressClick.current = false), 0)
      const col = d.over ? colsRef.current.find((c) => c.key === d.over) : undefined
      if (col) move(d.id, col, d.index, { clientX: ev.clientX, clientY: ev.clientY })
    }
    const up = (ev: PointerEvent): void => end(ev)
    const esc = (ev: KeyboardEvent): void => {
      if (ev.key !== 'Escape') return
      ev.stopPropagation()
      end(null)
    }
    window.addEventListener('pointermove', moveFn)
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
    const rect = (): { clientX: number; clientY: number } => {
      const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
      return { clientX: r.left + r.width / 2, clientY: r.top + 20 }
    }
    if (e.key === 'Escape') {
      e.preventDefault()
      if (ctl.highlight) ctl.setHighlight(null)
      else ctl.setSelection([])
    } else if (e.key === 'Enter') {
      e.preventDefault()
      ctl.reveal([card.id], { select: true })
    } else if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      e.preventDefault()
      move(card.id, col, Math.max(0, ri + (e.key === 'ArrowUp' ? -1 : 1)))
      focusCard(card.id)
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
        if (target && target.key !== col.key && !target.locked) {
          move(card.id, target, target.cards.length, rect())
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

  const cardMenu = (e: React.MouseEvent, card: FormNode, col: BoardColumn): void => {
    if (!selected.has(card.id)) ctl.setSelection([card.id])
    const items: MenuItem[] = [
      { label: 'Reveal in map', icon: <MapPin size={14} />, onClick: () => ctl.reveal([card.id], { select: true }) },
      {
        label: 'Move to',
        icon: <ArrowRightLeft size={14} />,
        submenu: columns.filter((c) => c.key !== col.key && !c.locked).map((c) => ({ label: `${c.emoji ? c.emoji + ' ' : ''}${c.label}`, onClick: () => move(card.id, c, c.cards.length, e) }))
      },
      { label: 'Tags', icon: <Tag size={14} />, submenu: tagMenuItems(meta, card.tags ?? [], (t) => setTags(ctl, card.id, card.tags?.includes(t) ? { remove: [t] } : { add: [t] })) },
      { separator: true },
      { label: 'Vote', icon: <ThumbsUp size={14} />, onClick: () => vote(ctl, card.id, 1) },
      { label: 'Remove vote', icon: <ThumbsDown size={14} />, disabled: !card.votes, onClick: () => vote(ctl, card.id, -1) },
      { separator: true },
      { label: 'Delete', icon: <Trash2 size={14} />, danger: true, onClick: () => deleteNodes(ctl, [card.id]) }
    ]
    showContextMenu(e, items)
  }

  const colMenu = (e: React.MouseEvent, col: BoardColumn): void => {
    const items: MenuItem[] = [
      { label: 'Add card', icon: <Plus size={14} />, disabled: !!col.locked, onClick: () => setAdding(col.key) },
      {
        label: col.wip ? `WIP limit: ${col.wip}…` : 'Set WIP limit…',
        icon: <Gauge size={14} />,
        onClick: () =>
          void promptText({ title: `WIP limit for “${col.label}”`, message: 'Most cards this column should hold (empty = no limit).', initial: col.wip ? String(col.wip) : '', okLabel: 'Set', validate: (v) => (!v.trim() || /^\d+$/.test(v.trim()) ? null : 'A whole number') }).then((v) => {
            if (v === null) return
            const wip = { ...(board.wip ?? {}) }
            if (v.trim() && Number(v) > 0) wip[col.key] = Number(v)
            else delete wip[col.key]
            updateBoard(ctl, board.id, { wip: Object.keys(wip).length ? wip : undefined })
          })
      }
    ]
    if (board.source.mode === 'groups' && col.groupId) {
      const src = board.source
      items.push(
        { label: 'Reveal group', icon: <MapPin size={14} />, onClick: () => ctl.reveal([col.groupId!]) },
        { label: 'Remove column from board', icon: <X size={14} />, disabled: src.groupIds.length < 2, onClick: () => updateBoard(ctl, board.id, { source: { ...src, groupIds: src.groupIds.filter((g) => g !== col.groupId) } }) }
      )
    }
    showContextMenu(e, items)
  }

  const addColumnMenu = (e: React.MouseEvent): void => {
    if (board.source.mode !== 'groups') return
    const src = board.source
    const rest = groupsInOrder(ctl.data).filter((g) => !src.groupIds.includes(g.id))
    showContextMenu(e, rest.length ? rest.map((g) => ({ label: `${g.emoji ?? '▢'}  ${groupTitle(g)}`, onClick: () => updateBoard(ctl, board.id, { source: { ...src, groupIds: [...src.groupIds, g.id] } }) })) : [{ label: 'Every group is already a column', disabled: true }])
  }

  const dragCard = drag ? forms(ctl.data).find((f) => f.id === drag.id) : null
  const reg = meta.fields ?? {}

  if (!columns.length)
    return (
      <div className="fm-board-setup">
        <div className="fm-board-setup-card">
          <div className="fm-board-setup-title">🫙 This board has no columns</div>
          <div className="fm-board-setup-sub">{board.source.mode === 'groups' ? 'Its groups were removed from the map.' : `The field “${board.source.field}” has no values yet.`}</div>
        </div>
      </div>
    )

  return (
    <div className={`fm-board-body${drag ? ' is-dragging' : ''}`} ref={rootRef}>
      <div className="fm-board-scroll" ref={scrollRef}>
        {columns.map((col, ci) => {
          const over = !!drag && drag.over === col.key && !col.locked
          const shown = col.cards.slice(0, limit[col.key] ?? PAGE)
          const placeholderAt = over ? Math.min(drag!.index, shown.filter((c) => c.id !== drag!.id).length) : -1
          let r = -1
          return (
            <section key={col.key} className={`fm-col${over ? ' is-drop-target' : ''}${col.locked ? ' is-locked' : ''}`} data-col={col.key} style={{ '--fm-col-color': col.color ?? 'var(--background-modifier-border-focus)' } as React.CSSProperties}>
              <header className="fm-col-head" onContextMenu={(e) => colMenu(e, col)}>
                {col.emoji ? <span className="fm-col-emoji">{col.emoji}</span> : <span className="fm-col-dot" />}
                <span className="fm-col-label" title={col.hint ?? col.label}>
                  {col.label}
                </span>
                <span className={`fm-col-count${col.wip && col.cards.length > col.wip ? ' is-over' : ''}`} title={col.wip ? `WIP limit ${col.wip}` : `${col.cards.length} cards`}>
                  {col.cards.length}
                  {col.wip ? `/${col.wip}` : ''}
                </span>
                <span className="fm-toolbar-spacer" />
                {!col.locked && (
                  <button className="clickable-icon small fm-col-add" title={`Add a card to “${col.label}”`} onClick={() => setAdding(col.key)}>
                    <Plus />
                  </button>
                )}
                <button className="clickable-icon small fm-col-menu" title="Column menu" onClick={(e) => colMenu(e, col)}>
                  <MoreHorizontal />
                </button>
              </header>
              <div className="fm-col-body">
                {shown.map((card) => {
                  if (card.id !== drag?.id) r++
                  const ri = r
                  return (
                    <div key={card.id} className="fm-col-slot">
                      {placeholderAt === ri && card.id !== drag?.id && <div className="fm-col-placeholder" />}
                      <BoardCard
                        card={card}
                        meta={meta}
                        skip={skip}
                        selected={selected.has(card.id)}
                        dim={!selected.has(card.id) && (dimmed?.(card) ?? false)}
                        dragging={drag?.id === card.id}
                        dropped={dropped === card.id}
                        onPointerDown={(e) => onCardPointerDown(e, card, col.key)}
                        onClick={(e) => select(e, card.id)}
                        onDoubleClick={() => ctl.reveal([card.id], { select: true })}
                        onKeyDown={(e) => onCardKey(e, card, ci, col.cards.indexOf(card))}
                        onFocus={() => {
                          if (!pointerFocus.current && !selected.has(card.id)) ctl.setSelection([card.id])
                        }}
                        onContextMenu={(e) => cardMenu(e, card, col)}
                      />
                    </div>
                  )
                })}
                {over && placeholderAt >= shown.filter((c) => c.id !== drag!.id).length && <div className="fm-col-placeholder" />}
                {col.cards.length > shown.length && (
                  <button className="fm-col-addrow" onClick={() => setLimit({ ...limit, [col.key]: shown.length + PAGE })}>
                    Show {Math.min(PAGE, col.cards.length - shown.length)} more of {col.cards.length - shown.length}
                  </button>
                )}
                {!col.cards.length && !over && (
                  <div className="fm-col-empty">
                    <div className="fm-col-empty-emoji">{col.emoji ?? '🫙'}</div>
                    <div>{col.hint ?? 'Nothing here yet.'}</div>
                    {!col.locked && <div className="fm-col-empty-sub">Drag a card here or add one.</div>}
                  </div>
                )}
                {!col.locked && <QuickAdd ctl={ctl} board={board} col={col} open={adding === col.key} setOpen={(o) => setAdding(o ? col.key : null)} />}
              </div>
            </section>
          )
        })}
        {board.source.mode === 'groups' && (
          <button className="fm-col-new" onClick={addColumnMenu} title="Add a group as a column">
            <Plus size={14} /> Column
          </button>
        )}
      </div>
      <div className="fm-board-foot">
        {total} card{total === 1 ? '' : 's'}
        {board.source.mode === 'groups' ? ' · columns are groups on the canvas' : ` · by ${fieldLabel(board.source.field, reg[board.source.field]).toLowerCase()}`}
      </div>
      {drag && dragCard && (
        <div className="fm-board-ghost" style={{ left: drag.x - drag.offX, top: drag.y - drag.offY, width: drag.width }}>
          <BoardCardBody card={dragCard} meta={meta} skip={skip} />
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------- cards

interface BoardCardProps {
  card: FormNode
  meta: FormMapMeta
  skip?: string
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
}

function BoardCard(p: BoardCardProps) {
  const state = cardState(p.card, p.meta.fields ?? {})
  const cls = ['fm-bcard', p.selected && 'is-selected', p.dim && 'is-dim', p.dragging && 'is-dragging', p.dropped && 'is-dropped', state === 'win' && 'is-done', state === 'muted' && 'is-muted'].filter(Boolean).join(' ')
  const accent = cardAccent(p.card, p.meta)
  return (
    <div
      className={cls}
      data-card={p.card.id}
      tabIndex={0}
      role="button"
      aria-label={cardTitle(p.card)}
      aria-pressed={p.selected}
      style={accent ? ({ '--fm-card-color': accent } as React.CSSProperties) : undefined}
      onPointerDown={p.onPointerDown}
      onClick={p.onClick}
      onDoubleClick={p.onDoubleClick}
      onKeyDown={p.onKeyDown}
      onFocus={p.onFocus}
      onContextMenu={p.onContextMenu}
    >
      <BoardCardBody card={p.card} meta={p.meta} skip={p.skip} />
    </div>
  )
}

function BoardCardBody({ card, meta, skip }: { card: FormNode; meta: FormMapMeta; skip?: string }) {
  const reg = meta.fields ?? {}
  const excerpt = (card.text ?? '').replace(/[#*_`>[\]]/g, '').trim()
  const showExcerpt = excerpt && excerpt !== card.title?.trim()
  const checklist = Object.entries(card.fields).find(([k, v]) => reg[k]?.type === 'checklist' && Array.isArray(v) && v.length)?.[1] as ChecklistItem[] | undefined
  const tags = card.tags ?? []
  return (
    <>
      <div className="fm-bcard-top">
        <div className="fm-bcard-title">{cardTitle(card)}</div>
        {cardState(card, reg) === 'win' && <Check className="fm-bcard-check" size={14} strokeWidth={3} />}
        <VoteBadge votes={card.votes} />
      </div>
      {showExcerpt && <div className="fm-bcard-text">{excerpt}</div>}
      <div className="fm-bcard-chips">
        {tags.map((t) => (
          <TagChip key={t} tag={t} meta={meta} compact />
        ))}
        <FieldChips fields={card.fields} reg={reg} skip={skip} max={4} />
        {checklist && <span className="fm-bcard-ac">☑ {checklist.filter((i) => i?.done).length}/{checklist.length}</span>}
      </div>
    </>
  )
}

// ---------------------------------------------------------------- quick add

function QuickAdd({ ctl, board, col, open, setOpen }: { ctl: FormMapCtl; board: Board; col: BoardColumn; open: boolean; setOpen: (open: boolean) => void }) {
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
    const id = addCardToColumn(ctl, board, col, title)
    ctl.setSelection([id])
    // keep the input open for rapid capture
    setText('')
  }

  if (!open)
    return (
      <button className="fm-col-addrow" onClick={() => setOpen(true)}>
        <Plus size={13} /> Add card
      </button>
    )
  return (
    <div className="fm-quickadd">
      <textarea
        ref={ref}
        className="fm-quickadd-input"
        rows={2}
        value={text}
        placeholder="Title… (Enter to add, Esc to close)"
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
