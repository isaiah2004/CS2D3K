// Block-level Live Preview widgets (must come from a StateField because they span lines):
// frontmatter → properties, tables → rendered table, embed-only lines → rendered embed below.
import { StateField, type EditorState, type Range } from '@codemirror/state'
import { Decoration, EditorView, WidgetType, type DecorationSet } from '@codemirror/view'
import { syntaxTree } from '@codemirror/language'
import type { SyntaxNode } from '@lezer/common'
import { renderMarkdown, renderFrontmatter } from '@/lib/markdown/render'
import { hydrateMarkdown } from '@/lib/markdown/MarkdownPreview'
import { parseFrontmatter } from '@/lib/mdparse'
import { escapeHtml } from '@/lib/util'
import { getSettings } from '@/store/settings'
import { notePath, livePreview, refreshDecorations, selectionTouches, focusChanged } from './state'
import { imageSrc } from './widgets'

interface BlockItem {
  kind: 'frontmatter' | 'table' | 'embed'
  from: number
  to: number
  /** embed: wiki link text (or markdown image url) */
  raw?: string
  /** embed: markdown image syntax ![](url) instead of ![[...]] */
  mdImage?: boolean
}

/** True when the embed/image at [from, to] is the only thing on its line. */
export function isBlockEmbed(state: EditorState, from: number, to: number): boolean {
  const line = state.doc.lineAt(from)
  return to <= line.to && line.text.trim() === state.doc.sliceString(from, to)
}

const CONTAINERS = new Set(['Document', 'BulletList', 'OrderedList', 'ListItem'])

function scan(state: EditorState): BlockItem[] {
  const items: BlockItem[] = []
  const doc = state.doc
  const visit = (node: SyntaxNode): void => {
    for (let n = node.firstChild; n; n = n.nextSibling) {
      // an unclosed `---` (still being typed, or a leading rule) is not rendered as properties
      if (n.name === 'Frontmatter') {
        if (n.getChildren('FrontmatterMark').length > 1) items.push({ kind: 'frontmatter', from: n.from, to: n.to })
      }
      else if (n.name === 'Table') items.push({ kind: 'table', from: doc.lineAt(n.from).from, to: doc.lineAt(n.to).to })
      else if (n.name === 'Paragraph') {
        for (let c = n.firstChild; c; c = c.nextSibling) {
          if ((c.name !== 'Embed' && c.name !== 'Image') || !isBlockEmbed(state, c.from, c.to)) continue
          if (c.name === 'Embed') {
            const target = c.getChild('WikiTarget')
            if (!target) continue
            items.push({ kind: 'embed', from: c.from, to: c.to, raw: doc.sliceString(target.from, c.getChild('WikiAlias')?.to ?? target.to) })
          } else {
            const url = c.getChild('URL')
            if (url) items.push({ kind: 'embed', from: c.from, to: c.to, raw: doc.sliceString(url.from, url.to), mdImage: true })
          }
        }
      } else if (CONTAINERS.has(n.name)) visit(n)
    }
  }
  visit(syntaxTree(state).topNode)
  return items
}

const embedHiddenLine = Decoration.line({ class: 'cm-embed-hidden' })
const hide = Decoration.replace({})

function decorate(state: EditorState, items: BlockItem[]): DecorationSet {
  const out: Range<Decoration>[] = []
  const path = state.facet(notePath)
  const doc = state.doc
  for (const it of items) {
    if (it.kind === 'embed') {
      const line = doc.lineAt(it.from)
      out.push(Decoration.widget({ widget: new EmbedWidget(it.raw!, !!it.mdImage, path), block: true, side: 1 }).range(line.to))
      if (!selectionTouches(state, line.from, line.to)) out.push(embedHiddenLine.range(line.from), hide.range(it.from, it.to))
      continue
    }
    // frontmatter: a cursor at the very start of the note (fresh open) keeps the properties view
    if (selectionTouches(state, it.kind === 'frontmatter' ? it.from + 1 : it.from, it.to)) continue
    const text = doc.sliceString(it.from, it.to)
    if (it.kind === 'frontmatter' && !getSettings().showFrontmatter) {
      // "show properties" off: hide the block entirely until the cursor enters it
      out.push(Decoration.replace({ block: true }).range(it.from, it.to))
      continue
    }
    const widget = it.kind === 'frontmatter' ? new PropertiesWidget(text) : new TableWidget(text, path)
    out.push(Decoration.replace({ widget, block: true }).range(it.from, it.to))
  }
  return Decoration.set(out, true)
}

export const blockWidgets = StateField.define<{ items: BlockItem[]; deco: DecorationSet }>({
  create(state) {
    const items = state.facet(livePreview) ? scan(state) : []
    return { items, deco: decorate(state, items) }
  },
  update(value, tr) {
    const structural =
      tr.docChanged ||
      syntaxTree(tr.state) !== syntaxTree(tr.startState) ||
      tr.startState.facet(livePreview) !== tr.state.facet(livePreview) ||
      tr.startState.facet(notePath) !== tr.state.facet(notePath) ||
      tr.effects.some((e) => e.is(refreshDecorations)) ||
      focusChanged(tr.startState, tr.state)
    if (structural) {
      const items = tr.state.facet(livePreview) ? scan(tr.state) : []
      return { items, deco: decorate(tr.state, items) }
    }
    if (tr.selection && value.items.length) return { items: value.items, deco: decorate(tr.state, value.items) }
    return value
  },
  provide: (f) => EditorView.decorations.from(f, (v) => v.deco)
})

/** Base for widgets that render markdown HTML and need re-measuring when their size changes. */
abstract class RenderedBlockWidget extends WidgetType {
  private cleanups = new WeakMap<HTMLElement, () => void>()

  protected abstract fill(el: HTMLElement, view: EditorView): (() => void) | void

  toDOM(view: EditorView): HTMLElement {
    const el = document.createElement('div')
    const undo = this.fill(el, view)
    const ro = new ResizeObserver(() => view.requestMeasure())
    ro.observe(el)
    this.cleanups.set(el, () => {
      ro.disconnect()
      undo?.()
    })
    return el
  }
  destroy(dom: HTMLElement): void {
    this.cleanups.get(dom)?.()
  }
  ignoreEvent(e: Event): boolean {
    // let links / buttons / checkboxes inside work; other clicks move the cursor into the source
    return !!(e.target as HTMLElement).closest?.('a, button, input, audio, video, iframe, .markdown-embed-content')
  }
}

class PropertiesWidget extends RenderedBlockWidget {
  constructor(readonly text: string) {
    super()
  }
  eq(o: PropertiesWidget): boolean {
    return o.text === this.text
  }
  get estimatedHeight(): number {
    return 40 + 26 * Math.max(0, this.text.split('\n').length - 2)
  }
  ignoreEvent(): boolean {
    return true
  }
  protected fill(el: HTMLElement, view: EditorView): void {
    el.className = 'cm-lp-properties markdown-rendered'
    // clicking the properties reveals the YAML source with the cursor on the first key
    el.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return
      e.preventDefault()
      const from = view.posAtDOM(el)
      const line = view.state.doc.lineAt(from)
      const next = line.number < view.state.doc.lines ? view.state.doc.line(line.number + 1) : line
      view.dispatch({ selection: { anchor: next.to } })
      view.focus()
    })
    const fm = parseFrontmatter(this.text + '\n')
    const data = fm.data ?? {}
    el.innerHTML = Object.keys(data).length
      ? renderFrontmatter(data)
      : `<div class="frontmatter-properties"><div class="fm-title">Properties</div><div class="fm-empty">${escapeHtml('No properties')}</div></div>`
  }
}

class TableWidget extends RenderedBlockWidget {
  constructor(
    readonly text: string,
    readonly sourcePath: string
  ) {
    super()
  }
  eq(o: TableWidget): boolean {
    return o.text === this.text && o.sourcePath === this.sourcePath
  }
  get estimatedHeight(): number {
    return 36 * Math.max(1, this.text.split('\n').length - 1)
  }
  protected fill(el: HTMLElement): () => void {
    el.className = 'cm-lp-table markdown-rendered'
    el.innerHTML = renderMarkdown(this.text, { sourcePath: this.sourcePath, showFrontmatter: false })
    return hydrateMarkdown(el, { sourcePath: this.sourcePath, depth: 1 })
  }
}

class EmbedWidget extends RenderedBlockWidget {
  constructor(
    readonly raw: string,
    readonly mdImage: boolean,
    readonly sourcePath: string
  ) {
    super()
  }
  eq(o: EmbedWidget): boolean {
    return o.raw === this.raw && o.mdImage === this.mdImage && o.sourcePath === this.sourcePath
  }
  get estimatedHeight(): number {
    return 120
  }
  protected fill(el: HTMLElement): (() => void) | void {
    el.className = 'cm-lp-embed-block markdown-rendered'
    if (this.mdImage) {
      const src = imageSrc(this.raw, this.sourcePath)
      el.innerHTML = src ? `<img src="${escapeHtml(src)}" alt="">` : `<span class="cm-lp-embed-missing">${escapeHtml(this.raw)}</span>`
      return
    }
    const pipe = this.raw.indexOf('|')
    const target = pipe >= 0 ? this.raw.slice(0, pipe) : this.raw
    const alt = pipe >= 0 ? this.raw.slice(pipe + 1) : ''
    el.innerHTML = `<span class="internal-embed" data-src="${escapeHtml(target.trim())}" data-alt="${escapeHtml(alt.trim())}"></span>`
    return hydrateMarkdown(el, { sourcePath: this.sourcePath, depth: 1 })
  }
}
