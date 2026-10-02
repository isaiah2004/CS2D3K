import { describe, expect, it, vi } from 'vitest'
import { parser as baseParser, GFM } from '@lezer/markdown'
import { obsidianExtensions } from '@/views/markdown/editor/syntax'

// editor tests build real CodeMirror views: give them headroom on a loaded full-suite run
vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 })

const parser = baseParser.configure([GFM, ...obsidianExtensions])

/** "Name[text]" for every node of the given names. */
function nodes(doc: string, ...names: string[]): string[] {
  const out: string[] = []
  parser.parse(doc).iterate({
    enter(n) {
      if (names.includes(n.name)) out.push(`${n.name}[${doc.slice(n.from, n.to)}]`)
    }
  })
  return out
}

describe('views/markdown/editor/syntax wikilinks', () => {
  it('parses [[target]] into marks and a target', () => {
    expect(nodes('see [[Note]] now', 'WikiLink', 'WikiMark', 'WikiTarget')).toEqual(['WikiLink[[[Note]]]', 'WikiMark[[[]', 'WikiTarget[Note]', 'WikiMark[]]]'])
  })

  it('splits [[target|alias]] at the pipe', () => {
    expect(nodes('[[a/b#h|Shown]]', 'WikiTarget', 'WikiPipe', 'WikiAlias')).toEqual(['WikiTarget[a/b#h]', 'WikiPipe[|]', 'WikiAlias[Shown]'])
  })

  it('parses ![[embeds]] as Embed', () => {
    expect(nodes('![[img.png|200]]', 'Embed', 'WikiLink', 'WikiTarget')).toEqual(['Embed[![[img.png|200]]]', 'WikiTarget[img.png]'])
  })

  it('rejects empty, unclosed, multi-line and nested-open links', () => {
    expect(nodes('[[]]', 'WikiLink')).toEqual([])
    expect(nodes('[[open', 'WikiLink')).toEqual([])
    expect(nodes('[[a\nb]]', 'WikiLink')).toEqual([])
    expect(nodes('[[a [[b]]', 'WikiLink')).toEqual(['WikiLink[[[b]]]'])
    expect(nodes('! [[x]]', 'Embed')).toEqual([])
  })

  it('takes precedence over markdown links', () => {
    expect(nodes('[[x]](y)', 'WikiLink', 'Link')).toEqual(['WikiLink[[[x]]]'])
  })

  it('is not parsed inside inline code', () => {
    expect(nodes('`[[x]]`', 'WikiLink')).toEqual([])
  })
})

describe('views/markdown/editor/syntax highlight', () => {
  it('parses ==text== with marks', () => {
    expect(nodes('a ==hi there== b', 'Highlight', 'HighlightMark')).toEqual(['Highlight[==hi there==]', 'HighlightMark[==]', 'HighlightMark[==]'])
  })

  it('needs non-space content next to the delimiters and exactly two equals signs', () => {
    expect(nodes('a == b == c', 'Highlight')).toEqual([])
    expect(nodes('===x===', 'Highlight')).toEqual([])
    expect(nodes('==unclosed', 'Highlight')).toEqual([])
  })
})

describe('views/markdown/editor/syntax hashtags', () => {
  it('parses #tags with nested paths, dashes and underscores', () => {
    expect(nodes('#tag and #a/b-c_d.', 'Hashtag')).toEqual(['Hashtag[#tag]', 'Hashtag[#a/b-c_d]'])
  })

  it('supports unicode letters', () => {
    expect(nodes('#über #日本', 'Hashtag')).toEqual(['Hashtag[#über]', 'Hashtag[#日本]'])
  })

  it('requires at least one non-digit', () => {
    expect(nodes('#123 #1a', 'Hashtag')).toEqual(['Hashtag[#1a]'])
  })

  it('only starts after whitespace, ( , or ;', () => {
    expect(nodes('a#b (#c ,#d ;#e', 'Hashtag')).toEqual(['Hashtag[#c]', 'Hashtag[#d]', 'Hashtag[#e]'])
  })

  it('does not treat headings or code as tags', () => {
    expect(nodes('# Heading', 'Hashtag')).toEqual([])
    expect(nodes('`#x`', 'Hashtag')).toEqual([])
  })
})

describe('views/markdown/editor/syntax %% comments', () => {
  it('parses inline %%comments%% with marks', () => {
    expect(nodes('a %%secret%% b', 'PercentComment', 'PercentCommentMark')).toEqual(['PercentComment[%%secret%%]', 'PercentCommentMark[%%]', 'PercentCommentMark[%%]'])
  })

  it('ignores an unclosed %%', () => {
    expect(nodes('a %%open', 'PercentComment')).toEqual([])
  })

  it('hides emphasis inside a comment', () => {
    expect(nodes('%%*x*%%', 'Emphasis')).toEqual([])
  })
})

describe('views/markdown/editor/syntax frontmatter', () => {
  it('parses a --- block on the first line up to the closing ---', () => {
    const doc = '---\na: 1\n---\nbody'
    expect(nodes(doc, 'Frontmatter', 'FrontmatterMark')).toEqual(['Frontmatter[---\na: 1\n---]', 'FrontmatterMark[---]', 'FrontmatterMark[---]'])
    expect(nodes(doc, 'Paragraph')).toEqual(['Paragraph[body]'])
  })

  it('accepts ... as the closing fence', () => {
    expect(nodes('---\na: 1\n...\nbody', 'Frontmatter')).toEqual(['Frontmatter[---\na: 1\n...]'])
  })

  it('does not swallow the closing fence as a setext heading or rule', () => {
    expect(nodes('---\ntitle\n---\n', 'SetextHeading2', 'HorizontalRule')).toEqual([])
  })

  it('only applies at the very start of the document', () => {
    expect(nodes('text\n\n---\na: 1\n---', 'Frontmatter')).toEqual([])
    expect(nodes(' ---\na\n---', 'Frontmatter')).toEqual([])
  })
})
