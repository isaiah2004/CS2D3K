// Small CodeMirror 6 editor used by canvas text cards (markdown) and code cells.
import { useEffect, useRef } from 'react'
import { Annotation, Compartment, EditorState, type Extension } from '@codemirror/state'
import { EditorView, keymap, lineNumbers, drawSelection, highlightActiveLine, highlightActiveLineGutter, placeholder as cmPlaceholder } from '@codemirror/view'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { HighlightStyle, syntaxHighlighting, indentOnInput, bracketMatching, LanguageDescription, indentUnit } from '@codemirror/language'
import { languages } from '@codemirror/language-data'
import { closeBrackets, closeBracketsKeymap, autocompletion, completionKeymap } from '@codemirror/autocomplete'
import { highlightSelectionMatches } from '@codemirror/search'
import { markdown } from '@codemirror/lang-markdown'
import { tags as t } from '@lezer/highlight'

/** Languages offered in the code cell dropdown: value → [label, CodeMirror language name]. */
export const CODE_LANGS: { id: string; label: string; cm: string }[] = [
  { id: 'python', label: 'Python', cm: 'Python' },
  { id: 'js', label: 'JavaScript', cm: 'JavaScript' },
  { id: 'ts', label: 'TypeScript', cm: 'TypeScript' },
  { id: 'bash', label: 'Bash', cm: 'Shell' },
  { id: 'powershell', label: 'PowerShell', cm: 'PowerShell' },
  { id: 'go', label: 'Go', cm: 'Go' },
  { id: 'rust', label: 'Rust', cm: 'Rust' },
  { id: 'c', label: 'C', cm: 'C' },
  { id: 'cpp', label: 'C++', cm: 'C++' },
  { id: 'ruby', label: 'Ruby', cm: 'Ruby' },
  { id: 'lua', label: 'Lua', cm: 'Lua' },
  { id: 'php', label: 'PHP', cm: 'PHP' },
  { id: 'bat', label: 'Batch', cm: '' },
  { id: 'json', label: 'JSON', cm: 'JSON' },
  { id: 'html', label: 'HTML', cm: 'HTML' },
  { id: 'css', label: 'CSS', cm: 'CSS' },
  { id: 'sql', label: 'SQL', cm: 'SQL' },
  { id: 'yaml', label: 'YAML', cm: 'YAML' },
  { id: 'java', label: 'Java', cm: 'Java' },
  { id: 'markdown', label: 'Markdown', cm: 'Markdown' },
  { id: 'text', label: 'Plain text', cm: '' }
]

/** Languages the runner can execute. */
export const RUNNABLE = new Set(['python', 'js', 'ts', 'bash', 'powershell', 'go', 'rust', 'c', 'cpp', 'ruby', 'lua', 'php', 'bat'])

const ALIAS: Record<string, string> = {
  javascript: 'js', node: 'js', typescript: 'ts', py: 'python', python3: 'python', sh: 'bash', shell: 'bash', zsh: 'bash',
  ps1: 'powershell', pwsh: 'powershell', golang: 'go', rs: 'rust', 'c++': 'cpp', rb: 'ruby', md: 'markdown', yml: 'yaml', cmd: 'bat'
}

export function canonicalLang(lang: string | undefined): string {
  const l = (lang ?? '').trim().toLowerCase()
  return ALIAS[l] ?? l
}

const langCache = new Map<string, Promise<Extension | null>>()

/** Load CodeMirror language support for a cell language id (cached). */
export function loadLanguage(lang: string): Promise<Extension | null> {
  const id = canonicalLang(lang)
  let p = langCache.get(id)
  if (!p) {
    const name = CODE_LANGS.find((l) => l.id === id)?.cm ?? id
    const desc = name ? (LanguageDescription.matchLanguageName(languages, name, false) ?? LanguageDescription.matchLanguageName(languages, name, true)) : null
    p = desc ? desc.load().then((s) => s as Extension, () => null) : Promise.resolve(null)
    langCache.set(id, p)
  }
  return p
}

const highlight = HighlightStyle.define([
  { tag: [t.comment, t.lineComment, t.blockComment, t.docComment], color: 'var(--code-comment)', fontStyle: 'italic' },
  { tag: [t.keyword, t.controlKeyword, t.moduleKeyword, t.operatorKeyword, t.definitionKeyword, t.modifier, t.self, t.null, t.bool], color: 'var(--code-keyword)' },
  { tag: [t.string, t.special(t.string), t.regexp, t.character, t.escape], color: 'var(--code-string)' },
  { tag: [t.number, t.integer, t.float, t.atom], color: 'var(--code-number)' },
  { tag: [t.function(t.variableName), t.function(t.propertyName), t.macroName], color: 'var(--code-function)' },
  { tag: [t.typeName, t.className, t.namespace, t.standard(t.variableName)], color: 'var(--code-type)' },
  { tag: [t.propertyName, t.attributeName, t.labelName], color: 'var(--code-property)' },
  { tag: [t.operator, t.punctuation, t.bracket, t.derefOperator], color: 'var(--code-operator)' },
  { tag: [t.tagName, t.angleBracket], color: 'var(--code-tag)' },
  { tag: t.meta, color: 'var(--text-faint)' },
  { tag: t.invalid, color: 'var(--text-error)' },
  // markdown
  { tag: t.heading1, fontWeight: '700', fontSize: '1.3em' },
  { tag: t.heading2, fontWeight: '700', fontSize: '1.18em' },
  { tag: [t.heading3, t.heading4, t.heading5, t.heading6], fontWeight: '700' },
  { tag: t.strong, fontWeight: '700' },
  { tag: t.emphasis, fontStyle: 'italic' },
  { tag: t.strikethrough, textDecoration: 'line-through' },
  { tag: t.link, color: 'var(--text-accent)' },
  { tag: t.url, color: 'var(--text-faint)' },
  { tag: t.monospace, fontFamily: 'var(--font-monospace)', color: 'var(--code-string)' },
  { tag: t.quote, color: 'var(--text-muted)' },
  { tag: [t.processingInstruction, t.contentSeparator], color: 'var(--text-faint)' }
])

const baseTheme = EditorView.theme({
  '&': { height: '100%', background: 'transparent', color: 'var(--text-normal)' },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': { overflow: 'auto', lineHeight: '1.55' },
  '.cm-content': { caretColor: 'var(--text-normal)' },
  '.cm-cursor': { borderLeftColor: 'var(--text-normal)', borderLeftWidth: '2px' },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection': { background: 'var(--text-selection) !important' },
  '.cm-activeLine': { background: 'var(--background-modifier-hover)' },
  '.cm-gutters': { background: 'transparent', border: 'none', color: 'var(--text-faint)' },
  '.cm-activeLineGutter': { background: 'transparent', color: 'var(--text-muted)' },
  '.cm-matchingBracket': { background: 'var(--background-modifier-hover)', outline: '1px solid var(--background-modifier-border-focus)' },
  '.cm-selectionMatch': { background: 'var(--text-highlight-bg)' },
  '.cm-placeholder': { color: 'var(--text-faint)' },
  '.cm-tooltip': { background: 'var(--background-secondary)', border: '1px solid var(--background-modifier-border)', borderRadius: 'var(--radius-s)' },
  '.cm-tooltip-autocomplete > ul > li[aria-selected]': { background: 'var(--background-modifier-active-hover)', color: 'var(--text-normal)' }
})

const external = Annotation.define<boolean>()

export interface CmEditorProps {
  value: string
  onChange: (v: string) => void
  /** 'markdown' for text cards, otherwise a code cell language id */
  lang: string
  mode: 'text' | 'code'
  autoFocus?: boolean
  placeholder?: string
  onEscape?: () => void
  onModEnter?: () => void
  onBlur?: () => void
  /** reports how many (unscaled) px of content don't fit in the editor */
  onOverflow?: (px: number) => void
  /** on mount: focus and put the caret at this client point (a click that mounted the editor) */
  focusAt?: { x: number; y: number } | null
  onFocusApplied?: () => void
  className?: string
}

export default function CmEditor(p: CmEditorProps) {
  const hostRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const langComp = useRef(new Compartment())
  const cb = useRef(p)
  cb.current = p

  useEffect(() => {
    const host = hostRef.current!
    const isCode = p.mode === 'code'
    const extensions: Extension[] = [
      history(),
      drawSelection(),
      indentOnInput(),
      bracketMatching(),
      closeBrackets(),
      syntaxHighlighting(highlight),
      highlightSelectionMatches(),
      baseTheme,
      EditorState.tabSize.of(4),
      indentUnit.of(isCode ? '    ' : '\t'),
      keymap.of([
        ...closeBracketsKeymap,
        ...completionKeymap,
        { key: 'Escape', run: () => (cb.current.onEscape ? (cb.current.onEscape(), true) : false) },
        { key: 'Mod-Enter', run: () => (cb.current.onModEnter ? (cb.current.onModEnter(), true) : false) },
        ...defaultKeymap,
        ...historyKeymap,
        ...(isCode ? [indentWithTab] : [])
      ]),
      EditorView.updateListener.of((u) => {
        if (u.docChanged && !u.transactions.some((tr) => tr.annotation(external))) cb.current.onChange(u.state.doc.toString())
        if ((u.docChanged || u.geometryChanged) && cb.current.onOverflow) {
          u.view.requestMeasure({
            key: 'canvas-overflow',
            read: (v) => v.scrollDOM.scrollHeight - v.scrollDOM.clientHeight,
            write: (o) => {
              if (o > 0) cb.current.onOverflow?.(o)
            }
          })
        }
        if (u.focusChanged && !u.view.hasFocus) cb.current.onBlur?.()
      }),
      langComp.current.of([]),
      EditorView.contentAttributes.of({ spellcheck: isCode ? 'false' : 'true', autocapitalize: 'off' })
    ]
    if (isCode) extensions.push(lineNumbers(), highlightActiveLineGutter(), highlightActiveLine(), autocompletion({ activateOnTyping: true }))
    else extensions.push(EditorView.lineWrapping, markdown())
    if (p.placeholder) extensions.push(cmPlaceholder(p.placeholder))
    const view = new EditorView({ state: EditorState.create({ doc: p.value, extensions }), parent: host })
    viewRef.current = view
    if (p.autoFocus) {
      requestAnimationFrame(() => {
        view.focus()
        view.dispatch({ selection: { anchor: view.state.doc.length } })
      })
    } else if (p.focusAt) {
      const at = p.focusAt
      requestAnimationFrame(() => {
        if (viewRef.current !== view) return
        const pos = view.posAtCoords(at) ?? view.state.doc.length
        view.focus()
        view.dispatch({ selection: { anchor: pos } })
        cb.current.onFocusApplied?.()
      })
    }
    return () => {
      view.destroy()
      viewRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // language
  useEffect(() => {
    if (p.mode !== 'code') return
    let cancelled = false
    void loadLanguage(p.lang).then((ext) => {
      if (cancelled || !viewRef.current) return
      viewRef.current.dispatch({ effects: langComp.current.reconfigure(ext ?? []) })
    })
    return () => {
      cancelled = true
    }
  }, [p.lang, p.mode])

  // external value changes (undo, file reload)
  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    const cur = view.state.doc.toString()
    if (cur !== p.value) view.dispatch({ changes: { from: 0, to: cur.length, insert: p.value }, annotations: external.of(true) })
  }, [p.value])

  return <div ref={hostRef} className={`canvas-cm ${p.className ?? ''}`} />
}

/** Focus the CodeMirror editor inside an element (if any). */
export function focusEditorIn(el: Element | null): boolean {
  const cm = el?.querySelector('.cm-editor')
  if (!cm) return false
  const view = EditorView.findFromDOM(cm as HTMLElement)
  view?.focus()
  return !!view
}
