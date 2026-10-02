// Map lens: the canvas engine + form-map extension (form cards, semantic zones, relations, mind-map keys,
// why-trace, minimap, layout tools, pen and pitch mode).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Maximize,
  Search,
  X,
  ChevronLeft,
  ChevronRight,
  Lock,
  LockOpen,
  LayoutGrid,
  Presentation,
  Pencil,
  CornerDownRight,
  ArrowDown,
  Shapes,
  ThumbsUp,
  ThumbsDown,
  Link2,
  AlignStartVertical,
  AlignCenterVertical,
  AlignEndVertical,
  AlignStartHorizontal,
  AlignCenterHorizontal,
  AlignEndHorizontal,
  AlignHorizontalDistributeCenter,
  AlignVerticalDistributeCenter,
  SquareDashed,
  Type,
  FileText,
  SquareCode,
  Globe,
  Group as GroupIcon,
  PenLine,
  Filter
} from 'lucide-react'
import type { LensProps } from '../context'
import CanvasEngine from '../../canvas/CanvasEngine'
import type { CanvasExtension, EdgeAppearance, EngineApi, EngineRenderCtx } from '../../canvas/engine'
import type { LodNodeStyle } from '../../canvas/lodLayer'
import { snap, colorCss, type CanvasData, type CanvasEdge, type CanvasNode, type Point } from '../../canvas/model'
import { useUi, notice, type MenuItem } from '@/store/ui'
import { hexId, clamp } from '@/lib/util'
import {
  KINDS,
  KIND_ORDER,
  RELATIONS,
  applyZone,
  cardTitle,
  fieldDef,
  isForm,
  isZone,
  newForm,
  optionOf,
  zoneAt,
  zoneIn,
  zones,
  type DrawingNode,
  type FormKind,
  type FormMapEdge,
  type FormNode,
  type Relation,
  type ZoneNode
} from '../schema'
import { whyTrace } from '../analysis'
import { celebrate, isWin } from '../fun/celebrate'
import Hud from '../fun/Hud'
import { MAP_NODE_TYPES } from './mapNodes'
import { MapActionsContext, MapContext, type MapActions, type MapContextValue } from './mapContext'
import MapToolbar, { type PenState } from './MapToolbar'
import Minimap from './Minimap'
import {
  inferRelation,
  childKind,
  parentEdge,
  zoneAtPoint,
  centerIn,
  findFree,
  alignTargets,
  distributeTargets,
  tidyZone,
  simplify,
  smoothPath,
  type AlignMode
} from './logic'
import { useWorkspace } from '@/store/workspace'
import './map.css'

interface Chip {
  id: number
  text: string
  x: number
  y: number
  tone: 'good' | 'info'
}

let chipSeq = 0
const sameSet = (a: string[], b: string[]): boolean => a.length === b.length && a.every((x) => b.includes(x))
const easeInOut = (t: number): number => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2)

export default function MapLens({ ctl }: LensProps) {
  // the shell keeps the map mounted (hidden) while another lens shows, so switching back is instant
  const active = ctl.lens === 'map'
  const engineRef = useRef<EngineApi | null>(null)
  const ctlRef = useRef(ctl)
  ctlRef.current = ctl
  const data = ctl.data
  const doc = ctl.doc
  const docRef = useRef(doc)
  docRef.current = doc
  const eng = (): EngineApi | null => engineRef.current
  const latest = (): CanvasData => docRef.current.data

  const [pen, setPenState] = useState<PenState | null>(null)
  const penRef = useRef(pen)
  penRef.current = pen
  const [stroke, setStroke] = useState<number[] | null>(null)
  const [pitch, setPitch] = useState<number | null>(null)
  const pitchRef = useRef(pitch)
  pitchRef.current = pitch
  const inspectorBeforePitch = useRef<boolean | null>(null)
  const sidebarsBeforePitch = useRef<{ left: boolean; right: boolean } | null>(null)
  const restoreSidebars = useCallback(() => {
    const prev = sidebarsBeforePitch.current
    if (!prev) return
    sidebarsBeforePitch.current = null
    const ws = useWorkspace.getState()
    ws.toggleSidebar('left', prev.left)
    ws.toggleSidebar('right', prev.right)
  }, [])
  // closing the tab mid-pitch must not leave the sidebars hidden
  useEffect(() => restoreSidebars, [restoreSidebars])
  const [chips, setChips] = useState<Chip[]>([])
  const [fresh, setFresh] = useState<Set<string>>(() => new Set())
  const [wiggle, setWiggle] = useState<Set<string>>(() => new Set())
  const [pulse, setPulse] = useState<Set<string> | null>(null)

  const setPen = useCallback((p: PenState | null) => {
    setPenState(p)
    if (p) eng()?.select([])
  }, [])

  // ---------------------------------------------------------------- feedback
  const chip = useCallback((text: string, clientX: number, clientY: number, tone: 'good' | 'info' = 'info') => {
    const r = eng()?.root()?.getBoundingClientRect()
    if (!r) return
    const c: Chip = { id: ++chipSeq, text, x: clientX - r.left, y: clientY - r.top, tone }
    setChips((cs) => [...cs.slice(-5), c])
    setTimeout(() => setChips((cs) => cs.filter((x) => x.id !== c.id)), 1700)
  }, [])

  const flash = useCallback((setter: typeof setFresh, ids: string[], ms: number) => {
    setter((s) => new Set([...s, ...ids]))
    setTimeout(() => setter((s) => new Set([...s].filter((x) => !ids.includes(x)))), ms)
  }, [])

  /** client coords of a world point */
  const clientOf = useCallback((p: Point): Point => {
    const e = eng()
    const r = e?.root()?.getBoundingClientRect()
    if (!e || !r) return { x: 0, y: 0 }
    const s = e.toScreen(p)
    return { x: s.x + r.left, y: s.y + r.top }
  }, [])

  /** keep a node in view (pans at the current zoom if it is off screen) */
  const ensureVisible = useCallback((n: { x: number; y: number; width: number; height: number }) => {
    const e = eng()
    if (!e) return
    const v = e.getViewport()
    const { w, h } = e.viewSize()
    const cx = n.x + n.width / 2
    const cy = n.y + n.height / 2
    // only move when the card's center is out of comfortable view
    const c = e.toScreen({ x: cx, y: cy })
    if (c.x > 60 && c.y > 60 && c.x < w - 60 && c.y < h - 100) return
    e.setViewport({ x: w / 2 - cx * v.zoom, y: h / 2 - cy * v.zoom, zoom: v.zoom })
  }, [])

  // ---------------------------------------------------------------- creation
  /** after a card was created: pop, select, edit */
  const afterCreate = useCallback(
    (node: CanvasNode, edit = true) => {
      flash(setFresh, [node.id], 700)
      const e = eng()
      e?.select([node.id])
      ensureVisible(node)
      if (edit) e?.setEditing(node.id)
    },
    [flash, ensureVisible]
  )

  /** apply zone fields to a freshly added card (same undo step) */
  const assignZone = useCallback((id: string) => {
    docRef.current.update(
      (d) => {
        let changed = false
        const nodes = d.nodes.map((n) => {
          if (n.id !== id || !isForm(n)) return n
          const m = applyZone(n, zoneAt(d, n))
          if (m !== n) changed = true
          return m
        })
        return changed ? { ...d, nodes } : d
      },
      { history: false }
    )
  }, [])

  const createForm = useCallback(
    (kind: FormKind, at?: Point, connect?: { from: string; side: 'top' | 'right' | 'bottom' | 'left' }) => {
      const e = eng()
      if (!e) return
      const def = KINDS[kind]
      const node = e.addNode({ type: 'form', kind, title: '', text: '', fields: {}, ...def.defaultSize }, at, connect)
      assignZone(node.id)
      afterCreate(node)
    },
    [assignZone, afterCreate]
  )

  const createZone = useCallback(
    (at?: Point) => {
      const e = eng()
      if (!e) return
      const node = e.addNode({ type: 'zone', label: 'New zone', emoji: '✨', prompt: 'What belongs here?', locked: false, width: 760, height: 520 }, at)
      flash(setFresh, [node.id], 700)
      e.setEditing(node.id)
    },
    [flash]
  )

  // ---------------------------------------------------------------- mind-map keys
  const mindmap = useCallback(
    (mode: 'child' | 'sibling', id: string) => {
      const d = latest()
      const s = d.nodes.find((n) => n.id === id)
      if (!s || !isForm(s)) return
      const kind = mode === 'child' ? childKind(s.kind) : s.kind
      const size = KINDS[kind].defaultSize
      let edge: FormMapEdge | null = null
      let pos: Point
      const nid = hexId()
      if (mode === 'child') {
        pos = { x: snap(s.x + s.width + 100), y: snap(s.y) }
        edge = { id: hexId(), fromNode: nid, fromSide: 'left', toNode: s.id, toSide: 'right', relation: inferRelation(kind, s.kind) }
      } else {
        pos = { x: s.x, y: snap(s.y + s.height + 30) }
        const pe = parentEdge(d, s.id)
        if (pe) edge = { id: hexId(), fromNode: nid, fromSide: pe.fromSide, toNode: pe.toNode, toSide: pe.toSide, relation: pe.relation }
      }
      const free = findFree(d, { ...pos, ...size })
      let node: FormNode = newForm(kind, { x: free.x, y: free.y }, { id: nid })
      node = applyZone(node, zoneAt(d, node))
      docRef.current.update((dd) => ({ ...dd, nodes: [...dd.nodes, node], edges: edge ? [...dd.edges, edge] : dd.edges }))
      afterCreate(node)
    },
    [afterCreate]
  )

  // ---------------------------------------------------------------- field actions
  const setField = useCallback(
    (id: string, key: string, value: unknown, at?: { clientX: number; clientY: number }) => {
      const n = latest().nodes.find((x) => x.id === id)
      if (!n || !isForm(n)) return
      const prev = n.fields?.[key]
      if (prev === value) return
      ctlRef.current.updateForm(id, { fields: { [key]: value } })
      if (isWin(n.kind, key, value) && at) celebrate(at.clientX, at.clientY)
    },
    []
  )

  const fieldMenu = useCallback(
    (id: string, key: string, e: React.MouseEvent) => {
      const n = latest().nodes.find((x) => x.id === id)
      if (!n || !isForm(n)) return
      const f = fieldDef(n.kind, key)
      if (!f?.options) return
      const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
      const at = { clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 }
      const items: MenuItem[] = f.options.map((o) => ({
        label: o.label,
        icon: <span className="fm-menu-dot" style={{ background: o.color ?? 'var(--text-faint)' }} />,
        checked: n.fields?.[key] === o.value,
        onClick: () => setField(id, key, o.value, at)
      }))
      if (n.fields?.[key] !== undefined) items.push({ separator: true }, { label: `Clear ${f.label.toLowerCase()}`, icon: <X />, onClick: () => setField(id, key, undefined) })
      useUi.getState().showMenu({ x: r.left, y: r.bottom + 4 }, items)
    },
    [setField]
  )

  const vote = useCallback(
    (id: string, delta: number, at?: { clientX: number; clientY: number }) => {
      const n = latest().nodes.find((x) => x.id === id)
      if (!n || !isForm(n)) return
      const v = Math.max(0, (n.votes ?? 0) + delta)
      if (v === (n.votes ?? 0)) return
      ctlRef.current.updateForm(id, { votes: v || undefined })
      if (at) chip(delta > 0 ? '+1 vote' : '−1 vote', at.clientX, at.clientY - 12, delta > 0 ? 'good' : 'info')
    },
    [chip]
  )

  const toggleZoneLock = useCallback(
    (id: string) => {
      const z = latest().nodes.find((x) => x.id === id) as ZoneNode | undefined
      if (!z) return
      const locked = z.locked !== false
      docRef.current.update((d) => ({ ...d, nodes: d.nodes.map((n) => (n.id === id ? { ...n, locked: !locked } : n)) }))
      const c = clientOf({ x: z.x + 120, y: z.y })
      chip(locked ? '🔓 Unlocked — drag to move, edges to resize' : '🔒 Locked', c.x, c.y, 'info')
    },
    [chip, clientOf]
  )

  // stable action object for node bodies
  const fns = useRef({ setField, fieldMenu, vote, mindmap, toggleZoneLock, chip })
  fns.current = { setField, fieldMenu, vote, mindmap, toggleZoneLock, chip }
  const actions = useMemo<MapActions>(
    () => ({
      setField: (...a) => fns.current.setField(...a),
      fieldMenu: (...a) => fns.current.fieldMenu(...a),
      vote: (...a) => fns.current.vote(...a),
      mindmap: (...a) => fns.current.mindmap(...a),
      toggleZoneLock: (...a) => fns.current.toggleZoneLock(...a),
      chip: (...a) => fns.current.chip(...a)
    }),
    []
  )

  const zoneCounts = useMemo(() => {
    const m = new Map<string, number>()
    const zs = zones(data)
    for (const n of data.nodes) {
      if (isZone(n) || n.type === 'drawing') continue
      const z = zoneIn(zs, n)
      if (z) m.set(z.id, (m.get(z.id) ?? 0) + 1)
    }
    return m
  }, [data])
  const mapCtx = useMemo<MapContextValue>(() => ({ actions, zoneCounts }), [actions, zoneCounts])

  // ---------------------------------------------------------------- tweened layout changes
  const tween = useCallback((targets: Map<string, Point>, zonePatch?: { id: string; height: number }) => {
    if (!targets.size && !zonePatch) return
    const d0 = latest()
    const starts = new Map<string, Point>()
    for (const n of d0.nodes) if (targets.has(n.id)) starts.set(n.id, { x: n.x, y: n.y })
    docRef.current.checkpoint()
    const t0 = performance.now()
    const dur = 340
    const apply = (k: number, final: boolean): void =>
      docRef.current.update(
        (d) => ({
          ...d,
          nodes: d.nodes.map((n) => {
            if (zonePatch && n.id === zonePatch.id) return { ...n, height: zonePatch.height }
            const a = starts.get(n.id)
            const b = targets.get(n.id)
            if (!a || !b) return n
            return final ? { ...n, x: b.x, y: b.y } : { ...n, x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k }
          })
        }),
        { history: false }
      )
    const step = (now: number): void => {
      const t = Math.min(1, (now - t0) / dur)
      apply(easeInOut(t), t >= 1)
      if (t < 1) requestAnimationFrame(step)
    }
    requestAnimationFrame(step)
  }, [])

  const tidy = useCallback(
    (zoneId: string) => {
      const z = latest().nodes.find((n) => n.id === zoneId)
      if (!z || !isZone(z)) return
      const { targets, height } = tidyZone(latest(), z)
      tween(targets, height !== z.height ? { id: z.id, height } : undefined)
    },
    [tween]
  )

  const align = useCallback((ids: string[], mode: AlignMode) => tween(alignTargets(latest().nodes.filter((n) => ids.includes(n.id)), mode)), [tween])
  const distribute = useCallback((ids: string[], axis: 'x' | 'y') => tween(distributeTargets(latest().nodes.filter((n) => ids.includes(n.id)), axis)), [tween])

  // ---------------------------------------------------------------- why-trace + reveal
  const toggleWhy = useCallback(() => {
    const c = ctlRef.current
    const sel = (eng()?.getSelection() ?? []).filter((id) => latest().nodes.some((n) => n.id === id && isForm(n)))
    if (!sel.length) {
      if (c.highlight) c.setHighlight(null)
      else notice('Select a card, then press W to trace why it exists')
      return
    }
    const ids = [...new Set(sel.flatMap((id) => whyTrace(latest(), id)))]
    if (c.highlight && sameSet(c.highlight, ids)) c.setHighlight(null)
    else c.setHighlight(ids)
  }, [])

  const reveal = useCallback(
    (ids: string[], opts?: { select?: boolean }) => {
      const e = eng()
      if (!e) return
      const nodeIds = ids.filter((id) => latest().nodes.some((n) => n.id === id))
      if (!nodeIds.length) return
      e.fitNodes(nodeIds, 1)
      if (opts?.select) e.select(nodeIds)
      setPulse(new Set(nodeIds))
      setTimeout(() => setPulse(null), 1500)
    },
    []
  )

  // ---------------------------------------------------------------- pitch mode
  const slides = useMemo(
    () =>
      zones(data)
        .filter((z) => typeof z.order === 'number')
        .sort((a, b) => (a.order ?? 0) - (b.order ?? 0)),
    [data]
  )
  const slidesRef = useRef(slides)
  slidesRef.current = slides

  const goSlide = useCallback((i: number) => {
    const list = slidesRef.current
    if (!list.length) return
    const idx = clamp(i, 0, list.length - 1)
    setPitch(idx)
    // frame the zone between the title card and the slide bar (after layout: the inspector may have just closed)
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        const e = eng()
        const z = list[idx]
        if (!e) return
        const { w, h } = e.viewSize()
        const top = 150
        const bottom = 80
        const zoom = clamp(Math.min((w - 120) / z.width, (h - top - bottom) / z.height), 0.1, 1.4)
        const cy = top + (h - top - bottom) / 2
        e.setViewport({ x: w / 2 - (z.x + z.width / 2) * zoom, y: cy - (z.y + z.height / 2) * zoom, zoom })
      })
    )
  }, [])

  const startPitch = useCallback(
    (from = 0) => {
      if (!slidesRef.current.length) {
        notice('Give zones an order to present them as slides')
        return
      }
      const c = ctlRef.current
      if (pitchRef.current === null) {
        inspectorBeforePitch.current = c.inspectorOpen
        // give the slides the whole window: collapse the app sidebars, restored on exit
        const ws = useWorkspace.getState()
        sidebarsBeforePitch.current = { left: ws.left.open, right: ws.right.open }
        ws.toggleSidebar('left', false)
        ws.toggleSidebar('right', false)
      }
      c.setInspectorOpen(false)
      setPenState(null)
      eng()?.select([])
      eng()?.setEditing(null)
      goSlide(from)
      eng()?.focus()
    },
    [goSlide]
  )

  const exitPitch = useCallback(() => {
    setPitch(null)
    if (inspectorBeforePitch.current) ctlRef.current.setInspectorOpen(true)
    inspectorBeforePitch.current = null
    restoreSidebars()
    requestAnimationFrame(() => requestAnimationFrame(() => eng()?.fitAll()))
  }, [])

  // ---------------------------------------------------------------- register with the shell
  const shellFns = useRef({ reveal, startPitch })
  shellFns.current = { reveal, startPitch }
  useEffect(() => {
    const c = ctlRef.current
    c.registerMap({
      reveal: (ids, opts) => shellFns.current.reveal(ids, opts),
      fit: () => eng()?.fitAll(),
      present: () => shellFns.current.startPitch(0)
    })
    return () => c.registerMap(null)
  }, [])

  // shared selection → engine
  useEffect(() => {
    const e = eng()
    if (!e) return
    const want = ctl.selection.filter((id) => data.nodes.some((n) => n.id === id) || data.edges.some((x) => x.id === id))
    if (!sameSet(e.getSelection(), want)) e.select(want)
  }, [ctl.selection, data])

  // ---------------------------------------------------------------- dimming
  const hl = useMemo(() => (ctl.highlight ? new Set(ctl.highlight) : null), [ctl.highlight])
  const slideZone = pitch !== null ? slides[pitch] : null
  const ff = ctl.focusFilter
  // dimmed node ids, computed once per change (not per card per render)
  const dimSet = useMemo(() => {
    if (!slideZone && !hl && !ff) return null
    const dim = (n: CanvasNode): boolean => {
      if (slideZone) return isZone(n) ? n.id !== slideZone.id : !centerIn(slideZone, n)
      if (hl) return !isZone(n) && !hl.has(n.id)
      if (ff && isForm(n)) {
        if (ff.kinds?.length && !ff.kinds.includes(n.kind)) return true
        if (ff.phase && n.fields?.phase !== ff.phase) return true
      }
      return false
    }
    const out = new Set<string>()
    for (const n of data.nodes) if (dim(n)) out.add(n.id)
    return out
  }, [data.nodes, slideZone, hl, ff])
  const nodeDim = (n: CanvasNode): boolean => !!dimSet?.has(n.id)
  // memoized so the engine's canvas layer only re-renders when the dimming / highlight really changes
  const nodeLod = useCallback(
    (n: CanvasNode): LodNodeStyle | undefined => {
      const dim = !!dimSet?.has(n.id)
      if (isForm(n)) {
        const def = KINDS[n.kind] ?? KINDS.note
        return { title: cardTitle(n) || 'Untitled', label: `${def.emoji} ${def.label.toUpperCase()}`, accent: def.color, dim, radius: 10 }
      }
      if (isZone(n)) return { header: `${n.emoji ? `${n.emoji} ` : ''}${n.label || 'Zone'}`, accent: colorCss(n.color) ?? 'var(--text-faint)', dim, radius: 18 }
      if (n.type === 'drawing') {
        const dr = n as DrawingNode
        return { points: dr.points ?? [], stroke: colorCss(dr.stroke) ?? dr.stroke ?? 'var(--text-normal)', strokeWidth: dr.strokeWidth ?? 3, dim }
      }
      return undefined
    },
    [dimSet]
  )
  const edgeAppearance = useCallback(
    (edge: CanvasEdge): EdgeAppearance | undefined => {
      const rel = (edge as FormMapEdge).relation
      const dim = hl ? !hl.has(edge.id) : !!dimSet && (dimSet.has(edge.fromNode) || dimSet.has(edge.toNode))
      const def = rel ? RELATIONS[rel] : undefined
      if (!def && !dim) return undefined
      return {
        color: def?.color,
        dashed: def?.dashed,
        dim,
        label: def?.verb || undefined,
        className: [def && `fm-rel-${def.relation}`, dim ? 'fm-dim' : hl ? 'fm-lit' : ''].filter(Boolean).join(' ')
      }
    },
    [hl, dimSet]
  )
  const byId = useMemo(() => new Map(data.nodes.map((n) => [n.id, n])), [data.nodes])

  // ---------------------------------------------------------------- pen
  const onPenDown = (e: React.PointerEvent, w: Point): boolean => {
    if (!penRef.current || e.button !== 0) return false
    e.preventDefault()
    const en = eng()
    if (!en) return false
    const zoom = en.getViewport().zoom
    const pts = [w.x, w.y]
    setStroke(pts.slice())
    const move = (ev: PointerEvent): void => {
      const p = en.toWorld(ev.clientX, ev.clientY)
      const lx = pts[pts.length - 2]
      const ly = pts[pts.length - 1]
      if (Math.hypot(p.x - lx, p.y - ly) < 1.5 / zoom) return
      pts.push(p.x, p.y)
      setStroke(pts.slice())
    }
    const up = (): void => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      setStroke(null)
      const simple = simplify(pts, 0.9 / zoom)
      const sw = clamp(3 / zoom, 2, 14)
      let minX = Infinity
      let minY = Infinity
      let maxX = -Infinity
      let maxY = -Infinity
      for (let i = 0; i < simple.length; i += 2) {
        minX = Math.min(minX, simple[i])
        maxX = Math.max(maxX, simple[i])
        minY = Math.min(minY, simple[i + 1])
        maxY = Math.max(maxY, simple[i + 1])
      }
      const x = Math.floor(minX - sw)
      const y = Math.floor(minY - sw)
      const rel = simple.map((v, i) => Math.round((v - (i % 2 === 0 ? x : y)) * 10) / 10)
      const node: DrawingNode = {
        id: hexId(),
        type: 'drawing',
        x,
        y,
        width: Math.ceil(maxX - minX + sw * 2) || 1,
        height: Math.ceil(maxY - minY + sw * 2) || 1,
        points: rel,
        strokeWidth: Math.round(sw * 10) / 10,
        ...(penRef.current?.color ? { stroke: penRef.current.color } : {})
      }
      docRef.current.update((d) => ({ ...d, nodes: [...d.nodes, node] }))
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    return true
  }

  // ---------------------------------------------------------------- keyboard
  const onKeyDown = (e: React.KeyboardEvent): boolean => {
    const mod = e.ctrlKey || e.metaKey
    const consume = (): true => {
      e.preventDefault()
      e.stopPropagation()
      return true
    }
    if (pitchRef.current !== null) {
      const i = pitchRef.current
      if (['ArrowRight', 'ArrowDown', 'PageDown', ' ', 'Enter'].includes(e.key)) {
        goSlide(i + 1)
        return consume()
      }
      if (['ArrowLeft', 'ArrowUp', 'PageUp', 'Backspace'].includes(e.key)) {
        goSlide(i - 1)
        return consume()
      }
      if (e.key === 'Home') return (goSlide(0), consume())
      if (e.key === 'End') return (goSlide(slidesRef.current.length - 1), consume())
      if (e.key === 'Escape') return (exitPitch(), consume())
      return false
    }
    if (e.key === 'Escape') {
      if (penRef.current) return (setPen(null), consume())
      if (ctlRef.current.highlight) return (ctlRef.current.setHighlight(null), consume())
      if (ctlRef.current.focusFilter) return (ctlRef.current.setFocusFilter(null), consume())
      return false
    }
    if (mod || e.altKey) return false
    const sel = eng()?.getSelection() ?? []
    const single = sel.length === 1 ? latest().nodes.find((n) => n.id === sel[0]) : undefined
    if (e.key === 'Tab' && !e.shiftKey && single && isForm(single)) return (mindmap('child', single.id), consume())
    if (e.key === 'Enter' && !e.shiftKey && single && isForm(single)) return (mindmap('sibling', single.id), consume())
    if (e.key === 'Enter' && e.shiftKey && single) return (eng()?.startEditing(single.id), consume())
    if (e.key === 'w' || e.key === 'W') return (toggleWhy(), consume())
    if (e.key === 'p' || e.key === 'P') return (setPen(penRef.current ? null : {}), consume())
    return false
  }

  // ---------------------------------------------------------------- menus
  const kindItems = (make: (k: FormKind) => void): MenuItem[] =>
    KIND_ORDER.map((k) => ({ label: KINDS[k].label, icon: <span className="fm-menu-emoji">{KINDS[k].emoji}</span>, onClick: () => make(k) }))

  const nodeMenu = (node: CanvasNode, items: MenuItem[], selection: CanvasNode[]): MenuItem[] => {
    const head: MenuItem[] = []
    const ids = selection.map((n) => n.id)
    if (selection.length === 1 && isForm(node)) {
      const n = node
      head.push(
        { label: 'Edit', icon: <Pencil />, hint: 'Dbl-click', onClick: () => eng()?.startEditing(n.id) },
        { label: 'Why does this exist?', icon: <Search />, hint: 'W', onClick: toggleWhy },
        { label: `Add child ${KINDS[childKind(n.kind)].label.toLowerCase()}`, icon: <CornerDownRight />, hint: 'Tab', onClick: () => mindmap('child', n.id) },
        { label: 'Add sibling', icon: <ArrowDown />, hint: 'Enter', onClick: () => mindmap('sibling', n.id) },
        {
          label: 'Kind',
          icon: <Shapes />,
          submenu: KIND_ORDER.map((k) => ({
            label: KINDS[k].label,
            icon: <span className="fm-menu-emoji">{KINDS[k].emoji}</span>,
            checked: n.kind === k,
            onClick: () => {
              const sz = KINDS[k].defaultSize
              docRef.current.update((d) => ({ ...d, nodes: d.nodes.map((x) => (x.id === n.id ? { ...x, kind: k, width: Math.max(x.width, sz.width) } : x)) }))
              assignZone(n.id)
            }
          }))
        },
        { label: 'Vote +1', icon: <ThumbsUp />, onClick: () => vote(n.id, 1) }
      )
      if (n.votes) head.push({ label: 'Remove a vote', icon: <ThumbsDown />, onClick: () => vote(n.id, -1) })
      head.push({ separator: true })
    } else if (selection.length === 1 && isZone(node)) {
      const z = node
      const locked = z.locked !== false
      head.push(
        { label: locked ? 'Unlock zone' : 'Lock zone', icon: locked ? <LockOpen /> : <Lock />, onClick: () => toggleZoneLock(z.id) },
        { label: 'Rename zone', icon: <Type />, onClick: () => eng()?.startEditing(z.id) },
        { label: 'Tidy cards', icon: <LayoutGrid />, onClick: () => tidy(z.id) },
        {
          label: `Add ${KINDS[z.defaultKind ?? 'idea'].label.toLowerCase()} here`,
          icon: <span className="fm-menu-emoji">{KINDS[z.defaultKind ?? 'idea'].emoji}</span>,
          onClick: () => createForm(z.defaultKind ?? 'idea', { x: z.x + z.width / 2, y: z.y + 120 })
        }
      )
      const idx = slides.findIndex((s) => s.id === z.id)
      if (idx >= 0) head.push({ label: 'Present from here', icon: <Presentation />, onClick: () => startPitch(idx) })
      head.push({ separator: true })
    }
    const movable = selection.filter((n) => !isZone(n) || n.locked === false)
    if (movable.length >= 2) {
      const mids = movable.map((n) => n.id)
      head.push(
        {
          label: 'Align',
          icon: <AlignStartVertical />,
          submenu: [
            { label: 'Left', icon: <AlignStartVertical />, onClick: () => align(mids, 'left') },
            { label: 'Center', icon: <AlignCenterVertical />, onClick: () => align(mids, 'center') },
            { label: 'Right', icon: <AlignEndVertical />, onClick: () => align(mids, 'right') },
            { separator: true },
            { label: 'Top', icon: <AlignStartHorizontal />, onClick: () => align(mids, 'top') },
            { label: 'Middle', icon: <AlignCenterHorizontal />, onClick: () => align(mids, 'middle') },
            { label: 'Bottom', icon: <AlignEndHorizontal />, onClick: () => align(mids, 'bottom') }
          ]
        },
        {
          label: 'Distribute',
          icon: <AlignHorizontalDistributeCenter />,
          disabled: movable.length < 3,
          submenu: [
            { label: 'Horizontally', icon: <AlignHorizontalDistributeCenter />, onClick: () => distribute(mids, 'x') },
            { label: 'Vertically', icon: <AlignVerticalDistributeCenter />, onClick: () => distribute(mids, 'y') }
          ]
        }
      )
      if (selection.some(isForm)) head.push({ label: 'Why do these exist?', icon: <Search />, hint: 'W', onClick: toggleWhy })
      head.push({ separator: true })
    }
    // the canvas "Edit" item doesn't apply to forms/zones (we provide our own)
    return [...head, ...items.filter((it) => !(isForm(node) || isZone(node)) || it.label !== 'Edit')]
  }

  const edgeMenu = (edge: CanvasEdge, items: MenuItem[]): MenuItem[] => {
    const cur = (edge as FormMapEdge).relation
    return [
      {
        label: 'Relation',
        icon: <Link2 />,
        submenu: (Object.keys(RELATIONS) as Relation[]).map((r) => ({
          label: RELATIONS[r].label,
          hint: RELATIONS[r].hint,
          icon: <span className="fm-menu-dot" style={{ background: RELATIONS[r].color }} />,
          checked: (cur ?? 'relates') === r,
          onClick: () => docRef.current.update((d) => ({ ...d, edges: d.edges.map((x) => (x.id === edge.id ? { ...x, relation: r } : x)) }))
        }))
      },
      { separator: true },
      ...items
    ]
  }

  const backgroundMenu = (at: Point, items: MenuItem[]): MenuItem[] => {
    const z = zoneAtPoint(latest(), at)
    const k = z?.defaultKind ?? 'idea'
    const head: MenuItem[] = [
      { label: `Add ${KINDS[k].label.toLowerCase()} here`, icon: <span className="fm-menu-emoji">{KINDS[k].emoji}</span>, onClick: () => createForm(k, at) },
      { label: 'Add card', icon: <Shapes />, submenu: kindItems((kk) => createForm(kk, at)) },
      { label: 'Add zone here', icon: <SquareDashed />, onClick: () => createZone(at) }
    ]
    if (z) head.push({ label: `Tidy “${z.label}”`, icon: <LayoutGrid />, onClick: () => tidy(z.id) })
    head.push({ label: 'Pen', icon: <PenLine />, hint: 'P', onClick: () => setPen({}) }, { separator: true })
    return [...head, { label: 'Canvas', icon: <Type />, submenu: items.filter((it) => !it.separator && /^Add /.test(it.label ?? '')) }, ...items.filter((it) => !/^Add /.test(it.label ?? ''))]
  }

  const moreMenu = (e: React.MouseEvent): void => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const en = eng()
    useUi.getState().showMenu({ x: r.left, y: r.top - 8 - 5 * 30 }, [
      { label: 'Text card', icon: <Type />, onClick: () => en?.create('text') },
      { label: 'Note from vault', icon: <FileText />, onClick: () => en?.create('note') },
      { label: 'Code cell', icon: <SquareCode />, onClick: () => en?.create('code') },
      { label: 'Web page', icon: <Globe />, onClick: () => en?.create('link') },
      { label: 'Group', icon: <GroupIcon />, onClick: () => en?.create('group') }
    ])
  }

  // ---------------------------------------------------------------- zone assignment on drop
  const onMoveEnd = (ids: string[]): void => {
    const changes: { card: FormNode; keys: string[] }[] = []
    docRef.current.update(
      (d) => {
        let changed = false
        const nodes = d.nodes.map((n) => {
          if (!ids.includes(n.id) || !isForm(n)) return n
          const m = applyZone(n, zoneAt(d, n))
          if (m === n) return n
          changed = true
          changes.push({ card: m, keys: Object.keys(m.fields).filter((k) => m.fields[k] !== n.fields?.[k]) })
          return m
        })
        return changed ? { ...d, nodes } : d
      },
      { history: false }
    )
    if (!changes.length) return
    for (const { card, keys } of changes.slice(0, 4)) {
      const text = keys
        .map((k) => {
          const f = fieldDef(card.kind, k)
          return `${f?.label ?? k} → ${optionOf(f, card.fields[k])?.label ?? String(card.fields[k])}`
        })
        .join(', ')
      const c = clientOf({ x: card.x + card.width / 2, y: card.y })
      chip(text, c.x, c.y, 'good')
      if (keys.some((k) => isWin(card.kind, k, card.fields[k]))) celebrate(c.x, c.y)
    }
    flash(setWiggle, changes.map((c) => c.card.id), 600)
  }

  // ---------------------------------------------------------------- extension
  const formCount = useMemo(() => data.nodes.filter(isForm).length, [data.nodes])

  const renderWorld = (ctx: EngineRenderCtx): React.ReactNode => {
    let drop: React.ReactNode = null
    if (ctx.moving) {
      const card = data.nodes.find((n) => ctx.moving!.has(n.id) && isForm(n)) as FormNode | undefined
      const z = card ? zoneAt(data, card) : null
      if (card && z) {
        const m = applyZone(card, z)
        if (m !== card) {
          const label = Object.keys(m.fields)
            .filter((k) => m.fields[k] !== card.fields?.[k])
            .map((k) => `${fieldDef(card.kind, k)?.label ?? k} → ${optionOf(fieldDef(card.kind, k), m.fields[k])?.label ?? String(m.fields[k])}`)
            .join(', ')
          drop = (
            <div
              className="fm-drop-target"
              style={{ left: z.x, top: z.y, width: z.width, height: z.height, '--fm-zone': colorCss(z.color) ?? 'var(--interactive-accent)' } as React.CSSProperties}
            >
              <div className="fm-drop-label">{label}</div>
            </div>
          )
        }
      }
    }
    return (
      <>
        {drop}
        {stroke && (
          <svg className="canvas-edges fm-pen-live">
            <path d={smoothPath(stroke)} style={{ stroke: colorCss(pen?.color) ?? 'var(--text-normal)', strokeWidth: clamp(3 / ctx.vp.zoom, 2, 14) }} />
          </svg>
        )}
      </>
    )
  }

  const navigate = useCallback((p: Point, animate: boolean) => {
    const e = eng()
    if (!e) return
    const { w, h } = e.viewSize()
    const z = e.getViewport().zoom
    e.setViewport({ x: w / 2 - p.x * z, y: h / 2 - p.y * z, zoom: z }, animate)
  }, [])

  const renderOverlay = (ctx: EngineRenderCtx): React.ReactNode => (
    <>
      {pitch === null && (
        <div className="fm-hud-slot" data-canvas-ui>
          <Hud ctl={ctl} />
        </div>
      )}
      {pitch === null && (ctl.highlight || ctl.focusFilter) && (
        <div className="fm-banner" data-canvas-ui>
          {ctl.highlight ? <Search size={13} /> : <Filter size={13} />}
          <span>
            {ctl.highlight
              ? `Why-trace · ${ctl.highlight.filter((id) => byId.has(id)).length} cards`
              : `Focus · ${[...(ctl.focusFilter?.kinds ?? []).map((k) => KINDS[k].plural), ctl.focusFilter?.phase].filter(Boolean).join(' · ')}`}
          </span>
          <kbd>Esc</kbd>
          <button className="fm-banner-close" title="Clear" onClick={() => (ctl.highlight ? ctl.setHighlight(null) : ctl.setFocusFilter(null))}>
            <X size={13} />
          </button>
        </div>
      )}
      {pen && pitch === null && (
        <div className="fm-pen-hint" data-canvas-ui>
          <PenLine size={13} /> Drawing — <kbd>Esc</kbd> to stop
        </div>
      )}
      {pitch === null && <Minimap nodes={data.nodes} vp={ctx.vp} size={ctx.size} api={ctx.api} dimmed={dimSet} onNavigate={navigate} />}
      {slideZone && pitch !== null && (
        <>
          <div className="fm-pitch-title" key={slideZone.id} data-canvas-ui style={{ '--fm-zone': colorCss(slideZone.color) ?? 'var(--interactive-accent)' } as React.CSSProperties}>
            {slideZone.emoji && <div className="fm-pitch-emoji">{slideZone.emoji}</div>}
            <div>
              <div className="fm-pitch-label">{slideZone.label}</div>
              {slideZone.prompt && <div className="fm-pitch-prompt">{slideZone.prompt}</div>}
            </div>
          </div>
          <div className="fm-pitch-bar" data-canvas-ui>
            <button className="fm-pitch-btn" title="Previous (←)" disabled={pitch === 0} onClick={() => goSlide(pitch - 1)}>
              <ChevronLeft size={16} />
            </button>
            <div className="fm-pitch-dots">
              {slides.map((s, i) => (
                <button key={s.id} className={`fm-pitch-dot${i === pitch ? ' is-active' : ''}`} title={s.label} onClick={() => goSlide(i)} />
              ))}
            </div>
            <span className="fm-pitch-count">
              {pitch + 1} / {slides.length}
            </span>
            <button className="fm-pitch-btn" title="Next (→)" disabled={pitch === slides.length - 1} onClick={() => goSlide(pitch + 1)}>
              <ChevronRight size={16} />
            </button>
            <button className="fm-pitch-btn" title="Exit (Esc)" onClick={exitPitch}>
              <X size={15} />
            </button>
          </div>
        </>
      )}
      {chips.map((c) => (
        <div key={c.id} className={`fm-chip-float is-${c.tone}`} style={{ left: c.x, top: c.y }}>
          {c.text}
        </div>
      ))}
    </>
  )

  const ext: CanvasExtension = {
    nodeTypes: MAP_NODE_TYPES,
    nodeClass: (n) => {
      const c: string[] = []
      if (fresh.has(n.id)) c.push('fm-new')
      if (wiggle.has(n.id)) c.push('fm-wiggle')
      if (pulse?.has(n.id)) c.push('fm-pulse')
      if (hl?.has(n.id) && !isZone(n)) c.push('fm-lit')
      if (nodeDim(n)) c.push('fm-dim')
      return c.length ? c.join(' ') : undefined
    },
    nodeLod,
    edgeAppearance,
    onEdgeCreate: (edge, d) => {
      const a = d.nodes.find((n) => n.id === edge.fromNode)
      const b = d.nodes.find((n) => n.id === edge.toNode)
      if (!a || !b || !isForm(a) || !isForm(b)) return edge
      const relation = inferRelation(a.kind, b.kind)
      const p = clientOf({ x: (a.x + a.width / 2 + b.x + b.width / 2) / 2, y: (a.y + a.height / 2 + b.y + b.height / 2) / 2 })
      setTimeout(() => chip(`${KINDS[a.kind].emoji} ${RELATIONS[relation].verb || 'relates to'} ${KINDS[b.kind].emoji}`, p.x, p.y, 'info'), 0)
      return { ...edge, relation }
    },
    edgeDropItems: (at, connect) => [
      ...KIND_ORDER.map((k) => ({
        label: `Add ${KINDS[k].label.toLowerCase()}`,
        icon: <span className="fm-menu-emoji">{KINDS[k].emoji}</span>,
        onClick: () => createForm(k, at, connect)
      })),
      { separator: true },
      { label: 'Text card', icon: <Type />, onClick: () => eng()?.create('text', at) }
    ],
    onMoveEnd,
    onPointerDown: onPenDown,
    onDoubleClick: (e, w, node) => {
      if (node && isForm(node)) return false
      if (node && isZone(node)) {
        if ((e.target as HTMLElement).closest('[data-zone-head]')) return false
        createForm(node.defaultKind ?? 'idea', w)
        return true
      }
      if (node) return false
      const z = zoneAtPoint(latest(), w)
      createForm(z?.defaultKind ?? 'idea', w)
      return true
    },
    onKeyDown,
    nodeMenu,
    edgeMenu,
    backgroundMenu,
    onSelectionChange: (ids) => {
      const c = ctlRef.current
      if (!sameSet(ids, c.selection)) c.setSelection(ids)
    },
    toolbar: (
      <MapToolbar
        onCreate={(k) => createForm(k)}
        onDrop={(k, x, y) => {
          const e = eng()
          const r = e?.root()?.getBoundingClientRect()
          if (!e || !r || x < r.left || x > r.right || y < r.top || y > r.bottom) return
          createForm(k, e.toWorld(x, y))
        }}
        onZone={() => createZone()}
        pen={pen}
        setPen={setPen}
        onMore={moreMenu}
      />
    ),
    headerActions: active ? (
      <button className="clickable-icon small" title="Zoom to fit (Shift+1)" onClick={() => eng()?.fitAll()}>
        <Maximize />
      </button>
    ) : null,
    status: (ctx) => `${formCount} cards · ${data.edges.length} relations · ${Math.round(ctx.vp.zoom * 100)}%`,
    renderOverlay,
    renderWorld,
    hideChrome: pitch !== null,
    className: ['fm-map', pen && 'fm-pen-mode', pitch !== null && 'fm-pitching', (hl || ff) && 'fm-has-focus'].filter(Boolean).join(' '),
    viewportKey: 'mapViewport'
  }

  return (
    <MapActionsContext.Provider value={actions}>
      <MapContext.Provider value={mapCtx}>
        <CanvasEngine tab={ctl.tab} visible={ctl.visible && active} focused={ctl.focused && active} doc={doc} path={ctl.path} ext={ext} engineRef={engineRef} />
      </MapContext.Provider>
    </MapActionsContext.Provider>
  )
}
