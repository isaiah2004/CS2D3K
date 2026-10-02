// Markdown view commands — registered once; they act on the focused markdown view instance.
import type { EditorView } from '@codemirror/view'
import { openSearchPanel } from '@codemirror/search'
import { foldAll, unfoldAll } from '@codemirror/language'
import { registerCommands } from '@/store/commands'
import type { ViewMode } from '@/store/settings'
import { toggleWrap, insertWikiLink, toggleChecklist, toggleComment } from './editor/formatting'
import { runCodeBlockAt } from './editor/codeRun'
import { notice } from '@/store/ui'

export interface MarkdownViewHandle {
  editor(): EditorView | null
  mode(): ViewMode
  setMode(mode: ViewMode): void
  toggleReading(): void
  toggleSource(): void
}

let active: MarkdownViewHandle | null = null

/** Called by views when their focused state changes. */
export function setFocusedMarkdownView(h: MarkdownViewHandle, focused: boolean): void {
  if (focused) active = h
  else if (active === h) active = null
}

/** Don't hijack formatting keys while the user types in some other input (sidebar search, inline title…). */
function focusAllowsEditing(): boolean {
  const ae = document.activeElement as HTMLElement | null
  if (!ae || ae === document.body) return true
  const v = active?.editor()
  if (v && v.dom.contains(ae)) return true
  return !(ae.isContentEditable || ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.tagName === 'SELECT')
}

const hasView = (): boolean => !!active
const editing = (): boolean => !!active && active.mode() !== 'reading' && !!active.editor() && focusAllowsEditing()

/** Run fn on the focused editor (in editing mode). */
function withEditor(fn: (v: EditorView) => unknown): () => void {
  return () => {
    const v = active?.editor()
    if (!v) return
    fn(v)
    v.focus()
  }
}

/** Make sure the focused view is editable (switching out of reading view) and run fn. */
function inEditor(fn: (v: EditorView) => unknown): () => void {
  return () => {
    if (!active) return
    if (active.mode() === 'reading') active.setMode('live')
    const v = active.editor()
    if (!v) return
    // the mode switch re-renders: wait a frame so the editor is visible before acting
    requestAnimationFrame(() => {
      v.focus()
      fn(v)
    })
  }
}

registerCommands([
  { id: 'editor:toggle-mode', name: 'Toggle reading view', hotkeys: ['Mod+E'], check: hasView, run: () => active?.toggleReading() },
  { id: 'editor:toggle-source', name: 'Toggle Live Preview/Source mode', check: hasView, run: () => active?.toggleSource() },
  { id: 'editor:toggle-bold', name: 'Toggle bold', hotkeys: ['Mod+B'], check: editing, run: withEditor((v) => toggleWrap(v, '**')) },
  { id: 'editor:toggle-italic', name: 'Toggle italics', hotkeys: ['Mod+I'], check: editing, run: withEditor((v) => toggleWrap(v, '*')) },
  { id: 'editor:toggle-strikethrough', name: 'Toggle strikethrough', check: editing, run: withEditor((v) => toggleWrap(v, '~~')) },
  { id: 'editor:toggle-highlight', name: 'Toggle highlight', check: editing, run: withEditor((v) => toggleWrap(v, '==')) },
  { id: 'editor:toggle-code', name: 'Toggle inline code', check: editing, run: withEditor((v) => toggleWrap(v, '`')) },
  { id: 'editor:insert-link', name: 'Insert internal link', hotkeys: ['Mod+K'], check: editing, run: withEditor(insertWikiLink) },
  { id: 'editor:toggle-checklist', name: 'Toggle checklist status', hotkeys: ['Mod+L'], check: editing, run: withEditor(toggleChecklist) },
  { id: 'editor:toggle-comment', name: 'Toggle comment', hotkeys: ['Mod+/'], check: editing, run: withEditor(toggleComment) },
  { id: 'editor:fold-all', name: 'Fold all headings and lists', check: editing, run: withEditor(foldAll) },
  { id: 'editor:unfold-all', name: 'Unfold all headings and lists', check: editing, run: withEditor(unfoldAll) },
  {
    id: 'editor:run-code-block',
    name: 'Run code block under cursor',
    hotkeys: ['Mod+Shift+Enter'],
    check: editing,
    run: withEditor((v) => {
      if (!runCodeBlockAt(v, v.state.selection.main.head)) notice('Place the cursor inside a fenced code block to run it')
    })
  },
  { id: 'editor:find', name: 'Search current file', hotkeys: ['Mod+F'], check: hasView, run: inEditor(openSearchPanel) },
  {
    id: 'editor:replace',
    name: 'Search and replace in current file',
    hotkeys: ['Mod+H'],
    check: hasView,
    run: inEditor((v) => {
      openSearchPanel(v)
      requestAnimationFrame(() => v.dom.querySelector<HTMLInputElement>('.cm-search input[name=replace]')?.focus())
    })
  }
])
