// Monaco-based code editor view.
import { useEffect, useRef, useState } from 'react'
import type * as Monaco from 'monaco-editor'
import { Play, Square, SquareTerminal, WrapText, Map as MapIcon, FileWarning, FileX } from 'lucide-react'
import type { ViewProps } from '../types'
import { loadMonaco, type MonacoKit, type ModelEntry } from '@/lib/monaco'
import { MONACO_THEME, monoFontFamily } from '@/lib/monaco/theme'
import { readFile, registerFlusher } from '@/lib/fileops'
import { RUNNABLE_LANGS } from '@/lib/filetypes'
import { runCode, type RunHandle } from '@/lib/runCode'
import { basename, dirname, extname } from '@/lib/path'
import { nextTerminalCwd } from '@/lib/terminalCwd'
import { formatBytes, debounce } from '@/lib/util'
import { useSettings, getSettings, type Settings } from '@/store/settings'
import { useWorkspace } from '@/store/workspace'
import { useVault } from '@/store/vault'
import { registerCommands, hotkeysFor, formatHotkey } from '@/store/commands'
import { notice } from '@/store/ui'
import { ViewHeaderActions, StatusBarItem } from '@/components/Slots'
import { beginRun, showOutput, emitRunOutput } from '@/components/terminal/output'
import './code.css'

const LARGE_FILE = 5 * 1024 * 1024

type Phase = 'loading' | 'ready' | 'large' | 'binary' | 'error'

interface CodeInstance {
  save(): void
  run(): void
  canRun(): boolean
  format(): void
  toggleWrap(): void
  goToLine(): void
}

interface CursorInfo {
  line: number
  col: number
  selected: number
  selections: number
}

interface ModelInfo {
  lang: string
  insertSpaces: boolean
  tabSize: number
  eol: 'LF' | 'CRLF'
}

// ------------------------------------------------------------- module-level commands

let focusedInstance: CodeInstance | null = null

/** A code view is the focused view and the keyboard isn't in the bottom panel (terminal). */
function codeFocused(): boolean {
  return !!focusedInstance && !document.activeElement?.closest('.bottom-panel')
}

registerCommands([
  { id: 'code:run-file', name: 'Code: Run file', hotkeys: ['Mod+Shift+Enter', 'F5'], check: () => codeFocused() && focusedInstance!.canRun(), run: () => focusedInstance?.run() },
  { id: 'code:save', name: 'Code: Save file', hotkeys: ['Mod+S'], check: codeFocused, run: () => focusedInstance?.save() },
  { id: 'code:format', name: 'Code: Format document', hotkeys: ['Shift+Alt+F'], check: codeFocused, run: () => focusedInstance?.format() },
  { id: 'code:toggle-word-wrap', name: 'Code: Toggle word wrap', hotkeys: ['Alt+Z'], check: codeFocused, run: () => focusedInstance?.toggleWrap() },
  { id: 'code:go-to-line', name: 'Code: Go to line…', check: () => !!focusedInstance, run: () => focusedInstance?.goToLine() }
])

// ------------------------------------------------------------- helpers

function editorOptions(s: Settings, wrap: boolean, minimap: boolean): Monaco.editor.IEditorOptions {
  return {
    fontSize: s.codeFontSize,
    fontLigatures: s.codeFontLigatures,
    lineNumbers: s.codeLineNumbers ? 'on' : 'off',
    minimap: { enabled: minimap },
    wordWrap: wrap ? 'on' : 'off'
  }
}

function cursorInfo(ed: Monaco.editor.IStandaloneCodeEditor): CursorInfo {
  const pos = ed.getPosition()
  const sels = ed.getSelections() ?? []
  const model = ed.getModel()
  let selected = 0
  if (model) for (const s of sels) selected += model.getValueLengthInRange(s)
  return { line: pos?.lineNumber ?? 1, col: pos?.column ?? 1, selected, selections: sels.length }
}

function modelInfo(kit: MonacoKit, model: Monaco.editor.ITextModel): ModelInfo {
  const id = model.getLanguageId()
  const lang = kit.monaco.languages.getLanguages().find((l) => l.id === id)
  const o = model.getOptions()
  return { lang: lang?.aliases?.[0] ?? id, insertSpaces: o.insertSpaces, tabSize: o.tabSize, eol: model.getEOL() === '\r\n' ? 'CRLF' : 'LF' }
}

function hotkeyHint(id: string): string {
  const h = hotkeysFor(id)[0]
  return h ? ` (${formatHotkey(h)})` : ''
}

// ------------------------------------------------------------- view

export default function CodeView({ tab, visible, focused }: ViewProps) {
  const hostRef = useRef<HTMLDivElement>(null)
  const kitRef = useRef<MonacoKit | null>(null)
  const editorRef = useRef<Monaco.editor.IStandaloneCodeEditor | null>(null)
  const entryRef = useRef<ModelEntry | null>(null)
  const pathRef = useRef(tab.path ?? '')
  pathRef.current = tab.path ?? pathRef.current
  const runRef = useRef<RunHandle | null>(null)
  const handledNav = useRef<unknown>(undefined)
  const focusedRef = useRef(focused)
  focusedRef.current = focused

  const [phase, setPhase] = useState<Phase>('loading')
  const [error, setError] = useState('')
  const [force, setForce] = useState(false)
  const [entry, setEntry] = useState<ModelEntry | null>(null)
  const [dirty, setDirty] = useState(false)
  const [running, setRunning] = useState(false)
  const [cursor, setCursor] = useState<CursorInfo>({ line: 1, col: 1, selected: 0, selections: 1 })
  const [info, setInfo] = useState<ModelInfo | null>(null)

  const settings = useSettings((s) => s.settings)
  const wordWrap = (tab.state?.wordWrap as boolean | undefined) ?? settings.codeWordWrap
  const minimap = (tab.state?.minimap as boolean | undefined) ?? settings.codeMinimap
  const optsRef = useRef({ wordWrap, minimap })
  optsRef.current = { wordWrap, minimap }

  const ext = extname(tab.path ?? '')
  const runnable = RUNNABLE_LANGS.has(ext)
  const size = useVault((s) => (tab.path ? (s.files[tab.path]?.size ?? 0) : 0))

  // ---------------------------------------------------------- instance API (stable, reads refs)
  const instRef = useRef<CodeInstance | null>(null)
  if (!instRef.current) {
    const inst: CodeInstance = {
      save() {
        const kit = kitRef.current
        const e = entryRef.current
        if (kit && e) void kit.saveEntry(e)
      },
      canRun: () => RUNNABLE_LANGS.has(extname(pathRef.current)) && !!entryRef.current,
      run() {
        void runFile()
      },
      format() {
        const ed = editorRef.current
        if (!ed) return
        const action = ed.getAction('editor.action.formatDocument')
        if (!action || !action.isSupported()) {
          notice(`No formatter available for ${ed.getModel()?.getLanguageId() ?? 'this file'}`)
          return
        }
        void action.run()
      },
      toggleWrap() {
        useWorkspace.getState().updateTabState(tab.id, { wordWrap: !optsRef.current.wordWrap })
      },
      goToLine() {
        const ed = editorRef.current
        if (!ed) return
        ed.focus()
        void ed.getAction('editor.action.gotoLine')?.run()
      }
    }
    instRef.current = inst
  }

  async function runFile(): Promise<void> {
    const e = entryRef.current
    const kit = kitRef.current
    if (!e || !kit) return
    if (runRef.current) {
      runRef.current.kill()
      return
    }
    const path = pathRef.current
    const title = basename(path)
    kit.flushEntry(e)
    const live = beginRun(title)
    showOutput()
    let handle: RunHandle
    try {
      handle = runCode(extname(path), e.model.getValue(), { sourcePath: path, onOutput: (stream, data) => live.append(stream, data) })
    } catch (err) {
      live.finish({ runId: '', code: null, stdout: '', stderr: '', durationMs: 0, error: (err as Error).message })
      return
    }
    live.setKill(handle.kill)
    runRef.current = handle
    setRunning(true)
    const res = await handle.done.catch((err: Error) => ({ runId: handle.runId, code: null, stdout: '', stderr: '', durationMs: 0, error: err.message }))
    runRef.current = null
    setRunning(false)
    live.finish(res)
    const failed = !!res.error || res.code !== 0
    emitRunOutput({ title, text: res.error ? `${res.stdout}${res.stderr}${res.error}` : res.stdout + res.stderr, stream: failed ? 'stderr' : 'stdout' })
  }

  async function openInTerminal(): Promise<void> {
    try {
      nextTerminalCwd.set(await window.api.fs.absPath(dirname(pathRef.current)))
    } catch {
      nextTerminalCwd.set(null)
    }
    useWorkspace.getState().addBottomTab('terminal')
  }

  // ---------------------------------------------------------- create editor
  useEffect(() => {
    const path = tab.path
    if (!path) {
      setPhase('error')
      setError('No file')
      return
    }
    if (!force && (useVault.getState().files[path]?.size ?? 0) > LARGE_FILE) {
      setPhase('large')
      return
    }
    setPhase('loading')
    let cancelled = false
    const cleanups: (() => void)[] = []

    void (async () => {
      let kit: MonacoKit
      let content = ''
      try {
        kit = await loadMonaco()
        if (!kit.getEntry(path)) content = await readFile(path)
      } catch (err) {
        if (!cancelled) {
          setPhase('error')
          setError((err as Error).message)
        }
        return
      }
      if (cancelled) return
      if (!kit.getEntry(path) && content.includes('\0')) {
        setPhase('binary')
        return
      }
      kitRef.current = kit
      const e = kit.acquireModel(path, content)
      entryRef.current = e
      const s = getSettings()
      const ed = kit.monaco.editor.create(hostRef.current!, {
        model: e.model,
        theme: MONACO_THEME,
        fontFamily: monoFontFamily(),
        ...editorOptions(s, optsRef.current.wordWrap, optsRef.current.minimap),
        automaticLayout: true,
        scrollBeyondLastLine: false,
        smoothScrolling: true,
        cursorBlinking: 'smooth',
        cursorSmoothCaretAnimation: 'on',
        renderLineHighlight: 'all',
        renderWhitespace: 'selection',
        bracketPairColorization: { enabled: true },
        guides: { bracketPairs: 'active', indentation: true },
        stickyScroll: { enabled: true },
        padding: { top: 8, bottom: 8 },
        fixedOverflowWidgets: true,
        overviewRulerBorder: false,
        scrollbar: { verticalScrollbarSize: 12, horizontalScrollbarSize: 12, useShadows: false },
        'semanticHighlighting.enabled': true,
        tabFocusMode: false,
        mouseWheelZoom: false
      })
      editorRef.current = ed
      kit.liveEditors.add(ed)
      if (kit.isScriptPath(path)) void kit.loadVaultLibs()

      // restore position unless a navigation request is pending
      const st = tab.state ?? {}
      if (st._nav === undefined || st._nav === st.navDone) {
        handledNav.current = st._nav
        const c = st.cursor as { line: number; col: number } | undefined
        if (c) ed.setPosition({ lineNumber: c.line, column: c.col })
        if (typeof st.scrollTop === 'number') ed.setScrollTop(st.scrollTop)
      }

      const persist = debounce(() => {
        const p = ed.getPosition()
        if (!p) return
        useWorkspace.getState().updateTabState(tab.id, { cursor: { line: p.lineNumber, col: p.column }, scrollTop: ed.getScrollTop() })
      }, 500)
      const refreshInfo = (): void => {
        const m = ed.getModel()
        if (!m) return
        const next = modelInfo(kit, m)
        setInfo((prev) => (prev && (Object.keys(next) as (keyof ModelInfo)[]).every((k) => prev[k] === next[k]) ? prev : next))
      }
      cleanups.push(
        () => persist.flush(),
        (() => {
          const ds = [
            ed.onDidChangeCursorSelection(() => {
              setCursor(cursorInfo(ed))
              persist()
            }),
            ed.onDidScrollChange((ev) => ev.scrollTopChanged && persist()),
            ed.onDidChangeModel(refreshInfo),
            ed.onDidChangeModelOptions(refreshInfo),
            ed.onDidChangeModelLanguage(refreshInfo),
            ed.onDidChangeModelContent(refreshInfo)
          ]
          return () => ds.forEach((d) => d.dispose())
        })(),
        registerFlusher(() => {
          const cur = entryRef.current
          if (cur && (cur.timer || kit.isDirty(cur))) void kit.saveEntry(cur)
        })
      )
      setCursor(cursorInfo(ed))
      refreshInfo()
      setEntry(e)
      setPhase('ready')
      if (focusedRef.current && document.activeElement === document.body) ed.focus()
    })()

    return () => {
      cancelled = true
      cleanups.forEach((fn) => fn())
      const kit = kitRef.current
      const ed = editorRef.current
      if (kit && ed) {
        kit.liveEditors.delete(ed)
        ed.dispose()
      }
      if (kit && entryRef.current) kit.releaseModel(entryRef.current)
      editorRef.current = null
      entryRef.current = null
      if (focusedInstance === instRef.current) focusedInstance = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [force])

  // ---------------------------------------------------------- dirty tracking
  useEffect(() => {
    const kit = kitRef.current
    if (!entry || !kit) return
    const upd = (): void => setDirty(kit.isDirty(entry))
    upd()
    return kit.onEntryChange(entry, upd)
  }, [entry])

  // ---------------------------------------------------------- rename: move to the model of the new path
  useEffect(() => {
    const kit = kitRef.current
    const ed = editorRef.current
    const old = entryRef.current
    if (phase !== 'ready' || !kit || !ed || !old || !tab.path || old.path === tab.path) return
    const vs = ed.saveViewState()
    const next = kit.renameModel(old, tab.path)
    ed.setModel(next.model)
    if (vs) ed.restoreViewState(vs)
    kit.releaseModel(old, { save: false })
    entryRef.current = next
    setEntry(next)
  }, [tab.path, phase])

  // ---------------------------------------------------------- settings / per-tab toggles
  useEffect(() => {
    editorRef.current?.updateOptions(editorOptions(settings, wordWrap, minimap))
  }, [settings.codeFontSize, settings.codeFontLigatures, settings.codeLineNumbers, wordWrap, minimap, phase])

  useEffect(() => {
    if (phase === 'ready') kitRef.current?.updateIndentation(settings.tabSize)
  }, [settings.tabSize, phase])

  // auto-save turned on while dirty → save right away
  useEffect(() => {
    const kit = kitRef.current
    const e = entryRef.current
    if (settings.codeAutoSave && kit && e && kit.isDirty(e)) void kit.saveEntry(e)
  }, [settings.codeAutoSave])

  // ---------------------------------------------------------- visibility / focus
  useEffect(() => {
    const kit = kitRef.current
    const e = entryRef.current
    if (!visible && kit && e) kit.flushEntry(e)
  }, [visible])

  useEffect(() => {
    if (focused) {
      focusedInstance = instRef.current
      const ed = editorRef.current
      if (ed && document.activeElement === document.body) ed.focus()
    } else if (focusedInstance === instRef.current) focusedInstance = null
  }, [focused, phase])

  // ---------------------------------------------------------- navigation requests
  const nav = tab.state?._nav
  useEffect(() => {
    const ed = editorRef.current
    const model = ed?.getModel()
    if (phase !== 'ready' || !ed || !model || nav === undefined || nav === handledNav.current) return
    handledNav.current = nav
    const st = tab.state ?? {}
    const line = typeof st.line === 'number' ? Math.min(model.getLineCount(), Math.max(1, st.line + 1)) : null
    const query = typeof st.query === 'string' ? st.query : ''
    let match: Monaco.editor.FindMatch | null = null
    if (query) {
      const from = line ? { lineNumber: line, column: 1 } : { lineNumber: 1, column: 1 }
      match = model.findNextMatch(query, from, false, false, null, false)
    }
    if (match) {
      ed.setSelection(match.range)
      ed.revealRangeInCenter(match.range)
    } else if (line) {
      ed.setPosition({ lineNumber: line, column: model.getLineFirstNonWhitespaceColumn(line) || 1 })
      ed.revealLineInCenter(line)
    }
    ed.focus()
    useWorkspace.getState().updateTabState(tab.id, { navDone: nav })
  }, [nav, phase])

  // ---------------------------------------------------------- render
  const header = (
    <ViewHeaderActions>
      {dirty && !settings.codeAutoSave && (
        <span className="code-dirty-dot" title={`Unsaved changes${hotkeyHint('code:save')}`} onClick={() => instRef.current?.save()} />
      )}
      {runnable && phase === 'ready' && (
        <button
          className={`clickable-icon small${running ? ' code-run-stop' : ' code-run'}`}
          title={running ? 'Stop' : `Run file${hotkeyHint('code:run-file')}`}
          onClick={() => void runFile()}
        >
          {running ? <Square /> : <Play />}
        </button>
      )}
      <button className="clickable-icon small" title="Open in terminal" onClick={() => void openInTerminal()}>
        <SquareTerminal />
      </button>
      <button className={`clickable-icon small${wordWrap ? ' is-active' : ''}`} title={`Toggle word wrap${hotkeyHint('code:toggle-word-wrap')}`} onClick={() => instRef.current?.toggleWrap()}>
        <WrapText />
      </button>
      <button
        className={`clickable-icon small${minimap ? ' is-active' : ''}`}
        title="Toggle minimap"
        onClick={() => useWorkspace.getState().updateTabState(tab.id, { minimap: !minimap })}
      >
        <MapIcon />
      </button>
    </ViewHeaderActions>
  )

  const toggleEol = (): void => {
    const ed = editorRef.current
    const m = ed?.getModel()
    const kit = kitRef.current
    if (!m || !kit) return
    m.pushEOL(m.getEOL() === '\r\n' ? kit.monaco.editor.EndOfLineSequence.LF : kit.monaco.editor.EndOfLineSequence.CRLF)
    setInfo(modelInfo(kit, m))
  }

  return (
    <div className="code-view">
      {header}
      <div className="code-view-editor" ref={hostRef} style={{ visibility: phase === 'ready' ? 'visible' : 'hidden' }} />
      {phase === 'large' && (
        <div className="code-view-message">
          <FileWarning />
          <div className="code-view-message-title">This file is too large to edit</div>
          <div className="code-view-message-text">
            {basename(tab.path ?? '')} is {formatBytes(size)}. Files over {formatBytes(LARGE_FILE)} aren't opened in the editor to keep CS2D3K responsive.
          </div>
          <div className="code-view-message-actions">
            <button className="btn" onClick={() => setForce(true)}>
              Open anyway
            </button>
            <button className="btn" onClick={() => tab.path && void window.api.fs.openWithDefaultApp(tab.path)}>
              Open with default app
            </button>
          </div>
        </div>
      )}
      {(phase === 'binary' || phase === 'error') && (
        <div className="code-view-message">
          <FileX />
          <div className="code-view-message-title">{phase === 'binary' ? 'Binary file' : "Can't open this file"}</div>
          <div className="code-view-message-text">
            {phase === 'binary' ? `${basename(tab.path ?? '')} appears to be a binary file and can't be shown in the editor.` : error}
          </div>
          {tab.path && (
            <div className="code-view-message-actions">
              <button className="btn" onClick={() => void window.api.fs.openWithDefaultApp(tab.path!)}>
                Open with default app
              </button>
            </div>
          )}
        </div>
      )}
      <StatusBarItem active={focused && phase === 'ready'}>
        <div className="status-bar-item clickable" title="Go to line" onClick={() => instRef.current?.goToLine()}>
          Ln {cursor.line}, Col {cursor.col}
          {cursor.selections > 1 ? ` (${cursor.selections} selections)` : cursor.selected ? ` (${cursor.selected} selected)` : ''}
        </div>
        {info && (
          <>
            <div className="status-bar-item">{info.insertSpaces ? 'Spaces' : 'Tab size'}: {info.tabSize}</div>
            <div className="status-bar-item">UTF-8</div>
            <div className="status-bar-item clickable" title="Toggle line endings" onClick={toggleEol}>
              {info.eol}
            </div>
            <div className="status-bar-item">{info.lang}</div>
          </>
        )}
      </StatusBarItem>
    </div>
  )
}
