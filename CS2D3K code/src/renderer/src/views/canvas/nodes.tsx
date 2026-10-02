// Canvas node components: generic node shell + per-type bodies.
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import hljs from 'highlight.js/lib/common'
import { Play, Square, Eraser, ExternalLink, Globe, FileWarning, Loader2 } from 'lucide-react'
import MarkdownPreview from '@/lib/markdown/MarkdownPreview'
import { extractSubpath } from '@/lib/markdown/render'
import { onExternalChange } from '@/lib/fileops'
import { useVault } from '@/store/vault'
import { useWorkspace } from '@/store/workspace'
import { IMAGE_EXTS, MEDIA_EXTS, isTextLike } from '@/lib/filetypes'
import { basename, extname } from '@/lib/path'
import { escapeHtml } from '@/lib/util'
import { runCode, type RunHandle } from '@/lib/runCode'
import { emit } from '@/lib/events'
import { FileIcon } from '@/components/FileIcon'
import CmEditor, { CODE_LANGS, RUNNABLE, canonicalLang } from './CmEditor'
import { colorCss, isHttpsUrl, toggleTaskLine, SIDES, type CanvasNode } from './model'
import { textExcerpt } from './cull'
import type { NodeTypeDef } from './engine'
import type { LodNodeStyle } from './lodLayer'

export interface NodeApi {
  canvasPath: string
  updateNode(id: string, patch: Partial<CanvasNode>, history?: boolean | string): void
  setEditing(id: string | null): void
  focusCanvas(): void
  /** keep a node mounted (and fully rendered) even when it is culled, e.g. a code cell that is running or has output */
  pin(id: string, on: boolean): void
}

interface NodeProps {
  node: CanvasNode
  selected: boolean
  editing: boolean
  /** this node is the hovered target of an edge being created */
  edgeTarget: boolean
  api: NodeApi
  /** custom node type (engine extension) */
  def?: NodeTypeDef
  /** extra classes from the extension (e.g. dimming) */
  extraClass?: string
  /** level of detail: render a light placeholder (no markdown, CodeMirror, iframes or images) */
  lod?: boolean
  /** render resize + connection handles (always when not lod; on hover / selection when lod) */
  chrome?: boolean
}

const RESIZE_DIRS = ['n', 'e', 's', 'w', 'ne', 'se', 'sw', 'nw'] as const

export function openVaultFile(path: string, newTab: boolean, subpath?: string): void {
  useWorkspace.getState().openFile(path, { target: newTab ? 'tab' : undefined, state: subpath ? { subpath, _nav: Date.now() } : undefined })
}

function NodeChrome({ node, selected, resize = true, handles = true }: { node: CanvasNode; selected: boolean; resize?: boolean; handles?: boolean }) {
  return (
    <>
      {resize &&
        RESIZE_DIRS.map((d) => <div key={d} className={`canvas-resize canvas-resize-${d}${selected ? '' : ' is-passive'}`} data-resize={d} />)}
      {handles && SIDES.map((s) => <div key={s} className={`canvas-handle canvas-handle-${s}`} data-handle={s} data-node={node.id} />)}
    </>
  )
}

export const NodeView = memo(function NodeView({ node, selected, editing, edgeTarget, api, def, extraClass, lod = false, chrome = true }: NodeProps) {
  const color = colorCss(node.color)
  const cls = [
    'canvas-node',
    `canvas-node-${node.type}`,
    lod && 'is-lod',
    selected && 'is-selected',
    editing && 'is-editing',
    edgeTarget && 'is-edge-target',
    color && 'has-color',
    def?.className?.(node),
    extraClass
  ]
    .filter(Boolean)
    .join(' ')
  // positioned with left/top, not a transform: a transform per card is a paint property node per card, which Chrome
  // re-layerizes on every camera frame (cost grows with the number of mounted cards)
  const style = {
    left: node.x,
    top: node.y,
    width: node.width,
    height: node.height,
    ...(color ? { '--canvas-color': color } : {})
  } as React.CSSProperties

  if (def) {
    const Body = def.Body
    const body = <Body node={node} selected={selected} editing={editing} api={api} lod={lod} />
    return (
      <div className={cls} data-node-id={node.id} style={style}>
        {def.bare ? body : <div className="canvas-node-container">{body}</div>}
        {chrome && <NodeChrome node={node} selected={selected} resize={def.canResize ? def.canResize(node) : true} handles={def.connectable !== false} />}
      </div>
    )
  }

  if (node.type === 'group') {
    return (
      <div className={cls} data-node-id={node.id} style={style}>
        <GroupLabel node={node} editing={editing} api={api} />
        <div className="canvas-group-body" style={lod ? undefined : groupBackground(node)} />
        {chrome && <NodeChrome node={node} selected={selected} />}
      </div>
    )
  }

  return (
    <div className={cls} data-node-id={node.id} style={style}>
      {node.type === 'file' && node.file && <FileLabel node={node} />}
      <div className="canvas-node-container">
        {lod ? (
          <LodBody node={node} />
        ) : (
          <>
            {node.type === 'text' && <TextBody node={node} editing={editing} api={api} />}
            {node.type === 'file' && <FileBody node={node} />}
            {node.type === 'link' && <LinkBody node={node} selected={selected} />}
            {node.type === 'code' && <CodeBody node={node} api={api} selected={selected} />}
          </>
        )}
        {!['text', 'file', 'link', 'code'].includes(node.type) && <div className="canvas-node-empty">Unsupported node type “{node.type}”</div>}
      </div>
      {chrome && <NodeChrome node={node} selected={selected} />}
    </div>
  )
})

// ------------------------------------------------------------------ level-of-detail placeholder

const lodStyles = new WeakMap<CanvasNode, LodNodeStyle>()

/** How built-in node types look when the canvas layer draws them (huge boards zoomed out). Cached per node object. */
export function defaultLodStyle(node: CanvasNode): LodNodeStyle {
  let st = lodStyles.get(node)
  if (st) return st
  const ext = extname(node.file ?? '')
  switch (node.type) {
    case 'text':
      st = { title: textExcerpt(node.text ?? '', 0).title || 'Empty card' }
      break
    case 'code': {
      const lang = canonicalLang(node.language) || 'python'
      st = { label: CODE_LANGS.find((l) => l.id === lang)?.label ?? lang, title: (node.code ?? '').split('\n').find((l) => l.trim())?.trim() ?? '', mono: true }
      break
    }
    case 'file':
      st = { label: ext === 'md' ? 'Note' : ext ? ext.toUpperCase() : 'File', title: node.file ? (ext === 'md' ? basename(node.file).slice(0, -3) : basename(node.file)) : 'File' }
      break
    case 'link': {
      let host = node.url ?? ''
      try {
        host = new URL(host).host || host
      } catch {
        /* keep raw */
      }
      st = { label: 'Web page', title: host }
      break
    }
    case 'group':
      st = { header: node.label || 'Group' }
      break
    default:
      st = { title: String(node.title ?? node.label ?? node.text ?? node.type) }
  }
  lodStyles.set(node, st)
  return st
}

/** What a card shows when zoomed far out (or before its full content mounts): title, a short excerpt, its kind. */
function LodBody({ node }: { node: CanvasNode }) {
  if (node.type === 'text') {
    const { title, body } = textExcerpt(node.text ?? '')
    return (
      <div className="canvas-node-content canvas-lod">
        {title ? <div className="canvas-lod-title">{title}</div> : <div className="canvas-node-placeholder">Double-click to edit</div>}
        {body && <div className="canvas-lod-body">{body}</div>}
      </div>
    )
  }
  if (node.type === 'code') {
    const lang = canonicalLang(node.language) || 'python'
    return (
      <div className="canvas-code canvas-lod-code">
        <div className="canvas-code-header">
          <span className="canvas-lod-lang">{CODE_LANGS.find((l) => l.id === lang)?.label ?? lang}</span>
        </div>
        <pre className="canvas-code-static">{(node.code ?? '').split('\n', 12).join('\n')}</pre>
      </div>
    )
  }
  if (node.type === 'file' || node.type === 'link') {
    // the same legible title as text cards (scaled up when zoomed out), plus what kind of thing it is
    const st = defaultLodStyle(node)
    return (
      <div className="canvas-node-content canvas-lod">
        <div className="canvas-lod-kind">
          {node.type === 'file' ? <FileIcon ext={extname(node.file ?? '')} size={14} /> : <Globe size={14} />}
          {st.label}
        </div>
        <div className="canvas-lod-title">{st.title}</div>
      </div>
    )
  }
  return null
}

function groupBackground(node: CanvasNode): React.CSSProperties | undefined {
  if (!node.background) return undefined
  const url = window.api.fs.resourceUrl(node.background)
  const style = node.backgroundStyle
  return {
    backgroundImage: `url("${url}")`,
    backgroundSize: style === 'repeat' ? 'auto' : style === 'ratio' ? 'contain' : 'cover',
    backgroundRepeat: style === 'repeat' ? 'repeat' : 'no-repeat',
    backgroundPosition: 'center'
  }
}

// ------------------------------------------------------------------ group

function GroupLabel({ node, editing, api }: { node: CanvasNode; editing: boolean; api: NodeApi }) {
  const [draft, setDraft] = useState(node.label ?? '')
  const finished = useRef(false)
  useEffect(() => {
    if (editing) {
      setDraft(node.label ?? '')
      finished.current = false
    }
  }, [editing, node.label])
  if (editing) {
    const done = (save: boolean): void => {
      if (finished.current) return
      finished.current = true
      if (save && draft !== (node.label ?? '')) api.updateNode(node.id, { label: draft || undefined })
      api.setEditing(null)
      api.focusCanvas()
    }
    return (
      <div className="canvas-group-label is-editing" data-interactive>
        <input
          autoFocus
          value={draft}
          placeholder="Group name"
          onChange={(e) => setDraft(e.target.value)}
          onFocus={(e) => e.currentTarget.select()}
          onBlur={() => done(true)}
          onKeyDown={(e) => {
            e.stopPropagation()
            if (e.key === 'Enter') done(true)
            else if (e.key === 'Escape') done(false)
          }}
        />
      </div>
    )
  }
  return (
    <div className={`canvas-group-label${node.label ? '' : ' is-empty'}`} data-group-label>
      {node.label || 'Group'}
    </div>
  )
}

// ------------------------------------------------------------------ text

function TextBody({ node, editing, api }: { node: CanvasNode; editing: boolean; api: NodeApi }) {
  const text = node.text ?? ''
  const onChange = useCallback((v: string) => api.updateNode(node.id, { text: v }, `text:${node.id}`), [api, node.id])
  const heightRef = useRef(node.height)
  heightRef.current = node.height
  // grow the card so the text stays visible (while typing, and once rendered)
  const grow = useCallback((px: number) => api.updateNode(node.id, { height: Math.ceil(heightRef.current + px) }, `text:${node.id}`), [api, node.id])
  const contentRef = useRef<HTMLDivElement>(null)
  const wasEditing = useRef(editing)
  useEffect(() => {
    if (wasEditing.current && !editing) {
      const id = requestAnimationFrame(() => {
        const el = contentRef.current
        if (el && el.scrollHeight > el.clientHeight + 1) grow(Math.min(el.scrollHeight - el.clientHeight, 800))
      })
      wasEditing.current = editing
      return () => cancelAnimationFrame(id)
    }
    wasEditing.current = editing
  }, [editing, grow])
  if (editing) {
    return (
      <div className="canvas-node-content canvas-text-editor" data-interactive>
        <CmEditor
          value={text}
          onChange={onChange}
          lang="markdown"
          mode="text"
          autoFocus
          placeholder="Type something…"
          onOverflow={grow}
          onEscape={() => {
            api.setEditing(null)
            api.focusCanvas()
          }}
        />
      </div>
    )
  }
  return (
    <div className="canvas-node-content" ref={contentRef}>
      {text.trim() ? (
        <MarkdownPreview
          source={text}
          sourcePath={api.canvasPath}
          className="canvas-markdown"
          onToggleTask={(line, checked) => api.updateNode(node.id, { text: toggleTaskLine(text, line, checked) })}
        />
      ) : (
        <div className="canvas-node-placeholder">Double-click to edit</div>
      )}
    </div>
  )
}

// ------------------------------------------------------------------ file

type FileState = { status: 'loading' } | { status: 'missing' } | { status: 'ok'; text: string } | { status: 'error'; message: string }

const MAX_TEXT_BYTES = 512 * 1024

/** Text content of a vault file, kept live as it changes. */
function useFileText(path: string, enabled: boolean): FileState {
  const entry = useVault((s) => s.files[path])
  const mtime = entry?.mtime
  const exists = !!entry
  const size = entry?.size ?? 0
  const [state, setState] = useState<FileState>({ status: 'loading' })
  useEffect(() => {
    if (!enabled) return
    if (!exists) {
      setState({ status: 'missing' })
      return
    }
    if (size > MAX_TEXT_BYTES) {
      setState({ status: 'error', message: 'File too large to preview' })
      return
    }
    let cancelled = false
    window.api.fs
      .readText(path)
      .then((text) => !cancelled && setState({ status: 'ok', text }))
      .catch((e) => !cancelled && setState({ status: 'error', message: String(e?.message ?? e) }))
    return () => {
      cancelled = true
    }
  }, [path, mtime, exists, size, enabled])
  useEffect(() => {
    if (!enabled) return
    return onExternalChange(path, (text) => setState({ status: 'ok', text }))
  }, [path, enabled])
  return state
}

function FileLabel({ node }: { node: CanvasNode }) {
  const path = node.file!
  const ext = extname(path)
  const name = ext === 'md' ? basename(path).slice(0, -3) : basename(path)
  return (
    <div
      className="canvas-node-label"
      title={`${path}\nClick to open · Ctrl+click to open in a new tab`}
      data-file-label
      onClick={(e) => {
        e.stopPropagation()
        openVaultFile(path, e.ctrlKey || e.metaKey, node.subpath)
      }}
    >
      {name}
      {node.subpath ? <span className="canvas-node-label-sub"> › {node.subpath.replace(/^#\^?/, '')}</span> : null}
    </div>
  )
}

function FileBody({ node }: { node: CanvasNode }) {
  const path = node.file ?? ''
  const ext = extname(path)
  const exists = useVault((s) => !!s.files[path])
  const isNote = ext === 'md'
  const isCode = !isNote && ext !== 'canvas' && isTextLike(ext)
  const state = useFileText(path, exists && (isNote || isCode))

  if (!path || !exists) {
    return (
      <div className="canvas-file-missing">
        <FileWarning size={22} />
        <div className="canvas-file-missing-title">File not found</div>
        <div className="canvas-file-missing-path">{path || '(no file)'}</div>
      </div>
    )
  }
  if (IMAGE_EXTS.has(ext)) {
    return <img className="canvas-file-image" src={window.api.fs.resourceUrl(path)} alt={basename(path)} draggable={false} />
  }
  if (MEDIA_EXTS.has(ext)) {
    const audio = ['mp3', 'wav', 'ogg', 'm4a', 'flac'].includes(ext)
    return (
      <div className="canvas-file-media" data-interactive>
        {audio ? <audio controls src={window.api.fs.resourceUrl(path)} /> : <video controls src={window.api.fs.resourceUrl(path)} />}
      </div>
    )
  }
  if (isNote || isCode) {
    if (state.status === 'loading') return <div className="canvas-node-content canvas-file-loading" />
    if (state.status === 'missing') return <div className="canvas-file-missing">File not found</div>
    if (state.status === 'error') return <FileTile path={path} note={state.message} />
    if (isNote) {
      const src = node.subpath ? extractSubpath(state.text, node.subpath) : state.text
      return (
        <div className="canvas-node-content">
          <MarkdownPreview source={src} sourcePath={path} className="canvas-markdown" />
        </div>
      )
    }
    return <CodePreview text={state.text} ext={ext} />
  }
  return <FileTile path={path} note={ext === 'canvas' ? 'Canvas' : ext ? ext.toUpperCase() + ' file' : 'File'} />
}

function FileTile({ path, note }: { path: string; note?: string }) {
  return (
    <div className="canvas-file-tile">
      <FileIcon ext={extname(path)} size={30} strokeWidth={1.5} />
      <div className="canvas-file-tile-name">{basename(path)}</div>
      {note && <div className="canvas-file-tile-note">{note}</div>}
    </div>
  )
}

const HLJS_ALIAS: Record<string, string> = { mjs: 'javascript', cjs: 'javascript', mts: 'typescript', cts: 'typescript', ps1: 'powershell', h: 'c', hpp: 'cpp', yml: 'yaml', txt: 'plaintext' }

function CodePreview({ text, ext }: { text: string; ext: string }) {
  const lang = HLJS_ALIAS[ext] ?? ext
  const clipped = text.length > 60000 ? text.slice(0, 60000) : text
  let html: string
  try {
    html = hljs.getLanguage(lang) ? hljs.highlight(clipped, { language: lang, ignoreIllegals: true }).value : escapeHtml(clipped)
  } catch {
    html = escapeHtml(clipped)
  }
  return (
    <div className="canvas-node-content canvas-code-preview">
      <pre>
        <code className="hljs" dangerouslySetInnerHTML={{ __html: html }} />
      </pre>
    </div>
  )
}

// ------------------------------------------------------------------ link

function LinkBody({ node, selected }: { node: CanvasNode; selected: boolean }) {
  const url = (node.url ?? '').trim()
  let host = url
  try {
    host = new URL(url).host || url
  } catch {
    /* keep raw */
  }
  return (
    <div className="canvas-link">
      <div className="canvas-link-header">
        <Globe size={14} />
        <span className="canvas-link-url" title={url}>
          {host}
        </span>
        <button
          className="clickable-icon small"
          data-interactive
          title="Open in browser"
          onClick={(e) => {
            e.stopPropagation()
            if (/^https?:/i.test(url)) void window.api.app.openExternal(url)
          }}
        >
          <ExternalLink />
        </button>
      </div>
      {isHttpsUrl(url) ? (
        <div className={`canvas-link-frame${selected ? ' is-live' : ''}`} data-interactive={selected ? '' : undefined}>
          <iframe src={url} title={url} sandbox="allow-scripts allow-same-origin allow-popups allow-forms" referrerPolicy="no-referrer" loading="lazy" />
        </div>
      ) : (
        <div className="canvas-link-noframe">
          <Globe size={26} strokeWidth={1.4} />
          <div>{url ? 'Preview is only available for https:// pages' : 'No URL'}</div>
          <div className="canvas-link-noframe-url">{url}</div>
        </div>
      )}
    </div>
  )
}

// ------------------------------------------------------------------ code cell

interface RunState {
  running: boolean
  chunks: { stream: 'stdout' | 'stderr'; text: string }[]
  status?: string
  failed?: boolean
}

function CodeBody({ node, api, selected }: { node: CanvasNode; api: NodeApi; selected: boolean }) {
  const lang = canonicalLang(node.language) || 'python'
  const code = node.code ?? ''
  const [run, setRun] = useState<RunState | null>(null)
  const handleRef = useRef<RunHandle | null>(null)
  const outRef = useRef<HTMLPreElement>(null)
  const codeRef = useRef(code)
  codeRef.current = code
  const langRef = useRef(lang)
  langRef.current = lang
  const runnable = RUNNABLE.has(lang)

  useEffect(() => () => handleRef.current?.kill(), [])
  // a cell that is running or shows output stays mounted when scrolled away (its state lives here)
  const hasRun = run !== null
  useEffect(() => {
    if (!hasRun) return
    api.pin(node.id, true)
    return () => api.pin(node.id, false)
  }, [hasRun, api, node.id])

  // CodeMirror only while the cell is selected or focused; otherwise static highlighted code (much cheaper to mount).
  // A click into the static code mounts the editor and puts the caret where the click was.
  const [focusWithin, setFocusWithin] = useState(false)
  const [focusAt, setFocusAt] = useState<{ x: number; y: number } | null>(null)
  const active = selected || focusWithin || focusAt !== null

  const start = useCallback(() => {
    if (handleRef.current) return
    const l = langRef.current
    if (!RUNNABLE.has(l)) {
      setRun({ running: false, chunks: [], status: `No runner for "${l}"`, failed: true })
      return
    }
    setRun({ running: true, chunks: [] })
    const h = runCode(l, codeRef.current, {
      sourcePath: api.canvasPath,
      onOutput: (stream, text) =>
        setRun((r) => {
          if (!r) return r
          const chunks = r.chunks.slice()
          const last = chunks[chunks.length - 1]
          if (last && last.stream === stream) chunks[chunks.length - 1] = { stream, text: last.text + text }
          else chunks.push({ stream, text })
          return { ...r, chunks }
        })
    })
    handleRef.current = h
    void h.done
      .then((r) => {
        setRun((s) => {
          const chunks = s?.chunks.length ? s.chunks : [...(r.stdout ? [{ stream: 'stdout' as const, text: r.stdout }] : []), ...(r.stderr ? [{ stream: 'stderr' as const, text: r.stderr }] : [])]
          return {
            running: false,
            chunks,
            status: r.error ? `Error: ${r.error}` : `Exit code ${r.code ?? '—'} · ${formatMs(r.durationMs)}`,
            failed: !!r.error || r.code !== 0
          }
        })
        emit('run-output', { title: `${l} (canvas ${basename(api.canvasPath)})`, text: r.stdout + (r.stderr ? `\n${r.stderr}` : ''), stream: r.code === 0 ? 'stdout' : 'stderr' })
      })
      .catch((e) => setRun({ running: false, chunks: [], status: `Error: ${String(e?.message ?? e)}`, failed: true }))
      .finally(() => {
        handleRef.current = null
      })
  }, [api])

  const stop = (): void => handleRef.current?.kill()

  useEffect(() => {
    const el = outRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [run?.chunks])

  const onChange = useCallback((v: string) => api.updateNode(node.id, { code: v }, `code:${node.id}`), [api, node.id])

  return (
    <div className="canvas-code">
      <div className="canvas-code-header">
        <select
          className="canvas-code-lang"
          data-interactive
          value={CODE_LANGS.some((l) => l.id === lang) ? lang : '__other'}
          onChange={(e) => api.updateNode(node.id, { language: e.target.value })}
          title="Language"
        >
          {CODE_LANGS.map((l) => (
            <option key={l.id} value={l.id}>
              {l.label}
            </option>
          ))}
          {!CODE_LANGS.some((l) => l.id === lang) && <option value="__other">{lang}</option>}
        </select>
        <div className="canvas-code-spacer" />
        {run && !run.running && (
          <button className="clickable-icon small" data-interactive title="Clear output" onClick={() => setRun(null)}>
            <Eraser />
          </button>
        )}
        {run?.running ? (
          <button className="canvas-code-run is-running" data-interactive title="Stop" onClick={stop}>
            <Square size={11} fill="currentColor" /> Stop
          </button>
        ) : (
          <button className="canvas-code-run" data-interactive disabled={!runnable} title={runnable ? 'Run (Ctrl+Enter)' : 'This language cannot be run'} onClick={start}>
            <Play size={12} fill="currentColor" /> Run
          </button>
        )}
      </div>
      <div
        className="canvas-code-editor"
        data-interactive
        onPointerDown={(e) => {
          if (!active && e.button === 0) setFocusAt({ x: e.clientX, y: e.clientY })
        }}
        onFocus={() => setFocusWithin(true)}
        onBlur={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFocusWithin(false)
        }}
      >
        {active ? (
          <CmEditor
            value={code}
            onChange={onChange}
            lang={lang}
            mode="code"
            placeholder="Write code, then press Ctrl+Enter to run"
            onModEnter={start}
            onEscape={() => api.focusCanvas()}
            focusAt={focusAt}
            onFocusApplied={() => setFocusAt(null)}
          />
        ) : (
          <StaticCode code={code} lang={lang} />
        )}
      </div>
      {run && (
        <div className={`canvas-code-output${run.failed ? ' is-error' : ''}`} data-interactive>
          <div className="canvas-code-status">
            {run.running ? (
              <>
                <Loader2 size={12} className="canvas-spin" /> Running…
              </>
            ) : (
              run.status
            )}
          </div>
          {run.chunks.length > 0 && (
            <pre ref={outRef}>
              {run.chunks.map((c, i) => (
                <span key={i} className={c.stream === 'stderr' ? 'stderr' : undefined}>
                  {c.text}
                </span>
              ))}
            </pre>
          )}
        </div>
      )}
    </div>
  )
}

const HLJS_LANG: Record<string, string> = { js: 'javascript', ts: 'typescript', html: 'xml', bat: 'dos', text: 'plaintext' }

/** Read-only code with syntax colors, laid out like the CodeMirror editor (line numbers, padding) so swapping is seamless. */
const StaticCode = memo(function StaticCode({ code, lang }: { code: string; lang: string }) {
  const html = useMemo(() => {
    const l = HLJS_LANG[lang] ?? lang
    const clipped = code.length > 20000 ? code.slice(0, 20000) : code
    try {
      return hljs.getLanguage(l) ? hljs.highlight(clipped, { language: l, ignoreIllegals: true }).value : escapeHtml(clipped)
    } catch {
      return escapeHtml(clipped)
    }
  }, [code, lang])
  const lines = code.split('\n').length
  return (
    <div className="canvas-code-static-view">
      <div className="canvas-code-gutter" aria-hidden>
        {Array.from({ length: Math.min(lines, 400) }, (_, i) => (
          <div key={i}>{i + 1}</div>
        ))}
      </div>
      {code ? (
        <pre className="canvas-code-static hljs" dangerouslySetInnerHTML={{ __html: html }} />
      ) : (
        <pre className="canvas-code-static is-empty">Write code, then press Ctrl+Enter to run</pre>
      )}
    </div>
  )
})

function formatMs(ms: number): string {
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(2)} s`
}
