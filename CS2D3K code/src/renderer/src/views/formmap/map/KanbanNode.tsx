// Embedded kanban node: a self-contained board on the canvas (its own columns and cards).
// Cards drag within and between columns (and kanban nodes), out onto the canvas (they become canvas cards), and canvas
// cards drop into its columns (MapLens). Columns can be added, renamed, recolored, collapsed, reordered (drag the
// header) and deleted. Zoomed out it renders a light placeholder; the engine culls it like any node.
import { memo, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Check, ChevronsLeftRight, MoreHorizontal, Plus, Trash2, Pencil, ArrowLeft, ArrowRight, Shapes, Palette, ExternalLink, Tag as TagIcon, Columns3 } from 'lucide-react'
import type { NodeBodyProps, NodeTypeDef } from '../../canvas/engine'
import { colorCss } from '../../canvas/model'
import { hexId } from '@/lib/util'
import { confirmDialog, showContextMenu, type MenuItem } from '@/store/ui'
import { cardTitle, fmColor, tagColor, type KanbanCard, type KanbanColumn, type KanbanNode, type FormMapMeta } from '../schema'
import {
  addKanbanColumn,
  deleteKanbanCard,
  deleteKanbanColumn,
  insertKanbanCard,
  kanbanCount,
  moveKanbanCard,
  moveKanbanColumn,
  updateKanbanCard,
  updateKanbanColumn
} from '../kanban'
import { colorItems, FieldChips, tagMenuItems, TagChip } from '../lenses/widgets'
import { celebrate } from '../fun/celebrate'
import { useMapActions, useMeta } from './mapContext'

type CssVars = React.CSSProperties & Record<`--${string}`, string>

const KanbanBody = memo(function KanbanBody({ node, selected, editing, api, lod }: NodeBodyProps) {
  const k = node as KanbanNode
  if (lod) return <KanbanLod k={k} />
  return <KanbanBoard k={k} selected={selected} editing={editing} api={api} />
})

export const KANBAN_NODE: NodeTypeDef = { Body: KanbanBody, bare: true, editable: true, className: () => 'fm-node-kanban' }

/** zoomed out: title + column headers with counts, no cards */
/** cards shown per column while zoomed out (placeholders stay cheap) */
const LOD_STUBS = 6

function KanbanLod({ k }: { k: KanbanNode }) {
  return (
    <div className="fm-kb is-lod">
      <div className="fm-kb-head">
        <span className="fm-kb-icon">📋</span>
        <span className="fm-kb-title">{k.title?.trim() || 'Kanban'}</span>
      </div>
      <div className="fm-kb-cols">
        {k.columns.map((c) => (
          <div key={c.id} className={`fm-kb-col${c.collapsed ? ' is-collapsed' : ''}`} style={{ '--kb-color': fmColor(c.color) ?? 'var(--text-faint)' } as CssVars}>
            <div className="fm-kb-col-head">
              <span className="fm-kb-col-title">{c.title || 'Column'}</span>
              <span className="fm-kb-col-count">{c.cards.length}</span>
            </div>
            <div className="fm-kb-stubs">
              {c.cards.slice(0, LOD_STUBS).map((card) => (
                <div key={card.id} className={`fm-kb-stub${card.done ? ' is-done' : ''}`}>
                  {card.title || 'Untitled'}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------- drag state

type Target = { type: 'col'; kanbanId: string; colId: string; index: number; line: { x: number; y: number; w: number } } | { type: 'canvas' } | null

interface CardDrag {
  kind: 'card'
  cardId: string
  fromCol: string
  x: number
  y: number
  offX: number
  offY: number
  width: number
  target: Target
}
interface ColDrag {
  kind: 'col'
  colId: string
  x: number
  y: number
  index: number
  line: { x: number; y: number; h: number } | null
}
type Drag = CardDrag | ColDrag

const NO_DRAG_FROM = 'button, input, textarea, [data-no-drag]'

/** The drop target under a screen point for a card being dragged out of `nodeEl`. */
function cardTarget(cx: number, cy: number, cardId: string, nodeEl: HTMLElement): Target {
  const els = document.elementsFromPoint(cx, cy) as HTMLElement[]
  const colEl = els.find((e) => e.dataset?.kanbanCol)
  if (colEl) {
    const list = colEl.querySelector<HTMLElement>('[data-kanban-list]')
    const cards = list ? [...list.querySelectorAll<HTMLElement>('[data-kcard]')].filter((e) => e.dataset.kcard !== cardId) : []
    let index = cards.findIndex((e) => {
      const r = e.getBoundingClientRect()
      return cy < r.top + r.height / 2
    })
    if (index < 0) index = cards.length
    const lr = (list ?? colEl).getBoundingClientRect()
    const y = index < cards.length ? cards[index].getBoundingClientRect().top - 5 : cards.length ? cards[cards.length - 1].getBoundingClientRect().bottom + 4 : lr.top + 6
    return { type: 'col', kanbanId: colEl.dataset.kanban!, colId: colEl.dataset.kanbanCol!, index, line: { x: lr.left + 6, y, w: lr.width - 12 } }
  }
  const canvas = nodeEl.closest('.canvas-view')
  if (canvas && els.includes(canvas as HTMLElement) && !els.some((e) => e.closest?.('[data-canvas-ui]'))) return { type: 'canvas' }
  return null
}

// ---------------------------------------------------------------- board

function KanbanBoard({ k, selected, editing, api }: { k: KanbanNode; selected: boolean; editing: boolean; api: NodeBodyProps['api'] }) {
  const actions = useMapActions()
  const meta = useMeta()
  const rootRef = useRef<HTMLDivElement>(null)
  const colsRef = useRef<HTMLDivElement>(null)
  const [drag, setDrag] = useState<Drag | null>(null)
  const dragRef = useRef<Drag | null>(null)
  const [editCard, setEditCard] = useState<string | null>(null)
  const [adding, setAdding] = useState<string | null>(null)
  const [renaming, setRenaming] = useState<string | null>(null)
  const kRef = useRef(k)
  kRef.current = k

  const update = (fn: (x: KanbanNode) => KanbanNode, history?: string): void => actions.kanban.update(k.id, fn, history)
  const count = kanbanCount(k)

  // ------------------------------------------------ card drag
  const onCardPointerDown = (e: React.PointerEvent, card: KanbanCard, col: KanbanColumn): void => {
    if (e.button !== 0 || (e.target as HTMLElement).closest(NO_DRAG_FROM) || editCard === card.id) return
    const el = e.currentTarget as HTMLElement
    const rect = el.getBoundingClientRect()
    const sx = e.clientX
    const sy = e.clientY
    let started = false
    const move = (ev: PointerEvent): void => {
      if (!started) {
        if (Math.hypot(ev.clientX - sx, ev.clientY - sy) < 5) return
        started = true
        document.body.classList.add('fm-kb-dragging')
      }
      const target = cardTarget(ev.clientX, ev.clientY, card.id, rootRef.current!)
      const next: CardDrag = { kind: 'card', cardId: card.id, fromCol: col.id, x: ev.clientX, y: ev.clientY, offX: sx - rect.left, offY: sy - rect.top, width: rect.width, target }
      dragRef.current = next
      setDrag(next)
      autoScroll(ev.clientX)
    }
    const end = (ev: PointerEvent | null): void => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('keydown', esc, true)
      document.body.classList.remove('fm-kb-dragging')
      const d = dragRef.current
      dragRef.current = null
      setDrag(null)
      if (!ev || !started || !d || d.kind !== 'card' || !d.target) return
      const t = d.target
      if (t.type === 'canvas') actions.kanban.cardOut(k.id, card.id, ev.clientX, ev.clientY)
      else if (t.kanbanId === k.id) {
        const last = kRef.current.columns.at(-1)?.id
        update((x) => moveKanbanCard(x, card.id, t.colId, t.index))
        if (t.colId === last && d.fromCol !== last) celebrate(ev.clientX, ev.clientY)
      } else actions.kanban.cardAcross(k.id, card.id, t.kanbanId, t.colId, t.index, { clientX: ev.clientX, clientY: ev.clientY })
    }
    const up = (ev: PointerEvent): void => end(ev)
    const esc = (ev: KeyboardEvent): void => {
      if (ev.key !== 'Escape') return
      ev.stopPropagation()
      end(null)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('keydown', esc, true)
  }

  // ------------------------------------------------ column drag (reorder by the header)
  const onColPointerDown = (e: React.PointerEvent, col: KanbanColumn): void => {
    if (e.button !== 0 || (e.target as HTMLElement).closest(NO_DRAG_FROM) || renaming === col.id) return
    const sx = e.clientX
    const sy = e.clientY
    let started = false
    const target = (cx: number): { index: number; line: ColDrag['line'] } => {
      const els = [...(colsRef.current?.querySelectorAll<HTMLElement>(':scope > [data-kanban-col]') ?? [])].filter((x) => x.dataset.kanbanCol !== col.id)
      let index = els.findIndex((x) => {
        const r = x.getBoundingClientRect()
        return cx < r.left + r.width / 2
      })
      if (index < 0) index = els.length
      const ref = els[index] ?? els[els.length - 1]
      if (!ref) return { index: 0, line: null }
      const r = ref.getBoundingClientRect()
      return { index, line: { x: index < els.length ? r.left - 6 : r.right + 4, y: r.top, h: r.height } }
    }
    const move = (ev: PointerEvent): void => {
      if (!started) {
        if (Math.hypot(ev.clientX - sx, ev.clientY - sy) < 5) return
        started = true
        document.body.classList.add('fm-kb-dragging')
      }
      const t = target(ev.clientX)
      const next: ColDrag = { kind: 'col', colId: col.id, x: ev.clientX, y: ev.clientY, ...t }
      dragRef.current = next
      setDrag(next)
      autoScroll(ev.clientX)
    }
    const end = (commit: boolean): void => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('keydown', esc, true)
      document.body.classList.remove('fm-kb-dragging')
      const d = dragRef.current
      dragRef.current = null
      setDrag(null)
      if (commit && started && d?.kind === 'col') update((x) => moveKanbanColumn(x, col.id, d.index))
    }
    const up = (): void => end(true)
    const esc = (ev: KeyboardEvent): void => {
      if (ev.key !== 'Escape') return
      ev.stopPropagation()
      end(false)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('keydown', esc, true)
  }

  const autoScroll = (cx: number): void => {
    const sc = colsRef.current
    if (!sc) return
    const r = sc.getBoundingClientRect()
    if (cx < r.left + 40) sc.scrollLeft -= 12
    else if (cx > r.right - 40) sc.scrollLeft += 12
  }

  // ------------------------------------------------ menus
  const deleteColumn = async (col: KanbanColumn): Promise<void> => {
    if (col.cards.length) {
      const ok = await confirmDialog({ title: 'Delete column?', message: `“${col.title || 'Column'}” and its ${col.cards.length} card${col.cards.length === 1 ? '' : 's'} will be deleted.`, okLabel: 'Delete', danger: true })
      if (!ok) return
    }
    update((x) => deleteKanbanColumn(x, col.id))
  }
  const addColumn = (index?: number): void => {
    let id = ''
    update((x) => {
      const r = addKanbanColumn(x, 'New column', index)
      id = r.id
      return r.node
    })
    setRenaming(id)
    requestAnimationFrame(() => colsRef.current?.querySelector(`[data-kanban-col="${id}"]`)?.scrollIntoView({ inline: 'nearest', block: 'nearest' }))
  }

  const colMenu = (e: React.MouseEvent, col: KanbanColumn, i: number): void => {
    showContextMenu(e, [
      { label: 'Add card', icon: <Plus />, onClick: () => setAdding(col.id) },
      { label: 'Rename', icon: <Pencil />, onClick: () => setRenaming(col.id) },
      { label: col.collapsed ? 'Expand' : 'Collapse', icon: <ChevronsLeftRight />, onClick: () => update((x) => updateKanbanColumn(x, col.id, { collapsed: !col.collapsed })) },
      { label: 'Color', icon: <Palette />, submenu: colorItems(col.color, (c) => update((x) => updateKanbanColumn(x, col.id, { color: c }))) },
      { separator: true },
      { label: 'Move left', icon: <ArrowLeft />, disabled: i === 0, onClick: () => update((x) => moveKanbanColumn(x, col.id, i - 1)) },
      { label: 'Move right', icon: <ArrowRight />, disabled: i === k.columns.length - 1, onClick: () => update((x) => moveKanbanColumn(x, col.id, i + 1)) },
      { label: 'Add column after', icon: <Columns3 />, onClick: () => addColumn(i + 1) },
      { separator: true },
      { label: 'Delete column', icon: <Trash2 />, danger: true, onClick: () => void deleteColumn(col) }
    ])
  }

  const cardMenu = (e: React.MouseEvent, card: KanbanCard, col: KanbanColumn): void => {
    const r = rootRef.current!.getBoundingClientRect()
    const items: MenuItem[] = [
      { label: 'Edit', icon: <Pencil />, hint: 'Enter', onClick: () => setEditCard(card.id) },
      { label: card.done ? 'Mark not done' : 'Mark done', icon: <Check />, onClick: () => toggleDone(card, e) },
      { label: 'Move to', icon: <Shapes />, submenu: k.columns.filter((c) => c.id !== col.id).map((c) => ({ label: c.title || 'Column', onClick: () => update((x) => moveKanbanCard(x, card.id, c.id, Infinity)) })) },
      { label: 'Tags', icon: <TagIcon />, submenu: tagMenuItems(meta, card.tags ?? [], (t) => update((x) => updateKanbanCard(x, card.id, { tags: card.tags?.includes(t) ? card.tags.filter((y) => y !== t) : [...(card.tags ?? []), t] }))) },
      { label: 'Move to canvas', icon: <ExternalLink />, onClick: () => actions.kanban.cardOut(k.id, card.id, r.right + 170, r.top + 90) },
      { separator: true },
      { label: 'Delete card', icon: <Trash2 />, danger: true, hint: 'Del', onClick: () => update((x) => deleteKanbanCard(x, card.id)) }
    ]
    showContextMenu(e, items)
  }

  const toggleDone = (card: KanbanCard, e?: { clientX: number; clientY: number }): void => {
    update((x) => updateKanbanCard(x, card.id, { done: !card.done || undefined }))
    if (!card.done && e) celebrate(e.clientX, e.clientY)
  }

  const nodeMenu = (e: React.MouseEvent): void => {
    showContextMenu(e, [
      { label: 'Add column', icon: <Columns3 />, onClick: () => addColumn() },
      { label: 'Rename board', icon: <Pencil />, onClick: () => api.setEditing(k.id) },
      { label: 'Convert to groups', icon: <Shapes />, onClick: () => actions.kanban.convertToGroups(k.id) }
    ])
  }

  // ------------------------------------------------ keyboard on a focused card
  const onCardKey = (e: React.KeyboardEvent, card: KanbanCard, col: KanbanColumn, ci: number, ri: number): void => {
    if (editCard === card.id) return
    const handled = (): void => {
      e.preventDefault()
      e.stopPropagation()
    }
    const focus = (id: string): void => void requestAnimationFrame(() => rootRef.current?.querySelector<HTMLElement>(`[data-kcard="${id}"]`)?.focus())
    if (e.key === 'Enter') {
      handled()
      setEditCard(card.id)
    } else if (e.key === 'Delete' || e.key === 'Backspace') {
      handled()
      update((x) => deleteKanbanCard(x, card.id))
    } else if (e.key === ' ' || e.key === 'x') {
      handled()
      const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
      toggleDone(card, { clientX: r.left + 12, clientY: r.top + 12 })
    } else if ((e.shiftKey || e.altKey) && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
      handled()
      const to = k.columns[ci + (e.key === 'ArrowLeft' ? -1 : 1)]
      if (!to) return
      update((x) => moveKanbanCard(x, card.id, to.id, ri))
      if (to.id === k.columns.at(-1)?.id) {
        const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
        celebrate(r.right, r.top)
      }
      focus(card.id)
    } else if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      handled()
      update((x) => moveKanbanCard(x, card.id, col.id, Math.max(0, ri + (e.key === 'ArrowUp' ? -1 : 1))))
      focus(card.id)
    } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      handled()
      const next = col.cards[ri + (e.key === 'ArrowUp' ? -1 : 1)]
      if (next) focus(next.id)
    } else if (e.key === 'Escape') {
      handled()
      ;(e.currentTarget as HTMLElement).blur()
      api.focusCanvas()
    }
  }

  const dragCard = drag?.kind === 'card' ? k.columns.flatMap((c) => c.cards).find((c) => c.id === drag.cardId) : undefined

  return (
    <div className={`fm-kb${selected ? ' is-selected' : ''}${drag ? ' is-dragging' : ''}`} ref={rootRef}>
      <div className="fm-kb-head">
        <span className="fm-kb-icon">📋</span>
        {editing ? <TitleInput k={k} api={api} /> : <span className={`fm-kb-title${k.title?.trim() ? '' : ' is-empty'}`}>{k.title?.trim() || 'Kanban'}</span>}
        <span className="fm-kb-meta">
          {k.columns.length} col{k.columns.length === 1 ? '' : 's'} · {count} card{count === 1 ? '' : 's'}
        </span>
        <span className="fm-spacer" />
        <button className="fm-kb-btn" data-interactive title="Add column" aria-label="Add column" onClick={() => addColumn()}>
          <Plus size={14} />
        </button>
        <button className="fm-kb-btn" data-interactive title="Board menu" aria-label="Board menu" onClick={nodeMenu}>
          <MoreHorizontal size={14} />
        </button>
      </div>
      <div className="fm-kb-cols" ref={colsRef} data-interactive>
        {k.columns.map((col, ci) => (
          <Column
            key={col.id}
            k={k}
            col={col}
            meta={meta}
            dragging={drag?.kind === 'card' ? drag.cardId : null}
            colDragging={drag?.kind === 'col' && drag.colId === col.id}
            over={drag?.kind === 'card' && drag.target?.type === 'col' && drag.target.kanbanId === k.id && drag.target.colId === col.id}
            renaming={renaming === col.id}
            setRenaming={(on) => setRenaming(on ? col.id : null)}
            adding={adding === col.id}
            setAdding={(on) => setAdding(on ? col.id : null)}
            editCard={editCard}
            setEditCard={setEditCard}
            onHeadPointerDown={(e) => onColPointerDown(e, col)}
            onMenu={(e) => colMenu(e, col, ci)}
            onCardPointerDown={(e, card) => onCardPointerDown(e, card, col)}
            onCardMenu={(e, card) => cardMenu(e, card, col)}
            onCardKey={(e, card, ri) => onCardKey(e, card, col, ci, ri)}
            onToggleDone={toggleDone}
            update={update}
          />
        ))}
        <button className="fm-kb-addcol" onClick={() => addColumn()} title="Add column">
          <Plus size={14} /> Column
        </button>
      </div>
      {drag &&
        createPortal(
          drag.kind === 'card' ? (
            <>
              {dragCard && (
                <div className={`fm-kb-ghost${drag.target?.type === 'canvas' ? ' is-out' : ''}`} style={{ left: drag.x - drag.offX, top: drag.y - drag.offY, width: drag.width }}>
                  <div className="fm-kb-card-title">{cardTitle(dragCard)}</div>
                  {drag.target?.type === 'canvas' && <div className="fm-kb-ghost-hint">Drop to place on the canvas</div>}
                </div>
              )}
              {drag.target?.type === 'col' && <div className="fm-kb-dropline" style={{ left: drag.target.line.x, top: drag.target.line.y, width: drag.target.line.w }} />}
            </>
          ) : (
            drag.line && <div className="fm-kb-dropline is-vertical" style={{ left: drag.line.x, top: drag.line.y, height: drag.line.h }} />
          ),
          document.body
        )}
    </div>
  )
}

function TitleInput({ k, api }: { k: KanbanNode; api: NodeBodyProps['api'] }) {
  const [v, setV] = useState(k.title ?? '')
  const done = useRef(false)
  const finish = (save: boolean): void => {
    if (done.current) return
    done.current = true
    if (save && v.trim() !== (k.title ?? '')) api.updateNode(k.id, { title: v.trim() || 'Kanban' })
    api.setEditing(null)
    api.focusCanvas()
  }
  return (
    <input
      className="fm-kb-title-input"
      data-interactive
      autoFocus
      value={v}
      placeholder="Board name"
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

// ---------------------------------------------------------------- column

interface ColumnProps {
  k: KanbanNode
  col: KanbanColumn
  meta: FormMapMeta
  dragging: string | null
  colDragging: boolean
  over: boolean
  renaming: boolean
  setRenaming(on: boolean): void
  adding: boolean
  setAdding(on: boolean): void
  editCard: string | null
  setEditCard(id: string | null): void
  onHeadPointerDown(e: React.PointerEvent): void
  onMenu(e: React.MouseEvent): void
  onCardPointerDown(e: React.PointerEvent, card: KanbanCard): void
  onCardMenu(e: React.MouseEvent, card: KanbanCard): void
  onCardKey(e: React.KeyboardEvent, card: KanbanCard, ri: number): void
  onToggleDone(card: KanbanCard, e?: { clientX: number; clientY: number }): void
  update(fn: (x: KanbanNode) => KanbanNode, history?: string): void
}

function Column(p: ColumnProps) {
  const { k, col } = p
  const color = fmColor(col.color) ?? 'var(--text-faint)'
  if (col.collapsed)
    return (
      <section className={`fm-kb-col is-collapsed${p.over ? ' is-over' : ''}`} data-kanban-col={col.id} data-kanban={k.id} style={{ '--kb-color': color } as CssVars}>
        <button className="fm-kb-collapsed" title={`Expand “${col.title}”`} onClick={() => p.update((x) => updateKanbanColumn(x, col.id, { collapsed: false }))} onContextMenu={p.onMenu}>
          <span className="fm-kb-col-count">{col.cards.length}</span>
          <span className="fm-kb-collapsed-title">{col.title || 'Column'}</span>
        </button>
        <div data-kanban-list />
      </section>
    )
  return (
    <section className={`fm-kb-col${p.over ? ' is-over' : ''}${p.colDragging ? ' is-dragging' : ''}`} data-kanban-col={col.id} data-kanban={k.id} style={{ '--kb-color': color } as CssVars}>
      <header className="fm-kb-col-head" onPointerDown={p.onHeadPointerDown} onDoubleClick={() => p.setRenaming(true)} onContextMenu={p.onMenu}>
        <span className="fm-kb-col-dot" />
        {p.renaming ? (
          <ColumnTitleInput
            value={col.title}
            onDone={(v) => {
              p.setRenaming(false)
              if (v !== null && v !== col.title) p.update((x) => updateKanbanColumn(x, col.id, { title: v || col.title || 'Column' }))
            }}
          />
        ) : (
          <span className="fm-kb-col-title" title="Drag to reorder · double-click to rename">
            {col.title || 'Column'}
          </span>
        )}
        <span className="fm-kb-col-count">{col.cards.length}</span>
        <span className="fm-spacer" />
        <button className="fm-kb-btn" title="Add card" aria-label={`Add card to ${col.title}`} onClick={() => p.setAdding(true)}>
          <Plus size={13} />
        </button>
        <button className="fm-kb-btn" title="Column menu" aria-label={`${col.title} menu`} onClick={p.onMenu}>
          <MoreHorizontal size={13} />
        </button>
      </header>
      <div className="fm-kb-list" data-kanban-list>
        {col.cards.map((card, ri) =>
          p.editCard === card.id ? (
            <CardEditor
              key={card.id}
              card={card}
              onDone={(patch) => {
                p.setEditCard(null)
                if (patch) p.update((x) => updateKanbanCard(x, card.id, patch))
              }}
            />
          ) : (
            <Card
              key={card.id}
              card={card}
              meta={p.meta}
              dragging={p.dragging === card.id}
              onPointerDown={(e) => p.onCardPointerDown(e, card)}
              onDoubleClick={() => p.setEditCard(card.id)}
              onContextMenu={(e) => p.onCardMenu(e, card)}
              onKeyDown={(e) => p.onCardKey(e, card, ri)}
              onToggleDone={(e) => p.onToggleDone(card, e)}
            />
          )
        )}
        {p.adding ? (
          <AddCard
            onAdd={(title) => p.update((x) => insertKanbanCard(x, col.id, { id: hexId(), title }))}
            onClose={() => p.setAdding(false)}
          />
        ) : (
          <button className="fm-kb-add" onClick={() => p.setAdding(true)}>
            <Plus size={12} /> Add card
          </button>
        )}
      </div>
    </section>
  )
}

function ColumnTitleInput({ value, onDone }: { value: string; onDone: (v: string | null) => void }) {
  const [v, setV] = useState(value)
  const done = useRef(false)
  const finish = (r: string | null): void => {
    if (done.current) return
    done.current = true
    onDone(r === null ? null : r.trim())
  }
  return (
    <input
      className="fm-kb-col-input"
      autoFocus
      value={v}
      onChange={(e) => setV(e.target.value)}
      onFocus={(e) => e.currentTarget.select()}
      onBlur={() => finish(v)}
      onPointerDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation()
        if (e.key === 'Enter') finish(v)
        else if (e.key === 'Escape') finish(null)
      }}
    />
  )
}

// ---------------------------------------------------------------- cards

interface CardProps {
  card: KanbanCard
  meta: FormMapMeta
  dragging: boolean
  onPointerDown(e: React.PointerEvent): void
  onDoubleClick(): void
  onContextMenu(e: React.MouseEvent): void
  onKeyDown(e: React.KeyboardEvent): void
  onToggleDone(e: React.MouseEvent): void
}

function Card({ card, meta, dragging, onPointerDown, onDoubleClick, onContextMenu, onKeyDown, onToggleDone }: CardProps) {
  const accent = colorCss(card.color) ?? (card.tags?.length ? tagColor(meta, card.tags[0]) : undefined)
  const text = (card.text ?? '').replace(/[#*_`>[\]]/g, '').trim()
  const hasChips = !!card.tags?.length || !!(card.fields && Object.keys(card.fields).length)
  return (
    <div
      className={`fm-kb-card${card.done ? ' is-done' : ''}${dragging ? ' is-dragging' : ''}${accent ? ' has-accent' : ''}`}
      data-kcard={card.id}
      tabIndex={0}
      role="button"
      aria-label={cardTitle(card)}
      style={accent ? ({ '--kb-accent': accent } as CssVars) : undefined}
      onPointerDown={onPointerDown}
      onDoubleClick={(e) => {
        e.stopPropagation()
        onDoubleClick()
      }}
      onContextMenu={onContextMenu}
      onKeyDown={onKeyDown}
    >
      <div className="fm-kb-card-top">
        <button className={`fm-kb-check${card.done ? ' is-on' : ''}`} title={card.done ? 'Done — click to reopen' : 'Mark done'} aria-label="Done" aria-pressed={!!card.done} onClick={onToggleDone}>
          {card.done && <Check size={10} strokeWidth={3.5} />}
        </button>
        <div className={`fm-kb-card-title${card.title?.trim() ? '' : ' is-untitled'}`}>{cardTitle(card)}</div>
        {!!card.votes && (
          <span className="fm-vote-badge">
            <span className="fm-vote-dot" />
            {card.votes}
          </span>
        )}
      </div>
      {text && text !== card.title?.trim() && <div className="fm-kb-card-text">{text}</div>}
      {hasChips && (
        <div className="fm-kb-card-chips">
          {card.tags?.map((t) => <TagChip key={t} tag={t} meta={meta} compact />)}
          <FieldChips fields={card.fields} reg={meta.fields ?? {}} max={3} />
        </div>
      )}
    </div>
  )
}

function CardEditor({ card, onDone }: { card: KanbanCard; onDone: (patch: Partial<KanbanCard> | null) => void }) {
  const [title, setTitle] = useState(card.title)
  const [text, setText] = useState(card.text ?? '')
  const done = useRef(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const textRef = useRef<HTMLTextAreaElement>(null)
  const finish = (save: boolean): void => {
    if (done.current) return
    done.current = true
    onDone(save && (title !== card.title || text !== (card.text ?? '')) ? { title: title.trim(), text: text.trim() ? text : undefined } : null)
  }
  useLayoutEffect(() => {
    const el = textRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(160, el.scrollHeight)}px`
  }, [text])
  const keys = (e: React.KeyboardEvent): void => {
    e.stopPropagation()
    if (e.key === 'Escape') {
      e.preventDefault()
      finish(false)
    } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault()
      finish(true)
    }
  }
  return (
    <div
      className="fm-kb-card is-editing"
      ref={rootRef}
      onBlur={(e) => {
        if (!rootRef.current?.contains(e.relatedTarget as Node | null)) finish(true)
      }}
    >
      <input
        className="fm-kb-edit-title"
        autoFocus
        value={title}
        placeholder="Card title"
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => {
          keys(e)
          if (e.key === 'Enter' && !e.ctrlKey && !e.metaKey) {
            e.preventDefault()
            finish(true)
          }
        }}
      />
      <textarea ref={textRef} className="fm-kb-edit-text" rows={2} value={text} placeholder="Notes (markdown) — Ctrl+Enter to save" onChange={(e) => setText(e.target.value)} onKeyDown={keys} />
    </div>
  )
}

function AddCard({ onAdd, onClose }: { onAdd: (title: string) => void; onClose: () => void }) {
  const [v, setV] = useState('')
  const ref = useRef<HTMLTextAreaElement>(null)
  useEffect(() => {
    ref.current?.focus({ preventScroll: true })
    ref.current?.scrollIntoView({ block: 'nearest' })
  }, [])
  const add = (): void => {
    const t = v.trim()
    if (!t) return
    onAdd(t)
    setV('')
  }
  return (
    <div className="fm-kb-addform">
      <textarea
        ref={ref}
        className="fm-kb-add-input"
        rows={2}
        value={v}
        placeholder="Card title… (Enter to add, Esc to close)"
        onChange={(e) => setV(e.target.value)}
        onKeyDown={(e) => {
          e.stopPropagation()
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault()
            add()
          } else if (e.key === 'Escape') {
            e.preventDefault()
            onClose()
          }
        }}
        onBlur={() => {
          if (v.trim()) add()
          onClose()
        }}
      />
    </div>
  )
}
