import { describe, expect, it } from 'vitest'
import { parseMarkdown, parseCanvasLinks, PARSER_VERSION } from '@/lib/mdparse'
import { CACHE_FORMAT, changedNames, decodeCache, encodeCache, linksAffected, type CachedFile } from '@/lib/metaCache'

const NOTE = `---
tags: [alpha, "beta"]
count: 3
flag: true
list:
  - one
  - 2
---
# Title with [[Link|alias]]

Text [[Target]] and [[Other#Heading|shown]] and ![[img.png]] and [md](folder/File%20Name.md#sec "t") #tag/sub
- [ ] open task
- [x] done task

\`\`\`js
[[not a link]]
\`\`\`
## Second
`

const CANVAS = JSON.stringify({
  nodes: [
    { id: 'a', type: 'file', file: 'Notes/A.md' },
    { id: 'b', type: 'text', text: 'see [[B]] #canvas' },
    { id: 'c', type: 'form', text: 'body', fields: { f: 'x [[C|c]]' } }
  ]
})

function file(meta: CachedFile['meta'], res: CachedFile['res'] = null, unres: CachedFile['unres'] = null): CachedFile {
  return { path: meta.path, mtime: 1_700_000_000_123.4567, size: 42, meta, res, unres }
}

describe('lib/metaCache encode / decode', () => {
  it('round-trips parsed notes and canvases exactly', async () => {
    const files = [file(parseMarkdown('dir/Note.md', NOTE)), file(parseCanvasLinks('Board.canvas', CANVAS)), file(parseMarkdown('Empty.md', ''))]
    const text = await encodeCache(['dir/', 'dir/Note.md', 'Board.canvas', 'Empty.md'], files, new WeakMap())
    const back = await decodeCache(text)
    expect(back).not.toBeNull()
    for (const f of files) {
      const d = back!.files.get(f.path)!
      // strict: same keys (including undefined subpath / display of wikilinks), same values
      expect(d.meta).toStrictEqual(f.meta)
      expect(d.mtime).toBe(f.mtime)
      expect(d.size).toBe(f.size)
    }
  })

  it('stores link resolution as indexes into the path set', async () => {
    const meta = parseMarkdown('a/Src.md', '[[T]] [[T]] [[gone]] [[Folder.md]]')
    const f = file(meta, { 'b/T.md': 2, 'Folder.md': 1 }, { gone: 1 })
    const text = await encodeCache(['a/', 'a/Src.md', 'b/', 'b/T.md', 'Folder.md/'], [f], new WeakMap())
    const d = (await decodeCache(text))!.files.get('a/Src.md')!
    expect(d.res).toEqual({ 'b/T.md': 2, 'Folder.md': 1 })
    expect(d.unres).toEqual({ gone: 1 })
  })

  it('drops a resolution that points outside its path set (resolved again on load)', async () => {
    const f = file(parseMarkdown('Src.md', '[[X]]'), { 'X.md': 1 }, {})
    const d = (await decodeCache(await encodeCache(['Src.md'], [f], new WeakMap())))!.files.get('Src.md')!
    expect(d.res).toBeNull()
    expect(d.unres).toBeNull()
  })

  it('reuses memoized lines for unchanged entries', async () => {
    const f = file(parseMarkdown('A.md', '[[B]]'))
    const lines = new WeakMap<CachedFile, string>()
    await encodeCache(['A.md'], [f], lines)
    lines.set(f, '["A.md",1,2,[],[],[],null,[],0,null,null]')
    const d = (await decodeCache(await encodeCache(['A.md'], [f], lines)))!.files.get('A.md')!
    expect(d.mtime).toBe(1)
  })

  it('rejects missing, corrupt, other-format and other-parser caches', async () => {
    expect(await decodeCache(null)).toBeNull()
    expect(await decodeCache('')).toBeNull()
    expect(await decodeCache('{not json')).toBeNull()
    expect(await decodeCache(JSON.stringify({ format: CACHE_FORMAT + 1, parser: PARSER_VERSION, paths: [] }))).toBeNull()
    expect(await decodeCache(JSON.stringify({ format: CACHE_FORMAT, parser: PARSER_VERSION + 1, paths: [] }))).toBeNull()
    expect(await decodeCache(JSON.stringify({ format: CACHE_FORMAT, parser: PARSER_VERSION, paths: [] }))).toEqual({ paths: [], files: new Map() })
  })

  it('skips broken lines but keeps the rest', async () => {
    const a = file(parseMarkdown('A.md', '[[B]]'))
    const b = file(parseMarkdown('B.md', '#tag'))
    const lines = (await encodeCache(['A.md', 'B.md'], [a, b], new WeakMap())).split('\n')
    lines[1] = lines[1].slice(0, 10)
    const d = await decodeCache(lines.join('\n'))
    expect([...d!.files.keys()]).toEqual(['B.md'])
  })
})

describe('lib/metaCache path set changes', () => {
  it('lists the lower-cased names (and note stems) that were added or removed', () => {
    const names = changedNames(['a/', 'a/Keep.md', 'Gone.md', 'img.PNG'], ['a/', 'a/Keep.md', 'b/', 'b/New Note.md', 'img.PNG'])
    expect([...names].sort()).toEqual(['b', 'gone', 'gone.md', 'new note', 'new note.md'].sort())
  })

  it('treats a file turning into a folder as a change', () => {
    expect([...changedNames(['x.md'], ['x.md/'])].sort()).toEqual(['x', 'x.md'])
  })

  it('flags only links whose last segment matches a changed name', () => {
    const names = changedNames(['A.md'], ['A.md', 'sub/Target.md'])
    const links = (s: string) => parseMarkdown('Src.md', s).links
    expect(linksAffected(links('[[A]] [[Other]]'), names)).toBe(false)
    expect(linksAffected(links('[[target]]'), names)).toBe(true)
    expect(linksAffected(links('[[x/TARGET.md]]'), names)).toBe(true)
    expect(linksAffected(links('[[sub]]'), names)).toBe(false)
    expect(linksAffected(links('[[..]]'), names)).toBe(true)
    expect(linksAffected(links('[[anything]]'), new Set())).toBe(false)
  })
})
