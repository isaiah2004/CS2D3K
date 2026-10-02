// Canvas data model (JSON Canvas 1.0 superset) + geometry helpers.
import { hexId } from '@/lib/util'

export type Side = 'top' | 'right' | 'bottom' | 'left'
export type EndKind = 'none' | 'arrow'
export type NodeType = 'text' | 'file' | 'link' | 'group' | 'code'

export interface CanvasNode {
  id: string
  type: string
  x: number
  y: number
  width: number
  height: number
  color?: string
  text?: string
  file?: string
  subpath?: string
  url?: string
  label?: string
  background?: string
  backgroundStyle?: string
  language?: string
  code?: string
  [key: string]: unknown
}

export interface CanvasEdge {
  id: string
  fromNode: string
  fromSide?: Side
  fromEnd?: EndKind
  toNode: string
  toSide?: Side
  toEnd?: EndKind
  color?: string
  label?: string
  [key: string]: unknown
}

export interface CanvasData {
  nodes: CanvasNode[]
  edges: CanvasEdge[]
  [key: string]: unknown
}

export interface Point {
  x: number
  y: number
}

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

export interface Viewport {
  x: number
  y: number
  zoom: number
}

export const GRID = 20
export const MIN_ZOOM = 0.1
export const MAX_ZOOM = 4
export const MIN_W = 60
export const MIN_H = 40

export const EMPTY_CANVAS: CanvasData = { nodes: [], edges: [] }

export const SIDES: Side[] = ['top', 'right', 'bottom', 'left']

/** Default sizes per node type (world px). */
export const DEFAULT_SIZE: Record<NodeType, { width: number; height: number }> = {
  text: { width: 260, height: 60 },
  file: { width: 400, height: 400 },
  link: { width: 400, height: 300 },
  group: { width: 500, height: 400 },
  code: { width: 440, height: 260 }
}

// ------------------------------------------------------------------ colors

export const COLOR_PRESETS: { id: string; name: string; css: string }[] = [
  { id: '1', name: 'Red', css: 'var(--color-red)' },
  { id: '2', name: 'Orange', css: 'var(--color-orange)' },
  { id: '3', name: 'Yellow', css: 'var(--color-yellow)' },
  { id: '4', name: 'Green', css: 'var(--color-green)' },
  { id: '5', name: 'Cyan', css: 'var(--color-cyan)' },
  { id: '6', name: 'Purple', css: 'var(--color-purple)' }
]

/** CSS color for a canvas color value ("1".."6" or "#hex"), or undefined. */
export function colorCss(c: unknown): string | undefined {
  if (typeof c !== 'string' || !c) return undefined
  const preset = COLOR_PRESETS.find((p) => p.id === c)
  if (preset) return preset.css
  if (/^#[0-9a-f]{3,8}$/i.test(c)) return c
  return undefined
}

// ------------------------------------------------------------------ parse / serialize

const num = (v: unknown, d: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v.trim() && Number.isFinite(Number(v)) ? Number(v) : d)
const isSide = (s: unknown): s is Side => s === 'top' || s === 'right' || s === 'bottom' || s === 'left'

/** Parse .canvas JSON. Invalid content yields an empty canvas with valid=false. */
export function parseCanvas(text: string): { data: CanvasData; valid: boolean } {
  if (!text.trim()) return { data: { nodes: [], edges: [] }, valid: true }
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return { data: { nodes: [], edges: [] }, valid: false }
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { data: { nodes: [], edges: [] }, valid: false }
  const obj = raw as Record<string, unknown>
  const ids = new Set<string>()
  const nodes: CanvasNode[] = []
  for (const n of Array.isArray(obj.nodes) ? obj.nodes : []) {
    if (!n || typeof n !== 'object' || Array.isArray(n)) continue
    const r = n as Record<string, unknown>
    let id = typeof r.id === 'string' && r.id ? r.id : hexId()
    while (ids.has(id)) id = hexId()
    ids.add(id)
    const type = typeof r.type === 'string' ? r.type : 'text'
    const size = Object.hasOwn(DEFAULT_SIZE, type) ? DEFAULT_SIZE[type as NodeType] : DEFAULT_SIZE.text
    nodes.push({
      ...r,
      id,
      type,
      x: num(r.x, 0),
      y: num(r.y, 0),
      width: Math.max(1, num(r.width, size.width)),
      height: Math.max(1, num(r.height, size.height))
    })
  }
  const edges: CanvasEdge[] = []
  for (const e of Array.isArray(obj.edges) ? obj.edges : []) {
    if (!e || typeof e !== 'object') continue
    const r = e as Record<string, unknown>
    if (typeof r.fromNode !== 'string' || typeof r.toNode !== 'string') continue
    let id = typeof r.id === 'string' && r.id ? r.id : hexId()
    while (ids.has(id)) id = hexId()
    ids.add(id)
    const edge: CanvasEdge = { ...r, id, fromNode: r.fromNode, toNode: r.toNode }
    if (!isSide(r.fromSide)) delete edge.fromSide
    if (!isSide(r.toSide)) delete edge.toSide
    edges.push(edge)
  }
  return { data: { ...obj, nodes, edges }, valid: true }
}

export function serializeCanvas(data: CanvasData): string {
  return JSON.stringify(data, null, '\t')
}

// ------------------------------------------------------------------ geometry

export const snap = (v: number, grid = GRID): number => Math.round(v / grid) * grid

export function rectOf(n: Rect): Rect {
  return { x: n.x, y: n.y, width: n.width, height: n.height }
}

export function boundsOf(rects: Rect[]): Rect | null {
  if (!rects.length) return null
  let x1 = Infinity
  let y1 = Infinity
  let x2 = -Infinity
  let y2 = -Infinity
  for (const r of rects) {
    x1 = Math.min(x1, r.x)
    y1 = Math.min(y1, r.y)
    x2 = Math.max(x2, r.x + r.width)
    y2 = Math.max(y2, r.y + r.height)
  }
  return { x: x1, y: y1, width: x2 - x1, height: y2 - y1 }
}

export function contains(outer: Rect, inner: Rect): boolean {
  return inner.x >= outer.x && inner.y >= outer.y && inner.x + inner.width <= outer.x + outer.width && inner.y + inner.height <= outer.y + outer.height
}

export function intersects(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y
}

export function normRect(a: Point, b: Point): Rect {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(a.x - b.x), height: Math.abs(a.y - b.y) }
}

export function sidePoint(n: Rect, side: Side): Point {
  switch (side) {
    case 'top':
      return { x: n.x + n.width / 2, y: n.y }
    case 'bottom':
      return { x: n.x + n.width / 2, y: n.y + n.height }
    case 'left':
      return { x: n.x, y: n.y + n.height / 2 }
    case 'right':
      return { x: n.x + n.width, y: n.y + n.height / 2 }
  }
}

export function sideNormal(side: Side): Point {
  switch (side) {
    case 'top':
      return { x: 0, y: -1 }
    case 'bottom':
      return { x: 0, y: 1 }
    case 'left':
      return { x: -1, y: 0 }
    case 'right':
      return { x: 1, y: 0 }
  }
}

export function oppositeSide(side: Side): Side {
  return side === 'top' ? 'bottom' : side === 'bottom' ? 'top' : side === 'left' ? 'right' : 'left'
}

/** Side of `n` closest to point `p` (relative to the node's aspect ratio). */
export function nearestSide(n: Rect, p: Point): Side {
  const dx = (p.x - (n.x + n.width / 2)) / (n.width / 2 || 1)
  const dy = (p.y - (n.y + n.height / 2)) / (n.height / 2 || 1)
  if (Math.abs(dx) > Math.abs(dy)) return dx > 0 ? 'right' : 'left'
  return dy > 0 ? 'bottom' : 'top'
}

/** Pick sensible sides for an edge without explicit sides. */
export function autoSides(a: Rect, b: Rect): [Side, Side] {
  const dx = b.x + b.width / 2 - (a.x + a.width / 2)
  const dy = b.y + b.height / 2 - (a.y + a.height / 2)
  if (Math.abs(dx) / (a.width + b.width) > Math.abs(dy) / (a.height + b.height)) return dx > 0 ? ['right', 'left'] : ['left', 'right']
  return dy > 0 ? ['bottom', 'top'] : ['top', 'bottom']
}

export const ARROW_LEN = 14
export const ARROW_W = 11

export interface EdgeGeometry {
  path: string
  /** arrow head polygons (points attr) */
  fromArrow?: string
  toArrow?: string
  mid: Point
  /** endpoint positions (for hit testing / handles) */
  p1: Point
  p2: Point
  /** the cubic as numbers [ax, ay, c1x, c1y, c2x, c2y, bx, by] (canvas drawing without parsing `path`) */
  curve: number[]
  /** arrow head triangles as [x1, y1, x2, y2, x3, y3] */
  fromArrowPts?: number[]
  toArrowPts?: number[]
}

function arrowPts(tip: Point, normal: Point): number[] {
  const bx = tip.x + normal.x * ARROW_LEN
  const by = tip.y + normal.y * ARROW_LEN
  const px = -normal.y * (ARROW_W / 2)
  const py = normal.x * (ARROW_W / 2)
  return [tip.x, tip.y, bx + px, by + py, bx - px, by - py]
}

const polyOf = (p: number[]): string => `${p[0]},${p[1]} ${p[2]},${p[3]} ${p[4]},${p[5]}`

const bez = (t: number, a: number, b: number, c: number, d: number): number => {
  const u = 1 - t
  return u * u * u * a + 3 * u * u * t * b + 3 * u * t * t * c + t * t * t * d
}

/**
 * Bezier between two side anchors. `s2` may be null for a free endpoint (edge being dragged).
 */
export function edgeGeometry(p1: Point, s1: Side, p2: Point, s2: Side | null, fromArrow: boolean, toArrow: boolean): EdgeGeometry {
  const n1 = sideNormal(s1)
  const n2 = s2 ? sideNormal(s2) : null
  const a = fromArrow ? { x: p1.x + n1.x * ARROW_LEN, y: p1.y + n1.y * ARROW_LEN } : p1
  const b = toArrow && n2 ? { x: p2.x + n2.x * ARROW_LEN, y: p2.y + n2.y * ARROW_LEN } : p2
  const dist = Math.hypot(b.x - a.x, b.y - a.y)
  const k = Math.max(30, Math.min(dist * 0.5, 220))
  const c1 = { x: a.x + n1.x * k, y: a.y + n1.y * k }
  const c2 = n2 ? { x: b.x + n2.x * k, y: b.y + n2.y * k } : { x: b.x - (b.x - c1.x) * 0.3, y: b.y - (b.y - c1.y) * 0.3 }
  const path = `M ${a.x} ${a.y} C ${c1.x} ${c1.y}, ${c2.x} ${c2.y}, ${b.x} ${b.y}`
  const mid = { x: bez(0.5, a.x, c1.x, c2.x, b.x), y: bez(0.5, a.y, c1.y, c2.y, b.y) }
  let toPts: number[] | undefined
  if (toArrow) {
    if (n2) toPts = arrowPts(p2, n2)
    else {
      // free end: point along the curve's final direction
      const dx = b.x - c2.x
      const dy = b.y - c2.y
      const len = Math.hypot(dx, dy) || 1
      toPts = arrowPts(p2, { x: -dx / len, y: -dy / len })
    }
  }
  const fromPts = fromArrow ? arrowPts(p1, n1) : undefined
  return {
    path,
    fromArrow: fromPts && polyOf(fromPts),
    toArrow: toPts && polyOf(toPts),
    mid,
    p1,
    p2,
    curve: [a.x, a.y, c1.x, c1.y, c2.x, c2.y, b.x, b.y],
    fromArrowPts: fromPts,
    toArrowPts: toPts
  }
}

/** Resolve the geometry of a stored edge (null if an endpoint is missing). */
export function geometryForEdge(e: CanvasEdge, byId: Map<string, CanvasNode>): EdgeGeometry | null {
  const a = byId.get(e.fromNode)
  const b = byId.get(e.toNode)
  if (!a || !b) return null
  const [as, bs] = autoSides(a, b)
  const s1 = e.fromSide ?? as
  const s2 = e.toSide ?? bs
  return edgeGeometry(sidePoint(a, s1), s1, sidePoint(b, s2), s2, e.fromEnd === 'arrow', (e.toEnd ?? 'arrow') === 'arrow')
}

// ------------------------------------------------------------------ misc

/** Nodes fully contained in any of the given groups (recursively), excluding the groups themselves. */
export function nodesInsideGroups(nodes: CanvasNode[], groupIds: Iterable<string>, isContainer: (n: CanvasNode) => boolean = (n) => n.type === 'group'): Set<string> {
  const out = new Set<string>()
  const queue = [...groupIds]
  const seen = new Set(queue)
  while (queue.length) {
    const gid = queue.pop()
    const g = nodes.find((n) => n.id === gid)
    if (!g) continue
    for (const n of nodes) {
      if (n.id === g.id || out.has(n.id) || seen.has(n.id)) continue
      if (contains(g, n)) {
        out.add(n.id)
        if (isContainer(n)) {
          seen.add(n.id)
          queue.push(n.id)
        }
      }
    }
  }
  return out
}

export function isHttpsUrl(u: string): boolean {
  return /^https:\/\//i.test(u.trim())
}

export function looksLikeUrl(s: string): boolean {
  return /^https?:\/\/[^\s]+$/i.test(s.trim())
}

/** Deep-ish clone of a set of nodes/edges with fresh ids, offset by (dx, dy). */
export function cloneWithNewIds(nodes: CanvasNode[], edges: CanvasEdge[], dx: number, dy: number): { nodes: CanvasNode[]; edges: CanvasEdge[] } {
  const map = new Map<string, string>()
  const nn = nodes.map((n) => {
    const id = hexId()
    map.set(n.id, id)
    return { ...structuredClone(n), id, x: n.x + dx, y: n.y + dy }
  })
  const ne = edges
    .filter((e) => map.has(e.fromNode) && map.has(e.toNode))
    .map((e) => ({ ...structuredClone(e), id: hexId(), fromNode: map.get(e.fromNode)!, toNode: map.get(e.toNode)! }))
  return { nodes: nn, edges: ne }
}

/** Toggle the n-th task checkbox source line (0-based line index). */
export function toggleTaskLine(text: string, line: number, checked: boolean): string {
  const lines = text.split('\n')
  if (line < 0 || line >= lines.length) return text
  lines[line] = lines[line].replace(/^(\s*(?:[-*+]|\d+[.)])\s+\[)[ xX]?(\])/, `$1${checked ? 'x' : ' '}$2`)
  return lines.join('\n')
}
