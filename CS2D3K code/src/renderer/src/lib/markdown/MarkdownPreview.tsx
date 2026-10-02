import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import { renderMarkdown, extractSubpath, RUN_TOKEN } from './render'
import { openLinkText } from '../fileops'
import { resolveLink } from '@/store/metadata'
import { useWorkspace } from '@/store/workspace'
import { useSettings } from '@/store/settings'
import { emit } from '../events'
import { runCode, type RunHandle } from '../runCode'
import { extname, basename } from '../path'
import { IMAGE_EXTS } from '../filetypes'
import { splitLinkText } from '../mdparse'
import { escapeHtml } from '../util'
import { attachHoverPreview } from './hoverPreview'
import '@/styles/markdown.css'

export interface MarkdownPreviewProps {
  source: string
  sourcePath: string
  className?: string
  /** enable ▶ buttons on runnable code blocks */
  runnable?: boolean
  /** called when a task checkbox is toggled (line = 0-based source line) */
  onToggleTask?: (line: number, checked: boolean) => void
  /** embed nesting depth (internal) */
  depth?: number
  style?: React.CSSProperties
}

const MAX_EMBED_DEPTH = 3

/** runs started from a rendered preview, so they can be stopped when the preview goes away */
const previewRuns = new WeakMap<HTMLElement, Set<RunHandle>>()

/** Wire up interactive behavior for rendered markdown inside `root`. Returns cleanup. */
export function hydrateMarkdown(root: HTMLElement, opts: { sourcePath: string; depth: number; onToggleTask?: (line: number, checked: boolean) => void }): () => void {
  const onClick = (e: MouseEvent): void => {
    const target = e.target as HTMLElement
    const link = target.closest<HTMLAnchorElement>('a.internal-link')
    if (link) {
      e.preventDefault()
      e.stopPropagation()
      void openLinkText(link.dataset.href ?? '', opts.sourcePath, e.ctrlKey || e.metaKey || e.button === 1)
      return
    }
    const tag = target.closest<HTMLAnchorElement>('a.tag')
    if (tag) {
      e.preventDefault()
      useWorkspace.getState().revealPane('search')
      setTimeout(() => emit('focus-search', { query: `#${tag.dataset.tag}` }), 30)
      return
    }
    const ext = target.closest<HTMLAnchorElement>('a.external-link')
    if (ext) {
      e.preventDefault()
      void window.api.app.openExternal(ext.href)
      return
    }
    if (target.matches('input.task-list-item-checkbox')) {
      const line = Number((target as HTMLInputElement).dataset.line)
      if (opts.onToggleTask && line >= 0) {
        e.preventDefault()
        opts.onToggleTask(line, (target as HTMLInputElement).checked)
      } else e.preventDefault()
      return
    }
    const copy = target.closest<HTMLButtonElement>('.code-block-copy')
    if (copy) {
      const code = copy.closest('.code-block')?.querySelector('code')?.textContent ?? ''
      void navigator.clipboard.writeText(code)
      copy.textContent = 'Copied!'
      setTimeout(() => (copy.textContent = 'Copy'), 1200)
      return
    }
    const run = target.closest<HTMLButtonElement>('.code-block-run')
    // only buttons rendered for real code fences: raw HTML in a note must not be able to fake one
    if (run && run.dataset.run === RUN_TOKEN) {
      const block = run.closest<HTMLElement>('.code-block')!
      const handle = runBlock(block, opts.sourcePath)
      let runs = previewRuns.get(root)
      if (!runs) previewRuns.set(root, (runs = new Set()))
      runs.add(handle)
      void handle.done.finally(() => runs!.delete(handle)).catch(() => {})
      return
    }
    const calloutTitle = target.closest<HTMLElement>('.callout-title')
    if (calloutTitle) {
      const callout = calloutTitle.closest<HTMLElement>('.callout')
      if (callout?.dataset.calloutFold) callout.classList.toggle('is-collapsed')
    }
  }
  root.addEventListener('click', onClick)
  const onAux = (e: MouseEvent): void => {
    if (e.button !== 1) return
    const link = (e.target as HTMLElement).closest<HTMLAnchorElement>('a.internal-link')
    if (link) {
      e.preventDefault()
      void openLinkText(link.dataset.href ?? '', opts.sourcePath, true)
    }
  }
  root.addEventListener('auxclick', onAux)
  void hydrateEmbeds(root, opts.sourcePath, opts.depth)
  // Mod+hover page previews (nested renders are covered by the top-level root's listener)
  const detachHover = opts.depth === 0 ? attachHoverPreview(root, { sourcePath: opts.sourcePath }) : null
  return () => {
    root.removeEventListener('click', onClick)
    root.removeEventListener('auxclick', onAux)
    detachHover?.()
  }
}

/** Run the code inside a rendered .code-block and stream output below it. */
export function runBlock(block: HTMLElement, sourcePath: string): RunHandle {
  const lang = block.dataset.lang ?? ''
  const code = block.querySelector('code')?.textContent ?? ''
  const out = block.querySelector<HTMLElement>('.code-block-output')!
  const btn = block.querySelector<HTMLButtonElement>('.code-block-run')
  out.hidden = false
  out.innerHTML = '<div class="code-output-status">Running…</div><pre class="code-output-text"></pre>'
  const pre = out.querySelector('pre')!
  if (btn) {
    btn.textContent = '■ Stop'
    btn.classList.add('is-running')
  }
  const handle = runCode(lang, code, {
    sourcePath,
    onOutput: (stream, data) => {
      const span = document.createElement('span')
      if (stream === 'stderr') span.className = 'stderr'
      span.textContent = data
      pre.appendChild(span)
    }
  })
  // killed by the user (■ Stop): reported as stopped, not as a failed run
  let stopped = false
  if (btn) {
    const stop = (ev: MouseEvent): void => {
      ev.stopPropagation()
      stopped = true
      handle.kill()
    }
    btn.addEventListener('click', stop, { once: true, capture: true })
    void handle.done.finally(() => btn.removeEventListener('click', stop, { capture: true })).catch(() => {})
  }
  void handle.done.then((r) => {
    const status = out.querySelector('.code-output-status')!
    if (r.error) {
      status.textContent = `Error: ${r.error}`
      status.className = 'code-output-status is-error'
    } else if (stopped || r.code === null) {
      status.textContent = `Stopped · ${r.durationMs} ms`
      status.className = 'code-output-status'
    } else {
      status.textContent = `Exited with code ${r.code} · ${r.durationMs} ms`
      status.className = `code-output-status${r.code === 0 ? '' : ' is-error'}`
    }
    if (!pre.textContent) pre.textContent = r.stdout + r.stderr
    if (btn) {
      btn.textContent = '▶ Run'
      btn.classList.remove('is-running')
    }
    emit('run-output', { title: `${lang} (${basename(sourcePath)})`, text: r.stdout + (r.stderr ? `\n${r.stderr}` : ''), stream: r.code === 0 ? 'stdout' : 'stderr' })
  }, (e: Error) => {
    const status = out.querySelector('.code-output-status')!
    status.textContent = `Error: ${e.message}`
    status.className = 'code-output-status is-error'
    if (btn) {
      btn.textContent = '▶ Run'
      btn.classList.remove('is-running')
    }
  })
  return handle
}

async function hydrateEmbeds(root: HTMLElement, sourcePath: string, depth: number): Promise<void> {
  const embeds = [...root.querySelectorAll<HTMLElement>('.internal-embed:not([data-hydrated])')]
  for (const el of embeds) {
    el.dataset.hydrated = '1'
    const raw = el.dataset.src ?? ''
    const { link, subpath } = splitLinkText(raw)
    const target = link ? resolveLink(link, sourcePath) : sourcePath
    if (!target) {
      el.innerHTML = `<a class="internal-link is-unresolved" data-href="${escapeHtml(raw)}" href="#">${escapeHtml(raw)}</a>`
      continue
    }
    const ext = extname(target)
    if (IMAGE_EXTS.has(ext)) {
      const alt = el.dataset.alt ?? ''
      const width = /^\d+$/.test(alt) ? ` width="${alt}"` : /^(\d+)x(\d+)$/.test(alt) ? ` width="${alt.split('x')[0]}"` : ''
      el.innerHTML = `<img src="${window.api.fs.resourceUrl(target)}" alt="${escapeHtml(alt)}"${width}>`
      el.classList.add('image-embed')
      continue
    }
    if (['mp3', 'wav', 'ogg', 'm4a'].includes(ext)) {
      el.innerHTML = `<audio controls src="${window.api.fs.resourceUrl(target)}"></audio>`
      continue
    }
    if (['mp4', 'webm', 'mov'].includes(ext)) {
      el.innerHTML = `<video controls src="${window.api.fs.resourceUrl(target)}" style="max-width:100%"></video>`
      continue
    }
    if (ext === 'pdf') {
      el.innerHTML = `<iframe src="${window.api.fs.resourceUrl(target)}" style="width:100%;height:500px;border:none"></iframe>`
      continue
    }
    if (ext === 'md' && depth < MAX_EMBED_DEPTH) {
      try {
        let content = await window.api.fs.readText(target)
        if (subpath) content = extractSubpath(content, subpath)
        el.classList.add('markdown-embed')
        el.innerHTML = `<div class="markdown-embed-title"><a class="internal-link" data-href="${escapeHtml(raw)}" href="#">${escapeHtml(basename(target).replace(/\.md$/, '') + (subpath ? ' › ' + subpath.slice(1) : ''))}</a></div><div class="markdown-embed-content markdown-rendered"></div>`
        const inner = el.querySelector<HTMLElement>('.markdown-embed-content')!
        inner.innerHTML = renderMarkdown(content, { sourcePath: target, showFrontmatter: false })
        hydrateMarkdown(inner, { sourcePath: target, depth: depth + 1 })
      } catch {
        el.textContent = raw
      }
      continue
    }
    // other files (code etc.): show a link + small preview for text-ish files
    el.innerHTML = `<a class="internal-link" data-href="${escapeHtml(raw)}" href="#">${escapeHtml(basename(target))}</a>`
  }
}

const codeBlockKey = (b: HTMLElement): string => `${b.dataset.lang ?? ''}\n${b.querySelector('code')?.textContent ?? ''}`

/** Renders markdown with Obsidian-like behaviors (links, embeds, tasks, runnable code). */
export default function MarkdownPreview({ source, sourcePath, className, runnable, onToggleTask, depth = 0, style }: MarkdownPreviewProps) {
  const ref = useRef<HTMLDivElement>(null)
  const showFm = useSettings((s) => s.settings.showFrontmatter)
  const html = useMemo(() => renderMarkdown(source, { sourcePath, runnable, showFrontmatter: showFm }), [source, sourcePath, runnable, showFm])
  const toggleRef = useRef(onToggleTask)
  toggleRef.current = onToggleTask

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    // keep code run output across re-renders (e.g. after toggling a task elsewhere in the note)
    const outputs = new Map<string, HTMLElement>()
    for (const b of el.querySelectorAll<HTMLElement>('.code-block')) {
      const out = b.querySelector<HTMLElement>('.code-block-output')
      if (out && !out.hidden) outputs.set(codeBlockKey(b), out)
    }
    el.innerHTML = html
    if (!outputs.size) return
    for (const b of el.querySelectorAll<HTMLElement>('.code-block')) {
      const prev = outputs.get(codeBlockKey(b))
      if (!prev) continue
      b.querySelector('.code-block-output')?.replaceWith(prev)
      outputs.delete(codeBlockKey(b))
    }
  }, [html])

  useEffect(() => {
    const el = ref.current
    if (!el) return
    return hydrateMarkdown(el, { sourcePath, depth, onToggleTask: (l, c) => toggleRef.current?.(l, c) })
  }, [html, sourcePath, depth])

  // closing the note stops snippets started from it (nothing would show their output or offer ■ Stop)
  useEffect(() => {
    const el = ref.current
    return () => {
      if (el) previewRuns.get(el)?.forEach((h) => h.kill())
    }
  }, [])

  return <div ref={ref} className={`markdown-rendered ${className ?? ''}`} style={style} />
}
