// Inline widgets used by Live Preview.
import { WidgetType, type EditorView } from '@codemirror/view'
import { resolveLink } from '@/store/metadata'
import { IMAGE_EXTS } from '@/lib/filetypes'
import { extname, basename } from '@/lib/path'
import { splitLinkText } from '@/lib/mdparse'

/** "•" for a bullet list marker; `fixed` = occupies the hanging-indent marker column. */
export class BulletWidget extends WidgetType {
  constructor(readonly fixed: boolean) {
    super()
  }
  eq(o: BulletWidget): boolean {
    return o.fixed === this.fixed
  }
  toDOM(): HTMLElement {
    const el = document.createElement('span')
    el.className = `cm-lp-bullet${this.fixed ? ' is-fixed' : ''}`
    const dot = document.createElement('span')
    dot.className = 'cm-lp-bullet-dot'
    el.appendChild(dot)
    return el
  }
}

/** Fixed-width replacement for the leading whitespace of nested list items. */
export class IndentWidget extends WidgetType {
  constructor(readonly level: number) {
    super()
  }
  eq(o: IndentWidget): boolean {
    return o.level === this.level
  }
  toDOM(): HTMLElement {
    const el = document.createElement('span')
    el.className = 'cm-lp-indent'
    el.style.setProperty('--lp-level', String(this.level))
    for (let i = 0; i < this.level; i++) {
      const g = document.createElement('span')
      g.className = 'cm-lp-indent-guide'
      el.appendChild(g)
    }
    return el
  }
}

/** Toggles "[ ]" ↔ "[x]" of the task on the line containing `pos`. */
export function toggleTaskAt(view: EditorView, pos: number): boolean {
  const line = view.state.doc.lineAt(pos)
  const m = /^(\s*(?:>\s*)*(?:[-*+]|\d+[.)])\s+\[)(.)\]/.exec(line.text)
  if (!m) return false
  const at = line.from + m[1].length
  view.dispatch({ changes: { from: at, to: at + 1, insert: m[2] === ' ' ? 'x' : ' ' }, userEvent: 'input.toggle-task' })
  return true
}

export class CheckboxWidget extends WidgetType {
  constructor(
    readonly checked: boolean,
    readonly fixed: boolean
  ) {
    super()
  }
  eq(o: CheckboxWidget): boolean {
    return o.checked === this.checked && o.fixed === this.fixed
  }
  toDOM(view: EditorView): HTMLElement {
    const wrap = document.createElement('span')
    wrap.className = `cm-lp-task${this.fixed ? ' is-fixed' : ''}`
    const input = document.createElement('input')
    input.type = 'checkbox'
    input.className = 'task-list-item-checkbox'
    input.checked = this.checked
    input.addEventListener('mousedown', (e) => e.preventDefault())
    input.addEventListener('click', (e) => {
      e.preventDefault()
      toggleTaskAt(view, view.posAtDOM(wrap))
    })
    wrap.appendChild(input)
    return wrap
  }
  ignoreEvent(): boolean {
    return true
  }
}

/** Plain text in place of some source text (e.g. " › " for a link subpath). */
export class TextWidget extends WidgetType {
  constructor(
    readonly text: string,
    readonly className: string
  ) {
    super()
  }
  eq(o: TextWidget): boolean {
    return o.text === this.text && o.className === this.className
  }
  toDOM(): HTMLElement {
    const el = document.createElement('span')
    el.className = this.className
    el.textContent = this.text
    return el
  }
  ignoreEvent(): boolean {
    return false
  }
}

export class HrWidget extends WidgetType {
  eq(): boolean {
    return true
  }
  toDOM(): HTMLElement {
    const el = document.createElement('span')
    el.className = 'cm-lp-hr'
    return el
  }
}

const CALLOUT_META: Record<string, { color: string; icon: string }> = {
  note: { color: 'var(--color-blue-rgb)', icon: '✎' },
  info: { color: 'var(--color-blue-rgb)', icon: 'ℹ' },
  todo: { color: 'var(--color-blue-rgb)', icon: '☑' },
  abstract: { color: 'var(--color-cyan-rgb)', icon: '≡' },
  summary: { color: 'var(--color-cyan-rgb)', icon: '≡' },
  tldr: { color: 'var(--color-cyan-rgb)', icon: '≡' },
  tip: { color: 'var(--color-cyan-rgb)', icon: '🔥' },
  hint: { color: 'var(--color-cyan-rgb)', icon: '🔥' },
  important: { color: 'var(--color-cyan-rgb)', icon: '🔥' },
  success: { color: 'var(--color-green-rgb)', icon: '✔' },
  check: { color: 'var(--color-green-rgb)', icon: '✔' },
  done: { color: 'var(--color-green-rgb)', icon: '✔' },
  question: { color: 'var(--color-orange-rgb)', icon: '?' },
  help: { color: 'var(--color-orange-rgb)', icon: '?' },
  faq: { color: 'var(--color-orange-rgb)', icon: '?' },
  warning: { color: 'var(--color-orange-rgb)', icon: '⚠' },
  caution: { color: 'var(--color-orange-rgb)', icon: '⚠' },
  attention: { color: 'var(--color-orange-rgb)', icon: '⚠' },
  failure: { color: 'var(--color-red-rgb)', icon: '✖' },
  fail: { color: 'var(--color-red-rgb)', icon: '✖' },
  missing: { color: 'var(--color-red-rgb)', icon: '✖' },
  danger: { color: 'var(--color-red-rgb)', icon: '⛔' },
  error: { color: 'var(--color-red-rgb)', icon: '⛔' },
  bug: { color: 'var(--color-red-rgb)', icon: '🐞' },
  example: { color: 'var(--color-purple-rgb)', icon: '☰' },
  quote: { color: '158, 158, 158', icon: '❝' },
  cite: { color: '158, 158, 158', icon: '❝' }
}

export function calloutMeta(type: string): { color: string; icon: string } {
  return Object.hasOwn(CALLOUT_META, type) ? CALLOUT_META[type] : CALLOUT_META.note
}

/** Replaces "[!type]" with the callout icon (and a default title when none was written). */
export class CalloutTitleWidget extends WidgetType {
  constructor(
    readonly type: string,
    readonly defaultTitle: string | null
  ) {
    super()
  }
  eq(o: CalloutTitleWidget): boolean {
    return o.type === this.type && o.defaultTitle === this.defaultTitle
  }
  toDOM(): HTMLElement {
    const el = document.createElement('span')
    el.className = 'cm-lp-callout-icon'
    el.textContent = calloutMeta(this.type).icon
    if (this.defaultTitle) {
      const t = document.createElement('span')
      t.className = 'cm-lp-callout-default-title'
      t.textContent = this.defaultTitle
      const frag = document.createElement('span')
      frag.append(el, t)
      return frag
    }
    return el
  }
}

/** Vault resource URL for an image link (or the URL itself when external). */
export function imageSrc(link: string, sourcePath: string): string | null {
  if (/^[a-z][a-z0-9+.-]*:/i.test(link)) return link
  let dec = link
  try {
    dec = decodeURIComponent(link)
  } catch {
    /* keep */
  }
  const target = resolveLink(splitLinkText(dec).link, sourcePath)
  return target ? window.api.fs.resourceUrl(target) : null
}

/** "100" or "100x200" sizes from an embed alias. */
export function embedSize(alt: string): { width?: number; height?: number } {
  const m = /^(\d+)(?:x(\d+))?$/.exec(alt.trim())
  if (!m) return {}
  return { width: Number(m[1]), height: m[2] ? Number(m[2]) : undefined }
}

export class ImageWidget extends WidgetType {
  constructor(
    readonly src: string,
    readonly alt: string,
    readonly width?: number
  ) {
    super()
  }
  eq(o: ImageWidget): boolean {
    return o.src === this.src && o.alt === this.alt && o.width === this.width
  }
  toDOM(view: EditorView): HTMLElement {
    const img = document.createElement('img')
    img.className = 'cm-lp-image'
    img.src = this.src
    img.alt = this.alt
    if (this.width) img.width = this.width
    img.addEventListener('load', () => view.requestMeasure())
    return img
  }
  ignoreEvent(): boolean {
    return false
  }
}

/** Inline (mid-text) embed: image, or a link chip for anything else. */
export class InlineEmbedWidget extends WidgetType {
  constructor(
    readonly raw: string,
    readonly sourcePath: string
  ) {
    super()
  }
  eq(o: InlineEmbedWidget): boolean {
    return o.raw === this.raw && o.sourcePath === this.sourcePath
  }
  toDOM(view: EditorView): HTMLElement {
    const { link, subpath, display } = splitLinkText(this.raw)
    const target = link ? resolveLink(link, this.sourcePath) : this.sourcePath
    if (target && IMAGE_EXTS.has(extname(target))) {
      return new ImageWidget(window.api.fs.resourceUrl(target), display ?? '', embedSize(display ?? '').width).toDOM(view)
    }
    const el = document.createElement('span')
    el.className = 'cm-lp-link cm-lp-internal cm-lp-embed-chip' + (target ? '' : ' is-unresolved')
    el.dataset.href = link + (subpath ?? '')
    el.textContent = display || (target ? basename(target).replace(/\.md$/, '') : link) + (subpath ? ' › ' + subpath.slice(1) : '')
    return el
  }
  ignoreEvent(): boolean {
    return false
  }
}
