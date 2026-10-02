// Viewport culling + level of detail for the canvas engine.
// Only nodes whose rect intersects the "covered" world rect (the view plus a generous margin) are mounted; the covered
// rect is recomputed when the camera leaves it or settles — never per frame. Below LOD_ZOOM cards render as light
// placeholders (no markdown, CodeMirror, iframes or images).
import type { CanvasNode, EdgeGeometry, Rect, Viewport } from './model'

/** below this zoom, cards render as placeholders (and `.is-zoomed-out` styles apply) */
export const LOD_ZOOM = 0.5
/** extra world area mounted around the view, as a fraction of the view size on each side */
export const CULL_MARGIN = 0.35
/** zoomed out with more nodes than this around the view, cards are drawn on the canvas layer instead of the DOM */
export const DOM_BUDGET = 100
/** never pin more than this many selected nodes outside the covered rect (Ctrl+A on a huge board) */
export const MAX_PINNED_SELECTION = 400

/** World rect seen through a viewport of `w`×`h` screen px. */
export function viewRect(v: Viewport, w: number, h: number): Rect {
  return { x: -v.x / v.zoom, y: -v.y / v.zoom, width: w / v.zoom, height: h / v.zoom }
}

export function expandRect(r: Rect, fx: number, fy = fx): Rect {
  const mx = r.width * fx
  const my = r.height * fy
  return { x: r.x - mx, y: r.y - my, width: r.width + 2 * mx, height: r.height + 2 * my }
}

export function containsRect(outer: Rect, inner: Rect): boolean {
  return inner.x >= outer.x && inner.y >= outer.y && inner.x + inner.width <= outer.x + outer.width && inner.y + inner.height <= outer.y + outer.height
}

const CELL = 1024

/**
 * Uniform grid over node rects (world units). Built once per node array (O(n)); queries touch only the cells under
 * the query rect, so finding what is on screen doesn't scan every node.
 */
export class SpatialIndex {
  private cells = new Map<number, number[]>()
  /** nodes too large to bucket (giant groups / zones) are always checked */
  private large: number[] = []

  constructor(readonly nodes: CanvasNode[]) {
    nodes.forEach((n, i) => {
      const x0 = Math.floor(n.x / CELL)
      const y0 = Math.floor(n.y / CELL)
      const x1 = Math.floor((n.x + n.width) / CELL)
      const y1 = Math.floor((n.y + n.height) / CELL)
      if ((x1 - x0 + 1) * (y1 - y0 + 1) > 64) {
        this.large.push(i)
        return
      }
      for (let cx = x0; cx <= x1; cx++)
        for (let cy = y0; cy <= y1; cy++) {
          const k = key(cx, cy)
          const list = this.cells.get(k)
          if (list) list.push(i)
          else this.cells.set(k, [i])
        }
    })
  }

  /** ids of nodes intersecting `r` */
  query(r: Rect): Set<string> {
    const out = new Set<string>()
    const hit = (i: number): void => {
      const n = this.nodes[i]
      if (n.x < r.x + r.width && n.x + n.width > r.x && n.y < r.y + r.height && n.y + n.height > r.y) out.add(n.id)
    }
    const x0 = Math.floor(r.x / CELL)
    const y0 = Math.floor(r.y / CELL)
    const x1 = Math.floor((r.x + r.width) / CELL)
    const y1 = Math.floor((r.y + r.height) / CELL)
    if ((x1 - x0 + 1) * (y1 - y0 + 1) > this.cells.size) {
      // the query covers more cells than exist: a linear pass is cheaper
      for (let i = 0; i < this.nodes.length; i++) hit(i)
      return out
    }
    for (let cx = x0; cx <= x1; cx++)
      for (let cy = y0; cy <= y1; cy++) {
        const list = this.cells.get(key(cx, cy))
        if (list) for (const i of list) hit(i)
      }
    for (const i of this.large) hit(i)
    return out
  }
}

// cell coordinates fit comfortably in 2^20 (± a billion world px)
const key = (cx: number, cy: number): number => (cx + 524288) * 1048576 + (cy + 524288)

/** Bounding box of an edge curve (endpoints, control polygon and arrow heads). */
export function geometryBounds(g: EdgeGeometry): Rect {
  // the bezier lies inside its control polygon; control points stay within 220 + arrow length of the endpoints
  const pad = 240
  const x1 = Math.min(g.p1.x, g.p2.x) - pad
  const y1 = Math.min(g.p1.y, g.p2.y) - pad
  const x2 = Math.max(g.p1.x, g.p2.x) + pad
  const y2 = Math.max(g.p1.y, g.p2.y) + pad
  return { x: x1, y: y1, width: x2 - x1, height: y2 - y1 }
}

/** Plain-text title + excerpt of a markdown card, for placeholders. */
export function textExcerpt(text: string, maxBody = 160): { title: string; body: string } {
  const lines = text.split('\n')
  let title = ''
  const body: string[] = []
  let len = 0
  let fence = false
  for (const raw of lines) {
    if (/^\s*(```|~~~)/.test(raw)) {
      fence = !fence
      continue
    }
    const l = fence ? raw.trim() : stripMd(raw)
    if (!l) continue
    if (!title) title = l
    else if (len < maxBody) {
      body.push(l)
      len += l.length + 1
    } else break
  }
  const b = body.join(' · ')
  return { title, body: b.length > maxBody ? b.slice(0, maxBody - 1) + '…' : b }
}

function stripMd(line: string): string {
  return line
    .replace(/^\s{0,3}(#{1,6}\s+|>\s?|[-*+]\s+(\[[ xX]\]\s+)?|\d+[.)]\s+)/, '')
    .replace(/!?\[\[([^\]|]*)(?:\|([^\]]*))?\]\]/g, (_, a: string, b?: string) => b ?? a)
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/(\*\*|__|\*|_|~~|==|`)/g, '')
    .trim()
}
