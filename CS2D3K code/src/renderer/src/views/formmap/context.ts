// Shared state for one form-map view instance (all lenses + inspector use it).
import { createContext, useContext } from 'react'
import type { CanvasDoc, UpdateOptions } from '../canvas/useCanvasDoc'
import type { TabState } from '@/store/workspace'
import type { FormKind, FormMapData, FormNode } from './schema'

export type LensId = 'map' | 'board' | 'table' | 'doc'

/** Imperative API the Map lens registers so other parts can drive the camera. */
export interface MapApi {
  /** fly the camera to fit these node ids (and optionally select them) */
  reveal(ids: string[], opts?: { select?: boolean }): void
  fit(): void
  /** start pitch (presentation) mode at the first ordered zone */
  present(): void
}

export interface FocusFilter {
  kinds?: FormKind[]
  /** feature phase value */
  phase?: string
}

export interface FormMapCtl {
  doc: CanvasDoc
  /** typed view of doc.data */
  data: FormMapData
  path: string
  tab: TabState
  visible: boolean
  focused: boolean

  lens: LensId
  setLens(l: LensId): void

  /** selected node ids (shared across lenses) */
  selection: string[]
  setSelection(ids: string[]): void

  /** ids to emphasise (everything else is dimmed in the map) — e.g. the "Why?" trace. null = none */
  highlight: string[] | null
  setHighlight(ids: string[] | null): void

  /** dim everything that doesn't match (kind / phase) */
  focusFilter: FocusFilter | null
  setFocusFilter(f: FocusFilter | null): void

  inspectorOpen: boolean
  setInspectorOpen(open: boolean): void

  /** switch to the map lens and fly to the given nodes */
  reveal(ids: string[], opts?: { select?: boolean }): void
  /** switch to the map lens and start pitch mode */
  present(): void
  /** called by the map lens on mount (and with null on unmount) */
  registerMap(api: MapApi | null): void

  /** convenience: patch a form card (fields are merged) */
  updateForm(id: string, patch: Partial<Omit<FormNode, 'fields'>> & { fields?: Record<string, unknown> }, opts?: UpdateOptions): void
}

export const FormMapContext = createContext<FormMapCtl | null>(null)

export function useFormMap(): FormMapCtl {
  const ctl = useContext(FormMapContext)
  if (!ctl) throw new Error('useFormMap outside FormMapView')
  return ctl
}

/** Props passed to every lens component. */
export interface LensProps {
  ctl: FormMapCtl
}
