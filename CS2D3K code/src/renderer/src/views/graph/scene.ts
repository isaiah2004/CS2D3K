// Data shared between the graph engine and its renderers (WebGL2 or the Canvas 2D fallback).
// Everything per node / per link lives in flat typed arrays indexed by node / link index; the engine flags
// what changed in `dirty` and the renderer uploads only that on its next draw.
import type { NodeKind } from './data'

export interface GNode {
  id: string
  kind: NodeKind
  label: string
  path?: string
  tag?: string
  link?: string
  groupColor?: string
  /** index into the scene arrays */
  index: number
  degree: number
  /** world radius */
  r: number
  /** label width in CSS px at the base font size (-1 = not measured) */
  lw: number
  /** renderer-owned label cache (atlas slot) */
  lab: unknown
}

export type RGBA = [number, number, number, number]

export const DIRTY_POS = 1
export const DIRTY_PROPS = 2
export const DIRTY_COLORS = 4
export const DIRTY_EDGES = 8
export const DIRTY_HL = 16
export const DIRTY_ALL = 31

export interface Scene {
  n: number
  /** padded node capacity (multiple of the position texture width) */
  cap: number
  m: number
  nodes: GNode[]
  /** x, y per node (length 2 * cap) */
  pos: Float32Array
  /** world radius, appear start time (ms, engine clock) per node (length 2 * cap) */
  props: Float32Array
  /** straight RGBA8 per node (length 4 * cap) */
  colors: Uint8Array
  /** per link: source index | direction bits << 30, target index (length 2 * m) */
  edges: Uint32Array
  /** highlighted nodes (hover source first) and links (same packing as `edges`) */
  hlNodes: Uint32Array
  hlNodeCount: number
  hlEdges: Uint32Array
  hlEdgeCount: number
  dirty: number
}

export interface LabelList {
  count: number
  idx: Int32Array
  alpha: Float32Array
  /** label font size in CSS px */
  fontPx: number
  font: string
}

export interface FrameParams {
  width: number
  height: number
  dpr: number
  cam: { x: number; y: number; k: number }
  time: number
  /** the zoom level changed recently (labels may be scaled instead of re-rasterized) */
  zooming: boolean
  /** camera or layout in motion (cached layers may be drawn at reduced resolution) */
  moving: boolean
  minR: number
  fade: number
  hlSource: number
  dimNode: number
  dimEdge: number
  linePx: number
  arrowAlpha: number
  /** arrow length in world units */
  arrowSize: number
  focus: number
  focusAlpha: number
  line: RGBA
  accent: RGBA
  text: RGBA
  bg: RGBA
  labels: LabelList
}

export interface Renderer {
  readonly kind: 'webgl2' | 'canvas2d'
  resize(width: number, height: number, dpr: number): void
  /** draws the frame; returns true when it needs another frame (labels still being rasterized) */
  draw(scene: Scene, f: FrameParams): boolean
  /** RGB at a CSS pixel of the last drawn frame (draws first so the drawing buffer is valid) */
  readPixel(scene: Scene, f: FrameParams, x: number, y: number): [number, number, number]
  /** forget cached label rasters (font changed) */
  resetLabels(): void
  /** drop cached layers so the next draw renders everything (benchmarks measure full redraws) */
  invalidate(): void
  /** block until the GPU finished (benchmarks) */
  finish(): void
  destroy(): void
  /** set when the GPU context is lost; the engine redraws once `onRestore` fires */
  lost: boolean
  onRestore: (() => void) | null
}

/** "#rgb", "#rrggbb" or "#rrggbbaa" → RGBA 0..1 (null if not a hex color) */
export function parseHex(c: string): RGBA | null {
  const m = /^#([0-9a-f]{3,8})$/i.exec(c.trim())
  if (!m) return null
  let h = m[1]
  if (h.length === 3 || h.length === 4) h = [...h].map((x) => x + x).join('')
  if (h.length !== 6 && h.length !== 8) return null
  const v = (i: number): number => parseInt(h.slice(i, i + 2), 16) / 255
  return [v(0), v(2), v(4), h.length === 8 ? v(6) : 1]
}

export const cssRgba = (c: RGBA, alpha = 1): string =>
  `rgba(${Math.round(c[0] * 255)},${Math.round(c[1] * 255)},${Math.round(c[2] * 255)},${c[3] * alpha})`
