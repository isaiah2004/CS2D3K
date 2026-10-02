// Tiny DSL for editor tests: "‸" marks a cursor, "«…»" marks a selection (anchor at «, head at »).
import { EditorSelection, EditorState, type Extension, type SelectionRange } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { markdown } from '@codemirror/lang-markdown'
import { ensureSyntaxTree } from '@codemirror/language'
import { GFM } from '@lezer/markdown'
import { obsidianExtensions } from '@/views/markdown/editor/syntax'

export function parseDoc(marked: string): { doc: string; ranges: SelectionRange[] } {
  const ranges: SelectionRange[] = []
  let doc = ''
  let anchor = -1
  for (const ch of marked) {
    if (ch === '‸') ranges.push(EditorSelection.cursor(doc.length))
    else if (ch === '«') anchor = doc.length
    else if (ch === '»') {
      ranges.push(EditorSelection.range(anchor, doc.length))
      anchor = -1
    } else doc += ch
  }
  return { doc, ranges: ranges.length ? ranges : [EditorSelection.cursor(0)] }
}

export const markdownLang = (): Extension => markdown({ extensions: [GFM, ...obsidianExtensions] })

export function makeState(marked: string, extensions: Extension = []): EditorState {
  const { doc, ranges } = parseDoc(marked)
  const state = EditorState.create({
    doc,
    selection: EditorSelection.create(ranges, ranges.length - 1),
    extensions: [EditorState.allowMultipleSelections.of(true), extensions]
  })
  // the initial parse only gets a ~20ms budget, which a loaded CI worker can miss: finish it, then commit the tree
  return ensureSyntaxTree(state, state.doc.length, 10_000) ? state.update({}).state : state
}

/** Finish parsing after a dispatch (same budget issue as above) and commit the full tree to the view state. */
export function parsed(view: EditorView): EditorView {
  if (ensureSyntaxTree(view.state, view.state.doc.length, 10_000)) view.dispatch({})
  return view
}

const views: EditorView[] = []

export function makeView(marked: string, extensions: Extension = []): EditorView {
  const view = new EditorView({ state: makeState(marked, extensions), parent: document.body })
  views.push(view)
  return view
}

export function destroyViews(): void {
  for (const v of views.splice(0)) v.destroy()
}

/** Serializes the doc with selection markers (inverse of parseDoc). */
export function show(state: EditorState): string {
  const marks: { pos: number; text: string }[] = []
  for (const r of state.selection.ranges) {
    if (r.empty) marks.push({ pos: r.head, text: '‸' })
    else {
      marks.push({ pos: r.anchor, text: '«' })
      marks.push({ pos: r.head, text: '»' })
    }
  }
  marks.sort((a, b) => b.pos - a.pos)
  let doc = state.doc.toString()
  for (const m of marks) doc = doc.slice(0, m.pos) + m.text + doc.slice(m.pos)
  return doc
}
