// Form-map view shell: owns the document + shared controller, hosts the lenses and the inspector.
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Map as MapIcon, KanbanSquare, Table2, FileText, PanelRight, Presentation } from 'lucide-react'
import type { ViewProps } from '../types'
import { useCanvasDoc } from '../canvas/useCanvasDoc'
import { ViewHeaderActions } from '@/components/Slots'
import { FormMapContext, type FocusFilter, type FormMapCtl, type LensId, type MapApi } from './context'
import { metaOf, normalizeFormMap, type FormMapData, type FormNode } from './schema'
import { TEMPLATES } from './templates'
import { useWorkspace } from '@/store/workspace'
import './formmap.css'

const MapLens = lazy(() => import('./map/MapLens'))
const BoardLens = lazy(() => import('./lenses/BoardLens'))
const TableLens = lazy(() => import('./lenses/TableLens'))
const DocLens = lazy(() => import('./lenses/DocLens'))
const Inspector = lazy(() => import('./inspector/Inspector'))

const LENSES: { id: LensId; label: string; icon: React.ReactNode; key: string }[] = [
  { id: 'map', label: 'Map', icon: <MapIcon size={14} />, key: '1' },
  { id: 'board', label: 'Board', icon: <KanbanSquare size={14} />, key: '2' },
  { id: 'table', label: 'Table', icon: <Table2 size={14} />, key: '3' },
  { id: 'doc', label: 'Doc', icon: <FileText size={14} />, key: '4' }
]

const isLens = (v: unknown): v is LensId => v === 'map' || v === 'board' || v === 'table' || v === 'doc'

export default function FormMapView({ tab, visible, focused }: ViewProps) {
  const path = tab.path ?? ''
  const doc = useCanvasDoc(path, normalizeFormMap)
  const data = doc.data as FormMapData
  // the registries keep their identity while only nodes change (cards don't re-render on every move)
  const meta = useMemo(() => metaOf(data), [data.formmap])

  const [lens, setLensState] = useState<LensId>(isLens(tab.state?.lens) ? tab.state.lens : 'map')
  const [selection, setSelection] = useState<string[]>([])
  const [highlight, setHighlight] = useState<string[] | null>(null)
  const [focusFilter, setFocusFilter] = useState<FocusFilter | null>(null)
  const [inspectorOpen, setInspectorOpenState] = useState<boolean>(tab.state?.inspector !== false)
  const [activeBoard, setActiveBoard] = useState<string | null>(typeof tab.state?.boardId === 'string' ? tab.state.boardId : null)
  const mapApi = useRef<MapApi | null>(null)
  const pending = useRef<((api: MapApi) => void) | null>(null)

  const setLens = useCallback(
    (l: LensId) => {
      setLensState(l)
      useWorkspace.getState().updateTabState(tab.id, { lens: l })
    },
    [tab.id]
  )
  const setInspectorOpen = useCallback(
    (open: boolean) => {
      setInspectorOpenState(open)
      useWorkspace.getState().updateTabState(tab.id, { inspector: open })
    },
    [tab.id]
  )

  /** run against the map api, switching to the map lens (and waiting for it to mount) if needed */
  const withMap = useCallback(
    (fn: (api: MapApi) => void) => {
      if (mapApi.current && lens === 'map') fn(mapApi.current)
      else {
        pending.current = fn
        setLens('map')
      }
    },
    [lens, setLens]
  )

  const docRef = useRef(doc)
  docRef.current = doc

  const openBoard = useCallback(
    (id: string) => {
      setActiveBoard(id)
      useWorkspace.getState().updateTabState(tab.id, { boardId: id })
      setLens('board')
    },
    [tab.id, setLens]
  )

  const ctl: FormMapCtl = useMemo(
    () => ({
      doc,
      data,
      meta,
      path,
      tab,
      visible,
      focused,
      lens,
      setLens,
      activeBoard,
      openBoard,
      selection,
      setSelection,
      highlight,
      setHighlight,
      focusFilter,
      setFocusFilter,
      inspectorOpen,
      setInspectorOpen,
      reveal: (ids, opts) => withMap((api) => api.reveal(ids, opts)),
      present: () => withMap((api) => api.present()),
      registerMap: (api) => {
        mapApi.current = api
        if (api && pending.current) {
          const fn = pending.current
          pending.current = null
          // let the map measure itself first
          requestAnimationFrame(() => fn(api))
        }
      },
      updateForm: (id, patch, opts) =>
        docRef.current.update(
          (d) => ({
            ...d,
            nodes: d.nodes.map((n) =>
              n.id === id ? ({ ...n, ...patch, fields: patch.fields ? { ...((n as FormNode).fields ?? {}), ...patch.fields } : (n as FormNode).fields } as typeof n) : n
            )
          }),
          opts
        )
    }),
    [doc, data, meta, path, tab, visible, focused, lens, setLens, activeBoard, openBoard, selection, highlight, focusFilter, inspectorOpen, setInspectorOpen, withMap]
  )

  // keyboard: Alt+1..4 switch lenses
  useEffect(() => {
    if (!focused) return
    const onKey = (e: KeyboardEvent): void => {
      if (!e.altKey || e.ctrlKey || e.metaKey) return
      const l = LENSES.find((x) => e.code === `Digit${x.key}`)
      if (l) {
        e.preventDefault()
        setLens(l.id)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [focused, setLens])

  // drop stale selection ids
  useEffect(() => {
    if (!selection.length) return
    const ids = new Set(data.nodes.map((n) => n.id))
    if (selection.some((s) => !ids.has(s))) setSelection(selection.filter((s) => ids.has(s)))
  }, [data, selection])

  // the map stays mounted once shown (hidden while another lens is active): switching back costs no remount
  const [mapMounted, setMapMounted] = useState(lens === 'map')
  if (lens === 'map' && !mapMounted) setMapMounted(true)
  // a reveal/present request made from another lens runs once the (already mounted) map is visible again
  useEffect(() => {
    if (lens !== 'map' || !mapApi.current || !pending.current) return
    const fn = pending.current
    pending.current = null
    const api = mapApi.current
    requestAnimationFrame(() => fn(api))
  }, [lens])

  const needsTemplate = doc.loaded && !doc.invalid && !data.formmap && data.nodes.length === 0

  const LensComp = lens === 'board' ? BoardLens : lens === 'table' ? TableLens : lens === 'doc' ? DocLens : null

  return (
    <FormMapContext.Provider value={ctl}>
      <ViewHeaderActions>
        <div className="fm-lens-switch" role="tablist" aria-label="Lens">
          {LENSES.map((l) => (
            <button
              key={l.id}
              role="tab"
              aria-selected={lens === l.id}
              className={`fm-lens-btn${lens === l.id ? ' is-active' : ''}`}
              title={`${l.label} (Alt+${l.key})`}
              onClick={() => setLens(l.id)}
            >
              {l.icon}
              <span>{l.label}</span>
            </button>
          ))}
        </div>
        <button className="clickable-icon small" title="Pitch mode — present ordered groups as slides" onClick={() => ctl.present()}>
          <Presentation />
        </button>
        <button className={`clickable-icon small${inspectorOpen ? ' is-active' : ''}`} title="Toggle inspector" onClick={() => setInspectorOpen(!inspectorOpen)}>
          <PanelRight />
        </button>
      </ViewHeaderActions>
      <div className="fm-root">
        {needsTemplate ? (
          <TemplatePicker onPick={(id) => doc.update(() => TEMPLATES.find((t) => t.id === id)!.build())} />
        ) : (
          <>
            <div className="fm-lens">
              {doc.loaded && mapMounted && (
                <div className={`fm-lens-map${lens === 'map' ? '' : ' is-hidden'}`} aria-hidden={lens !== 'map'}>
                  <Suspense fallback={<div className="empty-state">Loading…</div>}>
                    <MapLens ctl={ctl} />
                  </Suspense>
                </div>
              )}
              {doc.loaded && LensComp && (
                <Suspense fallback={<div className="empty-state">Loading…</div>}>
                  <LensComp ctl={ctl} />
                </Suspense>
              )}
            </div>
            {inspectorOpen && doc.loaded && (
              <div className="fm-inspector">
                <Suspense fallback={null}>
                  <Inspector ctl={ctl} />
                </Suspense>
              </div>
            )}
          </>
        )}
      </div>
    </FormMapContext.Provider>
  )
}

function TemplatePicker({ onPick }: { onPick: (id: string) => void }) {
  return (
    <div className="fm-template-picker">
      <div className="fm-template-title">Start a form-map</div>
      <div className="fm-template-sub">A more advanced canvas: cards with tags and fields, groups that give them meaning, and kanban boards.</div>
      <div className="fm-template-grid">
        {TEMPLATES.map((t) => (
          <button key={t.id} className="fm-template-card" onClick={() => onPick(t.id)}>
            <div className="fm-template-emoji">{t.emoji}</div>
            <div className="fm-template-name">{t.name}</div>
            <div className="fm-template-desc">{t.description}</div>
          </button>
        ))}
      </div>
    </div>
  )
}
