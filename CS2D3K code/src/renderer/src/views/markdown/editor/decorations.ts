// Markdown decorations computed from the syntax tree for the visible ranges.
// Always: heading line sizes, code block / frontmatter / table line styling, link targets.
// Live Preview only: hide markup away from the cursor and render bullets, checkboxes, links,
// images, callouts, rules and code block headers.
import { Decoration, ViewPlugin, EditorView, type DecorationSet, type ViewUpdate } from '@codemirror/view'
import type { Range } from '@codemirror/state'
import { syntaxTree } from '@codemirror/language'
import type { SyntaxNode, SyntaxNodeRef } from '@lezer/common'
import { resolveLink } from '@/store/metadata'
import { RUNNABLE_LANGS } from '@/lib/filetypes'
import { splitLinkText } from '@/lib/mdparse'
import { notePath, livePreview, refreshDecorations, selectionTouches, selectionTouchesLines, focusChanged } from './state'
import { BulletWidget, IndentWidget, CheckboxWidget, HrWidget, TextWidget, CalloutTitleWidget, ImageWidget, InlineEmbedWidget, calloutMeta, imageSrc } from './widgets'
import { CodeHeaderWidget } from './codeRun'
import { isBlockEmbed } from './blocks'

const hide = Decoration.replace({})
const bullet = Decoration.replace({ widget: new BulletWidget(false) })
const bulletFixed = Decoration.replace({ widget: new BulletWidget(true) })
const hr = Decoration.replace({ widget: new HrWidget() })
const subpathSep = new TextWidget(' › ', 'cm-lp-subpath-sep')
const inlineCode = Decoration.mark({ class: 'cm-inline-code' })
const markerMarks = [false, true].map((fixed) =>
  [false, true].map((number) => Decoration.mark({ class: `cm-lp-marker${fixed ? ' is-fixed' : ''}${number ? ' cm-lp-list-number' : ''}` }))
)
const markerMark = (fixed: boolean, number: boolean): Decoration => markerMarks[Number(fixed)][Number(number)]
const listLines: Decoration[] = []
function listLine(level: number): Decoration {
  return (listLines[level] ??= Decoration.line({ class: 'cm-lp-list-line', attributes: { style: `--lp-level: ${level}` } }))
}
const checkedLine = Decoration.line({ class: 'cm-task-checked' })
const frontmatterLine = Decoration.line({ class: 'cm-frontmatter-line' })
const tableLine = Decoration.line({ class: 'cm-table-line' })
const fenceHiddenLine = Decoration.line({ class: 'cm-fence-hidden' })
const headingLines = [1, 2, 3, 4, 5, 6].map((n) => Decoration.line({ class: `cm-heading-line cm-h${n}` }))

const EXTERNAL_RE = /^[a-z][a-z0-9+.-]*:/i

function linkMark(href: string, external: boolean, unresolved = false): Decoration {
  return Decoration.mark({
    class: `cm-lp-link ${external ? 'cm-lp-external' : 'cm-lp-internal'}${unresolved ? ' is-unresolved' : ''}`,
    attributes: external ? { 'data-href': href, 'data-external': 'true' } : { 'data-href': href }
  })
}

/** Link target text that is visible in source form (always present so hover/Mod+click work in source mode). */
function linkSourceMark(href: string, external: boolean): Decoration {
  return Decoration.mark({ attributes: external ? { 'data-href': href, 'data-external': 'true' } : { 'data-href': href } })
}

function decodeUrl(url: string): string {
  try {
    return decodeURIComponent(url)
  } catch {
    return url
  }
}

function isResolved(href: string, path: string): boolean {
  const { link } = splitLinkText(href)
  return !link || !!resolveLink(link, path)
}

function children(node: SyntaxNode, name: string): SyntaxNode[] {
  const out: SyntaxNode[] = []
  for (let c = node.firstChild; c; c = c.nextSibling) if (c.name === name) out.push(c)
  return out
}

const HEADING_RE = /^(?:ATX|Setext)Heading(\d)$/
const MARKUP_NODES: Record<string, string> = {
  Emphasis: 'EmphasisMark',
  StrongEmphasis: 'EmphasisMark',
  Strikethrough: 'StrikethroughMark',
  Highlight: 'HighlightMark',
  InlineCode: 'CodeMark'
}

function build(view: EditorView): DecorationSet {
  const state = view.state
  const doc = state.doc
  const live = state.facet(livePreview)
  const path = state.facet(notePath)
  const out: Range<Decoration>[] = []
  const seenBlocks = new Set<number>()
  const touches = (from: number, to: number): boolean => live && selectionTouches(state, from, to)
  const touchesLines = (from: number, to: number): boolean => live && selectionTouchesLines(state, from, to)

  /** add line decorations for each visible line of [from, to] */
  const eachLine = (from: number, to: number, vf: number, vt: number, fn: (lineFrom: number, first: boolean, last: boolean) => void): void => {
    const first = doc.lineAt(from).number
    const last = doc.lineAt(to).number
    const a = Math.max(first, doc.lineAt(vf).number)
    const b = Math.min(last, doc.lineAt(vt).number)
    for (let i = a; i <= b; i++) fn(doc.line(i).from, i === first, i === last)
  }

  const enter = (ref: SyntaxNodeRef, vf: number, vt: number): boolean | void => {
    const name = ref.name
    const heading = HEADING_RE.exec(name)
    if (heading) {
      const level = Number(heading[1])
      out.push(headingLines[level - 1].range(doc.lineAt(ref.from).from))
      if (!live || touchesLines(ref.from, ref.to)) return
      const node = ref.node
      for (const m of children(node, 'HeaderMark')) {
        if (name.startsWith('Setext')) {
          out.push(hide.range(m.from, m.to))
        } else if (m.from === node.from) {
          let end = m.to
          while (end < node.to && doc.sliceString(end, end + 1) === ' ') end++
          out.push(hide.range(m.from, end))
        } else {
          let start = m.from
          while (start > node.from && doc.sliceString(start - 1, start) === ' ') start--
          out.push(hide.range(start, m.to))
        }
      }
      return
    }

    const markName = MARKUP_NODES[name]
    if (markName) {
      if (name === 'InlineCode') out.push(inlineCode.range(ref.from, ref.to))
      if (live && !touches(ref.from, ref.to)) for (const m of children(ref.node, markName)) out.push(hide.range(m.from, m.to))
      return
    }

    switch (name) {
      case 'FencedCode': {
        if (seenBlocks.has(ref.from)) return false
        seenBlocks.add(ref.from)
        const node = ref.node
        const begin = doc.lineAt(ref.from)
        const end = doc.lineAt(ref.to)
        eachLine(ref.from, ref.to, vf, vt, (lf, first, last) =>
          out.push(Decoration.line({ class: `cm-codeblock-line${first ? ' cm-codeblock-begin' : ''}${last ? ' cm-codeblock-end' : ''}` }).range(lf))
        )
        const info = node.getChild('CodeInfo')
        const lang = info ? doc.sliceString(info.from, info.to).trim().split(/\s+/)[0] : ''
        const marks = node.getChildren('CodeMark')
        const active = !live || touches(begin.from, end.to)
        if (!active) {
          if (marks[0]) out.push(hide.range(marks[0].from, begin.to))
          if (marks.length > 1 && end.number > begin.number) {
            out.push(hide.range(marks[marks.length - 1].from, end.to))
            if (end.from >= vf && end.from <= vt) out.push(fenceHiddenLine.range(end.from))
          }
        }
        if (begin.to >= vf && begin.from <= vt) {
          out.push(Decoration.widget({ widget: new CodeHeaderWidget(lang, RUNNABLE_LANGS.has(lang.toLowerCase()), !active), side: 1 }).range(begin.to))
        }
        return false
      }
      case 'CodeBlock': {
        if (seenBlocks.has(ref.from)) return false
        seenBlocks.add(ref.from)
        eachLine(ref.from, ref.to, vf, vt, (lf, first, last) =>
          out.push(Decoration.line({ class: `cm-codeblock-line cm-indented-code${first ? ' cm-codeblock-begin' : ''}${last ? ' cm-codeblock-end' : ''}` }).range(lf))
        )
        return false
      }
      case 'Frontmatter': {
        if (seenBlocks.has(ref.from)) return false
        seenBlocks.add(ref.from)
        eachLine(ref.from, ref.to, vf, vt, (lf) => out.push(frontmatterLine.range(lf)))
        return false
      }
      case 'Table': {
        if (seenBlocks.has(ref.from)) return false
        seenBlocks.add(ref.from)
        eachLine(ref.from, ref.to, vf, vt, (lf) => out.push(tableLine.range(lf)))
        return
      }
      case 'Blockquote': {
        if (!live || seenBlocks.has(ref.from)) return
        seenBlocks.add(ref.from)
        if (ref.node.parent && ref.node.parent.name !== 'Document') return
        const firstLine = doc.lineAt(ref.from)
        const m = /^(\s*>\s*)\[!([\w-]+)\]([+-]?)/.exec(firstLine.text)
        const type = m ? m[2].toLowerCase() : null
        const attrs = type ? { style: `--callout-color: ${calloutMeta(type).color}`, 'data-callout': type } : undefined
        eachLine(ref.from, ref.to, vf, vt, (lf, first, last) =>
          out.push(
            Decoration.line({
              class: `${type ? 'cm-callout-line' : 'cm-quote-line'}${first ? ' cm-quote-first' : ''}${last ? ' cm-quote-last' : ''}${first && type ? ' cm-callout-title-line' : ''}`,
              attributes: attrs
            }).range(lf)
          )
        )
        if (m && type && !touchesLines(firstLine.from, firstLine.from)) {
          const start = firstLine.from + m[1].length
          let end = firstLine.from + m[0].length
          const title = firstLine.text.slice(m[0].length).trim()
          if (firstLine.text[m[0].length] === ' ') end++
          out.push(Decoration.replace({ widget: new CalloutTitleWidget(type, title ? null : type.charAt(0).toUpperCase() + type.slice(1)) }).range(start, end))
        }
        return
      }
      case 'QuoteMark': {
        if (!live || touchesLines(ref.from, ref.from)) return
        const end = doc.sliceString(ref.to, ref.to + 1) === ' ' ? ref.to + 1 : ref.to
        out.push(hide.range(ref.from, end))
        return
      }
      case 'ListMark': {
        if (!live) return
        const item = ref.node.parent
        const ordered = item?.parent?.name === 'OrderedList'
        const line = doc.lineAt(ref.from)
        const prefix = doc.sliceString(line.from, ref.from)
        const markEnd = doc.sliceString(ref.to, ref.to + 1) === ' ' ? ref.to + 1 : ref.to
        // hanging indent: leading whitespace becomes a fixed-width indent so wrapped lines align with the text
        const fixed = !!item && /^[ \t]*$/.test(prefix)
        if (fixed) {
          let level = 0
          for (let p = item!.parent; p; p = p.parent) if (p.name === 'ListItem') level++
          out.push(listLine(level).range(line.from))
          if (prefix) out.push(Decoration.replace({ widget: new IndentWidget(level) }).range(line.from, ref.from))
        }
        const marker = item?.getChild('Task')?.getChild('TaskMarker')
        if (marker) {
          const checked = doc.sliceString(marker.from + 1, marker.from + 2) !== ' '
          if (checked) out.push(checkedLine.range(line.from))
          const taskEnd = doc.sliceString(marker.to, marker.to + 1) === ' ' ? marker.to + 1 : marker.to
          if (ordered) {
            out.push(markerMark(fixed, true).range(ref.from, markEnd))
            if (!touches(marker.from, marker.to)) out.push(Decoration.replace({ widget: new CheckboxWidget(checked, false) }).range(marker.from, taskEnd))
          } else if (!touches(ref.from, marker.to)) {
            out.push(Decoration.replace({ widget: new CheckboxWidget(checked, fixed) }).range(ref.from, taskEnd))
          } else out.push(markerMark(fixed, false).range(ref.from, markEnd))
          return
        }
        if (ordered) out.push(markerMark(fixed, true).range(ref.from, markEnd))
        else if (!touches(ref.from, ref.to)) out.push((fixed ? bulletFixed : bullet).range(ref.from, markEnd))
        else out.push(markerMark(fixed, false).range(ref.from, markEnd))
        return
      }
      case 'HorizontalRule': {
        if (live && !touchesLines(ref.from, ref.to)) out.push(hr.range(ref.from, ref.to))
        return
      }
      case 'Escape': {
        if (live && !touches(ref.from, ref.to)) out.push(hide.range(ref.from, ref.from + 1))
        return
      }
      case 'Hashtag': {
        const tag = doc.sliceString(ref.from + 1, ref.to)
        out.push(Decoration.mark(live ? { class: 'cm-lp-tag', attributes: { 'data-tag': tag } } : { attributes: { 'data-tag': tag } }).range(ref.from, ref.to))
        return
      }
      case 'WikiLink': {
        const node = ref.node
        const target = node.getChild('WikiTarget')
        const alias = node.getChild('WikiAlias')
        if (!target) return false
        const href = doc.sliceString(target.from, target.to).trim()
        const unresolved = !isResolved(href, path)
        if (!live || touches(ref.from, ref.to)) {
          out.push(linkSourceMark(href, false).range(target.from, target.to))
          if (unresolved) out.push(Decoration.mark({ class: 'is-unresolved' }).range(ref.from, ref.to))
          return false
        }
        const shown = alias && alias.to > alias.from ? alias : target
        out.push(hide.range(ref.from, shown.from), hide.range(shown.to, ref.to))
        if (shown.to > shown.from) out.push(linkMark(href, false, unresolved).range(shown.from, shown.to))
        if (shown === target) {
          // "Note#Heading" displays as "Note › Heading", "#Heading" as "Heading"
          const text = doc.sliceString(target.from, target.to)
          const hash = text.indexOf('#')
          if (hash === 0) out.push(hide.range(target.from, target.from + 1))
          else if (hash > 0) out.push(Decoration.replace({ widget: subpathSep }).range(target.from + hash, target.from + hash + 1))
        }
        return false
      }
      case 'Embed': {
        const node = ref.node
        const target = node.getChild('WikiTarget')
        if (!target) return false
        const raw = doc.sliceString(target.from, node.getChild('WikiAlias')?.to ?? target.to)
        out.push(linkSourceMark(doc.sliceString(target.from, target.to).trim(), false).range(target.from, target.to))
        if (!live || touches(ref.from, ref.to) || isBlockEmbed(state, ref.from, ref.to)) return false
        out.push(Decoration.replace({ widget: new InlineEmbedWidget(raw, path) }).range(ref.from, ref.to))
        return false
      }
      case 'Link': {
        const node = ref.node
        const marks = children(node, 'LinkMark')
        const url = node.getChild('URL')
        if (!url || marks.length < 2) return
        const rawUrl = doc.sliceString(url.from, url.to)
        const external = EXTERNAL_RE.test(rawUrl)
        const href = external ? rawUrl : decodeUrl(rawUrl)
        out.push(linkSourceMark(href, external).range(url.from, url.to))
        if (!live || touches(ref.from, ref.to)) return
        const textFrom = marks[0].to
        const textTo = marks[1].from
        if (textTo <= textFrom) return
        out.push(hide.range(ref.from, textFrom), hide.range(textTo, ref.to))
        out.push(linkMark(href, external, !external && !href.startsWith('#') && !isResolved(href, path)).range(textFrom, textTo))
        return
      }
      case 'Image': {
        if (!live || touches(ref.from, ref.to) || isBlockEmbed(state, ref.from, ref.to)) return false
        const node = ref.node
        const url = node.getChild('URL')
        const marks = children(node, 'LinkMark')
        if (!url) return false
        const src = imageSrc(doc.sliceString(url.from, url.to), path)
        if (!src) return false
        const alt = marks.length >= 2 ? doc.sliceString(marks[0].to, marks[1].from) : ''
        out.push(Decoration.replace({ widget: new ImageWidget(src, alt) }).range(ref.from, ref.to))
        return false
      }
      case 'Autolink': {
        const url = ref.node.getChild('URL')
        if (!url) return false
        const href = doc.sliceString(url.from, url.to)
        if (live && !touches(ref.from, ref.to)) {
          out.push(hide.range(ref.from, url.from), hide.range(url.to, ref.to), linkMark(href, true).range(url.from, url.to))
        } else out.push(linkSourceMark(href, true).range(url.from, url.to))
        return false
      }
      case 'URL': {
        // bare URLs (GFM autolinks); URLs inside links are handled by their parent
        const parent = ref.node.parent?.name
        if (parent === 'Link' || parent === 'Image' || parent === 'Autolink' || parent === 'LinkReference') return
        const href = doc.sliceString(ref.from, ref.to)
        const full = /^www\./i.test(href) ? `https://${href}` : href
        out.push((live ? linkMark(full, true) : linkSourceMark(full, true)).range(ref.from, ref.to))
        return
      }
    }
  }

  const tree = syntaxTree(state)
  for (const { from, to } of view.visibleRanges) {
    tree.iterate({ from, to, enter: (ref) => enter(ref, from, to) })
  }
  return Decoration.set(out, true)
}

function needsRebuild(u: ViewUpdate): boolean {
  if (u.docChanged || u.viewportChanged || syntaxTree(u.state) !== syntaxTree(u.startState)) return true
  if (u.startState.facet(livePreview) !== u.state.facet(livePreview) || u.startState.facet(notePath) !== u.state.facet(notePath)) return true
  if (u.transactions.some((tr) => tr.effects.some((e) => e.is(refreshDecorations)))) return true
  if (focusChanged(u.startState, u.state)) return true
  return false
}

export const markdownDecorations = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet
    mouseDown = false
    pending = false
    private onUp = (): void => {
      if (!this.mouseDown) return
      this.mouseDown = false
      if (this.pending) {
        this.pending = false
        this.view.dispatch({ effects: refreshDecorations.of(null) })
      }
    }

    constructor(readonly view: EditorView) {
      this.decorations = build(view)
      document.addEventListener('mouseup', this.onUp, true)
    }

    update(u: ViewUpdate): void {
      if (needsRebuild(u)) {
        this.decorations = build(u.view)
        return
      }
      if (u.selectionSet && u.state.facet(livePreview)) {
        // don't reveal/hide markup while a mouse selection is in progress (avoids text jumping)
        if (this.mouseDown) this.pending = true
        else this.decorations = build(u.view)
      }
    }

    destroy(): void {
      document.removeEventListener('mouseup', this.onUp, true)
    }
  },
  {
    decorations: (v) => v.decorations,
    eventHandlers: {
      mousedown(e) {
        if (e.button === 0) this.mouseDown = true
      }
    }
  }
)
