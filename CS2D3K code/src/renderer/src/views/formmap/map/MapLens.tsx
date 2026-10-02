// Map lens: the canvas engine + form-map extension (plain cards with tags and fields, groups that assign fields,
// embedded kanban nodes, relations, mind-map keys, why-trace, minimap, layout tools, pen and pitch mode).
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
  PenLine,
  Filter,
  Tag,
  KanbanSquare,
  StickyNote,
  Columns3,
  Wand2,
  ListPlus
} from 'lucide-react'
import type { LensProps } from '../context'
import CanvasEngine from '../../canvas/CanvasEngine'
import type { CanvasExtension, EdgeAppearance, EngineApi, EngineRenderCtx } from '../../canvas/engine'
import type { LodNodeStyle } from '../../canvas/lodLayer'
import { snap, colorCss, type CanvasData, type CanvasEdge, type CanvasNode, type Point } from '../../canvas/model'
import { useUi, notice, promptText, type MenuItem } from '@/store/ui'
import { openLinkText } from '@/lib/fileops'
import { hexId, clamp } from '@/lib/util'
import {
  applyAssign,
  CARD_SIZE,
  cardAccent,
  cardTitle,
  fieldLabel,
  fieldText,
  fmColor,
  fromPreset,
  groupChain,
  groupChainIn,
  groups,
  groupTitle,
  inferRelation,
  isForm,
  isGroup,
  isKanban,
  newForm,
  optionLabel,
  optionsFor,
  parentGroup,
  presetById,
  presetOf,
  relationDef,
  RELATION_ORDER,
  RELATIONS,
  sameValue,
  type DrawingNode,
  type FieldDef,
  type FormMapEdge,
  type FormNode,
  type GroupNode,
  type KanbanNode,
  type Preset
} from '../schema'
import { whyTrace } from '../analysis'
import { newFieldBoard, newGroupsBoard, BOARD_FIELD_TYPES } from '../boards'
import { formIntoKanban, groupsToKanban, kanbanCardAcross, kanbanCardOut, kanbanCount, kanbanToGroups, newKanban, registerUsage, updateKanban } from '../kanban'
import { celebrateChanges, createBoard, setTags, toggleTag } from '../lenses/ops'
import { tagMenuItems } from '../lenses/widgets'
import { celebrate } from '../fun/celebrate'
import Hud from '../fun/Hud'
import { MAP_NODE_TYPES } from './mapNodes'
import { MapActionsContext, MapContext, MetaContext, type MapActions, type MapContextValue } from './mapContext'
import MapToolbar, { type PenState } from './MapToolbar'
import Minimap from './Minimap'
import { parentEdge, groupAtPoint, centerIn, findFree, alignTargets, distributeTargets, tidyGroup, simplify, smoothPath, type AlignMode } from './logic'
import { useWorkspace } from '@/store/workspace'
import './map.css'
import './kanban.css'

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
const linkTarget = (v: string): string => v.trim().replace(/^\[\[/, '').replace(/\]\]$/, '').split('|')[0].trim()

/** kanban column under a screen point (ignoring the dragged cards themselves) */
function kanbanColumnAt(x: number, y: number): HTMLElement | null {
  const els = document.elementsFromPoint(x, y) as HTMLElement[]
  return els.find((e) => e.dataset?.kanbanCol) ?? null
}

/** insertion index for a drop at screen y in a kanban column element */
function kanbanIndexAt(col: HTMLElement, y: number): number {
  const cards = [...col.querySelectorAll<HTMLElement>('[data-kcard]')]
  const i = cards.findIndex((c) => {
    const r = c.getBoundingClientRect()
    return y < r.top + r.height / 2
  })
  return i < 0 ? cards.length : i
}

export default function MapLens({ ctl }: LensProps) {
  // the shell keeps the map mounted (hidden) while another lens shows, so switching back is instant
  const active = ctl.lens === 'map'
  const engineRef = useRef<EngineApi | null>(null)
  const ctlRef = useRef(ctl)
  ctlRef.current = ctl
  const data = ctl.data
  const meta = ctl.meta
  const doc = ctl.doc
  const docRef = useRef(doc)
  docRef.current = doc
  const eng = (): EngineApi | null => engineRef.current
  const latest = (): CanvasData => docRef.current.data
  const metaRef = useRef(meta)
  metaRef.current = meta

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
  /** a canvas card is being dragged over a kanban column (no group drop target then) */
  const [overKanban, setOverKanban] = useState(false)
  const hoverCol = useRef<HTMLElement | null>(null)
  const preDrag = useRef<CanvasData | null>(null)

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

  /** apply group fields to a freshly added card + register its fields / tags (same undo step) */
  const settleNew = useCallback((id: string) => {
    docRef.current.update(
      (d) => {
        let changed = false
        let card: FormNode | null = null
        const nodes = d.nodes.map((n) => {
          if (n.id !== id || !isForm(n)) return n
          const m = applyAssign(n, groupChain(d, n))
          card = m
          if (m !== n) changed = true
          return m
        })
        const next = changed ? { ...d, nodes } : d
        return card ? registerUsage(next, [card]) : next
      },
      { history: false }
    )
  }, [])

  /**
   * Create a card. `preset`: a preset id, null = a plain card, undefined = the default preset of the group at `at`.
   */
  const createCard = useCallback(
    (preset: string | null | undefined, at?: Point, connect?: { from: string; side: 'top' | 'right' | 'bottom' | 'left' }) => {
      const e = eng()
      if (!e) return
      const m = metaRef.current
      const pid = preset === undefined ? (at ? groupAtPoint(latest(), at)?.preset : undefined) : (preset ?? undefined)
      const p = presetById(m, pid)
      const base = fromPreset(p)
      const node = e.addNode({ type: 'form', title: '', text: '', ...base, width: base.width ?? CARD_SIZE.width, height: base.height ?? CARD_SIZE.height }, at, connect)
      settleNew(node.id)
      afterCreate(node)
    },
    [settleNew, afterCreate]
  )

  const createGroup = useCallback(
    (at?: Point) => {
      const e = eng()
      if (!e) return
      const node = e.addNode({ type: 'group', label: 'New group', emoji: '✨', prompt: 'What belongs here?', width: 760, height: 520 }, at)
      flash(setFresh, [node.id], 700)
      e.setEditing(node.id)
    },
    [flash]
  )

  const createKanban = useCallback(
    (at?: Point) => {
      const e = eng()
      if (!e) return
      const k = newKanban({ x: 0, y: 0 })
      const node = e.addNode({ type: 'kanban', title: 'Kanban', columns: k.columns, width: k.width, height: k.height }, at)
      flash(setFresh, [node.id], 700)
      ensureVisible(node)
    },
    [flash, ensureVisible]
  )

  // ---------------------------------------------------------------- mind-map keys
  const mindmap = useCallback(
    (mode: 'child' | 'sibling', id: string) => {
      const d = latest()
      const s = d.nodes.find((n) => n.id === id)
      if (!s || !isForm(s)) return
      const m = metaRef.current
      const sp = presetOf(s, m.presets)
      const p = mode === 'child' ? presetById(m, sp?.child) : sp
      const base = p ? fromPreset(p) : mode === 'sibling' ? { tags: [...(s.tags ?? [])], fields: {} } : { tags: [], fields: {} }
      const size = { width: base.width ?? (mode === 'sibling' ? s.width : CARD_SIZE.width), height: base.height ?? (mode === 'sibling' ? s.height : CARD_SIZE.height) }
      let edge: FormMapEdge | null = null
      let pos: Point
      const nid = hexId()
      if (mode === 'child') {
        pos = { x: snap(s.x + s.width + 100), y: snap(s.y) }
        edge = { id: hexId(), fromNode: nid, fromSide: 'left', toNode: s.id, toSide: 'right', relation: inferRelation(m, base, s) }
      } else {
        pos = { x: s.x, y: snap(s.y + s.height + 30) }
        const pe = parentEdge(d, s.id)
        if (pe) edge = { id: hexId(), fromNode: nid, fromSide: pe.fromSide, toNode: pe.toNode, toSide: pe.toSide, relation: pe.relation }
      }
      const free = findFree(d, { ...pos, ...size })
      let node: FormNode = newForm({ x: free.x, y: free.y }, { id: nid, ...base, ...size })
      node = applyAssign(node, groupChain(d, node))
      docRef.current.update((dd) => registerUsage({ ...dd, nodes: [...dd.nodes, node], edges: edge ? [...dd.edges, edge] : dd.edges }, [node]))
      afterCreate(node)
    },
    [afterCreate]
  )

  // ---------------------------------------------------------------- field actions
  /** set a field from the card face (no relocation: the card stays where the user put it) */
  const setField = useCallback((id: string, key: string, value: unknown, at?: { clientX: number; clientY: number }) => {
    const n = latest().nodes.find((x) => x.id === id)
    if (!n || !isForm(n) || sameValue(n.fields?.[key], value)) return
    let before: CanvasData | null = null
    let after: CanvasData | null = null
    docRef.current.update((d) => {
      before = d
      after = registerUsage(
        {
          ...d,
          nodes: d.nodes.map((x) => {
            if (x.id !== id || !isForm(x)) return x
            const fields = { ...x.fields }
            if (value === undefined || value === '' || (Array.isArray(value) && !value.length)) delete fields[key]
            else fields[key] = value
            return { ...x, fields }
          })
        },
        [{ fields: { [key]: value } }]
      )
      return after
    })
    if (before && after) celebrateChanges(before, after, [id], at)
  }, [])

  const fieldMenu = useCallback(
    (id: string, key: string, e: React.MouseEvent) => {
      const n = latest().nodes.find((x) => x.id === id)
      if (!n || !isForm(n)) return
      const def = metaRef.current.fields?.[key]
      if (!def?.options) return
      const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
      const at = { clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 }
      const cur = n.fields?.[key]
      const multi = def.type === 'multiselect'
      const list = Array.isArray(cur) ? (cur as unknown[]) : cur === undefined ? [] : [cur]
      const items: MenuItem[] = optionsFor(def, n.tags).map((o) => ({
        label: optionLabel(o),
        icon: <span className="fm-menu-dot" style={{ background: fmColor(o.color) ?? 'var(--text-faint)' }} />,
        checked: multi ? list.includes(o.value) : cur === o.value,
        onClick: () => setField(id, key, multi ? (list.includes(o.value) ? list.filter((v) => v !== o.value) : [...list, o.value]) : o.value, at)
      }))
      if (cur !== undefined) items.push({ separator: true }, { label: `Clear ${fieldLabel(key, def).toLowerCase()}`, icon: <X />, onClick: () => setField(id, key, undefined) })
      useUi.getState().showMenu({ x: r.left, y: r.bottom + 4 }, items)
    },
    [setField]
  )

  const askValue = useCallback(
    async (id: string, key: string, def: FieldDef) => {
      const v = await promptText({ title: fieldLabel(key, def), placeholder: def.placeholder ?? (def.type === 'date' ? 'YYYY-MM-DD' : def.type === 'link' ? '[[Note]]' : ''), okLabel: 'Set' })
      if (v === null || !v.trim()) return
      if (def.type === 'number') setField(id, key, Number(v))
      else if (def.type === 'checklist') setField(id, key, [{ text: v.trim(), done: false }])
      else setField(id, key, v)
    },
    [setField]
  )

  const addFieldMenu = useCallback(
    (id: string, e: React.MouseEvent) => {
      const n = latest().nodes.find((x) => x.id === id)
      if (!n || !isForm(n)) return
      const reg = metaRef.current.fields ?? {}
      const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
      const at = { clientX: r.left + r.width / 2, clientY: r.top }
      const items: MenuItem[] = Object.entries(reg)
        .filter(([k]) => n.fields[k] === undefined)
        .map(([k, def]) => {
          const label = fieldLabel(k, def)
          if (def.type === 'select' || def.type === 'multiselect')
            return { label, submenu: optionsFor(def, n.tags).map((o) => ({ label: optionLabel(o), icon: <span className="fm-menu-dot" style={{ background: fmColor(o.color) ?? 'var(--text-faint)' }} />, onClick: () => setField(id, k, def.type === 'multiselect' ? [o.value] : o.value, at) })) }
          if (def.type === 'checkbox') return { label, onClick: () => setField(id, k, true, at) }
          if (def.type === 'rating') return { label, submenu: Array.from({ length: def.max ?? 5 }, (_, i) => ({ label: '★'.repeat(i + 1), onClick: () => setField(id, k, i + 1, at) })) }
          return { label: `${label}…`, onClick: () => void askValue(id, k, def) }
        })
      if (items.length) items.push({ separator: true })
      items.push({
        label: 'New field… (inspector)',
        icon: <ListPlus />,
        onClick: () => {
          ctlRef.current.setSelection([id])
          ctlRef.current.setInspectorOpen(true)
        }
      })
      useUi.getState().showMenu({ x: r.left, y: r.bottom + 4 }, items)
    },
    [setField, askValue]
  )

  const tagMenu = useCallback((id: string, e: React.MouseEvent) => {
    const n = latest().nodes.find((x) => x.id === id)
    if (!n || !isForm(n)) return
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
    useUi.getState().showMenu({ x: r.left, y: r.bottom + 4 }, tagMenuItems(metaRef.current, n.tags ?? [], (t) => toggleTag(ctlRef.current, id, t)))
  }, [])

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

  const toggleGroupLock = useCallback(
    (id: string) => {
      const g = latest().nodes.find((x) => x.id === id) as GroupNode | undefined
      if (!g) return
      const locked = g.locked === true
      docRef.current.update((d) => ({ ...d, nodes: d.nodes.map((n) => (n.id === id ? { ...n, locked: !locked } : n)) }))
      const c = clientOf({ x: g.x + 120, y: g.y })
      chip(locked ? '🔓 Unlocked — drag to move, edges to resize' : '🔒 Locked', c.x, c.y, 'info')
    },
    [chip, clientOf]
  )

  // ---------------------------------------------------------------- kanban nodes
  const kanbanUpdate = useCallback((id: string, fn: (k: KanbanNode) => KanbanNode, history?: string) => {
    docRef.current.update((d) => updateKanban(d, id, fn), history ? { history } : undefined)
  }, [])

  const kanbanCardOutFn = useCallback(
    (kanbanId: string, cardId: string, clientX: number, clientY: number) => {
      const e = eng()
      if (!e) return
      const w = e.toWorld(clientX, clientY)
      let id: string | null = null
      docRef.current.update((d) => {
        const r = kanbanCardOut(d, kanbanId, cardId, w)
        id = r.id
        return r.data
      })
      if (!id) return
      flash(setFresh, [id], 700)
      e.select([id])
      chip('Moved to the canvas', clientX, clientY - 20, 'good')
    },
    [flash, chip]
  )

  const kanbanCardAcrossFn = useCallback((fromId: string, cardId: string, toId: string, colId: string, index: number, at: { clientX: number; clientY: number }) => {
    docRef.current.update((d) => kanbanCardAcross(d, fromId, cardId, toId, colId, index))
    const to = latest().nodes.find((n) => n.id === toId)
    if (to && isKanban(to) && to.columns.at(-1)?.id === colId) celebrate(at.clientX, at.clientY)
  }, [])

  const convertToGroups = useCallback(
    (id: string) => {
      const k = latest().nodes.find((n) => n.id === id)
      if (!k || !isKanban(k)) return
      let res: ReturnType<typeof kanbanToGroups> | null = null
      docRef.current.update((d) => {
        res = kanbanToGroups(d, id)
        return res.data
      })
      const r = res as ReturnType<typeof kanbanToGroups> | null
      if (!r?.groupIds.length) return
      eng()?.select(r.groupIds)
      flash(setFresh, r.groupIds, 700)
      requestAnimationFrame(() => eng()?.fitNodes(r.groupIds, 1))
      notice(`“${k.title || 'Kanban'}” is now ${r.groupIds.length} groups, with a saved board in the Board lens`, 'success')
    },
    [flash]
  )

  const groupsToKanbanFn = useCallback(
    (ids: string[]) => {
      let res: ReturnType<typeof groupsToKanban> | null = null
      docRef.current.update((d) => {
        res = groupsToKanban(d, ids)
        return res.data
      })
      const r = res as ReturnType<typeof groupsToKanban> | null
      if (!r?.id) return
      eng()?.select([r.id])
      flash(setFresh, [r.id], 700)
      const notes = [r.removedEdges ? `${r.removedEdges} relation${r.removedEdges === 1 ? '' : 's'} removed` : '', r.leftovers ? `${r.leftovers} other item${r.leftovers === 1 ? '' : 's'} left on the canvas` : '']
      notice(`Converted to a kanban node${notes.some(Boolean) ? ` (${notes.filter(Boolean).join(', ')})` : ''}`, 'success')
    },
    [flash]
  )

  const openLink = useCallback((v: string, newTab: boolean) => {
    const t = linkTarget(v)
    if (t) void openLinkText(t, ctlRef.current.path, newTab)
  }, [])

  // stable action object for node bodies
  const fns = useRef({ setField, fieldMenu, addFieldMenu, tagMenu, vote, mindmap, toggleGroupLock, chip, openLink, kanbanUpdate, kanbanCardOutFn, kanbanCardAcrossFn, convertToGroups })
  fns.current = { setField, fieldMenu, addFieldMenu, tagMenu, vote, mindmap, toggleGroupLock, chip, openLink, kanbanUpdate, kanbanCardOutFn, kanbanCardAcrossFn, convertToGroups }
  const actions = useMemo<MapActions>(
    () => ({
      setField: (...a) => fns.current.setField(...a),
      fieldMenu: (...a) => fns.current.fieldMenu(...a),
      addFieldMenu: (...a) => fns.current.addFieldMenu(...a),
      tagMenu: (...a) => fns.current.tagMenu(...a),
      vote: (...a) => fns.current.vote(...a),
      mindmap: (...a) => fns.current.mindmap(...a),
      toggleGroupLock: (...a) => fns.current.toggleGroupLock(...a),
      chip: (...a) => fns.current.chip(...a),
      openLink: (...a) => fns.current.openLink(...a),
      kanban: {
        update: (...a) => fns.current.kanbanUpdate(...a),
        cardOut: (...a) => fns.current.kanbanCardOutFn(...a),
        cardAcross: (...a) => fns.current.kanbanCardAcrossFn(...a),
        convertToGroups: (...a) => fns.current.convertToGroups(...a)
      }
    }),
    []
  )

  const [groupCounts, parentGroups] = useMemo(() => {
    const m = new Map<string, number>()
    const parents = new Set<string>()
    const gs = groups(data)
    if (!gs.length) return [m, parents] as const
    for (const n of data.nodes) {
      if (n.type === 'drawing') continue
      // a card counts for every group it is in (nested groups included); a group marks its parents
      if (isGroup(n)) {
        const p = parentGroup(gs, n)
        if (p) parents.add(p.id)
      } else for (const g of groupChainIn(gs, n)) m.set(g.id, (m.get(g.id) ?? 0) + 1)
    }
    return [m, parents] as const
  }, [data])
  const mapCtx = useMemo<MapContextValue>(() => ({ groupCounts, parentGroups }), [groupCounts, parentGroups])

  // ---------------------------------------------------------------- tweened layout changes
  const tween = useCallback((targets: Map<string, Point>, groupPatch?: { id: string; height: number }) => {
    if (!targets.size && !groupPatch) return
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
            if (groupPatch && n.id === groupPatch.id) return { ...n, height: groupPatch.height }
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
    (groupId: string) => {
      const g = latest().nodes.find((n) => n.id === groupId)
      if (!g || !isGroup(g)) return
      const { targets, height } = tidyGroup(latest(), g)
      tween(targets, height !== g.height ? { id: g.id, height } : undefined)
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

  const reveal = useCallback((ids: string[], opts?: { select?: boolean }) => {
    const e = eng()
    if (!e) return
    const nodeIds = ids.filter((id) => latest().nodes.some((n) => n.id === id))
    if (!nodeIds.length) return
    e.fitNodes(nodeIds, 1)
    if (opts?.select) e.select(nodeIds)
    setPulse(new Set(nodeIds))
    setTimeout(() => setPulse(null), 1500)
  }, [])

  // ---------------------------------------------------------------- pitch mode
  const slides = useMemo(
    () =>
      groups(data)
        .filter((g) => typeof g.order === 'number')
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
    // frame the group between the title card and the slide bar (after layout: the inspector may have just closed)
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
        notice('Give groups a pitch order (inspector) to present them as slides')
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
  }, [restoreSidebars])

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
  const slideGroup = pitch !== null ? slides[pitch] : null
  const ff = ctl.focusFilter
  // dimmed node ids, computed once per change (not per card per render)
  const dimSet = useMemo(() => {
    if (!slideGroup && !hl && !ff?.tags?.length) return null
    const dim = (n: CanvasNode): boolean => {
      if (slideGroup) return isGroup(n) ? n.id !== slideGroup.id && !centerIn(slideGroup, n) : !centerIn(slideGroup, n)
      if (hl) return !isGroup(n) && !hl.has(n.id)
      if (ff?.tags?.length && isForm(n)) return !ff.tags.some((t) => n.tags?.includes(t))
      return false
    }
    const out = new Set<string>()
    for (const n of data.nodes) if (dim(n)) out.add(n.id)
    return out
  }, [data.nodes, slideGroup, hl, ff])
  const nodeDim = (n: CanvasNode): boolean => !!dimSet?.has(n.id)
  // memoized so the engine's canvas layer only re-renders when the dimming / highlight / registries really change
  const nodeLod = useCallback(
    (n: CanvasNode): LodNodeStyle | undefined => {
      const dim = !!dimSet?.has(n.id)
      if (isForm(n)) {
        const tags = n.tags ?? []
        return { title: cardTitle(n), label: tags.length ? tags.slice(0, 2).map((t) => `#${t}`).join(' ').toUpperCase() : undefined, accent: cardAccent(n, meta), dim, radius: 10 }
      }
      if (isGroup(n)) return { header: `${n.emoji ? `${n.emoji} ` : ''}${groupTitle(n)}`, accent: colorCss(n.color) ?? 'var(--text-faint)', dim, radius: 18 }
      if (isKanban(n)) {
        const k = n as KanbanNode
        return {
          title: k.title?.trim() || 'Kanban',
          label: `📋 KANBAN · ${kanbanCount(k)} CARDS`,
          accent: 'var(--interactive-accent)',
          dim,
          radius: 12,
          lanes: k.columns.map((c) => ({ title: c.title, color: fmColor(c.color), count: c.cards.length }))
        }
      }
      if (n.type === 'drawing') {
        const dr = n as DrawingNode
        return { points: dr.points ?? [], stroke: colorCss(dr.stroke) ?? dr.stroke ?? 'var(--text-normal)', strokeWidth: dr.strokeWidth ?? 3, dim }
      }
      return undefined
    },
    [dimSet, meta]
  )
  const edgeAppearance = useCallback(
    (edge: CanvasEdge): EdgeAppearance | undefined => {
      const rel = (edge as FormMapEdge).relation
      const dim = hl ? !hl.has(edge.id) : !!dimSet && (dimSet.has(edge.fromNode) || dimSet.has(edge.toNode))
      const def = rel ? relationDef(rel) : undefined
      if (!def && !dim) return undefined
      return {
        color: def?.color,
        dashed: def?.dashed,
        dim,
        label: def?.verb || undefined,
        className: [def && `fm-rel-${RELATIONS[def.relation] ? def.relation : 'custom'}`, dim ? 'fm-dim' : hl ? 'fm-lit' : ''].filter(Boolean).join(' ')
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
  const presetItems = (make: (p: string | null) => void): MenuItem[] => [
    { label: 'Card', icon: <StickyNote />, onClick: () => make(null) },
    ...(meta.presets ?? []).map((p) => ({ label: p.name, icon: <span className="fm-menu-emoji">{p.emoji ?? '▫️'}</span>, onClick: () => make(p.id) }))
  ]

  /** fields a group can be split by on a board */
  const boardFields = (): [string, FieldDef][] => Object.entries(meta.fields ?? {}).filter(([, f]) => BOARD_FIELD_TYPES.includes(f.type))

  const openNewBoard = (board: ReturnType<typeof newGroupsBoard>): void => {
    const c = ctlRef.current
    createBoard(c, board)
    c.openBoard(board.id)
  }

  const applyPreset = (ids: string[], p: Preset): void => {
    const base = fromPreset(p)
    setTags(ctlRef.current, ids, { add: base.tags })
    for (const [k, v] of Object.entries(base.fields)) {
      const want = ids.filter((id) => {
        const n = latest().nodes.find((x) => x.id === id)
        return n && isForm(n) && n.fields[k] === undefined
      })
      if (want.length) for (const id of want) setField(id, k, v)
    }
  }

  const nodeMenu = (node: CanvasNode, items: MenuItem[], selection: CanvasNode[]): MenuItem[] => {
    const head: MenuItem[] = []
    const selGroups = selection.filter(isGroup)
    const selForms = selection.filter(isForm)
    if (selection.length === 1 && isForm(node)) {
      const n = node
      const childPreset = presetById(meta, presetOf(n, meta.presets)?.child)
      head.push(
        { label: 'Edit', icon: <Pencil />, hint: 'Dbl-click', onClick: () => eng()?.startEditing(n.id) },
        { label: 'Why does this exist?', icon: <Search />, hint: 'W', onClick: toggleWhy },
        { label: `Add child${childPreset ? ` ${childPreset.name.toLowerCase()}` : ''}`, icon: <CornerDownRight />, hint: 'Tab', onClick: () => mindmap('child', n.id) },
        { label: 'Add sibling', icon: <ArrowDown />, hint: 'Enter', onClick: () => mindmap('sibling', n.id) },
        { label: 'Tags', icon: <Tag />, submenu: tagMenuItems(meta, n.tags ?? [], (t) => toggleTag(ctlRef.current, n.id, t)) }
      )
      if (meta.presets?.length) head.push({ label: 'Apply preset', icon: <Wand2 />, submenu: meta.presets.map((p) => ({ label: p.name, icon: <span className="fm-menu-emoji">{p.emoji ?? '▫️'}</span>, onClick: () => applyPreset([n.id], p) })) })
      head.push({ label: 'Vote +1', icon: <ThumbsUp />, onClick: () => vote(n.id, 1) })
      if (n.votes) head.push({ label: 'Remove a vote', icon: <ThumbsDown />, onClick: () => vote(n.id, -1) })
      head.push({ separator: true })
    } else if (selection.length === 1 && isGroup(node)) {
      const g = node
      const locked = g.locked === true
      const p = presetById(meta, g.preset)
      const fieldsForBoard = boardFields()
      head.push(
        { label: locked ? 'Unlock group' : 'Lock group', icon: locked ? <LockOpen /> : <Lock />, onClick: () => toggleGroupLock(g.id) },
        { label: 'Rename group', icon: <Type />, onClick: () => eng()?.startEditing(g.id) },
        { label: 'Tidy cards', icon: <LayoutGrid />, onClick: () => tidy(g.id) },
        { label: `Add ${p ? p.name.toLowerCase() : 'card'} here`, icon: p?.emoji ? <span className="fm-menu-emoji">{p.emoji}</span> : <StickyNote />, onClick: () => createCard(p?.id ?? null, { x: g.x + g.width / 2, y: g.y + 120 }) },
        { separator: true },
        { label: 'Create board from group', icon: <Columns3 />, onClick: () => openNewBoard(newGroupsBoard(latest(), [g.id])) }
      )
      if (fieldsForBoard.length)
        head.push({ label: 'Board of this group by', icon: <KanbanSquare />, submenu: fieldsForBoard.map(([k, f]) => ({ label: fieldLabel(k, f), onClick: () => openNewBoard(newFieldBoard(latest(), k, g.id)) })) })
      head.push({ label: 'Convert to kanban node', icon: <KanbanSquare />, onClick: () => groupsToKanbanFn([g.id]) })
      const idx = slides.findIndex((s) => s.id === g.id)
      if (idx >= 0) head.push({ label: 'Present from here', icon: <Presentation />, onClick: () => startPitch(idx) })
      head.push({ separator: true })
    } else if (selection.length === 1 && isKanban(node)) {
      const k = node
      head.push(
        { label: 'Rename board', icon: <Type />, onClick: () => eng()?.startEditing(k.id) },
        { label: 'Add column', icon: <Columns3 />, onClick: () => kanbanUpdate(k.id, (x) => ({ ...x, columns: [...x.columns, { id: hexId(), title: 'New column', cards: [] }] })) },
        { label: 'Convert to groups', icon: <Shapes />, onClick: () => convertToGroups(k.id) },
        { separator: true }
      )
    }
    if (selGroups.length >= 2) {
      head.push(
        { label: `Create board from ${selGroups.length} groups`, icon: <Columns3 />, onClick: () => openNewBoard(newGroupsBoard(latest(), selGroups.map((g) => g.id))) },
        { label: 'Convert selected groups to kanban node', icon: <KanbanSquare />, onClick: () => groupsToKanbanFn(selGroups.map((g) => g.id)) },
        { separator: true }
      )
    }
    if (selForms.length >= 2) {
      head.push({ label: `Tags (${selForms.length} cards)`, icon: <Tag />, submenu: tagMenuItems(meta, selForms.every((f) => f.tags?.length) ? [...new Set(selForms.flatMap((f) => f.tags ?? []))].filter((t) => selForms.every((f) => f.tags?.includes(t))) : [], (t) => setTags(ctlRef.current, selForms.map((f) => f.id), selForms.every((f) => f.tags?.includes(t)) ? { remove: [t] } : { add: [t] })) })
      if (meta.presets?.length) head.push({ label: 'Apply preset', icon: <Wand2 />, submenu: meta.presets.map((p) => ({ label: p.name, icon: <span className="fm-menu-emoji">{p.emoji ?? '▫️'}</span>, onClick: () => applyPreset(selForms.map((f) => f.id), p) })) })
    }
    const movable = selection.filter((n) => !isGroup(n) || n.locked !== true)
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
      if (selForms.length) head.push({ label: 'Why do these exist?', icon: <Search />, hint: 'W', onClick: toggleWhy })
      head.push({ separator: true })
    }
    // the canvas "Edit" / "Edit label" items don't apply to cards / groups / kanbans (we provide our own)
    const own = isForm(node) || isGroup(node) || isKanban(node)
    return [...head, ...items.filter((it) => !own || (it.label !== 'Edit' && it.label !== 'Edit label'))]
  }

  const edgeMenu = (edge: CanvasEdge, items: MenuItem[]): MenuItem[] => {
    const cur = (edge as FormMapEdge).relation ?? 'relates'
    const set = (r: string): void => docRef.current.update((d) => ({ ...d, edges: d.edges.map((x) => (x.id === edge.id ? { ...x, relation: r } : x)) }))
    return [
      {
        label: 'Relation',
        icon: <Link2 />,
        submenu: [
          ...RELATION_ORDER.map((r) => ({
            label: RELATIONS[r].label,
            hint: RELATIONS[r].hint,
            icon: <span className="fm-menu-dot" style={{ background: RELATIONS[r].color }} />,
            checked: cur === r,
            onClick: () => set(r)
          })),
          ...(RELATIONS[cur] ? [] : [{ label: relationDef(cur).label, icon: <span className="fm-menu-dot" style={{ background: 'var(--text-muted)' }} />, checked: true }]),
          { separator: true },
          {
            label: 'Custom…',
            icon: <Pencil />,
            onClick: () =>
              void promptText({ title: 'Custom relation', placeholder: 'e.g. blocks, inspires, owns', initial: RELATIONS[cur] ? '' : cur, okLabel: 'Set' }).then((v) => {
                if (v?.trim()) set(v.trim())
              })
          }
        ]
      },
      { separator: true },
      ...items
    ]
  }

  const backgroundMenu = (at: Point, items: MenuItem[]): MenuItem[] => {
    const g = groupAtPoint(latest(), at)
    const p = presetById(meta, g?.preset)
    const head: MenuItem[] = [
      { label: `Add ${p ? p.name.toLowerCase() : 'card'} here`, icon: p?.emoji ? <span className="fm-menu-emoji">{p.emoji}</span> : <StickyNote />, onClick: () => createCard(p?.id ?? null, at) },
      ...(meta.presets?.length ? [{ label: 'Add from preset', icon: <Shapes />, submenu: presetItems((pid) => createCard(pid, at)) }] : []),
      { label: 'Add group here', icon: <SquareDashed />, onClick: () => createGroup(at) },
      { label: 'Add kanban here', icon: <KanbanSquare />, onClick: () => createKanban(at) }
    ]
    if (g) head.push({ label: `Tidy “${groupTitle(g)}”`, icon: <LayoutGrid />, onClick: () => tidy(g.id) })
    head.push({ label: 'Pen', icon: <PenLine />, hint: 'P', onClick: () => setPen({}) }, { separator: true })
    return [...head, { label: 'Canvas', icon: <Type />, submenu: items.filter((it) => !it.separator && /^Add /.test(it.label ?? '')) }, ...items.filter((it) => !/^Add /.test(it.label ?? ''))]
  }

  const moreMenu = (e: React.MouseEvent): void => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const en = eng()
    useUi.getState().showMenu({ x: r.left, y: r.top - 8 - 4 * 30 }, [
      { label: 'Text card', icon: <Type />, onClick: () => en?.create('text') },
      { label: 'Note from vault', icon: <FileText />, onClick: () => en?.create('note') },
      { label: 'Code cell', icon: <SquareCode />, onClick: () => en?.create('code') },
      { label: 'Web page', icon: <Globe />, onClick: () => en?.create('link') }
    ])
  }

  // ---------------------------------------------------------------- drag: kanban drops + group assignment
  const clearHoverCol = (): void => {
    hoverCol.current?.classList.remove('is-over')
    hoverCol.current = null
  }

  const onMoveStart = (): void => {
    preDrag.current = latest()
  }

  const hasKanban = useMemo(() => data.nodes.some(isKanban), [data.nodes])
  const onMoveDrag = (ids: string[], e: PointerEvent): void => {
    // hit testing per pointer move only matters when there is a kanban node to drop into
    if (!hasKanban && !hoverCol.current) return
    const d = latest()
    const anyForm = ids.some((id) => {
      const n = byId.get(id) ?? d.nodes.find((x) => x.id === id)
      return !!n && isForm(n)
    })
    const col = anyForm ? kanbanColumnAt(e.clientX, e.clientY) : null
    if (col !== hoverCol.current) {
      clearHoverCol()
      if (col) {
        col.classList.add('is-over')
        hoverCol.current = col
      }
      setOverKanban(!!col)
    }
  }

  const onMoveEnd = (ids: string[], e: PointerEvent): void => {
    const col = hoverCol.current
    clearHoverCol()
    setOverKanban(false)
    const before = preDrag.current ?? latest()
    preDrag.current = null
    const movedForms = ids.filter((id) => {
      const n = latest().nodes.find((x) => x.id === id)
      return !!n && isForm(n)
    })
    // dropped into a kanban column: the canvas cards become kanban cards
    if (col && movedForms.length) {
      const kanbanId = col.dataset.kanban!
      const colId = col.dataset.kanbanCol!
      let index = kanbanIndexAt(col, e.clientY)
      let removed = 0
      docRef.current.update(
        (d) => {
          let next = d
          for (const id of movedForms) {
            const r = formIntoKanban(next, id, kanbanId, colId, index++)
            next = r.data
            removed += r.removedEdges
          }
          return next
        },
        { history: false }
      )
      const k = latest().nodes.find((n) => n.id === kanbanId)
      if (k && isKanban(k) && k.columns.at(-1)?.id === colId) celebrate(e.clientX, e.clientY)
      chip(`Moved into “${col.querySelector('.fm-kb-col-title')?.textContent ?? 'the board'}”${removed ? ` · ${removed} relation${removed === 1 ? '' : 's'} removed` : ''}`, e.clientX, e.clientY - 20, 'good')
      return
    }
    const changes: { card: FormNode; keys: string[] }[] = []
    let after: CanvasData = latest()
    docRef.current.update(
      (d) => {
        let changed = false
        const nodes = d.nodes.map((n) => {
          if (!ids.includes(n.id) || !isForm(n)) return n
          const m = applyAssign(n, groupChain(d, n))
          if (m === n) return n
          changed = true
          changes.push({ card: m, keys: Object.keys({ ...m.fields, ...n.fields }).filter((k) => !sameValue(m.fields[k], n.fields?.[k])) })
          return m
        })
        after = changed ? { ...d, nodes } : d
        return after
      },
      { history: false }
    )
    celebrateChanges(before, after, movedForms, { clientX: e.clientX, clientY: e.clientY })
    if (!changes.length) return
    const reg = metaRef.current.fields ?? {}
    for (const { card, keys } of changes.slice(0, 4)) {
      const text = keys.map((k) => `${fieldLabel(k, reg[k])} → ${fieldText(reg[k], card.fields[k]) || '—'}`).join(', ')
      const c = clientOf({ x: card.x + card.width / 2, y: card.y })
      chip(text, c.x, c.y, 'good')
    }
    flash(
      setWiggle,
      changes.map((c) => c.card.id),
      600
    )
  }

  // ---------------------------------------------------------------- extension
  const formCount = useMemo(() => data.nodes.filter(isForm).length, [data.nodes])
  const groupCount = useMemo(() => data.nodes.filter(isGroup).length, [data.nodes])

  const renderWorld = (ctx: EngineRenderCtx): React.ReactNode => {
    let drop: React.ReactNode = null
    if (ctx.moving && !overKanban) {
      const card = data.nodes.find((n) => ctx.moving!.has(n.id) && isForm(n)) as FormNode | undefined
      const chain = card ? groupChain(data, card) : []
      const g = chain.at(-1)
      if (card && g) {
        const m = applyAssign(card, chain)
        if (m !== card) {
          const reg = meta.fields ?? {}
          const label = Object.keys(m.fields)
            .filter((k) => !sameValue(m.fields[k], card.fields?.[k]))
            .map((k) => `${fieldLabel(k, reg[k])} → ${fieldText(reg[k], m.fields[k])}`)
            .join(', ')
          drop = (
            <div className="fm-drop-target" style={{ left: g.x, top: g.y, width: g.width, height: g.height, '--fm-group': colorCss(g.color) ?? 'var(--interactive-accent)' } as React.CSSProperties}>
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
              : `Focus · ${(ctl.focusFilter?.tags ?? []).map((t) => `#${t}`).join(' · ')}`}
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
      {pitch === null && <Minimap nodes={data.nodes} meta={meta} vp={ctx.vp} size={ctx.size} api={ctx.api} dimmed={dimSet} onNavigate={navigate} />}
      {slideGroup && pitch !== null && (
        <>
          <div className="fm-pitch-title" key={slideGroup.id} data-canvas-ui style={{ '--fm-group': colorCss(slideGroup.color) ?? 'var(--interactive-accent)' } as React.CSSProperties}>
            {slideGroup.emoji && <div className="fm-pitch-emoji">{slideGroup.emoji}</div>}
            <div>
              <div className="fm-pitch-label">{groupTitle(slideGroup)}</div>
              {slideGroup.prompt && <div className="fm-pitch-prompt">{slideGroup.prompt}</div>}
            </div>
          </div>
          <div className="fm-pitch-bar" data-canvas-ui>
            <button className="fm-pitch-btn" title="Previous (←)" disabled={pitch === 0} onClick={() => goSlide(pitch - 1)}>
              <ChevronLeft size={16} />
            </button>
            <div className="fm-pitch-dots">
              {slides.map((s, i) => (
                <button key={s.id} className={`fm-pitch-dot${i === pitch ? ' is-active' : ''}`} title={groupTitle(s)} onClick={() => goSlide(i)} />
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
      if (hl?.has(n.id) && !isGroup(n)) c.push('fm-lit')
      if (nodeDim(n)) c.push('fm-dim')
      return c.length ? c.join(' ') : undefined
    },
    nodeLod,
    edgeAppearance,
    onEdgeCreate: (edge, d) => {
      const a = d.nodes.find((n) => n.id === edge.fromNode)
      const b = d.nodes.find((n) => n.id === edge.toNode)
      if (!a || !b || !isForm(a) || !isForm(b)) return edge
      const relation = inferRelation(metaRef.current, a, b)
      const p = clientOf({ x: (a.x + a.width / 2 + b.x + b.width / 2) / 2, y: (a.y + a.height / 2 + b.y + b.height / 2) / 2 })
      setTimeout(() => chip(`${relationDef(relation).verb || 'relates to'}`, p.x, p.y, 'info'), 0)
      return { ...edge, relation }
    },
    edgeDropItems: (at, connect) => [
      ...presetItems((pid) => createCard(pid, at, connect)).map((it) => ({ ...it, label: `Add ${it.label!.toLowerCase()}` })),
      { separator: true },
      { label: 'Text card', icon: <Type />, onClick: () => eng()?.create('text', at) }
    ],
    onMoveStart,
    onMoveDrag,
    onMoveEnd,
    onPointerDown: onPenDown,
    onDoubleClick: (e, w, node) => {
      if (node && (isForm(node) || isKanban(node))) return false
      if (node && isGroup(node)) {
        if ((e.target as HTMLElement).closest('[data-group-head]')) return false
        createCard(undefined, w)
        return true
      }
      if (node) return false
      createCard(undefined, w)
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
        meta={meta}
        onCreate={(p) => createCard(p)}
        onDrop={(p, x, y) => {
          const e = eng()
          const r = e?.root()?.getBoundingClientRect()
          if (!e || !r || x < r.left || x > r.right || y < r.top || y > r.bottom) return
          createCard(p, e.toWorld(x, y))
        }}
        onGroup={() => createGroup()}
        onKanban={() => createKanban()}
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
    status: (ctx) => `${formCount} cards · ${groupCount} groups · ${data.edges.length} relations · ${Math.round(ctx.vp.zoom * 100)}%`,
    renderOverlay,
    renderWorld,
    hideChrome: pitch !== null,
    className: ['fm-map', pen && 'fm-pen-mode', pitch !== null && 'fm-pitching', (hl || ff) && 'fm-has-focus'].filter(Boolean).join(' '),
    viewportKey: 'mapViewport'
  }

  return (
    <MetaContext.Provider value={meta}>
      <MapActionsContext.Provider value={actions}>
        <MapContext.Provider value={mapCtx}>
          <CanvasEngine tab={ctl.tab} visible={ctl.visible && active} focused={ctl.focused && active} doc={doc} path={ctl.path} ext={ext} engineRef={engineRef} />
        </MapContext.Provider>
      </MapActionsContext.Provider>
    </MetaContext.Provider>
  )
}
