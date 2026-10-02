import { beforeEach, describe, expect, it } from 'vitest'
import { loadTestVault } from '../../../helpers/vault'
import { buildGraph, buildLocalGraph, matchQuery, parseQuery, type BuildOptions, type GraphData, type GraphNodeData, type LocalBuildOptions } from '@/views/graph/data'

const VAULT: Record<string, string> = {
  'A.md': 'Links [[B]] and [[C]] and [[Missing]] and ![[img.png]] #project/alpha #Shared',
  'B.md': 'Back to [[A]] #shared',
  'C.md': 'no outgoing links',
  'Orphan.md': 'alone',
  'folder/D.md': '[[B]] [[missing]] [[folder/E]]',
  'folder/E.md': '[[Far]] #deep',
  'map.canvas': JSON.stringify({ nodes: [{ id: 'f', type: 'file', file: 'C.md', x: 0, y: 0, width: 1, height: 1 }], edges: [] }),
  'img.png': '',
  'doc.pdf': ''
}

const base: BuildOptions = { showTags: false, showAttachments: false, existingOnly: false, showOrphans: true, search: '', groups: [] }
const local: LocalBuildOptions = { depth: 1, showTags: false, showAttachments: true, neighborLinks: true, groups: [] }

const nodeIds = (g: GraphData | null): string[] => (g ? g.nodes.map((n) => n.id).sort() : [])
const link = (g: GraphData, a: string, b: string) => g.links.find((l) => (l.source === a && l.target === b) || (l.source === b && l.target === a))

beforeEach(async () => {
  await loadTestVault(VAULT)
})

describe('views/graph/data parseQuery', () => {
  it('splits words, quoted phrases, field prefixes and negation', () => {
    expect(parseQuery('Foo "two words" -bar path:Dir file:x tag:#T')).toEqual([
      { neg: false, field: 'any', value: 'foo' },
      { neg: false, field: 'any', value: 'two words' },
      { neg: true, field: 'any', value: 'bar' },
      { neg: false, field: 'path', value: 'dir' },
      { neg: false, field: 'file', value: 'x' },
      { neg: false, field: 'tag', value: 't' }
    ])
  })

  it('treats a bare #word as a tag term', () => {
    expect(parseQuery('#Proj')).toEqual([{ neg: false, field: 'tag', value: 'proj' }])
    expect(parseQuery('-#x')).toEqual([{ neg: true, field: 'tag', value: 'x' }])
  })

  it('returns no terms for blank queries and empty quotes', () => {
    expect(parseQuery('')).toEqual([])
    expect(parseQuery('   ')).toEqual([])
    expect(parseQuery('""')).toEqual([])
  })

  it('is stateless across calls (global regex is reset)', () => {
    expect(parseQuery('a b')).toHaveLength(2)
    expect(parseQuery('a b')).toHaveLength(2)
  })
})

describe('views/graph/data matchQuery', () => {
  const note: GraphNodeData = { id: 'x/Note.md', kind: 'note', label: 'Note', path: 'x/Note.md' }
  const tag: GraphNodeData = { id: 'tag:proj/a', kind: 'tag', label: '#Proj/A', tag: 'Proj/A' }
  const unres: GraphNodeData = { id: 'unresolved:ghost', kind: 'unresolved', label: 'Ghost', link: 'Ghost' }
  const tagsOf = (p: string): string[] => (p === 'x/Note.md' ? ['proj/a'] : [])

  it('matches files by path, file name and tag (including nested tags)', () => {
    expect(matchQuery(note, parseQuery('x/no'), tagsOf)).toBe(true)
    expect(matchQuery(note, parseQuery('file:x/'), tagsOf)).toBe(false)
    expect(matchQuery(note, parseQuery('file:note'), tagsOf)).toBe(true)
    expect(matchQuery(note, parseQuery('tag:proj'), tagsOf)).toBe(true)
    expect(matchQuery(note, parseQuery('tag:pro'), tagsOf)).toBe(false)
  })

  it('matches tag nodes by tag name and #text', () => {
    expect(matchQuery(tag, parseQuery('#proj'), tagsOf)).toBe(true)
    expect(matchQuery(tag, parseQuery('#pr'), tagsOf)).toBe(false)
    expect(matchQuery(tag, parseQuery('proj/a'), tagsOf)).toBe(true)
    expect(matchQuery(tag, parseQuery('path:proj'), tagsOf)).toBe(false)
  })

  it('matches unresolved nodes by link text but never by tag', () => {
    expect(matchQuery(unres, parseQuery('gho'), tagsOf)).toBe(true)
    expect(matchQuery(unres, parseQuery('tag:ghost'), tagsOf)).toBe(false)
  })

  it('requires every term and honours negation', () => {
    expect(matchQuery(note, parseQuery('note -x/'), tagsOf)).toBe(false)
    expect(matchQuery(note, parseQuery('note -zzz'), tagsOf)).toBe(true)
    expect(matchQuery(note, [], tagsOf)).toBe(true)
  })
})

describe('views/graph/data buildGraph', () => {
  it('creates nodes for notes and canvases with readable labels', () => {
    const g = buildGraph(base)
    const byId = new Map(g.nodes.map((n) => [n.id, n]))
    expect(byId.get('folder/D.md')).toMatchObject({ kind: 'note', label: 'D', path: 'folder/D.md' })
    expect(byId.get('map.canvas')).toMatchObject({ kind: 'canvas', label: 'map.canvas' })
  })

  it('deduplicates links between two notes and records both directions', () => {
    const g = buildGraph(base)
    const ab = g.links.filter((l) => [l.source, l.target].sort().join() === 'A.md,B.md')
    expect(ab).toHaveLength(1)
    expect(ab[0]).toMatchObject({ kind: 'link', dir: 3 })
    const ac = link(g, 'A.md', 'C.md')!
    // source is the lexicographically smaller id; dir 1 = source→target
    expect(ac).toMatchObject({ source: 'A.md', target: 'C.md', dir: 1 })
    const dB = link(g, 'folder/D.md', 'B.md')!
    expect(dB).toMatchObject({ source: 'B.md', target: 'folder/D.md', dir: 2 })
  })

  it('links canvases to the files they embed', () => {
    expect(link(buildGraph(base), 'map.canvas', 'C.md')).toBeDefined()
  })

  it('merges unresolved links case-insensitively into one node', () => {
    const g = buildGraph(base)
    const missing = g.nodes.filter((n) => n.kind === 'unresolved' && n.id === 'unresolved:missing')
    expect(missing).toHaveLength(1)
    expect(link(g, 'A.md', 'unresolved:missing')).toMatchObject({ kind: 'unresolved' })
    expect(link(g, 'folder/D.md', 'unresolved:missing')).toBeDefined()
  })

  it('hides unresolved links with existingOnly', () => {
    const g = buildGraph({ ...base, existingOnly: true })
    expect(g.nodes.some((n) => n.kind === 'unresolved')).toBe(false)
    expect(g.links.some((l) => l.kind === 'unresolved')).toBe(false)
  })

  it('shows linked attachments only when enabled, never unlinked ones', () => {
    expect(nodeIds(buildGraph(base))).not.toContain('img.png')
    const g = buildGraph({ ...base, showAttachments: true })
    expect(g.nodes.find((n) => n.id === 'img.png')).toMatchObject({ kind: 'attachment', label: 'img.png' })
    expect(link(g, 'A.md', 'img.png')).toBeDefined()
    expect(nodeIds(g)).not.toContain('doc.pdf')
  })

  it('adds tag nodes merged case-insensitively with undirected links when enabled', () => {
    expect(buildGraph(base).nodes.some((n) => n.kind === 'tag')).toBe(false)
    const g = buildGraph({ ...base, showTags: true })
    const shared = g.nodes.filter((n) => n.id === 'tag:shared')
    expect(shared).toHaveLength(1)
    expect(shared[0]).toMatchObject({ kind: 'tag', tag: 'Shared', label: '#Shared' })
    expect(link(g, 'A.md', 'tag:shared')).toMatchObject({ kind: 'tag', dir: 0 })
    expect(link(g, 'B.md', 'tag:shared')).toBeDefined()
    expect(nodeIds(g)).toContain('tag:project/alpha')
  })

  it('keeps orphans by default and drops them when showOrphans is off', () => {
    expect(nodeIds(buildGraph(base))).toContain('Orphan.md')
    const g = buildGraph({ ...base, showOrphans: false })
    expect(nodeIds(g)).not.toContain('Orphan.md')
    expect(nodeIds(g)).toContain('C.md')
  })

  it('counts a note whose only links are hidden (unresolved with existingOnly) as an orphan', async () => {
    await loadTestVault({ 'Lone.md': '[[Ghost]]', 'X.md': '[[Y]]', 'Y.md': '' })
    expect(nodeIds(buildGraph({ ...base, showOrphans: false }))).toEqual(['Lone.md', 'X.md', 'Y.md', 'unresolved:ghost'])
    expect(nodeIds(buildGraph({ ...base, showOrphans: false, existingOnly: true }))).toEqual(['X.md', 'Y.md'])
  })

  it('filters by search, keeping tags/attachments/unresolved links of matching notes', () => {
    const g = buildGraph({ ...base, showTags: true, showAttachments: true, search: 'path:a.md' })
    expect(nodeIds(g)).toEqual(['A.md', 'img.png', 'tag:project/alpha', 'tag:shared', 'unresolved:missing'].sort())
    // links to filtered-out notes are removed
    expect(g.links.every((l) => nodeIds(g).includes(l.source) && nodeIds(g).includes(l.target))).toBe(true)
  })

  it('filters by tag search, matching nested tags', () => {
    const g = buildGraph({ ...base, search: 'tag:project' })
    expect(nodeIds(g)).toEqual(['A.md', 'unresolved:missing'])
  })

  it('supports negated search terms', () => {
    const ids = nodeIds(buildGraph({ ...base, existingOnly: true, search: '-folder/' }))
    expect(ids).toContain('A.md')
    expect(ids.some((id) => id.startsWith('folder/'))).toBe(false)
  })

  it('colors nodes by the first matching group and ignores empty group queries', () => {
    const g = buildGraph({
      ...base,
      showTags: true,
      groups: [
        { query: '', color: '#000000' },
        { query: 'path:folder/', color: '#ff0000' },
        { query: 'tag:shared', color: '#00ff00' },
        { query: 'folder', color: '#0000ff' }
      ]
    })
    const color = (id: string) => g.nodes.find((n) => n.id === id)!.groupColor
    expect(color('folder/D.md')).toBe('#ff0000')
    expect(color('B.md')).toBe('#00ff00')
    expect(color('tag:shared')).toBe('#00ff00')
    expect(color('C.md')).toBeUndefined()
  })

  it('does not link a note to itself', async () => {
    await loadTestVault({ 'Self.md': '[[Self]]' })
    const g = buildGraph(base)
    expect(g.links).toEqual([])
    expect(nodeIds(g)).toEqual(['Self.md'])
  })

  it('returns an empty graph for an empty vault', async () => {
    await loadTestVault({})
    expect(buildGraph(base)).toEqual({ nodes: [], links: [] })
  })
})

describe('views/graph/data buildLocalGraph', () => {
  it('returns null for unknown files and folders', () => {
    expect(buildLocalGraph('nope.md', local)).toBeNull()
    expect(buildLocalGraph('folder', local)).toBeNull()
  })

  it('collects direct neighbours at depth 1 (in- and outgoing)', () => {
    expect(nodeIds(buildLocalGraph('B.md', local))).toEqual(['A.md', 'B.md', 'folder/D.md'])
  })

  it('returns just the center at depth 0', () => {
    expect(nodeIds(buildLocalGraph('B.md', { ...local, depth: 0 }))).toEqual(['B.md'])
  })

  it('expands further with larger depth', () => {
    const ids = nodeIds(buildLocalGraph('B.md', { ...local, depth: 2 }))
    expect(ids).toEqual(expect.arrayContaining(['C.md', 'img.png', 'unresolved:missing', 'folder/E.md']))
    expect(ids).not.toContain('Orphan.md')
  })

  it('always includes unresolved neighbours', () => {
    expect(nodeIds(buildLocalGraph('folder/E.md', local))).toEqual(['folder/D.md', 'folder/E.md', 'unresolved:far'])
  })

  it('hides attachments unless enabled', () => {
    expect(nodeIds(buildLocalGraph('A.md', local))).toContain('img.png')
    expect(nodeIds(buildLocalGraph('A.md', { ...local, showAttachments: false }))).not.toContain('img.png')
  })

  it('can center on an attachment even with attachments hidden', () => {
    const g = buildLocalGraph('img.png', { ...local, showAttachments: false })
    expect(nodeIds(g)).toEqual(['A.md', 'img.png'])
    expect(g!.nodes.find((n) => n.id === 'img.png')!.kind).toBe('attachment')
  })

  it('makes an unlinked attachment a single-node graph', () => {
    expect(nodeIds(buildLocalGraph('doc.pdf', local))).toEqual(['doc.pdf'])
  })

  it('treats tag nodes as leaves: notes sharing only a tag are not pulled in', async () => {
    await loadTestVault({ 'P.md': '#t', 'Q.md': '#t' })
    const g = buildLocalGraph('P.md', { ...local, depth: 3, showTags: true })
    expect(nodeIds(g)).toEqual(['P.md', 'tag:t'])
  })

  it('drops links between same-depth neighbours when neighborLinks is off', async () => {
    await loadTestVault({ 'Hub.md': '[[X]] [[Y]]', 'X.md': '[[Y]]', 'Y.md': '' })
    const withLinks = buildLocalGraph('Hub.md', local)!
    const without = buildLocalGraph('Hub.md', { ...local, neighborLinks: false })!
    expect(nodeIds(without)).toEqual(['Hub.md', 'X.md', 'Y.md'])
    expect(link(withLinks, 'X.md', 'Y.md')).toBeDefined()
    expect(link(without, 'X.md', 'Y.md')).toBeUndefined()
    expect(link(without, 'Hub.md', 'X.md')).toBeDefined()
  })

  it('applies group colors to local graph nodes', () => {
    const g = buildLocalGraph('B.md', { ...local, groups: [{ query: 'file:a.md', color: 'red' }] })!
    expect(g.nodes.find((n) => n.id === 'A.md')!.groupColor).toBe('red')
    expect(g.nodes.find((n) => n.id === 'B.md')!.groupColor).toBeUndefined()
  })
})
