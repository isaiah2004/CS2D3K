// Builds the CodeMirror 6 markdown editor used by the note view.
import { Annotation, Compartment, EditorState, Prec, RangeSet, StateEffect, StateField, type Extension } from '@codemirror/state'
import { EditorView, keymap, drawSelection, dropCursor, placeholder, lineNumbers, gutterLineClass, GutterMarker, type ViewUpdate } from '@codemirror/view'
import { history, historyKeymap, defaultKeymap, indentMore, indentLess, insertTab } from '@codemirror/commands'
import { syntaxHighlighting, foldGutter, foldKeymap, indentUnit } from '@codemirror/language'
import { markdown, insertNewlineContinueMarkup, deleteMarkupBackward } from '@codemirror/lang-markdown'
import { languages } from '@codemirror/language-data'
import { GFM } from '@lezer/markdown'
import { search, searchKeymap } from '@codemirror/search'
import { autocompletion, closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete'
import type { Settings } from '@/store/settings'
import { obsidianExtensions } from './syntax'
import { markdownHighlightStyle } from './highlight'
import { notePath, livePreview, focusTracking } from './state'
import { markdownDecorations } from './decorations'
import { blockWidgets } from './blocks'
import { codeRunField } from './codeRun'
import { linkCompletion, tagCompletion } from './completion'
import { isListLine } from './formatting'

/** Marks transactions that sync content from disk / other views (not saved back, not in history). */
export const externalSync = Annotation.define<boolean>()

export type EditorSettings = Pick<Settings, 'showLineNumbers' | 'tabSize' | 'spellcheck' | 'foldHeadings' | 'autoPairBrackets'>

const compartments = {
  path: new Compartment(),
  mode: new Compartment(),
  lineNumbers: new Compartment(),
  fold: new Compartment(),
  brackets: new Compartment(),
  spell: new Compartment(),
  tabs: new Compartment()
}

function foldMarker(open: boolean): HTMLElement {
  const el = document.createElement('span')
  el.className = `cm-fold-marker${open ? '' : ' is-folded'}`
  el.innerHTML =
    '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>'
  return el
}

/** Fold arrows only show for the hovered line (like Obsidian): track it and tag its gutter elements. */
const setHoverLine = StateEffect.define<number | null>()
const hoverLineField = StateField.define<number | null>({
  create: () => null,
  update(v, tr) {
    for (const e of tr.effects) if (e.is(setHoverLine)) return e.value
    return v !== null && tr.docChanged ? null : v
  }
})
const hoverGutterMarker = new (class extends GutterMarker {
  elementClass = 'cm-hover-line'
})()
const foldHover = [
  hoverLineField,
  gutterLineClass.compute([hoverLineField], (s) => {
    const pos = s.field(hoverLineField)
    return pos === null || pos > s.doc.length ? RangeSet.empty : RangeSet.of([hoverGutterMarker.range(s.doc.lineAt(pos).from)])
  }),
  EditorView.domEventHandlers({
    mousemove(e, view) {
      const block = view.lineBlockAtHeight(e.clientY - view.documentTop)
      const pos = e.clientY < view.documentTop || e.clientY > view.documentTop + view.contentHeight ? null : block.from
      if (pos !== view.state.field(hoverLineField)) view.dispatch({ effects: setHoverLine.of(pos) })
      return false
    },
    mouseleave(_e, view) {
      if (view.state.field(hoverLineField) !== null) view.dispatch({ effects: setHoverLine.of(null) })
      return false
    }
  })
]

function settingExtensions(s: EditorSettings): Record<'lineNumbers' | 'fold' | 'brackets' | 'spell' | 'tabs', Extension> {
  return {
    lineNumbers: s.showLineNumbers ? lineNumbers() : [],
    fold: s.foldHeadings ? [foldGutter({ markerDOM: foldMarker }), foldHover] : [],
    brackets: s.autoPairBrackets ? [closeBrackets(), keymap.of(closeBracketsKeymap)] : [],
    spell: EditorView.contentAttributes.of({ spellcheck: s.spellcheck ? 'true' : 'false', autocorrect: 'off', autocapitalize: 'off' }),
    tabs: [EditorState.tabSize.of(s.tabSize), indentUnit.of('\t')]
  }
}

const baseTheme = EditorView.theme({
  '&': { backgroundColor: 'transparent', color: 'var(--text-normal)', fontSize: 'var(--font-text-size)' },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': { overflow: 'visible', fontFamily: 'var(--font-text)', lineHeight: 'var(--line-height-normal)' },
  '.cm-content': { caretColor: 'var(--text-normal)', padding: '0' },
  '.cm-line': { padding: '0' },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--text-normal)', borderLeftWidth: '1.5px' },
  '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground': {
    backgroundColor: 'var(--text-selection) !important'
  },
  '.cm-gutters': { backgroundColor: 'transparent', border: 'none', color: 'var(--text-faint)' },
  '.cm-placeholder': { color: 'var(--text-faint)' }
})

export interface CreateEditorOptions {
  parent: HTMLElement
  doc: string
  /** initial cursor position */
  cursor?: number
  path: string
  live: boolean
  settings: EditorSettings
  onUpdate: (u: ViewUpdate) => void
  /** extra extensions (event handlers etc.) */
  extensions?: Extension
}

export function createMarkdownEditor(o: CreateEditorOptions): EditorView {
  const s = settingExtensions(o.settings)
  const state = EditorState.create({
    doc: o.doc,
    selection: o.cursor !== undefined ? { anchor: Math.min(o.cursor, o.doc.length) } : undefined,
    extensions: [
      compartments.path.of(notePath.of(o.path)),
      compartments.mode.of(livePreview.of(o.live)),
      history(),
      drawSelection(),
      dropCursor(),
      EditorState.allowMultipleSelections.of(true),
      markdown({ extensions: [GFM, ...obsidianExtensions], codeLanguages: languages, addKeymap: false, completeHTMLTags: false }),
      EditorState.languageData.of(() => [{ closeBrackets: { brackets: ['(', '[', '{', '"'] } }]),
      syntaxHighlighting(markdownHighlightStyle),
      EditorView.lineWrapping,
      placeholder('Start writing…'),
      search({ top: true }),
      autocompletion({ override: [linkCompletion, tagCompletion], icons: false, activateOnTyping: true }),
      markdownDecorations,
      blockWidgets,
      codeRunField,
      focusTracking,
      compartments.lineNumbers.of(s.lineNumbers),
      compartments.fold.of(s.fold),
      compartments.brackets.of(s.brackets),
      compartments.spell.of(s.spell),
      compartments.tabs.of(s.tabs),
      Prec.high(
        keymap.of([
          { key: 'Enter', run: insertNewlineContinueMarkup },
          { key: 'Backspace', run: deleteMarkupBackward },
          { key: 'Tab', run: (v) => (isListLine(v) ? indentMore(v) : insertTab(v)), shift: indentLess }
        ])
      ),
      keymap.of([...searchKeymap, ...historyKeymap, ...foldKeymap, ...defaultKeymap]),
      baseTheme,
      EditorView.updateListener.of(o.onUpdate),
      o.extensions ?? []
    ]
  })
  return new EditorView({ state, parent: o.parent })
}

export function setEditorMode(view: EditorView, live: boolean): void {
  if (view.state.facet(livePreview) === live) return
  view.dispatch({ effects: compartments.mode.reconfigure(livePreview.of(live)) })
}

export function setEditorPath(view: EditorView, path: string): void {
  if (view.state.facet(notePath) === path) return
  view.dispatch({ effects: compartments.path.reconfigure(notePath.of(path)) })
}

export function applyEditorSettings(view: EditorView, settings: EditorSettings): void {
  const s = settingExtensions(settings)
  view.dispatch({
    effects: [
      compartments.lineNumbers.reconfigure(s.lineNumbers),
      compartments.fold.reconfigure(s.fold),
      compartments.brackets.reconfigure(s.brackets),
      compartments.spell.reconfigure(s.spell),
      compartments.tabs.reconfigure(s.tabs)
    ]
  })
}
