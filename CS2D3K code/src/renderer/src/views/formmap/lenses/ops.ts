// Shared form-map edits used by the inspector and the Board/Table/Doc lenses. Every change goes through ctl.doc.update.
import type { CanvasData, CanvasNode } from '../../canvas/model'
import type { FormMapCtl } from '../context'
import {
  applyZone,
  isForm,
  isZone,
  KINDS,
  newForm,
  zoneAt,
  zones,
  type FormKind,
  type FormMapData,
  type FormMapEdge,
  type FormMapMeta,
  type FormNode,
  type Relation,
  type ZoneNode
} from '../schema'
import { celebrate, isWin } from '../fun/celebrate'
import { hexId } from '@/lib/util'

type Rect = { x: number; y: number; width: number; height: number }

const PAD = 24
/** room for the zone header (emoji + label) */
const HEADER = 64
const STEP = 20
const MARGIN = 16

// ---------------------------------------------------------------- geometry

/** Zones in pitch order (ordered first, then the rest top-to-bottom). */
export function zonesInOrder(d: CanvasData): ZoneNode[] {
  return [...zones(d)].sort((a, b) => {
    const oa = a.order ?? Infinity
    const ob = b.order ?? Infinity
    if (oa !== ob) return oa - ob
    return a.y - b.y || a.x - b.x
  })
}

/** Map of card id → containing zone id (or null). */
export function zoneIndex(d: CanvasData): Map<string, string | null> {
  const m = new Map<string, string | null>()
  for (const n of d.nodes) if (isForm(n)) m.set(n.id, zoneAt(d, n)?.id ?? null)
  return m
}

const overlaps = (a: Rect, b: Rect, m = MARGIN): boolean =>
  a.x < b.x + b.width + m && a.x + a.width + m > b.x && a.y < b.y + b.height + m && a.y + a.height + m > b.y

/** Things a new card must not cover (zones and drawings don't count). */
const obstacles = (d: CanvasData, exclude?: string): CanvasNode[] => d.nodes.filter((n) => n.id !== exclude && !isZone(n) && n.type !== 'drawing')

/** First free grid spot inside `zone` for a card of `size` (falls back to a cascade near the top-left). */
export function freeSpotInZone(d: CanvasData, zone: ZoneNode, size: { width: number; height: number }, exclude?: string): { x: number; y: number } {
  const obs = obstacles(d, exclude).filter((n) => overlaps(n, zone, 0))
  const x0 = zone.x + PAD
  const y0 = zone.y + HEADER
  const x1 = zone.x + zone.width - PAD - size.width
  const y1 = zone.y + zone.height - PAD - size.height
  for (let y = y0; y <= y1; y += STEP)
    for (let x = x0; x <= Math.max(x0, x1); x += STEP) {
      const r = { x, y, ...size }
      if (!obs.some((o) => overlaps(r, o))) return { x, y }
    }
  // zone is full: cascade from the top-left so the card stays inside (and is still assigned)
  const k = obs.length % 8
  return { x: x0 + k * STEP, y: Math.min(y0 + k * STEP, zone.y + zone.height - size.height / 2 - 1) }
}

/** A free spot outside every zone: right of all content, scanning down. */
export function freeSpotOutside(d: CanvasData, size: { width: number; height: number }, exclude?: string): { x: number; y: number } {
  const all = d.nodes.filter((n) => n.id !== exclude)
  if (!all.length) return { x: 0, y: 0 }
  const right = Math.max(...all.map((n) => n.x + n.width))
  const top = Math.min(...all.map((n) => n.y))
  const obs = obstacles(d, exclude)
  const x = right + 80
  for (let y = top; ; y += STEP) {
    const r = { x, y, ...size }
    if (!obs.some((o) => overlaps(r, o))) return { x, y }
  }
}

/** Zone a new card of `kind` with `fields` naturally belongs to (null = none). */
export function bestZoneFor(d: CanvasData, kind: FormKind, fields: Record<string, unknown>, avoidKey?: string): ZoneNode | null {
  let best: ZoneNode | null = null
  let bestScore = 0
  for (const z of zonesInOrder(d)) {
    let score = z.defaultKind === kind ? 3 : 0
    let ok = true
    for (const [k, v] of Object.entries(z.assign ?? {})) {
      if (!KINDS[kind].fields.some((f) => f.key === k)) continue
      if (k === avoidKey) ok = false
      else if (fields[k] === undefined) continue
      else if (fields[k] === v) score += 2
      else ok = false
    }
    if (ok && score > bestScore) {
      best = z
      bestScore = score
    }
  }
  return best
}

/** Returns `d` with the card moved to a free spot in `zone` (or outside all zones) and the zone's fields applied. */
function placeCard(d: CanvasData, card: FormNode, zone: ZoneNode | null): FormNode {
  const size = { width: card.width, height: card.height }
  const at = zone ? freeSpotInZone(d, zone, size, card.id) : freeSpotOutside(d, size, card.id)
  return applyZone({ ...card, ...at }, zone)
}

const replaceNode = (d: CanvasData, n: CanvasNode): CanvasData => ({ ...d, nodes: d.nodes.map((x) => (x.id === n.id ? n : x)) })

// ---------------------------------------------------------------- cards

/** Moves a card geometrically into a zone (null = out of all zones), applying the zone's fields. One undo step. */
export function moveToZone(ctl: FormMapCtl, id: string, zoneId: string | null): void {
  ctl.doc.update((d) => {
    const card = d.nodes.find((n) => n.id === id)
    if (!card || !isForm(card)) return d
    const zone = zoneId ? (zones(d).find((z) => z.id === zoneId) ?? null) : null
    if ((zoneAt(d, card)?.id ?? null) === zoneId) return d
    return replaceNode(d, placeCard(d, card, zone))
  })
}

/**
 * Sets a field on one or more cards (undefined clears it). If a card sits in a zone that assigns a different value
 * for this field and another zone assigns the new one (e.g. phase MVP → Later), the card moves there too, so
 * position keeps matching meaning. Celebrates wins (done / decided / accepted).
 */
export function setField(ctl: FormMapCtl, ids: string | string[], key: string, value: unknown, at?: { clientX: number; clientY: number }): void {
  const list = Array.isArray(ids) ? ids : [ids]
  let won = false
  ctl.doc.update((d) => {
    let next = d
    for (const id of list) {
      const card = next.nodes.find((n) => n.id === id)
      if (!card || !isForm(card) || card.fields[key] === value) continue
      if (isWin(card.kind, key, value)) won = true
      const fields = { ...card.fields }
      if (value === undefined || value === '') delete fields[key]
      else fields[key] = value
      let updated: FormNode = { ...card, fields }
      const cur = zoneAt(next, card)
      if (cur?.assign && key in cur.assign && cur.assign[key] !== value) {
        // clearing (undefined) must not match zones that simply don't assign this key
        const target = value === undefined ? undefined : zonesInOrder(next).find((z) => z.assign?.[key] === value && z.id !== cur.id)
        if (target) updated = placeCard(next, updated, target)
      }
      next = replaceNode(next, updated)
    }
    return next
  })
  if (won) celebrate(at?.clientX, at?.clientY)
}

/** Changes a card's kind (fields of other kinds are kept, so switching back is lossless). */
export function setKind(ctl: FormMapCtl, ids: string | string[], kind: FormKind): void {
  const set = new Set(Array.isArray(ids) ? ids : [ids])
  ctl.doc.update((d) => ({ ...d, nodes: d.nodes.map((n) => (set.has(n.id) && isForm(n) && n.kind !== kind ? { ...n, kind } : n)) }))
}

export function vote(ctl: FormMapCtl, id: string, delta: number): void {
  ctl.doc.update(
    (d) => ({ ...d, nodes: d.nodes.map((n) => (n.id === id && isForm(n) ? { ...n, votes: Math.max(0, (n.votes ?? 0) + delta) } : n)) }),
    { history: `vote:${id}` }
  )
}

export interface AddCardOpts {
  title?: string
  text?: string
  fields?: Record<string, unknown>
  /** explicit zone (null = outside all zones); default: the zone the card naturally belongs to */
  zoneId?: string | null
  /** when picking a zone automatically, skip zones that assign this field (for "no value" columns) */
  avoidKey?: string
}

/** Creates a form card at a free spot and returns its id. */
export function addCard(ctl: FormMapCtl, kind: FormKind, opts: AddCardOpts = {}): string {
  const card = newForm(kind, { x: 0, y: 0 }, { title: opts.title ?? '', text: opts.text ?? '', fields: { ...(opts.fields ?? {}) } })
  ctl.doc.update((d) => {
    const zone =
      opts.zoneId === null ? null : opts.zoneId ? (zones(d).find((z) => z.id === opts.zoneId) ?? null) : bestZoneFor(d, kind, card.fields, opts.avoidKey)
    return { ...d, nodes: [...d.nodes, placeCard(d, card, zone)] }
  })
  return card.id
}

export function deleteNodes(ctl: FormMapCtl, ids: string[]): void {
  const set = new Set(ids)
  ctl.doc.update((d) => ({
    ...d,
    nodes: d.nodes.filter((n) => !set.has(n.id)),
    edges: d.edges.filter((e) => !set.has(e.fromNode) && !set.has(e.toNode) && !set.has(e.id))
  }))
}

/** Patch any node (zone, plain node) shallowly. */
export function patchNode(ctl: FormMapCtl, id: string, patch: Record<string, unknown>, history?: string): void {
  ctl.doc.update((d) => ({ ...d, nodes: d.nodes.map((n) => (n.id === id ? { ...n, ...patch } : n)) }), history ? { history } : undefined)
}

export function setMeta(ctl: FormMapCtl, patch: Partial<FormMapMeta>, history?: string): void {
  ctl.doc.update((d) => {
    const fm = (d as FormMapData).formmap ?? { version: 1 }
    return { ...d, formmap: { ...fm, ...patch } }
  }, history ? { history } : undefined)
}

// ---------------------------------------------------------------- relations

/** Sensible default relation from one card kind to another. */
export function inferRelation(from: FormKind, to: FormKind): Relation {
  if (to === 'goal' && (from === 'feature' || from === 'approach')) return 'serves'
  if (to === 'principle') return 'because'
  if (from === 'idea') return 'refines'
  if (from === 'feature' && to === 'feature') return 'depends'
  if (from === 'feature' && to === 'approach') return 'depends'
  return 'relates'
}

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
  ctl.doc.update((d) => ({ ...d, edges: d.edges.map((e) => (e.id === edgeId ? { ...e, relation } : e)) }))
}

export function removeEdge(ctl: FormMapCtl, edgeId: string): void {
  ctl.doc.update((d) => ({ ...d, edges: d.edges.filter((e) => e.id !== edgeId) }))
}
