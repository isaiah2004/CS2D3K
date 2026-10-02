// Page previews: Mod+hover (Ctrl / Cmd) over an internal link shows the rendered target in a popover.
// Used by the markdown editor, reading view (via hydrateMarkdown) and anything else rendering links.
import { renderMarkdown, extractSubpath } from './render'
import { hydrateMarkdown } from './MarkdownPreview'
import { resolveLink } from '@/store/metadata'
import { getSettings } from '@/store/settings'
import { splitLinkText } from '../mdparse'
import { IMAGE_EXTS, isTextLike } from '../filetypes'
import { extname, basename } from '../path'
import { escapeHtml, clamp } from '../util'

export interface HoverPreviewOptions {
  /** CSS selector matching link elements (default: elements with data-href that aren't external) */
  selector?: string
  /** vault path links are resolved against */
  sourcePath: string | (() => string)
  /** link text for an element (default: its data-href) */
  getLinktext?: (el: HTMLElement) => string | null
  /** require Ctrl/Cmd to be held (default true, like Obsidian) */
  requireMod?: boolean
}

interface Popover {
  el: HTMLElement
  anchor: HTMLElement
  parent: Popover | null
  cleanup: () => void
  closeTimer: ReturnType<typeof setTimeout> | null
}

const DEFAULT_SELECTOR = '[data-href]:not([data-external]):not(.external-link)'
const SHOW_DELAY = 180
const CLOSE_DELAY = 300
const popovers: Popover[] = []

const isMod = (e: MouseEvent | KeyboardEvent): boolean => e.ctrlKey || e.metaKey

function popoverOf(node: Node | null): Popover | null {
  const el = node instanceof Element ? node.closest('.hover-popover') : node?.parentElement?.closest('.hover-popover')
  return (el && popovers.find((p) => p.el === el)) || null
}

function closePopover(p: Popover): void {
  // close children first
  for (const c of popovers.filter((x) => x.parent === p)) closePopover(c)
  const i = popovers.indexOf(p)
  if (i >= 0) popovers.splice(i, 1)
  if (p.closeTimer) clearTimeout(p.closeTimer)
  p.cleanup()
  p.el.remove()
}

/** Close every open page preview. */
export function closeAllHoverPreviews(): void {
  for (const p of popovers.filter((x) => !x.parent)) closePopover(p)
}

function isHovered(p: Popover): boolean {
  if (p.el.matches(':hover') || (p.anchor.isConnected && p.anchor.matches(':hover'))) return true
  return popovers.some((c) => c.parent === p && isHovered(c))
}

function scheduleClose(p: Popover): void {
  if (p.closeTimer) clearTimeout(p.closeTimer)
  p.closeTimer = setTimeout(() => {
    p.closeTimer = null
    if (!popovers.includes(p)) return
    if (isHovered(p)) return
    closePopover(p)
    if (p.parent && !isHovered(p.parent)) scheduleClose(p.parent)
  }, CLOSE_DELAY)
}

async function fill(body: HTMLElement, linktext: string, sourcePath: string, onCleanup: (fn: () => void) => void): Promise<void> {
  const { link, subpath } = splitLinkText(linktext)
  const target = link ? resolveLink(link, sourcePath) : sourcePath
  if (!target) {
    body.innerHTML = `<div class="hover-popover-empty">“${escapeHtml(link)}” doesn’t exist yet. Click the link to create it.</div>`
    return
  }
  const ext = extname(target)
  if (IMAGE_EXTS.has(ext)) {
    body.innerHTML = `<img class="hover-popover-image" src="${escapeHtml(window.api.fs.resourceUrl(target))}" alt="">`
    return
  }
  if (ext === 'md') {
    let src = await window.api.fs.readText(target)
    if (subpath) src = extractSubpath(src, subpath)
    const rendered = document.createElement('div')
    rendered.className = 'markdown-rendered'
    rendered.innerHTML = src.trim()
      ? renderMarkdown(src, { sourcePath: target, showFrontmatter: !subpath && getSettings().showFrontmatter })
      : '<div class="hover-popover-empty">This note is empty.</div>'
    body.replaceChildren(rendered)
    onCleanup(hydrateMarkdown(rendered, { sourcePath: target, depth: 1 }))
    onCleanup(attachHoverPreview(rendered, { sourcePath: target }))
    return
  }
  if (isTextLike(ext)) {
    const text = await window.api.fs.readText(target)
    body.innerHTML = `<div class="hover-popover-file">${escapeHtml(basename(target))}</div><pre class="hover-popover-code"><code>${escapeHtml(text.slice(0, 4000))}</code></pre>`
    return
  }
  body.innerHTML = `<div class="hover-popover-file">${escapeHtml(basename(target))}</div>`
}

/** Show a page preview for `linktext` next to `anchor`. */
export function showHoverPreview(anchor: HTMLElement, linktext: string, sourcePath: string): void {
  const parent = popoverOf(anchor)
  // one preview chain at a time: a new top-level preview replaces the old one
  for (const p of [...popovers]) {
    if (!popovers.includes(p)) continue
    if (p.anchor === anchor) return
    if (p.parent === parent) closePopover(p)
  }
  const el = document.createElement('div')
  el.className = 'hover-popover'
  const body = document.createElement('div')
  body.className = 'hover-popover-body'
  body.innerHTML = '<div class="hover-popover-empty">Loading…</div>'
  el.appendChild(body)
  document.body.appendChild(el)

  const cleanups: (() => void)[] = []
  const pop: Popover = { el, anchor, parent, closeTimer: null, cleanup: () => cleanups.forEach((f) => f()) }
  popovers.push(pop)

  const position = (): void => {
    const r = anchor.getBoundingClientRect()
    const w = Math.min(480, window.innerWidth - 16)
    el.style.width = `${w}px`
    el.style.left = `${clamp(r.left, 8, window.innerWidth - w - 8)}px`
    const below = window.innerHeight - r.bottom
    const maxH = Math.min(440, Math.max(below, r.top) - 16)
    el.style.maxHeight = `${maxH}px`
    if (below >= Math.min(320, el.offsetHeight + 12) || below >= r.top) {
      el.style.top = `${r.bottom + 6}px`
      el.style.bottom = ''
    } else {
      el.style.top = ''
      el.style.bottom = `${window.innerHeight - r.top + 6}px`
    }
  }
  position()
  el.addEventListener('mouseenter', () => {
    if (pop.closeTimer) clearTimeout(pop.closeTimer)
    pop.closeTimer = null
  })
  el.addEventListener('mouseleave', () => scheduleClose(pop))
  void fill(body, linktext, sourcePath, (fn) => cleanups.push(fn))
    .catch(() => (body.innerHTML = '<div class="hover-popover-empty">Could not load preview.</div>'))
    .finally(() => {
      if (popovers.includes(pop)) position()
    })
}

let globalsInstalled = false
function installGlobals(): void {
  if (globalsInstalled) return
  globalsInstalled = true
  document.addEventListener(
    'mousedown',
    (e) => {
      if (!popovers.length) return
      if (!(e.target as Element).closest?.('.hover-popover')) closeAllHoverPreviews()
    },
    true
  )
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && popovers.length) closeAllHoverPreviews()
  })
}

/** Enable Mod+hover page previews for links inside `root`. Returns cleanup. */
export function attachHoverPreview(root: HTMLElement, opts: HoverPreviewOptions): () => void {
  installGlobals()
  const selector = opts.selector ?? DEFAULT_SELECTOR
  const requireMod = opts.requireMod ?? true
  const sourcePath = (): string => (typeof opts.sourcePath === 'function' ? opts.sourcePath() : opts.sourcePath)
  const linktextOf = (el: HTMLElement): string | null => (opts.getLinktext ? opts.getLinktext(el) : (el.dataset.href ?? null))
  let hovered: HTMLElement | null = null
  let showTimer: ReturnType<typeof setTimeout> | null = null

  const cancelShow = (): void => {
    if (showTimer) clearTimeout(showTimer)
    showTimer = null
  }
  const show = (el: HTMLElement, delay: number): void => {
    cancelShow()
    showTimer = setTimeout(() => {
      showTimer = null
      if (hovered !== el || !el.isConnected) return
      const text = linktextOf(el)
      if (text) showHoverPreview(el, text, sourcePath())
    }, delay)
  }

  const onOver = (e: MouseEvent): void => {
    const el = (e.target as HTMLElement).closest?.<HTMLElement>(selector)
    if (!el || !root.contains(el) || el === hovered) return
    hovered = el
    if (!requireMod || isMod(e)) show(el, SHOW_DELAY)
  }
  const onOut = (e: MouseEvent): void => {
    if (!hovered) return
    const to = e.relatedTarget as Node | null
    if (to && hovered.contains(to)) return
    const left = hovered
    hovered = null
    cancelShow()
    const p = popovers.find((x) => x.anchor === left)
    if (p) scheduleClose(p)
  }
  const onKey = (e: KeyboardEvent): void => {
    if (hovered && (e.key === 'Control' || e.key === 'Meta') && hovered.matches(':hover')) show(hovered, 0)
  }
  root.addEventListener('mouseover', onOver)
  root.addEventListener('mouseout', onOut)
  window.addEventListener('keydown', onKey)
  return () => {
    cancelShow()
    root.removeEventListener('mouseover', onOver)
    root.removeEventListener('mouseout', onOut)
    window.removeEventListener('keydown', onKey)
    for (const p of [...popovers]) if (root.contains(p.anchor) && popovers.includes(p)) closePopover(p)
  }
}
