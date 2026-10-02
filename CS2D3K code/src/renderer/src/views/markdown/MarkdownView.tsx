// The note view: CodeMirror 6 editor (Live Preview / Source) + Reading view, inline title,
// autosave, external sync, navigation, word count.
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { BookOpen, Pencil } from 'lucide-react'
import { EditorView, type ViewUpdate } from '@codemirror/view'
import { EditorSelection, Transaction, type Text, type SelectionRange } from '@codemirror/state'
import type { ViewProps } from '../types'
import { ViewHeaderActions, StatusBarItem } from '@/components/Slots'
import MarkdownPreview from '@/lib/markdown/MarkdownPreview'
import { attachHoverPreview } from '@/lib/markdown/hoverPreview'
import { readFile, saveFile, onExternalChange, broadcastContent, renamePath, registerFlusher } from '@/lib/fileops'
import { useWorkspace } from '@/store/workspace'
import { useSettings, getSettings, type ViewMode } from '@/store/settings'
import { useMetadata } from '@/store/metadata'
import { useVault } from '@/store/vault'
import { formatHotkey } from '@/store/commands'
import { notice } from '@/store/ui'
import { debounce, clamp } from '@/lib/util'
import { stem, dirname, join, validateName } from '@/lib/path'
import { parseFrontmatter } from '@/lib/mdparse'
import { createMarkdownEditor, setEditorMode, setEditorPath, applyEditorSettings, externalSync } from './editor/setup'
import { editorInteractions, insertFileLinks, FILE_MIME } from './editor/interactions'
import { refreshDecorations } from './editor/state'
import { killAllRuns } from './editor/codeRun'
import { toggleTaskAt } from './editor/widgets'
import { setFocusedMarkdownView, type MarkdownViewHandle } from './commands'
import './markdownView.css'

type EditMode = 'live' | 'source'

/** last mode per tab id, so navigating to another note in the same tab keeps reading/source mode */
const tabModes = new Map<string, { mode: ViewMode; editMode: EditMode }>()

const WORD_RE = /[\p{L}\p{N}][\p{L}\p{N}'’_-]*/gu

function countWords(text: string): number {
  let n = 0
  WORD_RE.lastIndex = 0
  while (WORD_RE.exec(text)) n++
  return n
}

/** 0-based line of a "#Heading" / "#^block" subpath in `doc`, or null. */
function findSubpathLine(doc: Text, subpath: string): number | null {
  if (subpath.startsWith('#^')) {
    const id = subpath.slice(2)
    for (let i = 1; i <= doc.lines; i++) if (doc.line(i).text.trimEnd().endsWith(`^${id}`)) return i - 1
    return null
  }
  const parts = subpath.split('#').filter(Boolean)
  const want = (parts[parts.length - 1] ?? '').trim().toLowerCase()
  if (!want) return null
  let inFence = false
  for (let i = 1; i <= doc.lines; i++) {
    const text = doc.line(i).text
    if (/^\s*(```|~~~)/.test(text)) inFence = !inFence
    if (inFence) continue
    const m = /^#{1,6}\s+(.*?)\s*#*\s*$/.exec(text)
    if (m && m[1].trim().toLowerCase() === want) return i - 1
  }
  return null
}

/** Replace the editor content with `content` using a minimal change (keeps selection/scroll stable). */
function syncContent(view: EditorView, content: string): void {
  const cur = view.state.doc.toString()
  if (cur === content) return
  let start = 0
  const min = Math.min(cur.length, content.length)
  while (start < min && cur.charCodeAt(start) === content.charCodeAt(start)) start++
  let endA = cur.length
  let endB = content.length
  while (endA > start && endB > start && cur.charCodeAt(endA - 1) === content.charCodeAt(endB - 1)) {
    endA--
    endB--
  }
  view.dispatch({
    changes: { from: start, to: endA, insert: content.slice(start, endB) },
    annotations: [Transaction.addToHistory.of(false), externalSync.of(true)]
  })
}

function InlineTitle({ path, editable, titleRef, onDone }: { path: string; editable: boolean; titleRef: React.RefObject<HTMLDivElement | null>; onDone: () => void }) {
  const name = stem(path)
  const committing = useRef(false)

  useLayoutEffect(() => {
    const el = titleRef.current
    if (el && document.activeElement !== el) el.textContent = name
  }, [name, titleRef])

  const commit = async (): Promise<void> => {
    const el = titleRef.current
    if (!el || committing.current) return
    const next = (el.textContent ?? '').replace(/\s+/g, ' ').trim()
    if (!next || next === name) {
      el.textContent = name
      return
    }
    const err = validateName(next)
    if (err) {
      notice(err, 'error')
      el.textContent = name
      return
    }
    committing.current = true
    const ok = await renamePath(path, join(dirname(path), `${next}.md`))
    committing.current = false
    if (!ok && titleRef.current) titleRef.current.textContent = name
  }

  return (
    <div
      ref={titleRef}
      className="md-inline-title"
      contentEditable={editable ? 'plaintext-only' : false}
      suppressContentEditableWarning
      spellCheck={false}
      tabIndex={editable ? 0 : -1}
      onBlur={() => void commit()}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault()
          titleRef.current?.blur()
          onDone()
        } else if (e.key === 'Escape') {
          e.preventDefault()
          if (titleRef.current) titleRef.current.textContent = name
          titleRef.current?.blur()
          onDone()
        }
      }}
    />
  )
}

export default function MarkdownView({ tab, visible, focused }: ViewProps) {
  const path = tab.path ?? ''
  const tabState = tab.state ?? {}
  // a tab keeps its mode while navigating between notes (like Obsidian)
  const remembered = tabModes.get(tab.id)
  const initialMode = (): ViewMode => {
    const m = tabState.mode as ViewMode | undefined
    return m === 'live' || m === 'source' || m === 'reading' ? m : (remembered?.mode ?? getSettings().defaultViewMode)
  }
  const [mode, setModeState] = useState<ViewMode>(initialMode)
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [readingSource, setReadingSource] = useState('')
  const [counts, setCounts] = useState({ words: 0, chars: 0, selection: false })

  const rootRef = useRef<HTMLDivElement>(null)
  const scrollerRef = useRef<HTMLDivElement>(null)
  const hostRef = useRef<HTMLDivElement>(null)
  const readingRef = useRef<HTMLDivElement>(null)
  const titleRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const pathRef = useRef(path)
  pathRef.current = path
  const modeRef = useRef(mode)
  const editModeRef = useRef<EditMode>(
    mode === 'source' || mode === 'live'
      ? mode
      : (tabState.editMode as EditMode | undefined) ?? remembered?.editMode ?? (getSettings().defaultViewMode === 'source' ? 'source' : 'live')
  )
  const tabIdRef = useRef(tab.id)
  tabIdRef.current = tab.id
  const visibleRef = useRef(visible)
  visibleRef.current = visible
  const savedScrollTop = useRef(0)
  const pendingScrollLine = useRef<number | null>(null)
  const lastNav = useRef<unknown>(undefined)

  const showLineNumbers = useSettings((s) => s.settings.showLineNumbers)
  const tabSize = useSettings((s) => s.settings.tabSize)
  const spellcheck = useSettings((s) => s.settings.spellcheck)
  const foldHeadings = useSettings((s) => s.settings.foldHeadings)
  const autoPairBrackets = useSettings((s) => s.settings.autoPairBrackets)
  const showFrontmatter = useSettings((s) => s.settings.showFrontmatter)

  // ------------------------------------------------------------ saving

  const timers = useRef<{
    save: ReturnType<typeof debounce<[]>>
    meta: ReturnType<typeof debounce<[]>>
    counts: ReturnType<typeof debounce<[]>>
    persistScroll: ReturnType<typeof debounce<[]>>
  } | null>(null)
  const externalCb = useRef((content: string): void => {
    const v = viewRef.current
    if (!v) return
    timers.current?.save.cancel()
    syncContent(v, content)
  }).current

  if (!timers.current) {
    timers.current = {
      save: debounce(() => {
        const v = viewRef.current
        if (!v) return
        const p = pathRef.current
        const content = v.state.doc.toString()
        saveFile(p, content).then(
          () => broadcastContent(p, content, externalCb),
          (e) => notice(`Couldn't save "${p}": ${(e as Error).message}`, 'error')
        )
      }, 400),
      meta: debounce(() => {
        const v = viewRef.current
        if (v) useMetadata.getState().updateContent(pathRef.current, v.state.doc.toString())
      }, 300),
      counts: debounce(() => {
        const v = viewRef.current
        if (!v) return
        const sel = v.state.selection.ranges.filter((r) => !r.empty)
        const text = sel.length ? sel.map((r) => v.state.sliceDoc(r.from, r.to)).join('\n') : v.state.doc.toString()
        setCounts({ words: countWords(text), chars: text.length, selection: sel.length > 0 })
      }, 150),
      persistScroll: debounce(() => {
        const line = topVisibleLine()
        if (line !== null) useWorkspace.getState().updateTabState(tabIdRef.current, { scroll: line })
      }, 800)
    }
  }
  const t = timers.current

  const onUpdate = (u: ViewUpdate): void => {
    if (u.docChanged) {
      const external = u.transactions.some((tr) => tr.annotation(externalSync))
      if (!external) {
        t.save()
        t.meta()
      }
      if (modeRef.current === 'reading') setReadingSource(u.state.doc.toString())
    }
    if ((u.docChanged || u.selectionSet) && visibleRef.current) t.counts()
  }
  const onUpdateRef = useRef(onUpdate)
  onUpdateRef.current = onUpdate

  // ------------------------------------------------------------ scroll helpers

  /** 0-based source line at the top of the viewport (or null before load). */
  function topVisibleLine(): number | null {
    const scroller = scrollerRef.current
    const v = viewRef.current
    if (!scroller || !v) return null
    const top = scroller.getBoundingClientRect().top
    if (modeRef.current === 'reading') {
      const els = readingRef.current?.querySelectorAll<HTMLElement>('[data-line]') ?? []
      for (const el of els) {
        if (el.getBoundingClientRect().bottom > top + 4) return Number(el.dataset.line) || 0
      }
      return 0
    }
    const h = top - v.documentTop
    if (h <= 0) return 0
    const block = v.lineBlockAtHeight(h)
    return v.state.doc.lineAt(block.from).number - 1
  }

  /** Scroll so that source `line` (0-based) is at the top (or centered). */
  function scrollToLine(line: number, center = false, flash = false): void {
    const scroller = scrollerRef.current
    const v = viewRef.current
    if (!scroller || !v) return
    if (modeRef.current === 'reading') {
      if (line <= 0 && !center) {
        scroller.scrollTop = 0
        return
      }
      let best: HTMLElement | null = null
      for (const el of readingRef.current?.querySelectorAll<HTMLElement>('[data-line]') ?? []) {
        const l = Number(el.dataset.line)
        if (l <= line && el.tagName !== 'INPUT') best = el
        else if (l > line) break
      }
      if (!best) return
      const target = best.tagName === 'INPUT' ? best.closest('li') ?? best : best
      const sr = scroller.getBoundingClientRect()
      const r = target.getBoundingClientRect()
      scroller.scrollTop += center ? r.top - sr.top - sr.height / 2 + r.height / 2 : r.top - sr.top - 12
      if (flash) {
        target.classList.remove('is-flashing')
        void target.offsetWidth
        target.classList.add('is-flashing')
      }
      return
    }
    if (line <= 0 && !center) {
      scroller.scrollTop = 0
      return
    }
    const l = v.state.doc.line(clamp(line + 1, 1, v.state.doc.lines))
    v.dispatch({ effects: EditorView.scrollIntoView(l.from, center ? { y: 'center' } : { y: 'start', yMargin: 12 }) })
  }

  // ------------------------------------------------------------ mode switching

  const setMode = (next: ViewMode): void => {
    if (next === modeRef.current) return
    pendingScrollLine.current = topVisibleLine()
    const v = viewRef.current
    if (next === 'reading') setReadingSource(v ? v.state.doc.toString() : readingSource)
    else {
      editModeRef.current = next
      if (v) setEditorMode(v, next === 'live')
    }
    modeRef.current = next
    setModeState(next)
    useWorkspace.getState().updateTabState(tab.id, { mode: next, editMode: editModeRef.current })
    tabModes.set(tab.id, { mode: next, editMode: editModeRef.current })
  }
  const setModeRef = useRef(setMode)
  setModeRef.current = setMode

  const handle = useRef<MarkdownViewHandle>({
    editor: () => viewRef.current,
    mode: () => modeRef.current,
    setMode: (m) => setModeRef.current(m),
    toggleReading: () => setModeRef.current(modeRef.current === 'reading' ? editModeRef.current : 'reading'),
    toggleSource: () => setModeRef.current(editModeRef.current === 'live' ? 'source' : 'live')
  }).current

  const modeMounted = useRef(false)
  useLayoutEffect(() => {
    const line = pendingScrollLine.current
    pendingScrollLine.current = null
    // first run = mount: focus is handled by the focus effect once the note has loaded
    const first = !modeMounted.current
    modeMounted.current = true
    if (first) return
    if (mode !== 'reading') {
      const v = viewRef.current
      if (v && visibleRef.current) v.focus()
    } else if (visibleRef.current) scrollerRef.current?.focus({ preventScroll: true })
    if (line !== null) scrollToLine(line)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode])

  // ------------------------------------------------------------ lifecycle

  useEffect(() => {
    let cancelled = false
    let view: EditorView | null = null
    let detachHover: (() => void) | null = null
    readFile(pathRef.current).then(
      (content) => {
        if (cancelled || !hostRef.current) return
        view = createMarkdownEditor({
          parent: hostRef.current,
          doc: content,
          // start below the frontmatter so typing doesn't land before the properties
          cursor: parseFrontmatter(content).endOffset,
          path: pathRef.current,
          live: editModeRef.current === 'live',
          settings: getSettings(),
          onUpdate: (u) => onUpdateRef.current(u),
          extensions: [editorInteractions]
        })
        viewRef.current = view
        detachHover = attachHoverPreview(view.contentDOM, { sourcePath: () => pathRef.current })
        setReadingSource(content)
        setLoaded(true)
      },
      (e) => !cancelled && setError((e as Error).message ?? String(e))
    )
    const unregisterFlush = registerFlusher(() => t.save.flush())
    return () => {
      cancelled = true
      unregisterFlush()
      t.save.flush()
      t.meta.cancel()
      t.counts.cancel()
      t.persistScroll.cancel()
      detachHover?.()
      if (view) {
        killAllRuns(view.state)
        view.destroy()
      }
      viewRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // after load: navigation request, restored scroll position, or title focus for new notes
  useEffect(() => {
    if (!loaded) return
    const st = tab.state ?? {}
    const hasNav = typeof st.line === 'number' || !!st.subpath || !!st.query
    if (hasNav) return // handled by the navigation effect
    if (typeof st.scroll === 'number' && st.scroll > 0) requestAnimationFrame(() => scrollToLine(st.scroll as number))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded])

  // file renamed / moved
  useEffect(() => {
    if (viewRef.current) setEditorPath(viewRef.current, path)
  }, [path, loaded])

  // content changes from disk / other tabs
  useEffect(() => {
    if (!path) return
    return onExternalChange(path, externalCb)
  }, [path, externalCb])

  // live settings
  useEffect(() => {
    const v = viewRef.current
    if (v) applyEditorSettings(v, { showLineNumbers, tabSize, spellcheck, foldHeadings, autoPairBrackets })
  }, [loaded, showLineNumbers, tabSize, spellcheck, foldHeadings, autoPairBrackets])

  // "show properties" toggled → rebuild the frontmatter widget
  useEffect(() => {
    viewRef.current?.dispatch({ effects: refreshDecorations.of(null) })
  }, [showFrontmatter])

  // files added/removed/renamed → link resolution (resolved/unresolved styling, embeds) may change
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null
    let count = Object.keys(useVault.getState().files).length
    const unsub = useVault.subscribe((s, prev) => {
      if (s.files === prev.files) return
      const n = Object.keys(s.files).length
      // plain saves only change mtimes; renames keep the count but replace keys
      if (n === count && Object.keys(prev.files).every((k) => k in s.files)) return
      count = n
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => viewRef.current?.dispatch({ effects: refreshDecorations.of(null) }), 200)
    })
    return () => {
      unsub()
      if (timer) clearTimeout(timer)
    }
  }, [])

  // hidden → flush pending save; shown → restore scroll + counts
  useLayoutEffect(() => {
    if (!visible) {
      t.save.flush()
      return
    }
    if (scrollerRef.current && savedScrollTop.current) scrollerRef.current.scrollTop = savedScrollTop.current
    t.counts()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible])

  // focus handling + command target
  useEffect(() => {
    if (!focused || !loaded) return
    setFocusedMarkdownView(handle, true)
    const st = tab.state ?? {}
    const root = rootRef.current
    if (st.focusTitle) {
      useWorkspace.getState().updateTabState(tab.id, { focusTitle: undefined })
      const title = titleRef.current
      if (title && getComputedStyle(title).display !== 'none' && modeRef.current !== 'reading') {
        title.focus()
        const range = document.createRange()
        range.selectNodeContents(title)
        const sel = window.getSelection()
        sel?.removeAllRanges()
        sel?.addRange(range)
        return () => setFocusedMarkdownView(handle, false)
      }
    }
    if (root && !root.contains(document.activeElement) && !document.activeElement?.closest('.modal-backdrop, input, textarea')) {
      if (modeRef.current === 'reading') scrollerRef.current?.focus({ preventScroll: true })
      else viewRef.current?.focus()
    }
    return () => setFocusedMarkdownView(handle, false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focused, loaded])

  // navigation requests (line / #heading / #^block / query)
  const navKey = tabState._nav
  useEffect(() => {
    if (!loaded) return
    const st = tab.state ?? {}
    const line0 = typeof st.line === 'number' ? st.line : null
    const subpath = typeof st.subpath === 'string' ? st.subpath : null
    const query = typeof st.query === 'string' && st.query ? st.query : null
    if (line0 === null && !subpath && !query) return
    const key = navKey ?? 'initial'
    if (lastNav.current === key) return
    lastNav.current = key
    useWorkspace.getState().updateTabState(tab.id, { line: undefined, subpath: undefined, query: undefined })
    requestAnimationFrame(() => {
      const v = viewRef.current
      if (!v) return
      const doc = v.state.doc
      let line = line0 ?? 0
      if (subpath) line = findSubpathLine(doc, subpath) ?? line
      line = clamp(line, 0, doc.lines - 1)
      if (modeRef.current === 'reading') {
        scrollToLine(line, true, true)
        return
      }
      const l = doc.line(line + 1)
      let selection: SelectionRange = EditorSelection.cursor(subpath && !query ? l.to : l.from)
      if (query) {
        const text = doc.toString().toLowerCase()
        const q = query.toLowerCase()
        let at = text.indexOf(q, l.from)
        if (at < 0) at = text.indexOf(q)
        if (at >= 0) selection = EditorSelection.range(at, at + q.length)
      }
      v.dispatch({ selection, effects: EditorView.scrollIntoView(selection.from, { y: 'center' }) })
      v.focus()
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, navKey])

  // ------------------------------------------------------------ handlers

  const editing = mode !== 'reading'

  const onToggleTask = (line: number): void => {
    const v = viewRef.current
    if (!v || line < 0 || line >= v.state.doc.lines) return
    toggleTaskAt(v, v.state.doc.line(line + 1).from)
  }

  const focusEditorAtStart = (): void => {
    const v = viewRef.current
    if (!v) return
    if (modeRef.current === 'reading') return
    v.dispatch({ selection: EditorSelection.cursor(0), scrollIntoView: true })
    v.focus()
  }

  /** clicks on the padding around / below the text place the cursor (like Obsidian) */
  const onScrollerMouseDown = (e: React.MouseEvent): void => {
    const v = viewRef.current
    if (!v || !editing || e.button !== 0) return
    const target = e.target as HTMLElement
    if (target !== scrollerRef.current && !target.classList.contains('md-sizer') && target !== hostRef.current) return
    e.preventDefault()
    const content = v.contentDOM.getBoundingClientRect()
    if (e.clientY > content.bottom) {
      v.dispatch({ selection: EditorSelection.cursor(v.state.doc.length) })
    } else {
      const pos = v.posAtCoords({ x: clamp(e.clientX, content.left + 1, content.right - 1), y: e.clientY })
      if (pos !== null) v.dispatch({ selection: EditorSelection.cursor(pos) })
    }
    v.focus()
  }

  const onDragOver = (e: React.DragEvent): void => {
    if (!editing || !e.dataTransfer.types.includes(FILE_MIME)) return
    e.preventDefault()
    e.stopPropagation()
    e.dataTransfer.dropEffect = 'copy'
  }
  const onDrop = (e: React.DragEvent): void => {
    if (!editing || !e.dataTransfer.types.includes(FILE_MIME)) return
    e.stopPropagation()
    if (e.nativeEvent.defaultPrevented) return // handled by the editor itself
    e.preventDefault()
    const v = viewRef.current
    if (!v) return
    const data = e.dataTransfer.getData(FILE_MIME)
    const pos = e.clientY > v.contentDOM.getBoundingClientRect().bottom ? v.state.doc.length : (v.posAtCoords({ x: e.clientX, y: e.clientY }, false) ?? v.state.selection.main.head)
    insertFileLinks(v, data.split('\n').filter(Boolean), pos)
  }

  const onScroll = (): void => {
    if (!visibleRef.current || !scrollerRef.current) return
    savedScrollTop.current = scrollerRef.current.scrollTop
    t.persistScroll()
  }

  if (error) return <div className="empty-state">Couldn’t open “{path}”: {error}</div>

  const modeHotkey = formatHotkey('Mod+E')
  return (
    <div ref={rootRef} className={`markdown-view is-${mode}${loaded ? '' : ' is-loading'}`}>
      <div
        ref={scrollerRef}
        className="md-scroller"
        tabIndex={-1}
        onScroll={onScroll}
        onMouseDown={onScrollerMouseDown}
        onDragOver={onDragOver}
        onDrop={onDrop}
        data-accepts-file-drop={editing ? '' : undefined}
      >
        <div className="md-sizer">
          <InlineTitle path={path} editable={editing} titleRef={titleRef} onDone={focusEditorAtStart} />
          <div ref={hostRef} className={`md-editor-host${editing ? '' : ' is-hidden'}${mode === 'source' ? ' is-source' : ' is-live'}`} />
          {mode === 'reading' && loaded && (
            <div ref={readingRef} className="md-reading">
              <MarkdownPreview source={readingSource} sourcePath={path} runnable onToggleTask={onToggleTask} />
            </div>
          )}
        </div>
      </div>
      <ViewHeaderActions>
        <button
          className="clickable-icon small"
          title={editing ? `Currently editing. Click to read (${modeHotkey})` : `Currently reading. Click to edit (${modeHotkey})`}
          aria-label={editing ? 'Switch to reading view' : 'Switch to editing view'}
          onClick={() => handle.toggleReading()}
        >
          {editing ? <BookOpen /> : <Pencil />}
        </button>
      </ViewHeaderActions>
      <StatusBarItem active={focused && loaded}>
        <div className="status-bar-item md-word-count" title={counts.selection ? 'Selection' : 'Whole note'}>
          {counts.words.toLocaleString()} {counts.words === 1 ? 'word' : 'words'}
          <span className="md-count-sep" />
          {counts.chars.toLocaleString()} {counts.chars === 1 ? 'character' : 'characters'}
        </div>
      </StatusBarItem>
    </div>
  )
}
