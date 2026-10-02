import { describe, expect, it } from 'vitest'
import { parseCanvasLinks, parseFrontmatter, parseMarkdown, slugifyHeading, splitLinkText } from '@/lib/mdparse'

const parse = (src: string) => parseMarkdown('note.md', src)
const links = (src: string) => parse(src).links.map(({ link, subpath, display, embed, markdown }) => ({ link, subpath, display, embed, markdown }))
const tags = (src: string) => parse(src).tags.map((t) => t.tag)

describe('lib/mdparse splitLinkText', () => {
  it('returns the bare link when there is no subpath or alias', () => {
    expect(splitLinkText('Folder/Note')).toEqual({ link: 'Folder/Note', subpath: undefined, display: undefined })
  })
  it('splits off an alias after the pipe', () => {
    expect(splitLinkText('Note|Shown text ')).toEqual({ link: 'Note', subpath: undefined, display: 'Shown text' })
  })
  it('splits off heading and block subpaths', () => {
    expect(splitLinkText('Note#Heading')).toMatchObject({ link: 'Note', subpath: '#Heading' })
    expect(splitLinkText('Note#^abc123')).toMatchObject({ link: 'Note', subpath: '#^abc123' })
  })
  it('handles subpath and alias together', () => {
    expect(splitLinkText('Note#Head|alias')).toEqual({ link: 'Note', subpath: '#Head', display: 'alias' })
  })
  it('yields an empty link for same-document subpaths', () => {
    expect(splitLinkText('#Heading')).toMatchObject({ link: '', subpath: '#Heading' })
  })
})

describe('lib/mdparse wikilinks', () => {
  it('extracts wikilinks with line and column', () => {
    const meta = parse('first line\nsee [[Note]] here')
    expect(meta.links).toEqual([{ link: 'Note', subpath: undefined, display: undefined, line: 1, col: 4, embed: false }])
  })
  it('marks embeds', () => {
    expect(links('![[image.png]] and ![[Note#Sec]]')).toEqual([
      { link: 'image.png', subpath: undefined, display: undefined, embed: true, markdown: undefined },
      { link: 'Note', subpath: '#Sec', display: undefined, embed: true, markdown: undefined }
    ])
  })
  it('keeps aliases and subpaths', () => {
    expect(links('[[Note#Heading|alias]] [[Other#^blk]]')).toEqual([
      { link: 'Note', subpath: '#Heading', display: 'alias', embed: false, markdown: undefined },
      { link: 'Other', subpath: '#^blk', display: undefined, embed: false, markdown: undefined }
    ])
  })
  it('finds several links on one line', () => {
    expect(parse('[[A]] [[B]] [[C]]').links.map((l) => [l.link, l.col])).toEqual([
      ['A', 0],
      ['B', 6],
      ['C', 12]
    ])
  })
  it('does not span lines', () => {
    expect(parse('[[broken\nlink]]').links).toEqual([])
  })
  it('ignores links in inline code and fenced code', () => {
    expect(parse('`[[A]]` [[B]]\n```\n[[C]]\n```\n~~~\n[[D]]\n~~~\n[[E]]').links.map((l) => l.link)).toEqual(['B', 'E'])
  })
  it('only closes a fence with the same fence character', () => {
    expect(parse('```\n~~~\n[[Inside]]\n```\n[[Outside]]').links.map((l) => l.link)).toEqual(['Outside'])
  })
})

describe('lib/mdparse markdown links', () => {
  it('extracts relative markdown links', () => {
    expect(links('[text](Folder/Note.md)')).toEqual([{ link: 'Folder/Note.md', subpath: undefined, display: 'text', embed: false, markdown: true }])
  })
  it('decodes percent-encoded spaces', () => {
    expect(parse('[x](My%20Note.md)').links[0].link).toBe('My Note.md')
  })
  it('keeps the raw url when decoding fails', () => {
    expect(parse('[x](100%.md)').links[0].link).toBe('100%.md')
  })
  it('splits subpaths off markdown links', () => {
    expect(parse('[x](Note.md#Some%20Heading)').links[0]).toMatchObject({ link: 'Note.md', subpath: '#Some Heading' })
  })
  it('marks image embeds', () => {
    expect(parse('![alt](img/pic.png)').links[0]).toMatchObject({ link: 'img/pic.png', embed: true, markdown: true })
  })
  it('accepts a title after the url', () => {
    expect(parse('[x](Note.md "Title")').links[0].link).toBe('Note.md')
  })
  it('ignores external links and same-document anchors', () => {
    expect(parse('[a](https://x.com/a.md) [b](mailto:me@x.com) [c](#heading) [d](file:///c.md)').links).toEqual([])
  })
})

describe('lib/mdparse tags', () => {
  it('extracts inline tags with their line', () => {
    expect(parse('intro\nsome #tag and #other').tags).toEqual([
      { tag: 'tag', line: 1 },
      { tag: 'other', line: 1 }
    ])
  })
  it('supports nested tags, dashes, underscores and unicode', () => {
    expect(tags('#project/sub-task #snake_case #über')).toEqual(['project/sub-task', 'snake_case', 'über'])
  })
  it('allows tags after opening punctuation', () => {
    expect(tags('(#a) x,#b x;#c')).toEqual(['a', 'b', 'c'])
  })
  it('ignores purely numeric tags', () => {
    expect(tags('issue #123 but #y2024')).toEqual(['y2024'])
  })
  it('requires a boundary before the hash', () => {
    expect(tags('a#b http://x.com/#frag')).toEqual([])
  })
  it('does not treat heading markers as tags', () => {
    expect(tags('# Heading\n## Sub heading #real')).toEqual(['real'])
  })
  it('ignores tags in code spans and fenced code', () => {
    expect(tags('`#nope` #yes\n```\n#nope2\n```')).toEqual(['yes'])
  })
  it('does not treat same-document link anchors as tags', () => {
    expect(tags('[jump](#section) #real')).toEqual(['real'])
  })
})

describe('lib/mdparse headings', () => {
  it('extracts ATX headings with level and line', () => {
    expect(parse('# One\ntext\n### Three').headings).toEqual([
      { level: 1, text: 'One', line: 0 },
      { level: 3, text: 'Three', line: 2 }
    ])
  })
  it('strips closing hash sequences', () => {
    expect(parse('## Title ##').headings[0].text).toBe('Title')
  })
  it('keeps a trailing hash that is part of the text', () => {
    expect(parse('# C#').headings[0].text).toBe('C#')
  })
  it('replaces wikilinks in headings with their display text', () => {
    expect(parse('# About [[Note]] and [[Other|alias]]').headings[0].text).toBe('About Note and alias')
  })
  it('requires a space after the hashes and at most six', () => {
    expect(parse('#notheading\n####### seven').headings).toEqual([])
  })
  it('ignores headings inside code fences', () => {
    expect(parse('```bash\n# comment\n```\n# Real').headings.map((h) => h.text)).toEqual(['Real'])
  })
})

describe('lib/mdparse tasks', () => {
  it('extracts open and done tasks with any bullet', () => {
    expect(parse('- [ ] open\n* [x] done\n  + [X] nested').tasks).toEqual([
      { line: 0, done: false, text: 'open' },
      { line: 1, done: true, text: 'done' },
      { line: 2, done: true, text: 'nested' }
    ])
  })
  it('ignores plain list items', () => {
    expect(parse('- item\n- [] not a task').tasks).toEqual([])
  })
})

describe('lib/mdparse frontmatter', () => {
  it('returns null data when there is no frontmatter', () => {
    expect(parseFrontmatter('# hi')).toEqual({ data: null, endLine: -1, endOffset: 0 })
  })
  it('returns null data for unterminated frontmatter', () => {
    expect(parseFrontmatter('---\ntitle: x\nbody').data).toBeNull()
    expect(parse('---\ntags: [a]\n#body').tags.map((t) => t.tag)).toEqual(['body'])
  })
  it('parses scalars', () => {
    const { data } = parseFrontmatter('---\ntitle: "Quoted: yes"\nsingle: \'x\'\nnum: 42\nfloat: -1.5\nyes: true\nno: false\nnone: null\ntilde: ~\nempty:\nurl: http://x.com\n---\n')
    expect(data).toEqual({
      title: 'Quoted: yes',
      single: 'x',
      num: 42,
      float: -1.5,
      yes: true,
      no: false,
      none: null,
      tilde: null,
      empty: null,
      url: 'http://x.com'
    })
  })
  it('parses inline arrays and dash lists', () => {
    const { data } = parseFrontmatter('---\naliases: [One, "Two"]\ntags:\n  - a\n  - b\n# a comment\n---')
    expect(data).toEqual({ aliases: ['One', 'Two'], tags: ['a', 'b'] })
  })
  it('reports the closing line and the offset after it', () => {
    const src = '---\na: 1\nb: 2\n---\nbody'
    const fm = parseFrontmatter(src)
    expect(fm.endLine).toBe(3)
    expect(src.slice(fm.endOffset)).toBe('body')
  })
  it('handles CRLF line endings and a missing trailing newline', () => {
    expect(parseFrontmatter('---\r\na: 1\r\n---\r\nbody')).toMatchObject({ data: { a: 1 }, endLine: 2 })
    expect(parseFrontmatter('---\na: 1\n---')).toMatchObject({ data: { a: 1 }, endLine: 2, endOffset: 12 })
  })
  it('collects frontmatter tags given as a list', () => {
    expect(parse('---\ntags:\n  - one\n  - "#two"\n---\n').tags).toEqual([
      { tag: 'one', line: 0 },
      { tag: 'two', line: 0 }
    ])
  })
  it('collects frontmatter tags given as an inline array or a string', () => {
    expect(tags('---\ntags: [a, b/c]\n---\n')).toEqual(['a', 'b/c'])
    expect(tags('---\ntags: x, #y z\n---\n')).toEqual(['x', 'y', 'z'])
    expect(tags('---\ntag: solo\n---\n')).toEqual(['solo'])
  })
  it('ignores non-string frontmatter tags', () => {
    expect(tags('---\ntags: [2024, ok]\n---\n')).toEqual(['ok'])
  })
  it('keeps aliases in the frontmatter data', () => {
    expect(parse('---\naliases: Solo\n---\n').frontmatter).toEqual({ aliases: 'Solo' })
  })
  it('starts scanning the body after the frontmatter and keeps absolute line numbers', () => {
    const meta = parse('---\ntitle: "[[NotALink]] #nottag"\n---\n# Head\n[[Link]] #tag\n- [ ] task')
    expect(meta.links.map((l) => [l.link, l.line])).toEqual([['Link', 4]])
    expect(meta.tags).toEqual([{ tag: 'tag', line: 4 }])
    expect(meta.headings).toEqual([{ level: 1, text: 'Head', line: 3 }])
    expect(meta.tasks).toEqual([{ line: 5, done: false, text: 'task' }])
  })
})

describe('lib/mdparse wordCount', () => {
  it('counts words outside frontmatter and code fences', () => {
    expect(parse("---\na: b c\n---\nHello world, it's\n```\nnot counted\n```\nmore").wordCount).toBe(4)
  })
})

describe('lib/mdparse parseCanvasLinks', () => {
  const canvas = (nodes: unknown[]) => JSON.stringify({ nodes, edges: [] })

  it('links file nodes as embeds', () => {
    const meta = parseCanvasLinks('a.canvas', canvas([{ id: '1', type: 'file', file: 'notes/B.md' }]))
    expect(meta.links).toEqual([{ link: 'notes/B.md', line: 0, col: 0, embed: true, markdown: true }])
  })
  it('extracts links and tags from text nodes', () => {
    const meta = parseCanvasLinks('a.canvas', canvas([{ id: '1', type: 'text', text: 'line\n[[Note|x]] #tag' }]))
    expect(meta.links).toMatchObject([{ link: 'Note', display: 'x', line: 0 }])
    expect(meta.tags).toEqual([{ tag: 'tag', line: 0 }])
  })
  it('extracts links from form nodes text and string fields', () => {
    const meta = parseCanvasLinks(
      'm.formmap',
      canvas([{ id: '1', type: 'form', text: '[[Body]]', fields: { note: '[[Linked]]', title: 'plain', n: 3, list: ['[[No]]'] } }])
    )
    expect(meta.links.map((l) => l.link)).toEqual(['Body', 'Linked'])
  })
  it('ignores other node types and links without targets', () => {
    const meta = parseCanvasLinks('a.canvas', canvas([{ id: '1', type: 'link', url: 'https://x' }, { id: '2', type: 'group' }, { id: '3', type: 'file' }]))
    expect(meta.links).toEqual([])
  })
  it('returns an empty meta for invalid json', () => {
    expect(parseCanvasLinks('a.canvas', '{nope')).toEqual({ path: 'a.canvas', links: [], tags: [], headings: [], frontmatter: null, tasks: [], wordCount: 0 })
    expect(parseCanvasLinks('a.canvas', '{}').links).toEqual([])
  })
  it('skips null nodes and keeps the links of the nodes after them', () => {
    const src = JSON.stringify({ nodes: [null, 3, { id: '1', type: 'file', file: 'B.md' }], edges: [] })
    expect(parseCanvasLinks('a.canvas', src).links.map((l) => l.link)).toEqual(['B.md'])
  })
  it('tolerates a non-array nodes field and a null document', () => {
    expect(parseCanvasLinks('a.canvas', '{"nodes":{}}').links).toEqual([])
    expect(parseCanvasLinks('a.canvas', 'null').links).toEqual([])
  })
})

describe('lib/mdparse slugifyHeading', () => {
  it('lowercases, drops punctuation and dashes whitespace', () => {
    expect(slugifyHeading('  Hello, World!  Again ')).toBe('hello-world-again')
    expect(slugifyHeading('Ünïcode 123-x')).toBe('ünïcode-123-x')
  })
})
