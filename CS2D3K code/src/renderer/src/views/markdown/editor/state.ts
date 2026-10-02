// Shared editor state bits: the note's vault path, live-preview flag, focus tracking and a refresh effect.
import { Facet, StateEffect, StateField, type EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'

/** Vault path of the note being edited (used for link resolution and running code). */
export const notePath = Facet.define<string, string>({ combine: (v) => v[0] ?? '' })

/** True when Live Preview (hide markup, render widgets) is active. */
export const livePreview = Facet.define<boolean, boolean>({ combine: (v) => v.some(Boolean) })

/** Dispatch to force decorations to be recomputed (e.g. files were added → link resolution changed). */
export const refreshDecorations = StateEffect.define<null>()

const setFocused = StateEffect.define<boolean>()

/** Whether the editor has focus — markup is only revealed around the cursor of a focused editor. */
export const editorFocused = StateField.define<boolean>({
  create: () => false,
  update(v, tr) {
    for (const e of tr.effects) if (e.is(setFocused)) return e.value
    return v
  }
})

export const focusTracking = [editorFocused, EditorView.focusChangeEffect.of((_s, focusing) => setFocused.of(focusing))]

/** True when the editor is focused and any selection range touches [from, to] (inclusive). */
export function selectionTouches(state: EditorState, from: number, to: number): boolean {
  if (!state.field(editorFocused, false)) return false
  for (const r of state.selection.ranges) if (r.from <= to && r.to >= from) return true
  return false
}

/** True when any selection range touches one of the lines spanned by [from, to]. */
export function selectionTouchesLines(state: EditorState, from: number, to: number): boolean {
  return selectionTouches(state, state.doc.lineAt(from).from, state.doc.lineAt(to).to)
}

/** Did focus change in this transaction set? */
export function focusChanged(start: EditorState, end: EditorState): boolean {
  return start.field(editorFocused, false) !== end.field(editorFocused, false)
}
