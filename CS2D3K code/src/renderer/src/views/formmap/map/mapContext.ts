// Context shared by map node bodies (form cards, zones, drawings) and the map lens.
import { createContext, useContext } from 'react'

export interface MapActions {
  /** set a form field (one undo step); celebrates decisions */
  setField(id: string, key: string, value: unknown, at?: { clientX: number; clientY: number }): void
  /** open a menu to pick a select field's value */
  fieldMenu(id: string, key: string, e: React.MouseEvent): void
  vote(id: string, delta: number, at?: { clientX: number; clientY: number }): void
  /** Tab (child) / Enter (sibling) */
  mindmap(mode: 'child' | 'sibling', id: string): void
  toggleZoneLock(id: string): void
  /** floating feedback chip at a screen point */
  chip(text: string, clientX: number, clientY: number, tone?: 'good' | 'info'): void
}

export interface MapContextValue {
  actions: MapActions
  /** number of cards per zone id */
  zoneCounts: Map<string, number>
}

export const MapContext = createContext<MapContextValue | null>(null)
/** the (stable) actions alone: cards subscribe to this one, so zone counts changing doesn't re-render every card */
export const MapActionsContext = createContext<MapActions | null>(null)

export function useMap(): MapContextValue {
  const v = useContext(MapContext)
  if (!v) throw new Error('useMap outside MapLens')
  return v
}

export function useMapActions(): MapActions {
  const v = useContext(MapActionsContext)
  if (!v) throw new Error('useMapActions outside MapLens')
  return v
}
