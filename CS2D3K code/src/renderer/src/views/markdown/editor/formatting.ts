// Editing commands: wrap/unwrap inline markup, links, checklists, comments.
import { EditorSelection, type ChangeSpec, type SelectionRange } from '@codemirror/state'
import type { EditorView } from '@codemirror/view'
import { startCompletion } from '@codemirror/autocomplete'

/** Wraps each selection in `open`/`close`, or removes them if already wrapped. */
export function toggleWrap(view: EditorView, open: string, close = open): boolean {
  const { state } = view
  const tr = state.changeByRange((range) => {
    let { from, to } = range
    if (from === to) {
      const word = state.wordAt(from)
      if (word) ({ from, to } = word)
    }
    const before = state.sliceDoc(from - open.length, from)
    const after = state.sliceDoc(to, to + close.length)
    // "*" must not match one half of "**"
    const isolated =
      open !== '*' || (state.sliceDoc(from - 2, from - 1) !== '*' || state.sliceDoc(from - 3, from - 2) === '*') && (state.sliceDoc(to + 1, to + 2) !== '*' || state.sliceDoc(to + 2, to + 3) === '*')
    if (before === open && after === close && isolated) {
      return {
        changes: [
          { from: from - open.length, to: from },
          { from: to, to: to + close.length }
        ],
        range: shift(range, range.empty ? range.head - open.length : from - open.length, to - open.length)
      }
    }
    const inner = state.sliceDoc(from, to)
    if (inner.length >= open.length + close.length && inner.startsWith(open) && inner.endsWith(close)) {
      return {
        changes: [
          { from, to: from + open.length },
          { from: to - close.length, to }
        ],
        range: EditorSelection.range(from, to - open.length - close.length)
      }
    }
    const changes: ChangeSpec[] = [
      { from, insert: open },
      { from: to, insert: close }
    ]
    if (range.empty && from === to) return { changes, range: EditorSelection.cursor(from + open.length) }
    if (range.empty) return { changes, range: EditorSelection.cursor(range.head + open.length) }
    return { changes, range: EditorSelection.range(from + open.length, to + open.length) }
  })
  view.dispatch(state.update(tr, { scrollIntoView: true, userEvent: 'input.format' }))
  return true
}

function shift(range: SelectionRange, from: number, to: number): SelectionRange {
  return range.empty ? EditorSelection.cursor(from) : EditorSelection.range(from, to)
}

/** Inserts `[[]]` (or wraps the selection) and opens link suggestions. */
export function insertWikiLink(view: EditorView): boolean {
  const { state } = view
  const tr = state.changeByRange((range) => {
    const text = state.sliceDoc(range.from, range.to)
    return {
      changes: { from: range.from, to: range.to, insert: `[[${text}]]` },
      range: text ? EditorSelection.cursor(range.from + text.length + 4) : EditorSelection.cursor(range.from + 2)
    }
  })
  view.dispatch(state.update(tr, { scrollIntoView: true, userEvent: 'input' }))
  if (state.selection.main.empty) startCompletion(view)
  return true
}

const LIST_RE = /^(\s*(?:>\s*)*)(?:([-*+])\s+\[(.)\](?:\s|$)|([-*+])\s|(\d+[.)])\s+\[(.)\](?:\s|$)|(\d+[.)])\s)?/

/** none → "- [ ] ", "- " → "- [ ] ", "- [ ] " ↔ "- [x] " for every selected line. */
export function toggleChecklist(view: EditorView): boolean {
  const { state } = view
  const changes: ChangeSpec[] = []
  const seen = new Set<number>()
  for (const r of state.selection.ranges) {
    for (let pos = r.from; pos <= r.to; ) {
      const line = state.doc.lineAt(pos)
      pos = line.to + 1
      if (seen.has(line.number)) continue
      seen.add(line.number)
      const m = LIST_RE.exec(line.text)!
      const indent = m[1].length
      if (m[3] !== undefined || m[6] !== undefined) {
        const box = line.text.indexOf('[', indent) + 1
        const cur = m[3] ?? m[6]
        changes.push({ from: line.from + box, to: line.from + box + 1, insert: cur === ' ' ? 'x' : ' ' })
      } else if (m[4] || m[7]) {
        const markerEnd = indent + (m[4] ?? m[7]).length + 1
        changes.push({ from: line.from + markerEnd, insert: '[ ] ' })
      } else {
        changes.push({ from: line.from + indent, insert: '- [ ] ' })
      }
    }
  }
  // cursors at an insertion point (e.g. an empty line) end up after the new "- [ ] "
  const changeSet = state.changes(changes)
  view.dispatch({ changes: changeSet, selection: state.selection.map(changeSet, 1), scrollIntoView: true, userEvent: 'input.format' })
  return true
}

/** Wraps the selection (or current line) in %% comments, or removes them. */
export function toggleComment(view: EditorView): boolean {
  const { state } = view
  const tr = state.changeByRange((range) => {
    if (range.empty) {
      const line = state.doc.lineAt(range.head)
      const m = /^(\s*)%%\s?(.*?)\s?%%\s*$/.exec(line.text)
      if (m) {
        const inner = m[2]
        const from = line.from + m[1].length
        return { changes: { from, to: line.to, insert: inner }, range: EditorSelection.cursor(Math.min(from + inner.length, Math.max(from, range.head - 3))) }
      }
      if (!line.text.trim()) return { changes: { from: range.head, insert: '%%  %%' }, range: EditorSelection.cursor(range.head + 3) }
      const indent = /^\s*/.exec(line.text)![0].length
      return {
        changes: [
          { from: line.from + indent, insert: '%% ' },
          { from: line.to, insert: ' %%' }
        ],
        range: EditorSelection.cursor(range.head + 3)
      }
    }
    const text = state.sliceDoc(range.from, range.to)
    const m = /^%%\s?([\s\S]*?)\s?%%$/.exec(text)
    if (m) return { changes: { from: range.from, to: range.to, insert: m[1] }, range: EditorSelection.range(range.from, range.from + m[1].length) }
    return { changes: { from: range.from, to: range.to, insert: `%%${text}%%` }, range: EditorSelection.range(range.from, range.to + 4) }
  })
  view.dispatch(state.update(tr, { scrollIntoView: true, userEvent: 'input.format' }))
  return true
}

/** Tab inside a list item indents it; elsewhere inserts a tab. */
export function isListLine(view: EditorView): boolean {
  const line = view.state.doc.lineAt(view.state.selection.main.head)
  return /^\s*(?:[-*+]|\d+[.)])(\s|$)/.test(line.text)
}
