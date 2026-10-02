// Saved boards (Board lens): the columns of a board, derived live from the map.
//   groups mode — each group is a column; a card belongs to the innermost board group containing its center
//   field mode  — the cards of one group (or the whole map) split into columns by a field's values
// Per-column card order is stored on the board (`order`); cards without a stored position follow in map reading order.
import type { CanvasData } from '../canvas/model'
import { hexId } from '@/lib/util'
import {
  fieldLabel,
  fmColor,
  forms,
  groupChainIn,
  groups,
  groupTitle,
  isEmptyValue,
  matchesFilter,
  metaOf,
  optionLabel,
  optionsFor,
  isDoneField,
  parentGroup,
  type Board,
  type FieldDef,
  type FormNode,
  type GroupNode
} from './schema'


/** column of cards without a value (field boards) */
export const NONE = '__none'
/** column of cards whose value is not one of the board's columns (field boards) */
export const OTHER = '__other'

export interface BoardColumn {
  key: string
  label: string
  emoji?: string
  /** CSS color */
  color?: string
  hint?: string
  /** groups mode: the column's group */
  groupId?: string
  /** field mode: the value a card gets when moved here (undefined = cleared) */
  value?: unknown
  /** cards can't be dropped here (the "other values" column) */
  locked?: boolean
  cards: FormNode[]
  /** WIP limit */
  wip?: number
}

/** reading order on the map: rows of ~60px, then left to right */
export const byPosition = (a: { x: number; y: number }, b: { x: number; y: number }): number => Math.round(a.y / 60) - Math.round(b.y / 60) || a.x - b.x

/** Cards in their stored order first, the rest in map reading order. */
export function orderCards(cards: FormNode[], order?: string[]): FormNode[] {
  const rank = new Map((order ?? []).map((id, i) => [id, i]))
  return [...cards].sort((a, b) => {
    const ra = rank.get(a.id)
    const rb = rank.get(b.id)
    if (ra !== undefined && rb !== undefined) return ra - rb
    if (ra !== undefined) return -1
    if (rb !== undefined) return 1
    return byPosition(a, b)
  })
}

const valueKey = (v: unknown): string => (typeof v === 'string' ? v : JSON.stringify(v))

/** The field types a board can split by. */
export const BOARD_FIELD_TYPES: FieldDef['type'][] = ['select', 'checkbox', 'rating', 'text', 'number', 'date', 'link']

/** Cards a board is about (its group scope and filter), before splitting into columns. */
export function boardScope(d: CanvasData, board: Board): FormNode[] {
  const all = forms(d).filter((c) => matchesFilter(c, board.filter))
  if (board.source.mode === 'field' && board.source.groupId) {
    const gs = groups(d)
    const gid = board.source.groupId
    return all.filter((c) => groupChainIn(gs, c).some((g) => g.id === gid))
  }
  return all
}

/** Columns of a board with their cards (ordered). */
export function boardColumns(d: CanvasData, board: Board): BoardColumn[] {
  const src = board.source
  const wip = board.wip ?? {}
  const finish = (cols: BoardColumn[]): BoardColumn[] => {
    for (const c of cols) {
      c.cards = orderCards(c.cards, board.order?.[c.key])
      if (wip[c.key]) c.wip = wip[c.key]
    }
    return cols
  }
  if (src.mode === 'groups') {
    const gs = groups(d)
    const byId = new Map(gs.map((g) => [g.id, g]))
    const cols: BoardColumn[] = []
    const colOf = new Map<string, BoardColumn>()
    for (const id of src.groupIds) {
      const g = byId.get(id)
      if (!g || colOf.has(id)) continue
      const col: BoardColumn = { key: g.id, label: groupTitle(g), emoji: g.emoji, color: fmColor(g.color), hint: g.prompt, groupId: g.id, cards: [] }
      cols.push(col)
      colOf.set(g.id, col)
    }
    for (const c of boardScope(d, board)) {
      const chain = groupChainIn(gs, c)
      for (let i = chain.length - 1; i >= 0; i--) {
        const col = colOf.get(chain[i].id)
        if (col) {
          col.cards.push(c)
          break
        }
      }
    }
    return finish(cols)
  }
  const meta = metaOf(d)
  const def = meta.fields?.[src.field]
  const cards = boardScope(d, board)
  const label = fieldLabel(src.field, def)
  const none: BoardColumn = { key: NONE, label: `No ${label.toLowerCase()}`, color: 'var(--text-faint)', value: undefined, cards: [] }
  const other: BoardColumn = { key: OTHER, label: 'Other values', color: 'var(--text-faint)', locked: true, cards: [] }
  let cols: BoardColumn[]
  const type = def?.type ?? 'text'
  if (type === 'checkbox') {
    const done = isDoneField(src.field, def)
    none.label = done ? 'Not done' : 'No'
    cols = [{ key: 'true', label: done ? 'Done' : 'Yes', color: 'var(--color-green)', value: true, cards: [] }]
  } else if (type === 'select') {
    const opts = optionsFor(def, board.filter?.tags)
    const shown = src.values?.length ? src.values.map((v) => opts.find((o) => o.value === v) ?? def?.options?.find((o) => o.value === v) ?? { value: v }) : opts
    cols = shown.map((o) => ({ key: o.value, label: optionLabel(o), color: fmColor(o.color), value: o.value, cards: [] }))
  } else if (type === 'rating') {
    const max = def?.max ?? 5
    none.label = 'Unrated'
    cols = Array.from({ length: max }, (_, i) => ({ key: String(i + 1), label: '★'.repeat(i + 1), color: 'var(--color-yellow)', value: i + 1, cards: [] }))
  } else {
    // free values: one column per distinct value (plus the board's own listed values)
    const vals = new Map<string, unknown>()
    for (const v of src.values ?? []) vals.set(valueKey(v), v)
    for (const c of cards) {
      const v = c.fields[src.field]
      if (!isEmptyValue(v) && !Array.isArray(v)) vals.set(valueKey(v), v)
    }
    const list = [...vals.values()].sort((a, b) => (typeof a === 'number' && typeof b === 'number' ? a - b : String(a).localeCompare(String(b))))
    cols = list.map((v) => ({ key: valueKey(v), label: String(v), value: v, cards: [] }))
  }
  const byKey = new Map(cols.map((c) => [c.key, c]))
  for (const c of cards) {
    const v = c.fields[src.field]
    if (isEmptyValue(v)) none.cards.push(c)
    else (byKey.get(type === 'checkbox' ? 'true' : valueKey(v)) ?? other).cards.push(c)
  }
  // "no value" first (a backlog) when it has cards (always for checkboxes); other values last
  return finish([...(none.cards.length || type === 'checkbox' ? [none] : []), ...cols, ...(other.cards.length ? [other] : [])])
}

/** The column a card is in on a board (null = not on the board). */
export function columnOf(cols: BoardColumn[], cardId: string): BoardColumn | null {
  for (const c of cols) if (c.cards.some((x) => x.id === cardId)) return c
  return null
}

/** The "done" column of a board: its last real column (not "no value" / "other"). */
export function doneColumn(cols: BoardColumn[]): BoardColumn | null {
  for (let i = cols.length - 1; i >= 0; i--) if (cols[i].key !== NONE && cols[i].key !== OTHER) return cols[i]
  return null
}

/** Progress of a board: cards in its done column / cards on it. */
export function boardProgress(d: CanvasData, board: Board): { done: number; total: number; column: BoardColumn | null } {
  const cols = boardColumns(d, board)
  const done = doneColumn(cols)
  return { done: done?.cards.length ?? 0, total: cols.reduce((s, c) => s + c.cards.length, 0), column: done }
}

/** Did any of these cards newly land in the done column of any board? (confetti) */
export function reachedDone(before: CanvasData, after: CanvasData, ids: string[]): boolean {
  const boards = metaOf(after).boards ?? []
  for (const b of boards) {
    const prev = doneColumn(boardColumns(before, b))
    const next = doneColumn(boardColumns(after, b))
    if (!next) continue
    for (const id of ids) if (next.cards.some((c) => c.id === id) && !(prev?.key === next.key && prev.cards.some((c) => c.id === id))) return true
  }
  return false
}

/** Default name for a board over some groups: their common parent group, else the column names. */
export function boardNameFor(d: CanvasData, groupIds: string[]): string {
  const gs = groups(d)
  const sel = gs.filter((g) => groupIds.includes(g.id))
  if (!sel.length) return 'Board'
  const parents = sel.map((g) => parentGroup(gs, g)?.id ?? null)
  const parent = parents.every((p) => p && p === parents[0]) ? gs.find((g) => g.id === parents[0]) : undefined
  if (parent?.label?.trim()) return parent.label.trim()
  const names = sel.map(groupTitle)
  return names.length <= 3 ? names.join(' / ') : `${names.slice(0, 2).join(' / ')} …`
}

/** A new groups-mode board over these groups, ordered left to right (then top to bottom). */
export function newGroupsBoard(d: CanvasData, groupIds: string[], name?: string): Board {
  const gs = groups(d).filter((g) => groupIds.includes(g.id))
  const ordered = [...gs].sort((a, b) => a.x - b.x || a.y - b.y).map((g) => g.id)
  return { id: hexId(), name: name ?? boardNameFor(d, ordered), source: { mode: 'groups', groupIds: ordered } }
}

export function newFieldBoard(d: CanvasData, field: string, groupId?: string, name?: string): Board {
  const meta = metaOf(d)
  const g = groupId ? (groups(d).find((x) => x.id === groupId) as GroupNode | undefined) : undefined
  const label = fieldLabel(field, meta.fields?.[field])
  return { id: hexId(), name: name ?? `${g ? `${groupTitle(g)} by ` : 'By '}${label.toLowerCase()}`, source: { mode: 'field', field, ...(groupId ? { groupId } : {}) } }
}
