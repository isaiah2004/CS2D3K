// Contexts shared by map node bodies (form cards, groups, kanban nodes, drawings) and the map lens.
import { createContext, useContext } from 'react'
import type { FormMapMeta, KanbanNode } from '../schema'

export interface KanbanActions {
  /** edit a kanban node (one undo step; `history` coalesces typing) */
  update(id: string, fn: (k: KanbanNode) => KanbanNode, history?: string): void
  /** a card dragged out of the node onto the canvas: becomes a canvas card at that point */
  cardOut(kanbanId: string, cardId: string, clientX: number, clientY: number): void
  /** a card dragged into another kanban node's column */
  cardAcross(fromId: string, cardId: string, toId: string, colId: string, index: number, at: { clientX: number; clientY: number }): void
  /** lay the columns out as groups (+ a saved board) */
  convertToGroups(id: string): void
}

export interface MapActions {
  /** set a form field (one undo step); celebrates finished cards */
  setField(id: string, key: string, value: unknown, at?: { clientX: number; clientY: number }): void
  /** open a menu to pick a select field's value */
  fieldMenu(id: string, key: string, e: React.MouseEvent): void
  /** "+" chip of a selected card: add a field */
  addFieldMenu(id: string, e: React.MouseEvent): void
  /** tag menu of a card */
  tagMenu(id: string, e: React.MouseEvent): void
  vote(id: string, delta: number, at?: { clientX: number; clientY: number }): void
  /** Tab (child) / Enter (sibling) */
  mindmap(mode: 'child' | 'sibling', id: string): void
  toggleGroupLock(id: string): void
  /** floating feedback chip at a screen point */
  chip(text: string, clientX: number, clientY: number, tone?: 'good' | 'info'): void
  openLink(value: string, newTab: boolean): void
  kanban: KanbanActions
}

export interface MapContextValue {
  /** number of cards per group id (nested groups' cards included) */
  groupCounts: Map<string, number>
  /** groups that contain other groups */
  parentGroups: ReadonlySet<string>
}

export const MapContext = createContext<MapContextValue | null>(null)
/** the (stable) actions alone: cards subscribe to this one, so group counts changing doesn't re-render every card */
export const MapActionsContext = createContext<MapActions | null>(null)
/** the map-wide registries; changes only when `formmap` changes (not when nodes move) */
export const MetaContext = createContext<FormMapMeta>({ version: 2 })

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

export const useMeta = (): FormMapMeta => useContext(MetaContext)
