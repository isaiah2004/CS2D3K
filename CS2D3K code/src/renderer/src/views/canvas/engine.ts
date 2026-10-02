// Extension points of the canvas engine (CanvasEngine.tsx).
// `.canvas` uses the engine with no extension; richer views (form-map) plug in node types, edge styling,
// menus, keyboard handling, overlays and lifecycle hooks.
import type { ComponentType, ReactNode } from 'react'
import type { MenuItem } from '@/store/ui'
import type { NodeApi } from './nodes'
import type { CreateKind } from './controls'
import type { CanvasData, CanvasEdge, CanvasNode, Point, Side, Viewport } from './model'
import type { LodNodeStyle } from './lodLayer'

export interface NodeBodyProps {
  node: CanvasNode
  selected: boolean
  editing: boolean
  api: NodeApi
  /** level of detail: zoomed far out (or not yet upgraded) — render only what is legible (title, kind), skip heavy content */
  lod?: boolean
}

/** A custom node type. Keep these objects stable (module-level) so node memoization works. */
export interface NodeTypeDef {
  Body: ComponentType<NodeBodyProps>
  /** 'back' renders behind edges (like groups), 'front' above cards (annotations) */
  layer?: 'back' | 'normal' | 'front'
  /** behaves like a group: nodes fully inside move with it, marquee needs full containment */
  container?: boolean
  /** no default card frame (.canvas-node-container) — the body draws its own */
  bare?: boolean
  /** show connection handles (default true) */
  connectable?: boolean
  canMove?(node: CanvasNode): boolean
  canResize?(node: CanvasNode): boolean
  /** double-click / Enter starts inline editing (editing=true is passed to Body) */
  editable?: boolean
  className?(node: CanvasNode): string | undefined
}

export interface EdgeAppearance {
  color?: string
  dashed?: boolean
  /** label shown when the edge has no explicit label */
  label?: string
  className?: string
  /** drawn faded (used by the canvas layer, which can't see `className`) */
  dim?: boolean
}

/** Live render context passed to overlay renderers. */
export interface EngineRenderCtx {
  /** the viewport as of the last React render (throttled while the camera moves; use api.onViewportChange for per-frame) */
  vp: Viewport
  size: { w: number; h: number }
  selection: Set<string>
  /** ids being dragged right now (null when not moving) */
  moving: Set<string> | null
  interacting: boolean
  api: EngineApi
}

/** Imperative handle of a mounted engine. */
export interface EngineApi {
  root(): HTMLDivElement | null
  data(): CanvasData
  getSelection(): string[]
  select(ids: string[]): void
  getViewport(): Viewport
  setViewport(v: Viewport, animate?: boolean): void
  /** called on every camera change (per frame while panning / zooming — keep it cheap, no React state); returns unsubscribe */
  onViewportChange(cb: (v: Viewport) => void): () => void
  viewSize(): { w: number; h: number }
  toWorld(clientX: number, clientY: number): Point
  toScreen(p: Point): Point
  viewCenter(): Point
  /** fly to fit these node ids */
  fitNodes(ids: string[], maxZoom?: number, animate?: boolean): void
  fitAll(): void
  /** add a node centered at `at` (default: a free spot near the view center); optionally connected */
  addNode(partial: Partial<CanvasNode> & { type: string }, at?: Point, connect?: { from: string; side: Side }): CanvasNode
  /** run a built-in canvas creation (text card, note from vault picker, code cell, web page prompt, group) */
  create(kind: CreateKind, at?: Point): void
  setEditing(id: string | null): void
  startEditing(id: string): void
  focus(): void
  deleteSelection(): void
}

export interface CanvasExtension {
  nodeTypes?: Record<string, NodeTypeDef>
  /** extra classes per node (e.g. dimming) — must be cheap */
  nodeClass?(node: CanvasNode): string | undefined
  /** how a node looks when drawn as a placeholder on the canvas layer (huge zoomed-out boards) — must be cheap */
  nodeLod?(node: CanvasNode): LodNodeStyle | undefined
  edgeAppearance?(edge: CanvasEdge): EdgeAppearance | undefined
  /** transform a freshly connected edge (e.g. infer a relation) */
  onEdgeCreate?(edge: CanvasEdge, data: CanvasData): CanvasEdge
  /** items for the menu shown when an edge is dropped on empty space */
  edgeDropItems?(at: Point, connect: { from: string; side: Side }): MenuItem[]
  /** called after a move-drag ends (same undo step: update with history:false) */
  onMoveEnd?(ids: string[], e: PointerEvent): void
  /** return true to consume */
  onPointerDown?(e: React.PointerEvent, world: Point): boolean
  onDoubleClick?(e: React.MouseEvent, world: Point, node: CanvasNode | null): boolean
  /** called before the engine's shortcuts (not while typing in an editor); return true to consume */
  onKeyDown?(e: React.KeyboardEvent): boolean
  nodeMenu?(node: CanvasNode, items: MenuItem[], selection: CanvasNode[]): MenuItem[]
  edgeMenu?(edge: CanvasEdge, items: MenuItem[]): MenuItem[]
  backgroundMenu?(at: Point, items: MenuItem[]): MenuItem[]
  onSelectionChange?(ids: string[]): void
  /** replaces the bottom creation toolbar (null = none) */
  toolbar?: ReactNode
  /** replaces the default header actions */
  headerActions?: ReactNode
  /** replaces the status bar text */
  status?(ctx: EngineRenderCtx): ReactNode
  /** screen-space overlay (HUD, minimap, pitch controls…) */
  renderOverlay?(ctx: EngineRenderCtx): ReactNode
  /** world-space overlay (drop targets, pen preview…), rendered above cards */
  renderWorld?(ctx: EngineRenderCtx): ReactNode
  /** hide zoom controls, toolbar and selection toolbar */
  hideChrome?: boolean
  className?: string
  /** tab.state key used to persist the viewport (default 'viewport') */
  viewportKey?: string
  /** max zoom used by "zoom to fit" (default 1) */
  fitMaxZoom?: number
}
