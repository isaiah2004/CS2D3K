// Embedded kanban nodes: pure edits of a kanban node, and conversions between kanban nodes and canvas cards / groups.
// Every function returns new data (callers wrap them in one doc.update = one undo step).
import type { CanvasData, Point } from '../canvas/model'
import { boundsOf, snap } from '../canvas/model'
import { hexId } from '@/lib/util'
import {
  applyAssign,
  cardState,
  cleanTag,
  defaultTagColor,
  FORMMAP_VERSION,
  groupChain,
  groupChainIn,
  groups,
  groupTitle,
  inferFieldType,
  isForm,
  isGroup,
  isKanban,
  metaOf,
  parentGroup,
  type Board,
  type FormMapData,
  type FormMapMeta,
  type FormNode,
  type GroupNode,
  type KanbanCard,
  type KanbanColumn,
  type KanbanNode
} from './schema'
import { byPosition } from './boards'
import { cardSizeFor, GROUP_PAD, GROUP_TOP } from './layout'

/** column width inside a kanban node (CSS uses the same) */
export const KANBAN_COL_W = 248
export const KANBAN_GAP = 10
/** horizontal padding + header height of a kanban node */
export const KANBAN_PAD = 12
export const KANBAN_HEAD = 46

const COLUMN_COLORS = ['gray', 'blue', 'orange', 'green', 'purple', 'cyan', 'pink', 'red']

export function newColumn(title: string, color?: string): KanbanColumn {
  return { id: hexId(), title, ...(color ? { color } : {}), cards: [] }
}

/** A new kanban node (To do / Doing / Done), centered at `at`. */
export function newKanban(at: Point, init: Partial<KanbanNode> = {}): KanbanNode {
  const columns = init.columns ?? [newColumn('To do', 'gray'), newColumn('Doing', 'blue'), newColumn('Done', 'green')]
  const size = kanbanSize(columns.length)
  return { id: hexId(), type: 'kanban', title: 'Kanban', columns, x: snap(at.x - size.width / 2), y: snap(at.y - size.height / 2), ...size, ...init }
}

export function kanbanSize(columns: number, cards = 3): { width: number; height: number } {
  return { width: snap(Math.max(1, columns) * (KANBAN_COL_W + KANBAN_GAP) - KANBAN_GAP + KANBAN_PAD * 2), height: snap(Math.min(640, Math.max(340, KANBAN_HEAD + 70 + cards * 64))) }
}

export const kanbanCount = (k: KanbanNode): number => k.columns.reduce((s, c) => s + c.cards.length, 0)

export function findKanbanCard(k: KanbanNode, cardId: string): { col: KanbanColumn; index: number; card: KanbanCard } | null {
  for (const col of k.columns) {
    const index = col.cards.findIndex((c) => c.id === cardId)
    if (index >= 0) return { col, index, card: col.cards[index] }
  }
  return null
}

/** Replace one kanban node (returns `d` when the node is missing or unchanged). */
export function updateKanban(d: CanvasData, id: string, fn: (k: KanbanNode) => KanbanNode): CanvasData {
  let changed = false
  const nodes = d.nodes.map((n) => {
    if (n.id !== id || !isKanban(n)) return n
    const next = fn(n)
    if (next !== n) changed = true
    return next
  })
  return changed ? { ...d, nodes } : d
}

const mapColumns = (k: KanbanNode, fn: (c: KanbanColumn, i: number) => KanbanColumn): KanbanNode => ({ ...k, columns: k.columns.map(fn) })

/** Move a card to `toCol` at `index` (index in the target column without the card). */
export function moveKanbanCard(k: KanbanNode, cardId: string, toCol: string, index: number): KanbanNode {
  const found = findKanbanCard(k, cardId)
  if (!found || !k.columns.some((c) => c.id === toCol)) return k
  if (found.col.id === toCol && (found.index === index || (index >= found.col.cards.length - 1 && found.index === found.col.cards.length - 1))) return k
  return mapColumns(k, (c) => {
    let cards = c.cards
    if (c.id === found.col.id) cards = cards.filter((x) => x.id !== cardId)
    if (c.id === toCol) {
      cards = [...cards]
      cards.splice(Math.max(0, Math.min(index, cards.length)), 0, found.card)
    }
    return cards === c.cards ? c : { ...c, cards }
  })
}

export function insertKanbanCard(k: KanbanNode, colId: string, card: KanbanCard, index = Infinity): KanbanNode {
  return mapColumns(k, (c) => {
    if (c.id !== colId) return c
    const cards = [...c.cards]
    cards.splice(Math.max(0, Math.min(index, cards.length)), 0, card)
    return { ...c, cards }
  })
}

export function updateKanbanCard(k: KanbanNode, cardId: string, patch: Partial<KanbanCard>): KanbanNode {
  return mapColumns(k, (c) => (c.cards.some((x) => x.id === cardId) ? { ...c, cards: c.cards.map((x) => (x.id === cardId ? { ...x, ...patch } : x)) } : c))
}

export function deleteKanbanCard(k: KanbanNode, cardId: string): KanbanNode {
  return mapColumns(k, (c) => (c.cards.some((x) => x.id === cardId) ? { ...c, cards: c.cards.filter((x) => x.id !== cardId) } : c))
}

export function addKanbanColumn(k: KanbanNode, title = 'New column', index = Infinity): { node: KanbanNode; id: string } {
  const col = newColumn(title, COLUMN_COLORS[k.columns.length % COLUMN_COLORS.length])
  const columns = [...k.columns]
  columns.splice(Math.max(0, Math.min(index, columns.length)), 0, col)
  return { node: { ...k, columns }, id: col.id }
}

export function updateKanbanColumn(k: KanbanNode, colId: string, patch: Partial<Omit<KanbanColumn, 'id' | 'cards'>>): KanbanNode {
  return mapColumns(k, (c) => (c.id === colId ? { ...c, ...patch } : c))
}

export function deleteKanbanColumn(k: KanbanNode, colId: string): KanbanNode {
  return { ...k, columns: k.columns.filter((c) => c.id !== colId) }
}

export function moveKanbanColumn(k: KanbanNode, colId: string, toIndex: number): KanbanNode {
  const from = k.columns.findIndex((c) => c.id === colId)
  if (from < 0) return k
  const columns = [...k.columns]
  const [col] = columns.splice(from, 1)
  const to = Math.max(0, Math.min(toIndex, columns.length))
  if (to === from) return k
  columns.splice(to, 0, col)
  return { ...k, columns }
}

// ---------------------------------------------------------------- registries

/** Register fields / tags used by `cards` that the map's registries don't know yet. */
export function registerUsage(d: CanvasData, cards: { tags?: string[]; fields?: Record<string, unknown> }[]): CanvasData {
  const meta = metaOf(d)
  let fields = meta.fields
  let tags = meta.tags
  for (const c of cards) {
    for (const [k, v] of Object.entries(c.fields ?? {}))
      if (!fields?.[k]) fields = { ...(fields ?? {}), [k]: { type: inferFieldType(v) } }
    for (const t of c.tags ?? []) if (!tags?.[t]) tags = { ...(tags ?? {}), [t]: { color: defaultTagColor(t) } }
  }
  if (fields === meta.fields && tags === meta.tags) return d
  const next: FormMapMeta = { ...meta, version: meta.version || FORMMAP_VERSION, ...(fields ? { fields } : {}), ...(tags ? { tags } : {}) }
  return { ...d, formmap: next }
}

// ---------------------------------------------------------------- canvas cards ↔ kanban cards

/** A canvas card as a kanban card (keeps id, title, text, tags, fields, votes and color). */
export function formToKanbanCard(f: FormNode, reg = {}): KanbanCard {
  const card: KanbanCard = { id: f.id, title: f.title ?? '' }
  if (f.text?.trim()) card.text = f.text
  if (f.tags?.length) card.tags = [...f.tags]
  if (Object.keys(f.fields ?? {}).length) card.fields = structuredClone(f.fields)
  if (f.votes) card.votes = f.votes
  if (typeof f.color === 'string' && f.color) card.color = f.color
  if (cardState(f, reg) === 'win') card.done = true
  return card
}

/** A kanban card as a canvas card centered at `at` (a done card gets a `done` checkbox field). */
export function kanbanCardToFormNode(c: KanbanCard, at: Point, takenIds: Set<string>): FormNode {
  const fields = structuredClone(c.fields ?? {})
  if (c.done && fields.done === undefined) fields.done = true
  const size = cardSizeFor({ ...c, fields })
  return {
    id: takenIds.has(c.id) ? hexId() : c.id,
    type: 'form',
    title: c.title,
    text: c.text ?? '',
    tags: [...(c.tags ?? [])],
    fields,
    ...(c.votes ? { votes: c.votes } : {}),
    ...(c.color ? { color: c.color } : {}),
    x: snap(at.x - size.width / 2),
    y: snap(at.y - size.height / 2),
    ...size
  }
}

const allIds = (d: CanvasData): Set<string> => new Set([...d.nodes.map((n) => n.id), ...d.edges.map((e) => e.id)])

/** Pop a card out of a kanban node onto the canvas at `at` (the drop group's fields are applied). */
export function kanbanCardOut(d: CanvasData, kanbanId: string, cardId: string, at: Point): { data: CanvasData; id: string | null } {
  const k = d.nodes.find((n) => n.id === kanbanId)
  if (!k || !isKanban(k)) return { data: d, id: null }
  const found = findKanbanCard(k, cardId)
  if (!found) return { data: d, id: null }
  let node = kanbanCardToFormNode(found.card, at, allIds(d))
  node = applyAssign(node, groupChain(d, node))
  let next = updateKanban(d, kanbanId, (x) => deleteKanbanCard(x, cardId))
  next = { ...next, nodes: [...next.nodes, node] }
  return { data: registerUsage(next, [node]), id: node.id }
}

/** Move a canvas card into a kanban column (its relations are removed: kanban cards have none). */
export function formIntoKanban(d: CanvasData, formId: string, kanbanId: string, colId: string, index: number): { data: CanvasData; removedEdges: number } {
  const f = d.nodes.find((n) => n.id === formId)
  const k = d.nodes.find((n) => n.id === kanbanId)
  if (!f || !isForm(f) || !k || !isKanban(k) || !k.columns.some((c) => c.id === colId)) return { data: d, removedEdges: 0 }
  const card = formToKanbanCard(f, metaOf(d).fields)
  const taken = new Set(k.columns.flatMap((c) => c.cards.map((x) => x.id)))
  if (taken.has(card.id)) card.id = hexId()
  const edges = d.edges.filter((e) => e.fromNode !== formId && e.toNode !== formId)
  const nodes = d.nodes.filter((n) => n.id !== formId).map((n) => (n.id === kanbanId ? insertKanbanCard(n as KanbanNode, colId, card, index) : n))
  return { data: { ...d, nodes, edges }, removedEdges: d.edges.length - edges.length }
}

/** Move a card from one kanban node into another one's column. */
export function kanbanCardAcross(d: CanvasData, fromId: string, cardId: string, toId: string, colId: string, index: number): CanvasData {
  if (fromId === toId) return updateKanban(d, fromId, (k) => moveKanbanCard(k, cardId, colId, index))
  const from = d.nodes.find((n) => n.id === fromId)
  const to = d.nodes.find((n) => n.id === toId)
  if (!from || !isKanban(from) || !to || !isKanban(to)) return d
  const found = findKanbanCard(from, cardId)
  if (!found || !to.columns.some((c) => c.id === colId)) return d
  const taken = new Set(to.columns.flatMap((c) => c.cards.map((x) => x.id)))
  const card = taken.has(found.card.id) ? { ...found.card, id: hexId() } : found.card
  return updateKanban(updateKanban(d, fromId, (k) => deleteKanbanCard(k, cardId)), toId, (k) => insertKanbanCard(k, colId, card, index))
}

// ---------------------------------------------------------------- kanban ↔ groups

const COL_W = 300
const COL_GAP = 40
const CARD_GAP = 16
const PARENT_PAD = 40

/**
 * Lays a kanban node's columns out as groups (inside a parent group named after the kanban) with its cards as canvas
 * cards, and saves a groups board over them. Returns the new data, the column group ids and the board id.
 */
export function kanbanToGroups(d: CanvasData, kanbanId: string): { data: CanvasData; groupIds: string[]; boardId: string | null } {
  const k = d.nodes.find((n) => n.id === kanbanId)
  if (!k || !isKanban(k)) return { data: d, groupIds: [], boardId: null }
  const taken = allIds(d)
  const x0 = snap(k.x + PARENT_PAD)
  const y0 = snap(k.y + PARENT_PAD + 20)
  const colGroups: GroupNode[] = []
  const cards: FormNode[] = []
  let maxH = 320
  const laid = k.columns.map((col, i) => {
    const gx = x0 + i * (COL_W + COL_GAP)
    let y = y0 + GROUP_TOP
    const items = col.cards.map((c) => {
      const node = kanbanCardToFormNode(c, { x: 0, y: 0 }, taken)
      taken.add(node.id)
      node.x = gx + GROUP_PAD
      node.y = y
      node.width = COL_W - GROUP_PAD * 2
      y += node.height + CARD_GAP
      return node
    })
    maxH = Math.max(maxH, snap(y - y0 + GROUP_PAD))
    return { col, gx, items }
  })
  for (const { col, gx, items } of laid) {
    const g: GroupNode = { id: hexId(), type: 'group', label: col.title || 'Column', x: gx, y: y0, width: COL_W, height: maxH }
    if (col.color) g.color = col.color
    colGroups.push(g)
    cards.push(...items)
  }
  const width = Math.max(COL_W, laid.length * (COL_W + COL_GAP) - COL_GAP)
  const parent: GroupNode = { id: hexId(), type: 'group', label: k.title?.trim() || 'Board', emoji: '📋', x: x0 - PARENT_PAD, y: y0 - PARENT_PAD - 20, width: width + PARENT_PAD * 2, height: maxH + PARENT_PAD * 2 + 20 }
  const board: Board = { id: hexId(), name: k.title?.trim() || 'Board', source: { mode: 'groups', groupIds: colGroups.map((g) => g.id) } }
  const meta = metaOf(d)
  const nodes = [parent, ...colGroups, ...d.nodes.filter((n) => n.id !== kanbanId), ...cards]
  let data: CanvasData = { ...d, nodes, formmap: { ...meta, version: meta.version || FORMMAP_VERSION, boards: [...(meta.boards ?? []), board] } }
  data = registerUsage(data, cards)
  return { data, groupIds: colGroups.map((g) => g.id), boardId: board.id }
}

/**
 * Turns groups into one kanban node: their cards become its cards (in reading order) and the groups and cards leave the
 * canvas. A single group holding nested groups converts its children (and goes too). Relations of the moved cards are
 * removed; other nodes inside the groups stay on the canvas. Saved boards drop the removed groups.
 */
export function groupsToKanban(d: CanvasData, groupIds: string[]): { data: CanvasData; id: string | null; removedEdges: number; leftovers: number } {
  const gs = groups(d)
  let picked = gs.filter((g) => groupIds.includes(g.id))
  if (!picked.length) return { data: d, id: null, removedEdges: 0, leftovers: 0 }
  let title = 'Kanban'
  const remove = new Set(picked.map((g) => g.id))
  if (picked.length === 1) {
    const parent = picked[0]
    const children = gs.filter((o) => parentGroup(gs, o)?.id === parent.id)
    if (children.length) {
      picked = children
      for (const c of children) remove.add(c.id)
    }
    title = groupTitle(parent)
  } else {
    const parents = picked.map((g) => parentGroup(gs, g))
    if (parents[0] && parents.every((p) => p?.id === parents[0]!.id)) title = groupTitle(parents[0])
  }
  picked.sort((a, b) => a.x - b.x || a.y - b.y)
  const colIds = new Set(picked.map((g) => g.id))
  const byCol = new Map<string, FormNode[]>(picked.map((g) => [g.id, []]))
  let leftovers = 0
  for (const n of d.nodes) {
    if (isGroup(n) || n.type === 'drawing' || isKanban(n)) continue
    const chain = groupChainIn(gs, n)
    const col = [...chain].reverse().find((g) => colIds.has(g.id))
    if (!col) continue
    if (isForm(n)) byCol.get(col.id)!.push(n)
    else leftovers++
  }
  const reg = metaOf(d).fields ?? {}
  const columns: KanbanColumn[] = picked.map((g) => ({
    id: hexId(),
    title: groupTitle(g),
    ...(typeof g.color === 'string' && g.color ? { color: g.color } : {}),
    cards: byCol.get(g.id)!.sort(byPosition).map((f) => formToKanbanCard(f, reg))
  }))
  const moved = new Set([...byCol.values()].flat().map((f) => f.id))
  const b = boundsOf(picked)!
  const most = Math.max(...columns.map((c) => c.cards.length))
  const node: KanbanNode = { id: hexId(), type: 'kanban', title, columns, x: snap(b.x), y: snap(b.y), ...kanbanSize(columns.length, most) }
  const edges = d.edges.filter((e) => !moved.has(e.fromNode) && !moved.has(e.toNode) && !remove.has(e.fromNode) && !remove.has(e.toNode))
  const nodes = [...d.nodes.filter((n) => !moved.has(n.id) && !remove.has(n.id)), node]
  const meta = metaOf(d)
  let formmap = (d as FormMapData).formmap
  if (meta.boards?.some((bd) => bd.source.mode === 'groups' && bd.source.groupIds.some((id) => remove.has(id)))) {
    const boards = meta.boards
      .map((bd) => (bd.source.mode === 'groups' ? { ...bd, source: { ...bd.source, groupIds: bd.source.groupIds.filter((id) => !remove.has(id)) } } : bd))
      .filter((bd) => bd.source.mode !== 'groups' || bd.source.groupIds.length > 0)
    formmap = { ...meta, boards }
  }
  return { data: { ...d, nodes, edges, ...(formmap ? { formmap } : {}) }, id: node.id, removedEdges: d.edges.length - edges.length, leftovers }
}

/** Tag name typed by a user (shared by kanban + inspector tag inputs). */
export const parseTags = (s: string): string[] =>
  s
    .split(/[,\s]+/)
    .map(cleanTag)
    .filter(Boolean)
