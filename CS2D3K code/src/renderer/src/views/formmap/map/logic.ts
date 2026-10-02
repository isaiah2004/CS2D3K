// Pure helpers for the map lens: relation inference, mind-map placement, layout (align/distribute/tidy), pen strokes.
import { snap, intersects, type CanvasData, type CanvasNode, type Point, type Rect } from '../../canvas/model'
import { isForm, isZone, zones, type FormKind, type FormMapEdge, type FormNode, type Relation, type ZoneNode } from '../schema'

// ---------------------------------------------------------------- relations

/** Sensible default relation for a new edge from → to. */
export function inferRelation(from?: FormKind, to?: FormKind): Relation {
  if (!from || !to) return 'relates'
  if (from === 'idea') return 'refines'
  if ((from === 'feature' || from === 'approach') && to === 'goal') return 'serves'
  if (to === 'principle' && from !== 'principle') return 'because'
  if (from === 'goal' && to === 'goal') return 'serves'
  if (from === 'feature' && (to === 'feature' || to === 'approach')) return 'depends'
  if (from === 'approach' && to === 'approach') return 'depends'
  if (from === 'question') return 'relates'
  return 'relates'
}

/** Kind of a mind-map child (Tab) under a parent of `kind`. */
export function childKind(kind: FormKind): FormKind {
  switch (kind) {
    case 'goal':
      return 'feature'
    case 'principle':
      return 'approach'
    case 'approach':
      return 'feature'
    case 'question':
      return 'idea'
    default:
      return kind
  }
}

const UPSTREAM: Relation[] = ['serves', 'because', 'refines', 'depends']

/** The edge to a card's mind-map parent: its first outgoing upstream relation to another form card. */
export function parentEdge(d: CanvasData, id: string): FormMapEdge | null {
  for (const e of d.edges as FormMapEdge[]) {
    if (e.fromNode !== id) continue
    const to = d.nodes.find((n) => n.id === e.toNode)
    if (to && isForm(to) && UPSTREAM.includes(e.relation ?? 'relates')) return e
  }
  return null
}

// ---------------------------------------------------------------- zones

export function centerIn(z: Rect, n: Rect): boolean {
  const cx = n.x + n.width / 2
  const cy = n.y + n.height / 2
  return cx >= z.x && cx <= z.x + z.width && cy >= z.y && cy <= z.y + z.height
}

/** Smallest zone containing a world point. */
export function zoneAtPoint(d: CanvasData, p: Point): ZoneNode | null {
  let best: ZoneNode | null = null
  for (const z of zones(d)) {
    if (p.x >= z.x && p.x <= z.x + z.width && p.y >= z.y && p.y <= z.y + z.height) {
      if (!best || z.width * z.height < best.width * best.height) best = z
    }
  }
  return best
}

/** Cards (non-zone, non-drawing) whose center is inside the zone — and not inside a smaller nested zone. */
export function cardsInZone(d: CanvasData, z: ZoneNode): CanvasNode[] {
  const zs = zones(d)
  return d.nodes.filter((n) => {
    if (isZone(n) || n.type === 'drawing' || n.type === 'group') return false
    if (!centerIn(z, n)) return false
    return !zs.some((o) => o.id !== z.id && o.width * o.height < z.width * z.height && centerIn(o, n))
  })
}

// ---------------------------------------------------------------- placement

/** Nearest free spot for `r`: tries below first, then neighbouring columns (never overlaps a card). */
export function findFree(d: CanvasData, r: Rect, ignore: Set<string> = new Set()): Rect {
  const cards = d.nodes.filter((n) => !ignore.has(n.id) && !isZone(n) && n.type !== 'group' && n.type !== 'drawing')
  const pad = (x: Rect): Rect => ({ x: x.x - 12, y: x.y - 12, width: x.width + 24, height: x.height + 24 })
  const sx = snap(r.width + 40)
  const sy = snap(r.height / 2 + 10) || 40
  const cands: { i: number; j: number; cost: number }[] = []
  for (let i = -2; i <= 4; i++) for (let j = -2; j <= 12; j++) cands.push({ i, j, cost: i * i * 9 + (j < 0 ? j * j * 3 : j * j) })
  cands.sort((a, b) => a.cost - b.cost)
  for (const c of cands) {
    const cur = { ...r, x: r.x + c.i * sx, y: r.y + c.j * sy }
    if (!cards.some((n) => intersects(pad(cur), n))) return cur
  }
  return r
}

// ---------------------------------------------------------------- layout

export type AlignMode = 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom'

export function alignTargets(nodes: CanvasNode[], mode: AlignMode): Map<string, Point> {
  const out = new Map<string, Point>()
  if (nodes.length < 2) return out
  const minX = Math.min(...nodes.map((n) => n.x))
  const maxX = Math.max(...nodes.map((n) => n.x + n.width))
  const minY = Math.min(...nodes.map((n) => n.y))
  const maxY = Math.max(...nodes.map((n) => n.y + n.height))
  for (const n of nodes) {
    let { x, y } = n
    if (mode === 'left') x = minX
    if (mode === 'right') x = maxX - n.width
    if (mode === 'center') x = (minX + maxX) / 2 - n.width / 2
    if (mode === 'top') y = minY
    if (mode === 'bottom') y = maxY - n.height
    if (mode === 'middle') y = (minY + maxY) / 2 - n.height / 2
    out.set(n.id, { x: Math.round(x), y: Math.round(y) })
  }
  return out
}

/** Even gaps between nodes along an axis (first and last stay put). */
export function distributeTargets(nodes: CanvasNode[], axis: 'x' | 'y'): Map<string, Point> {
  const out = new Map<string, Point>()
  if (nodes.length < 3) return out
  const size = axis === 'x' ? 'width' : 'height'
  const sorted = [...nodes].sort((a, b) => a[axis] - b[axis])
  const start = sorted[0][axis]
  const end = sorted[sorted.length - 1][axis] + sorted[sorted.length - 1][size]
  const total = sorted.reduce((s, n) => s + n[size], 0)
  const gap = (end - start - total) / (sorted.length - 1)
  let cur = start
  for (const n of sorted) {
    out.set(n.id, axis === 'x' ? { x: Math.round(cur), y: n.y } : { x: n.x, y: Math.round(cur) })
    cur += n[size] + gap
  }
  return out
}

export const ZONE_HEADER = 64
const ZONE_PAD = 30
const GAP = 20

/** Grid layout of a zone's cards in reading order. Returns targets and the zone height needed. */
export function tidyZone(d: CanvasData, z: ZoneNode): { targets: Map<string, Point>; height: number } {
  const cards = cardsInZone(d, z).sort((a, b) => (Math.abs(a.y - b.y) < 40 ? a.x - b.x : a.y - b.y))
  const targets = new Map<string, Point>()
  if (!cards.length) return { targets, height: z.height }
  const colW = Math.max(...cards.map((c) => c.width))
  const inner = z.width - ZONE_PAD * 2
  const cols = Math.max(1, Math.floor((inner + GAP) / (colW + GAP)))
  const used = cols * colW + (cols - 1) * GAP
  const x0 = z.x + ZONE_PAD + Math.max(0, (inner - used) / 2)
  let y = z.y + ZONE_HEADER + 10
  for (let i = 0; i < cards.length; i += cols) {
    const row = cards.slice(i, i + cols)
    row.forEach((c, j) => targets.set(c.id, { x: snap(x0 + j * (colW + GAP), 10), y: snap(y, 10) }))
    y += Math.max(...row.map((c) => c.height)) + GAP
  }
  return { targets, height: Math.max(z.height, snap(y - z.y + ZONE_PAD - GAP + 10)) }
}

// ---------------------------------------------------------------- pen

/** Ramer–Douglas–Peucker simplification on flat [x,y,...] points. */
export function simplify(pts: number[], eps: number): number[] {
  const n = pts.length / 2
  if (n < 3) return pts
  const keep = new Uint8Array(n)
  keep[0] = keep[n - 1] = 1
  const stack: [number, number][] = [[0, n - 1]]
  while (stack.length) {
    const [a, b] = stack.pop()!
    const ax = pts[a * 2]
    const ay = pts[a * 2 + 1]
    const bx = pts[b * 2]
    const by = pts[b * 2 + 1]
    const len = Math.hypot(bx - ax, by - ay) || 1
    let max = 0
    let idx = -1
    for (let i = a + 1; i < b; i++) {
      const px = pts[i * 2]
      const py = pts[i * 2 + 1]
      const dist = Math.abs((bx - ax) * (ay - py) - (ax - px) * (by - ay)) / len
      if (dist > max) {
        max = dist
        idx = i
      }
    }
    if (max > eps && idx > 0) {
      keep[idx] = 1
      stack.push([a, idx], [idx, b])
    }
  }
  const out: number[] = []
  for (let i = 0; i < n; i++) if (keep[i]) out.push(pts[i * 2], pts[i * 2 + 1])
  return out
}

/** Smooth SVG path through flat points (quadratic curves through midpoints). */
export function smoothPath(pts: number[], ox = 0, oy = 0): string {
  const n = pts.length / 2
  if (n === 0) return ''
  const P = (i: number): [number, number] => [pts[i * 2] + ox, pts[i * 2 + 1] + oy]
  if (n === 1) {
    const [x, y] = P(0)
    return `M ${x} ${y} l 0.01 0`
  }
  let d = `M ${P(0)[0]} ${P(0)[1]}`
  for (let i = 1; i < n - 1; i++) {
    const [x, y] = P(i)
    const [nx, ny] = P(i + 1)
    d += ` Q ${x} ${y} ${(x + nx) / 2} ${(y + ny) / 2}`
  }
  const [lx, ly] = P(n - 1)
  return d + ` L ${lx} ${ly}`
}

export function formsOf(nodes: CanvasNode[]): FormNode[] {
  return nodes.filter(isForm)
}
