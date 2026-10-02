// Placement helpers shared by the lenses, the inspector and the kanban conversions: where a card goes when it is moved
// into a group (or out of all groups) without the user dragging it.
import type { CanvasData, CanvasNode, Rect } from '../canvas/model'
import { snap } from '../canvas/model'
import { groups, isGroup, isInside, type GroupNode } from './schema'

/** padding inside a group around its cards */
export const GROUP_PAD = 24
/** room at the top of a group's box (its header sits above the box; this keeps the first row off the edge) */
export const GROUP_TOP = 40
const STEP = 20
const MARGIN = 16

const overlaps = (a: Rect, b: Rect, m = MARGIN): boolean =>
  a.x < b.x + b.width + m && a.x + a.width + m > b.x && a.y < b.y + b.height + m && a.y + a.height + m > b.y

/** Things a placed card must not cover: cards and other nodes, but not groups or drawings. */
const obstacles = (d: CanvasData, exclude?: string): CanvasNode[] => d.nodes.filter((n) => n.id !== exclude && !isGroup(n) && n.type !== 'drawing')

/** Groups nested inside `g` (their area belongs to them, not to `g`). */
export function childGroups(d: CanvasData, g: GroupNode): GroupNode[] {
  const gs = groups(d)
  return gs.filter((o) => isInside(gs, o, g.id))
}

/** First free grid spot inside a group for a card of `size` (avoids cards and nested groups; cascades when full). */
export function freeSpotInGroup(d: CanvasData, g: GroupNode, size: { width: number; height: number }, exclude?: string): { x: number; y: number } {
  const obs: Rect[] = [...obstacles(d, exclude).filter((n) => overlaps(n, g, 0)), ...childGroups(d, g)]
  const x0 = g.x + GROUP_PAD
  const y0 = g.y + GROUP_TOP
  const x1 = g.x + g.width - GROUP_PAD - size.width
  const y1 = g.y + g.height - GROUP_PAD - size.height
  for (let y = y0; y <= y1; y += STEP)
    for (let x = x0; x <= Math.max(x0, x1); x += STEP) {
      const r = { x, y, ...size }
      if (!obs.some((o) => overlaps(r, o))) return { x, y }
    }
  // the group is full: cascade from the top-left so the card's center stays inside (and it still belongs to the group)
  const k = obs.length % 8
  return { x: x0 + k * STEP, y: Math.min(y0 + k * STEP, g.y + g.height - size.height / 2 - 1) }
}

/** A free spot outside every group: right of all content, scanning down. */
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

/** A sensible canvas size for a card converted from a kanban card (or any title/text/tags/fields). */
export function cardSizeFor(c: { text?: string; tags?: string[]; fields?: Record<string, unknown> }): { width: number; height: number } {
  let h = 78
  if (c.tags?.length) h += 22
  if (c.text?.trim()) h += Math.min(90, 22 + Math.ceil(c.text.trim().length / 36) * 18)
  if (c.fields && Object.keys(c.fields).length) h += 30
  return { width: 260, height: snap(Math.max(100, h), 10) }
}
