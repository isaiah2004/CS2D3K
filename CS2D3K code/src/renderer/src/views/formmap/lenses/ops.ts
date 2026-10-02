// Shared form-map edits used by the map, the inspector and the Board/Table/Doc lenses. Every change goes through
// ctl.doc.update (one undo step each).
import type { CanvasData, CanvasNode } from '../../canvas/model'
import type { FormMapCtl } from '../context'
import {
  applyAssign,
  cardState,
  cleanTag,
  defaultTagColor,
  FORMMAP_VERSION,
  fromPreset,
  groupChain,
  groupChainIn,
  groupIn,
  groups,
  isDoneField,
  isForm,
  isGroup,
  isKanban,
  metaOf,
  newForm,
  presetById,
  sameValue,
  type Board,
  type CardFilter,
  type CheckRule,
  type FieldDef,
  type FieldRegistry,
  type FormMapData,
  type FormMapEdge,
  type FormMapMeta,
  type FormNode,
  type GroupNode,
  type KanbanNode,
  type Preset,
  type Relation
} from '../schema'
import { boardColumns, NONE, OTHER, reachedDone, type BoardColumn } from '../boards'
import { freeSpotInGroup, freeSpotOutside } from '../layout'
import { registerUsage } from '../kanban'
import { celebrate } from '../fun/celebrate'
import { hexId } from '@/lib/util'

type At = { clientX: number; clientY: number }

// ---------------------------------------------------------------- geometry

/** Groups in pitch order (ordered first, then the rest top-to-bottom, left-to-right). */
export function groupsInOrder(d: CanvasData): GroupNode[] {
  return [...groups(d)].sort((a, b) => {
    const oa = a.order ?? Infinity
    const ob = b.order ?? Infinity
    if (oa !== ob) return oa - ob
    return a.y - b.y || a.x - b.x
  })
}

/** Map of card id → innermost group id containing it (or null). */
export function groupIndex(d: CanvasData): Map<string, string | null> {
  const gs = groups(d)
  const m = new Map<string, string | null>()
  for (const n of d.nodes) if (isForm(n)) m.set(n.id, groupIn(gs, n)?.id ?? null)
  return m
}

/** The card moved to a free spot in `group` (or outside all groups), with the fields its new groups assign. */
export function placeInGroup(d: CanvasData, card: FormNode, group: GroupNode | null): FormNode {
  const size = { width: card.width, height: card.height }
  const at = group ? freeSpotInGroup(d, group, size, card.id) : freeSpotOutside(d, size, card.id)
  const moved = { ...card, ...at }
  return applyAssign(moved, groupChain(d, moved))
}

const replaceNode = (d: CanvasData, n: CanvasNode): CanvasData => ({ ...d, nodes: d.nodes.map((x) => (x.id === n.id ? n : x)) })
const withMeta = (d: CanvasData, patch: Partial<FormMapMeta>): CanvasData => {
  const m = metaOf(d)
  return { ...d, formmap: { ...m, version: m.version || FORMMAP_VERSION, ...patch } }
}

/** Confetti when an edit puts a card into a board's done column or ticks a done checkbox. */
export function celebrateChanges(before: CanvasData, after: CanvasData, ids: string[], at?: At): void {
  if (before === after || !ids.length) return
  const reg = metaOf(after).fields ?? {}
  const prev = new Map(before.nodes.map((n) => [n.id, n]))
  const ticked = ids.some((id) => {
    const a = prev.get(id)
    const b = after.nodes.find((n) => n.id === id)
    if (!a || !b || !isForm(a) || !isForm(b)) return false
    return Object.entries(b.fields).some(([k, v]) => v === true && a.fields[k] !== true && isDoneField(k, reg[k])) || (cardState(b, reg) === 'win' && cardState(a, reg) !== 'win')
  })
  if (ticked || reachedDone(before, after, ids)) celebrate(at?.clientX, at?.clientY)
}

/** Runs an update and celebrates what it finished. */
function updateCelebrating(ctl: FormMapCtl, ids: string[], fn: (d: CanvasData) => CanvasData, at?: At, opts?: { history?: boolean | string }): void {
  let before: CanvasData | null = null
  let after: CanvasData | null = null
  ctl.doc.update((d) => {
    before = d
    after = fn(d)
    return after
  }, opts)
  if (before && after) celebrateChanges(before, after, ids, at)
}

// ---------------------------------------------------------------- cards

/** Moves a card geometrically into a group (null = out of all groups), applying the groups' fields. One undo step. */
export function moveToGroup(ctl: FormMapCtl, id: string, groupId: string | null, at?: At): void {
  updateCelebrating(
    ctl,
    [id],
    (d) => {
      const card = d.nodes.find((n) => n.id === id)
      if (!card || !isForm(card)) return d
      const group = groupId ? (groups(d).find((g) => g.id === groupId) ?? null) : null
      if ((groupIn(groups(d), card)?.id ?? null) === groupId) return d
      return replaceNode(d, placeInGroup(d, card, group))
    },
    at
  )
}

/**
 * A card with one field set (undefined / '' clears it). If the card sits in a group assigning a different value for this
 * field and another group assigns the new one (e.g. phase MVP → Later), the card moves there too: position keeps
 * matching meaning.
 */
export function withField(d: CanvasData, card: FormNode, key: string, value: unknown): FormNode {
  const fields = { ...card.fields }
  if (value === undefined || value === '' || (Array.isArray(value) && !value.length)) delete fields[key]
  else fields[key] = value
  let updated: FormNode = { ...card, fields }
  const chain = groupChain(d, card)
  const conflict = chain.some((g) => g.assign && key in g.assign && !sameValue(g.assign[key], value))
  if (conflict && value !== undefined) {
    const inChain = new Set(chain.map((g) => g.id))
    const target = groupsInOrder(d).find((g) => !inChain.has(g.id) && g.assign && sameValue(g.assign[key], value))
    if (target) updated = placeInGroup(d, updated, target)
  }
  return updated
}

/** Sets a field on one or more cards (registers it if new). Celebrates finished cards. */
export function setField(ctl: FormMapCtl, ids: string | string[], key: string, value: unknown, at?: At): void {
  const list = Array.isArray(ids) ? ids : [ids]
  updateCelebrating(
    ctl,
    list,
    (d) => {
      let next = d
      for (const id of list) {
        const card = next.nodes.find((n) => n.id === id)
        if (!card || !isForm(card) || sameValue(card.fields[key], value)) continue
        next = replaceNode(next, withField(next, card, key, value))
      }
      return next === d ? d : registerUsage(next, [{ fields: { [key]: value } }])
    },
    at
  )
}

/** Adds and/or removes tags on cards (registering new tags with a color). */
export function setTags(ctl: FormMapCtl, ids: string | string[], change: { add?: string[]; remove?: string[] }): void {
  const set = new Set(Array.isArray(ids) ? ids : [ids])
  const add = (change.add ?? []).map(cleanTag).filter(Boolean)
  const remove = new Set((change.remove ?? []).map(cleanTag))
  ctl.doc.update((d) => {
    let changed = false
    const nodes = d.nodes.map((n) => {
      if (!set.has(n.id) || !isForm(n)) return n
      const cur = n.tags ?? []
      const tags = [...cur.filter((t) => !remove.has(t)), ...add.filter((t) => !cur.includes(t) && !remove.has(t))]
      if (tags.length === cur.length && tags.every((t, i) => t === cur[i])) return n
      changed = true
      return { ...n, tags }
    })
    return changed ? registerUsage({ ...d, nodes }, [{ tags: add }]) : d
  })
}

export function toggleTag(ctl: FormMapCtl, id: string, tag: string): void {
  const n = ctl.doc.data.nodes.find((x) => x.id === id)
  if (!n || !isForm(n)) return
  setTags(ctl, id, n.tags?.includes(tag) ? { remove: [tag] } : { add: [tag] })
}

export function vote(ctl: FormMapCtl, id: string, delta: number): void {
  ctl.doc.update(
    (d) => ({ ...d, nodes: d.nodes.map((n) => (n.id === id && isForm(n) ? { ...n, votes: Math.max(0, (n.votes ?? 0) + delta) || undefined } : n)) }),
    { history: `vote:${id}` }
  )
}

/** Group a new card naturally belongs to: one whose preset matches, or whose assign agrees with its fields. */
export function bestGroupFor(d: CanvasData, card: FormNode, presetId?: string, avoidKey?: string): GroupNode | null {
  let best: GroupNode | null = null
  let bestScore = 0
  for (const g of groupsInOrder(d)) {
    let score = presetId && g.preset === presetId ? 3 : 0
    let ok = true
    for (const [k, v] of Object.entries(g.assign ?? {})) {
      if (k === avoidKey) ok = false
      else if (card.fields[k] === undefined) continue
      else if (sameValue(card.fields[k], v)) score += 2
      else ok = false
    }
    if (ok && score > bestScore) {
      best = g
      bestScore = score
    }
  }
  return best
}

export interface AddCardOpts {
  title?: string
  text?: string
  tags?: string[]
  fields?: Record<string, unknown>
  /** preset id: default tags, fields, size, color */
  preset?: string
  /** explicit group (null = outside all groups); default: the group the card naturally belongs to (or outside) */
  groupId?: string | null
  /** when picking a group automatically, skip groups that assign this field (for "no value" columns) */
  avoidKey?: string
}

/** Creates a card at a free spot (in its group) and returns its id. */
export function addCard(ctl: FormMapCtl, opts: AddCardOpts = {}): string {
  const p = presetById(metaOf(ctl.doc.data), opts.preset)
  const base = fromPreset(p)
  const card = newForm({ x: 0, y: 0 }, { ...base, title: opts.title ?? '', text: opts.text ?? '', tags: [...new Set([...(base.tags ?? []), ...(opts.tags ?? [])])], fields: { ...base.fields, ...(opts.fields ?? {}) } })
  ctl.doc.update((d) => {
    const group =
      opts.groupId === null ? null : opts.groupId ? (groups(d).find((g) => g.id === opts.groupId) ?? null) : bestGroupFor(d, card, opts.preset, opts.avoidKey)
    return registerUsage({ ...d, nodes: [...d.nodes, placeInGroup(d, card, group)] }, [card])
  })
  return card.id
}

/** Deletes nodes (and their edges); saved boards forget deleted groups. */
export function deleteNodes(ctl: FormMapCtl, ids: string[]): void {
  const set = new Set(ids)
  ctl.doc.update((d) => {
    const next: CanvasData = {
      ...d,
      nodes: d.nodes.filter((n) => !set.has(n.id)),
      edges: d.edges.filter((e) => !set.has(e.fromNode) && !set.has(e.toNode) && !set.has(e.id))
    }
    const boards = metaOf(d).boards
    if (!boards?.some((b) => b.source.mode === 'groups' && b.source.groupIds.some((g) => set.has(g)))) return next
    return withMeta(next, { boards: boards.map((b) => (b.source.mode === 'groups' ? { ...b, source: { ...b.source, groupIds: b.source.groupIds.filter((g) => !set.has(g)) } } : b)) })
  })
}

/** Patch any node (group, kanban, plain node) shallowly. */
export function patchNode(ctl: FormMapCtl, id: string, patch: Record<string, unknown>, history?: string): void {
  ctl.doc.update(
    (d) => ({
      ...d,
      nodes: d.nodes.map((n) => {
        if (n.id !== id) return n
        const next = { ...n, ...patch }
        for (const [k, v] of Object.entries(patch)) if (v === undefined) delete next[k]
        return next
      })
    }),
    history ? { history } : undefined
  )
}

export function patchKanban(ctl: FormMapCtl, id: string, fn: (k: KanbanNode) => KanbanNode, history?: string): void {
  ctl.doc.update((d) => ({ ...d, nodes: d.nodes.map((n) => (n.id === id && isKanban(n) ? fn(n) : n)) }), history ? { history } : undefined)
}

export function setMeta(ctl: FormMapCtl, patch: Partial<FormMapMeta>, history?: string): void {
  ctl.doc.update((d) => {
    const next = withMeta(d, patch) as FormMapData
    for (const [k, v] of Object.entries(patch)) if (v === undefined) delete next.formmap![k]
    return next
  }, history ? { history } : undefined)
}

/** Re-applies the groups' fields to cards (Coach fix for "cards don't match their group"). */
export function applyGroupFields(ctl: FormMapCtl, ids: string[]): void {
  const set = new Set(ids)
  updateCelebrating(ctl, ids, (d) => {
    const gs = groups(d)
    let changed = false
    const nodes = d.nodes.map((n) => {
      if (!set.has(n.id) || !isForm(n)) return n
      const m = applyAssign(n, groupChainIn(gs, n))
      if (m !== n) changed = true
      return m
    })
    return changed ? { ...d, nodes } : d
  })
}

// ---------------------------------------------------------------- field registry

/** How many cards (and kanban cards) hold a value for a field. */
export function fieldUsage(d: CanvasData, key: string): number {
  let n = 0
  for (const x of d.nodes) {
    if (isForm(x) && x.fields?.[key] !== undefined) n++
    else if (isKanban(x)) for (const c of x.columns) for (const k of c.cards) if (k.fields?.[key] !== undefined) n++
  }
  return n
}

export function addField(ctl: FormMapCtl, name: string, def: FieldDef): boolean {
  const key = name.trim()
  if (!key || registryOfCtl(ctl)[key]) return false
  ctl.doc.update((d) => withMeta(d, { fields: { ...(metaOf(d).fields ?? {}), [key]: def } }))
  return true
}

const registryOfCtl = (ctl: FormMapCtl): FieldRegistry => metaOf(ctl.doc.data).fields ?? {}

/** Rewrites every card's (and kanban card's) fields. */
function mapCardFields(d: CanvasData, fn: (fields: Record<string, unknown>) => Record<string, unknown>): CanvasData {
  return {
    ...d,
    nodes: d.nodes.map((n) => {
      if (isForm(n)) {
        const f = fn(n.fields ?? {})
        return f === n.fields ? n : { ...n, fields: f }
      }
      if (isGroup(n) && n.assign) {
        const a = fn(n.assign)
        return a === n.assign ? n : { ...n, assign: Object.keys(a).length ? a : undefined }
      }
      if (isKanban(n)) {
        let changed = false
        const columns = n.columns.map((c) => ({
          ...c,
          cards: c.cards.map((k) => {
            if (!k.fields) return k
            const f = fn(k.fields)
            if (f === k.fields) return k
            changed = true
            return { ...k, fields: f }
          })
        }))
        return changed ? { ...n, columns } : n
      }
      return n
    })
  }
}

const renameKey = (o: Record<string, unknown> | undefined, from: string, to: string): Record<string, unknown> | undefined => {
  if (!o || !(from in o)) return o
  return Object.fromEntries(Object.entries(o).map(([k, v]) => [k === from ? to : k, v]))
}
const dropKey = (o: Record<string, unknown> | undefined, key: string): Record<string, unknown> | undefined => {
  if (!o || !(key in o)) return o
  const { [key]: _drop, ...rest } = o
  return rest
}
const filterKeys = (f: CardFilter | undefined, fn: (o: Record<string, unknown> | undefined) => Record<string, unknown> | undefined): CardFilter | undefined =>
  f ? { ...f, fields: fn(f.fields), notFields: fn(f.notFields) } : f

/** Renames a field everywhere: registry (same position), cards, group assigns, presets, boards and checks. */
export function renameField(ctl: FormMapCtl, from: string, to: string): boolean {
  const name = to.trim()
  const reg = registryOfCtl(ctl)
  if (!name || name === from || reg[name] || !reg[from]) return false
  ctl.doc.update((d) => {
    const meta = metaOf(d)
    const fields: FieldRegistry = {}
    for (const [k, v] of Object.entries(meta.fields ?? {})) {
      if (k !== from) fields[k] = v
      else {
        const { label: _label, ...rest } = v
        fields[name] = rest
      }
    }
    const rk = (o: Record<string, unknown> | undefined): Record<string, unknown> | undefined => renameKey(o, from, name)
    const next = mapCardFields(d, (f) => rk(f) ?? f)
    return withMeta(next, {
      fields,
      presets: meta.presets?.map((p) => ({ ...p, fields: rk(p.fields) })),
      boards: meta.boards?.map((b) => ({ ...b, filter: filterKeys(b.filter, rk), source: b.source.mode === 'field' && b.source.field === from ? { ...b.source, field: name } : b.source })),
      checks: meta.checks?.map((c) => renameInRule(c, from, name, rk))
    })
  })
  return true
}

function renameInRule(c: CheckRule, from: string, to: string, rk: (o: Record<string, unknown> | undefined) => Record<string, unknown> | undefined): CheckRule {
  const r = { ...c, match: filterKeys(c.match, rk)! } as CheckRule
  if ((r.type === 'field' || r.type === 'sum') && r.field === from) r.field = to
  if (r.type === 'relation' && r.target) r.target = filterKeys(r.target, rk)
  return r
}

/** Deletes a field: its values on every card, group assigns, presets, boards split by it and checks about it. */
export function deleteField(ctl: FormMapCtl, key: string): void {
  ctl.doc.update((d) => {
    const meta = metaOf(d)
    const dk = (o: Record<string, unknown> | undefined): Record<string, unknown> | undefined => dropKey(o, key)
    const next = mapCardFields(d, (f) => dk(f) ?? f)
    const { [key]: _drop, ...fields } = meta.fields ?? {}
    return withMeta(next, {
      fields,
      presets: meta.presets?.map((p) => ({ ...p, fields: dk(p.fields) })),
      boards: meta.boards?.filter((b) => !(b.source.mode === 'field' && b.source.field === key)).map((b) => ({ ...b, filter: filterKeys(b.filter, dk) })),
      checks: meta.checks?.filter((c) => !((c.type === 'field' || c.type === 'sum') && c.field === key))
    })
  })
}

function convertValue(v: unknown, type: FieldDef['type']): unknown {
  if (v === undefined) return v
  switch (type) {
    case 'number': {
      const n = typeof v === 'number' ? v : Number(String(v).trim())
      return Number.isFinite(n) && String(v).trim() !== '' ? n : v
    }
    case 'checkbox':
      return v === true || /^(true|yes|y|1|x|done)$/i.test(String(v)) ? true : undefined
    case 'rating': {
      const n = Math.round(Number(v))
      return Number.isFinite(n) && n > 0 ? Math.min(n, 10) : undefined
    }
    case 'multiselect':
      return Array.isArray(v) ? v : String(v).trim() ? [String(v)] : undefined
    case 'select':
    case 'text':
    case 'longtext':
    case 'date':
    case 'link':
      return Array.isArray(v) ? (typeof v[0] === 'string' ? v[0] : v) : v
    default:
      return v
  }
}

/** Changes a field's definition. Changing its type converts values where it can; select types gain options for values in use. */
export function updateFieldDef(ctl: FormMapCtl, key: string, patch: Partial<FieldDef>, history?: string): void {
  ctl.doc.update((d) => {
    const meta = metaOf(d)
    const cur = meta.fields?.[key]
    if (!cur) return d
    const def: FieldDef = { ...cur, ...patch }
    for (const [k, v] of Object.entries(patch)) if (v === undefined) delete (def as unknown as Record<string, unknown>)[k]
    let next = d
    if (patch.type && patch.type !== cur.type) {
      next = mapCardFields(d, (f) => {
        if (!(key in f)) return f
        const v = convertValue(f[key], patch.type!)
        if (v === f[key]) return f
        const out = { ...f }
        if (v === undefined) delete out[key]
        else out[key] = v
        return out
      })
      if (def.type === 'select' || def.type === 'multiselect') {
        const opts = [...(def.options ?? [])]
        for (const n of next.nodes)
          if (isForm(n)) for (const v of ([] as unknown[]).concat(n.fields[key] ?? [])) if (typeof v === 'string' && v && !opts.some((o) => o.value === v)) opts.push({ value: v })
        def.options = opts
      }
    }
    return withMeta(next, { fields: { ...(meta.fields ?? {}), [key]: def } })
  }, history ? { history } : undefined)
}

// ---------------------------------------------------------------- tags

export function tagUsage(d: CanvasData): Map<string, number> {
  const m = new Map<string, number>()
  for (const n of d.nodes) if (isForm(n)) for (const t of n.tags ?? []) m.set(t, (m.get(t) ?? 0) + 1)
  return m
}

export function setTagColor(ctl: FormMapCtl, tag: string, color: string | undefined): void {
  ctl.doc.update((d) => {
    const tags = { ...(metaOf(d).tags ?? {}) }
    tags[tag] = color ? { ...tags[tag], color } : { ...tags[tag], color: defaultTagColor(tag) }
    return withMeta(d, { tags })
  })
}

/** Renames a tag everywhere (cards, kanban cards, presets, filters, rules, option scopes); merges into an existing tag. */
export function renameTag(ctl: FormMapCtl, from: string, to: string): boolean {
  const name = cleanTag(to)
  if (!name || name === from) return false
  replaceTag(ctl, from, name)
  return true
}

export function deleteTag(ctl: FormMapCtl, tag: string): void {
  replaceTag(ctl, tag, null)
}

function replaceTag(ctl: FormMapCtl, from: string, to: string | null): void {
  const swap = (list: string[] | undefined): string[] | undefined => {
    if (!list?.includes(from)) return list
    const out: string[] = []
    for (const t of list) {
      const v = t === from ? to : t
      if (v && !out.includes(v)) out.push(v)
    }
    return out
  }
  const swapFilter = (f: CardFilter | undefined): CardFilter | undefined => (f ? { ...f, tags: swap(f.tags), notTags: swap(f.notTags) } : f)
  ctl.doc.update((d) => {
    const meta = metaOf(d)
    const nodes = d.nodes.map((n) => {
      if (isForm(n)) {
        const tags = swap(n.tags)
        return tags === n.tags ? n : { ...n, tags }
      }
      if (isKanban(n)) return { ...n, columns: n.columns.map((c) => ({ ...c, cards: c.cards.map((k) => (k.tags?.includes(from) ? { ...k, tags: swap(k.tags) } : k)) })) }
      return n
    })
    const tags = { ...(meta.tags ?? {}) }
    const def = tags[from]
    delete tags[from]
    if (to && !tags[to]) tags[to] = def ?? { color: defaultTagColor(to) }
    const fields = Object.fromEntries(
      Object.entries(meta.fields ?? {}).map(([k, f]) => [k, f.options?.some((o) => o.for?.includes(from)) ? { ...f, options: f.options.map((o) => ({ ...o, for: swap(o.for) })) } : f])
    )
    return withMeta(
      { ...d, nodes },
      {
        tags,
        fields,
        presets: meta.presets?.map((p) => ({ ...p, tags: swap(p.tags) })),
        boards: meta.boards?.map((b) => ({ ...b, filter: swapFilter(b.filter) })),
        checks: meta.checks?.map((c) => ({ ...c, match: swapFilter(c.match)!, ...(c.type === 'relation' ? { target: swapFilter(c.target) } : {}) }) as CheckRule),
        relationRules: meta.relationRules
          ?.map((r) => ({ ...r, from: r.from === from ? (to ?? undefined) : r.from, to: r.to === from ? (to ?? undefined) : r.to }))
          .filter((r, i) => to !== null || (meta.relationRules![i].from !== from && meta.relationRules![i].to !== from))
      }
    )
  })
}

// ---------------------------------------------------------------- presets

export function savePresets(ctl: FormMapCtl, presets: Preset[], history?: string): void {
  setMeta(ctl, { presets }, history)
}

// ---------------------------------------------------------------- boards

export function createBoard(ctl: FormMapCtl, board: Board): string {
  ctl.doc.update((d) => withMeta(d, { boards: [...(metaOf(d).boards ?? []), board] }))
  return board.id
}

export function updateBoard(ctl: FormMapCtl, id: string, patch: Partial<Board>, history?: string): void {
  ctl.doc.update((d) => withMeta(d, { boards: (metaOf(d).boards ?? []).map((b) => (b.id === id ? { ...b, ...patch } : b)) }), history ? { history } : undefined)
}

export function deleteBoard(ctl: FormMapCtl, id: string): void {
  ctl.doc.update((d) => {
    const m = metaOf(d)
    return withMeta(d, { boards: (m.boards ?? []).filter((b) => b.id !== id), ...(m.hudBoard === id ? { hudBoard: undefined } : {}) })
  })
}

/** The data with a card put into a board column: geometric move (groups) or field change (field boards). */
function intoColumn(d: CanvasData, board: Board, card: FormNode, col: BoardColumn): CanvasData {
  if (board.source.mode === 'groups') {
    const g = groups(d).find((x) => x.id === col.groupId)
    return g ? replaceNode(d, placeInGroup(d, card, g)) : d
  }
  return registerUsage(replaceNode(d, withField(d, card, board.source.field, col.value)), [{ fields: { [board.source.field]: col.value } }])
}

/**
 * Moves a card on a board to column `toKey` at `index` (in that column's displayed order, without the card): groups
 * boards move the card into the column's group on the canvas (applying its fields), field boards set the field. The
 * column order is saved on the board. One undo step; celebrates cards reaching the done column.
 */
export function moveOnBoard(ctl: FormMapCtl, boardId: string, cardId: string, toKey: string, index: number, at?: At): void {
  updateCelebrating(
    ctl,
    [cardId],
    (d) => {
      const board = metaOf(d).boards?.find((b) => b.id === boardId)
      const card = d.nodes.find((n) => n.id === cardId)
      if (!board || !card || !isForm(card) || toKey === OTHER) return d
      const cols = boardColumns(d, board)
      const to = cols.find((c) => c.key === toKey)
      if (!to || to.locked) return d
      const from = cols.find((c) => c.cards.some((x) => x.id === cardId))
      let next = from?.key === toKey ? d : intoColumn(d, board, card, to)
      // order: the target column's displayed order with the card inserted
      const list = to.cards.map((c) => c.id).filter((id) => id !== cardId)
      list.splice(Math.max(0, Math.min(index, list.length)), 0, cardId)
      const order: Record<string, string[]> = {}
      for (const [k, v] of Object.entries(board.order ?? {})) if (k !== toKey) order[k] = v.filter((id) => id !== cardId)
      order[toKey] = list
      const boards = (metaOf(next).boards ?? []).map((b) => (b.id === boardId ? { ...b, order } : b))
      next = withMeta(next, { boards })
      return next
    },
    at
  )
}

/** Adds a card to a board column (in the column's group, or with the column's field value) at the end of the column. */
export function addCardToColumn(ctl: FormMapCtl, board: Board, col: BoardColumn, title: string): string {
  const opts: AddCardOpts = { title }
  if (board.source.mode === 'groups') {
    opts.groupId = col.groupId
    opts.preset = groups(ctl.doc.data).find((g) => g.id === col.groupId)?.preset
  } else {
    const f = board.source.field
    if (col.key === NONE) opts.avoidKey = f
    else opts.fields = { [f]: col.value }
    if (board.source.groupId) opts.groupId = board.source.groupId
  }
  if (board.filter?.tags?.length) opts.tags = [...board.filter.tags]
  const id = addCard(ctl, opts)
  ctl.doc.update(
    (d) => {
      const b = metaOf(d).boards?.find((x) => x.id === board.id)
      if (!b) return d
      const cols = boardColumns(d, b)
      const c = cols.find((x) => x.cards.some((k) => k.id === id))
      if (!c) return d
      return withMeta(d, { boards: metaOf(d).boards!.map((x) => (x.id === b.id ? { ...x, order: { ...(x.order ?? {}), [c.key]: [...c.cards.map((k) => k.id).filter((k) => k !== id), id] } } : x)) })
    },
    { history: false }
  )
  return id
}

// ---------------------------------------------------------------- relations

export function addRelation(ctl: FormMapCtl, from: string, to: string, relation: Relation): void {
  if (from === to) return
  ctl.doc.update((d) => {
    const dup = (d.edges as FormMapEdge[]).some((e) => e.fromNode === from && e.toNode === to && (e.relation ?? 'relates') === relation)
    if (dup) return d
    const edge: FormMapEdge = { id: hexId(), fromNode: from, toNode: to, toEnd: 'arrow', relation }
    return { ...d, edges: [...d.edges, edge] }
  })
}

export function setRelation(ctl: FormMapCtl, edgeId: string, relation: Relation): void {
  const r = relation.trim()
  if (!r) return
  ctl.doc.update((d) => ({ ...d, edges: d.edges.map((e) => (e.id === edgeId ? { ...e, relation: r } : e)) }))
}

export function removeEdge(ctl: FormMapCtl, edgeId: string): void {
  ctl.doc.update((d) => ({ ...d, edges: d.edges.filter((e) => e.id !== edgeId) }))
}
