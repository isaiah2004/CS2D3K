import { afterEach, describe, expect, it, vi } from 'vitest'
import { EditorState } from '@codemirror/state'
import type { EditorView } from '@codemirror/view'
import { editorFocused, focusChanged, focusTracking, livePreview, notePath, selectionTouches, selectionTouchesLines } from '@/views/markdown/editor/state'
import { destroyViews, makeState, makeView } from './helpers'

// editor tests build real CodeMirror views: give them headroom on a loaded full-suite run
vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 })

/** Focus the view and wait (polling) for CodeMirror's deferred focus-change effect to land. */
async function focus(view: EditorView): Promise<EditorView> {
  view.focus()
  await vi.waitFor(() => expect(view.state.field(editorFocused)).toBe(true), { timeout: 10_000, interval: 10 })
  return view
}

const focusedView = (marked: string): Promise<EditorView> => focus(makeView(marked, focusTracking))

afterEach(destroyViews)

describe('views/markdown/editor/state facets', () => {
  it('notePath uses the first provided path, or empty', () => {
    expect(EditorState.create().facet(notePath)).toBe('')
    expect(EditorState.create({ extensions: [notePath.of('a.md'), notePath.of('b.md')] }).facet(notePath)).toBe('a.md')
  })

  it('livePreview is on if any provider enables it', () => {
    expect(EditorState.create().facet(livePreview)).toBe(false)
    expect(EditorState.create({ extensions: [livePreview.of(false), livePreview.of(true)] }).facet(livePreview)).toBe(true)
  })
})

describe('views/markdown/editor/state selection helpers', () => {
  it('never reports a touch while the editor is unfocused', () => {
    const state = makeState('ab‸cd', focusTracking)
    expect(state.field(editorFocused)).toBe(false)
    expect(selectionTouches(state, 0, 4)).toBe(false)
  })

  it('treats states without focus tracking as unfocused', () => {
    expect(selectionTouches(makeState('‸x'), 0, 1)).toBe(false)
  })

  it('reports a touch for ranges overlapping the selection (inclusive) once focused', async () => {
    const view = await focusedView('hello «wor»ld\nnext')
    expect(view.state.field(editorFocused)).toBe(true)
    expect(selectionTouches(view.state, 0, 6)).toBe(true)
    expect(selectionTouches(view.state, 9, 12)).toBe(true)
    expect(selectionTouches(view.state, 0, 5)).toBe(false)
    expect(selectionTouches(view.state, 10, 12)).toBe(false)
  })

  it('widens the check to whole lines with selectionTouchesLines', async () => {
    const view = await focusedView('hello «wor»ld\nnext')
    expect(selectionTouches(view.state, 0, 1)).toBe(false)
    expect(selectionTouchesLines(view.state, 0, 1)).toBe(true)
    expect(selectionTouchesLines(view.state, 13, 14)).toBe(false)
  })

  it('checks every selection range', async () => {
    const view = await focusedView('‸a\nb\n‸c')
    expect(selectionTouchesLines(view.state, 2, 2)).toBe(false)
    expect(selectionTouchesLines(view.state, 4, 4)).toBe(true)
  })

  it('detects focus changes between two states', async () => {
    const view = makeView('x', focusTracking)
    const before = view.state
    expect(focusChanged(before, before)).toBe(false)
    await focus(view)
    expect(focusChanged(before, view.state)).toBe(true)
  })
})
