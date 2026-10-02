// Lezer markdown extensions for Obsidian flavoured syntax:
// [[wikilinks]], ![[embeds]], ==highlight==, #tags, %%comments%% and YAML frontmatter.
import type { MarkdownConfig, InlineContext, BlockContext, Line, DelimiterType } from '@lezer/markdown'
import { Tag, tags as t } from '@lezer/highlight'

export const mdTags = {
  wikilink: Tag.define(t.link),
  embed: Tag.define(t.link),
  highlight: Tag.define(),
  hashtag: Tag.define(),
  frontmatter: Tag.define(t.meta)
}

const OPEN_BRACKET = 91 // [
const BANG = 33 // !
const HASH = 35 // #
const EQUALS = 61 // =
const PERCENT = 37 // %

function parseWikiLink(cx: InlineContext, next: number, pos: number): number {
  const start = pos
  const embed = next === BANG
  if (embed) {
    if (cx.char(pos + 1) !== OPEN_BRACKET || cx.char(pos + 2) !== OPEN_BRACKET) return -1
    pos++
  } else if (next !== OPEN_BRACKET || cx.char(pos + 1) !== OPEN_BRACKET) return -1
  const innerFrom = pos + 2
  const rest = cx.slice(innerFrom, Math.min(cx.end, innerFrom + 1000))
  const close = rest.indexOf(']]')
  if (close < 1) return -1
  const inner = rest.slice(0, close)
  if (inner.includes('\n') || inner.includes('[[')) return -1
  const innerTo = innerFrom + close
  const children = [cx.elt('WikiMark', start, innerFrom)]
  const pipe = inner.indexOf('|')
  if (pipe >= 0) {
    children.push(
      cx.elt('WikiTarget', innerFrom, innerFrom + pipe),
      cx.elt('WikiPipe', innerFrom + pipe, innerFrom + pipe + 1),
      cx.elt('WikiAlias', innerFrom + pipe + 1, innerTo)
    )
  } else children.push(cx.elt('WikiTarget', innerFrom, innerTo))
  children.push(cx.elt('WikiMark', innerTo, innerTo + 2))
  return cx.addElement(cx.elt(embed ? 'Embed' : 'WikiLink', start, innerTo + 2, children))
}

export const WikiLinks: MarkdownConfig = {
  defineNodes: [
    { name: 'WikiLink', style: { 'WikiLink/...': mdTags.wikilink } },
    { name: 'Embed', style: { 'Embed/...': mdTags.embed } },
    { name: 'WikiMark', style: t.processingInstruction },
    { name: 'WikiPipe', style: t.processingInstruction },
    { name: 'WikiTarget' },
    { name: 'WikiAlias' }
  ],
  parseInline: [{ name: 'WikiLink', parse: parseWikiLink, before: 'Link' }]
}

const HighlightDelim: DelimiterType = { resolve: 'Highlight', mark: 'HighlightMark' }

export const Highlight: MarkdownConfig = {
  defineNodes: [
    { name: 'Highlight', style: { 'Highlight/...': mdTags.highlight } },
    { name: 'HighlightMark', style: t.processingInstruction }
  ],
  parseInline: [
    {
      name: 'Highlight',
      parse(cx, next, pos) {
        if (next !== EQUALS || cx.char(pos + 1) !== EQUALS || cx.char(pos + 2) === EQUALS) return -1
        if (pos > cx.offset && cx.char(pos - 1) === EQUALS) return -1
        const before = cx.slice(pos - 1, pos)
        const after = cx.slice(pos + 2, pos + 3)
        const sBefore = /\s|^$/.test(before)
        const sAfter = /\s|^$/.test(after)
        return cx.addDelimiter(HighlightDelim, pos, pos + 2, !sAfter, !sBefore)
      },
      after: 'Emphasis'
    }
  ]
}

const TAG_RE = /^#([\p{L}\p{N}_\-/]*[\p{L}_\-/][\p{L}\p{N}_\-/]*)/u

export const Hashtags: MarkdownConfig = {
  defineNodes: [{ name: 'Hashtag', style: mdTags.hashtag }],
  parseInline: [
    {
      name: 'Hashtag',
      parse(cx, next, pos) {
        if (next !== HASH) return -1
        if (pos > cx.offset && !/[\s(,;]/.test(cx.slice(pos - 1, pos))) return -1
        const m = TAG_RE.exec(cx.slice(pos, Math.min(cx.end, pos + 200)))
        if (!m) return -1
        return cx.addElement(cx.elt('Hashtag', pos, pos + m[0].length))
      },
      after: 'Emphasis'
    }
  ]
}

export const PercentComments: MarkdownConfig = {
  defineNodes: [
    { name: 'PercentComment', style: { 'PercentComment/...': t.comment } },
    { name: 'PercentCommentMark', style: t.processingInstruction }
  ],
  parseInline: [
    {
      name: 'PercentComment',
      parse(cx, next, pos) {
        if (next !== PERCENT || cx.char(pos + 1) !== PERCENT) return -1
        const close = cx.slice(pos + 2, cx.end).indexOf('%%')
        if (close < 0) return -1
        const end = pos + 2 + close + 2
        return cx.addElement(cx.elt('PercentComment', pos, end, [cx.elt('PercentCommentMark', pos, pos + 2), cx.elt('PercentCommentMark', end - 2, end)]))
      },
      before: 'Emphasis'
    }
  ]
}

/** YAML frontmatter: `---` on the very first line up to the next `---` / `...` line. */
export const Frontmatter: MarkdownConfig = {
  defineNodes: [
    { name: 'Frontmatter', block: true, style: { 'Frontmatter/...': mdTags.frontmatter } },
    { name: 'FrontmatterMark', style: t.processingInstruction }
  ],
  parseBlock: [
    {
      name: 'Frontmatter',
      parse(cx: BlockContext, line: Line) {
        if (cx.lineStart !== 0 || !/^---\s*$/.test(line.text)) return false
        const marks = [cx.elt('FrontmatterMark', 0, 3)]
        while (cx.nextLine()) {
          if (/^(---|\.\.\.)\s*$/.test(line.text)) {
            marks.push(cx.elt('FrontmatterMark', cx.lineStart, cx.lineStart + 3))
            cx.nextLine()
            break
          }
        }
        cx.addElement(cx.elt('Frontmatter', 0, cx.prevLineEnd(), marks))
        return true
      },
      before: 'HorizontalRule'
    }
  ]
}

export const obsidianExtensions = [Frontmatter, WikiLinks, Highlight, Hashtags, PercentComments]
