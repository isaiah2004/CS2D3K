import { describe, expect, it } from 'vitest'
import { loadTestVault } from '../../helpers/vault'
import { useMetadata, resolveLink, linkTextFor, getBacklinks, getAllTags, getMeta } from '@/store/metadata'
import { useVault } from '@/store/vault'
import type { FileEntry } from '@shared/types'

const fileEntry = (path: string): FileEntry => ({
  path,
  name: path.split('/').pop()!,
  isDir: false,
  ext: path.includes('.') ? path.slice(path.lastIndexOf('.') + 1).toLowerCase() : '',
  mtime: 1,
  ctime: 1,
  size: 0
})

describe('store/metadata resolveLink', () => {
  it('prefers a file relative to the source folder over one at the vault root', async () => {
    await loadTestVault({ 'Note.md': '', 'a/Note.md': '', 'a/Src.md': '', 'Root.md': '' })
    expect(resolveLink('Note', 'a/Src.md')).toBe('a/Note.md')
    expect(resolveLink('Note', 'Root.md')).toBe('Note.md')
  })

  it('resolves ./ and ../ relative paths', async () => {
    await loadTestVault({ 'a/b/Src.md': '', 'a/Up.md': '', 'a/b/Here.md': '', 'Up.md': '' })
    expect(resolveLink('../Up', 'a/b/Src.md')).toBe('a/Up.md')
    expect(resolveLink('../Up.md', 'a/b/Src.md')).toBe('a/Up.md')
    expect(resolveLink('./Here', 'a/b/Src.md')).toBe('a/b/Here.md')
  })

  it('resolves vault-absolute paths (with or without leading slash, backslashes)', async () => {
    await loadTestVault({ 'docs/guide/Intro.md': '', 'other/Src.md': '' })
    expect(resolveLink('docs/guide/Intro', 'other/Src.md')).toBe('docs/guide/Intro.md')
    expect(resolveLink('/docs/guide/Intro.md', 'other/Src.md')).toBe('docs/guide/Intro.md')
    expect(resolveLink('docs\\guide\\Intro', 'other/Src.md')).toBe('docs/guide/Intro.md')
  })

  it('falls back to a case-insensitive basename lookup anywhere in the vault', async () => {
    await loadTestVault({ 'deep/er/Target Note.md': '', 'Src.md': '' })
    expect(resolveLink('Target Note', 'Src.md')).toBe('deep/er/Target Note.md')
    expect(resolveLink('target note', 'Src.md')).toBe('deep/er/Target Note.md')
    expect(resolveLink('TARGET NOTE.md', 'Src.md')).toBe('deep/er/Target Note.md')
  })

  it('picks the shallowest, then shortest path when a name is ambiguous', async () => {
    await loadTestVault({ 'x/y/Dup.md': '', 'zzzz/Dup.md': '', 'z/Dup.md': '', 'Src.md': '' })
    expect(resolveLink('Dup', 'Src.md')).toBe('z/Dup.md')
  })

  it('uses folder hints to disambiguate [[folder/Note]]', async () => {
    await loadTestVault({ 'b/Note.md': '', 'a/folder/Note.md': '', 'Src.md': '' })
    expect(resolveLink('folder/Note', 'Src.md')).toBe('a/folder/Note.md')
    expect(resolveLink('Folder/note', 'Src.md')).toBe('a/folder/Note.md')
    // no matching folder: still falls back to the best name match
    expect(resolveLink('nope/Note', 'Src.md')).toBe('b/Note.md')
  })

  it('only matches folder hints on a whole path segment', async () => {
    // regression: "xfolder/Note.md" ends with "folder/note.md" as a plain string
    await loadTestVault({ 'xfolder/Note.md': '', 'deep/folder/Note.md': '', 'Src.md': '' })
    expect(resolveLink('folder/Note', 'Src.md')).toBe('deep/folder/Note.md')
  })

  it('makes the .md extension optional but requires it for other files', async () => {
    await loadTestVault({ 'Note.md': '', 'assets/img.png': 'x', 'data.csv': '', 'Src.md': '' })
    expect(resolveLink('Note', 'Src.md')).toBe('Note.md')
    expect(resolveLink('Note.md', 'Src.md')).toBe('Note.md')
    expect(resolveLink('img.png', 'Src.md')).toBe('assets/img.png')
    expect(resolveLink('assets/img.png', 'Src.md')).toBe('assets/img.png')
    expect(resolveLink('img', 'Src.md')).toBeNull()
    expect(resolveLink('data.csv', 'Src.md')).toBe('data.csv')
  })

  it('handles dots in note names and never resolves to a folder', async () => {
    await loadTestVault({ 'v1.2 notes.md': '', 'Proj/inner.md': '', 'Src.md': '' })
    expect(resolveLink('v1.2 notes', 'Src.md')).toBe('v1.2 notes.md')
    expect(resolveLink('Proj', 'Src.md')).toBeNull()
  })

  it('prefers Note.md over a folder with the same name', async () => {
    await loadTestVault({ 'Proj.md': '', 'Proj/inner.md': '', 'Src.md': '' })
    expect(resolveLink('Proj', 'Src.md')).toBe('Proj.md')
  })

  it('returns the source itself for an empty link (e.g. [[#Heading]]) and null for unknown links', async () => {
    await loadTestVault({ 'Src.md': '' })
    expect(resolveLink('', 'Src.md')).toBe('Src.md')
    expect(resolveLink('', '')).toBeNull()
    expect(resolveLink('Missing', 'Src.md')).toBeNull()
  })
})

describe('store/metadata linkTextFor', () => {
  it('uses the bare name when unique, keeps the extension for non-markdown files', async () => {
    await loadTestVault({ 'deep/Unique.md': '', 'img/pic.png': 'x' })
    expect(linkTextFor('deep/Unique.md')).toBe('Unique')
    expect(linkTextFor('img/pic.png')).toBe('pic.png')
  })

  it('uses the bare name for the shortest of ambiguous files and the full path otherwise', async () => {
    await loadTestVault({ 'Dup.md': '', 'sub/Dup.md': '', 'a/pic.png': 'x', 'b/c/pic.png': 'x' })
    expect(linkTextFor('Dup.md')).toBe('Dup')
    expect(linkTextFor('sub/Dup.md')).toBe('sub/Dup')
    expect(linkTextFor('a/pic.png')).toBe('pic.png')
    expect(linkTextFor('b/c/pic.png')).toBe('b/c/pic.png')
  })

  it('generates link text that resolves back to the target', async () => {
    await loadTestVault({ 'Dup.md': '', 'sub/Dup.md': '', 'other/Src.md': '' })
    for (const p of ['Dup.md', 'sub/Dup.md']) expect(resolveLink(linkTextFor(p), 'other/Src.md')).toBe(p)
  })
})

describe('store/metadata index', () => {
  it('indexes markdown, canvas and formmap files with resolved / unresolved counts', async () => {
    await loadTestVault({
      'A.md': '[[B]] [[B#H]] ![[B]] [[Missing]] [[Missing|x]] [md](B.md) [ext](https://x.org) [anchor](#h)',
      'B.md': '# H',
      'map.canvas': JSON.stringify({ nodes: [{ id: '1', type: 'file', file: 'B.md' }, { id: '2', type: 'text', text: 'see [[A]] and [[Nope]]' }], edges: [] }),
      'f.formmap': JSON.stringify({ nodes: [{ id: '1', type: 'form', text: '[[A]]', fields: { owner: '[[B]]', plain: 'no link' } }], edges: [] }),
      'code.ts': '[[A]]'
    })
    const { resolved, unresolved, metas, ready } = useMetadata.getState()
    expect(ready).toBe(true)
    expect(resolved['A.md']).toEqual({ 'B.md': 4 })
    expect(unresolved['A.md']).toEqual({ Missing: 2 })
    expect(resolved['map.canvas']).toEqual({ 'B.md': 1, 'A.md': 1 })
    expect(unresolved['map.canvas']).toEqual({ Nope: 1 })
    expect(resolved['f.formmap']).toEqual({ 'A.md': 1, 'B.md': 1 })
    expect(metas['code.ts']).toBeUndefined()
    expect(getMeta('B.md')?.headings).toEqual([{ level: 1, text: 'H', line: 0 }])
  })

  it('getBacklinks lists other sources with counts, sorted, excluding self links', async () => {
    await loadTestVault({
      'z.md': '[[T]] [[T]]',
      'a.md': '[[T]]',
      'T.md': '[[T]] [[#Self]]',
      'm.canvas': JSON.stringify({ nodes: [{ id: '1', type: 'file', file: 'T.md' }], edges: [] }),
      'none.md': 'nothing'
    })
    expect(getBacklinks('T.md')).toEqual([
      { source: 'a.md', count: 1 },
      { source: 'm.canvas', count: 1 },
      { source: 'z.md', count: 2 }
    ])
    expect(getBacklinks('none.md')).toEqual([])
  })

  it('updateContent re-parses a file and bumps the version', async () => {
    await loadTestVault({ 'A.md': '[[B]]', 'B.md': '', 'C.md': '' })
    const v = useMetadata.getState().version
    useMetadata.getState().updateContent('A.md', '[[C]] [[Gone]]')
    const s = useMetadata.getState()
    expect(s.version).toBeGreaterThan(v)
    expect(s.resolved['A.md']).toEqual({ 'C.md': 1 })
    expect(s.unresolved['A.md']).toEqual({ Gone: 1 })
    expect(getBacklinks('B.md')).toEqual([])
  })

  it('reresolve turns unresolved links into resolved ones when the target appears', async () => {
    await loadTestVault({ 'A.md': '[[New]] [[sub/New]]' })
    expect(useMetadata.getState().unresolved['A.md']).toEqual({ New: 1, 'sub/New': 1 })
    useVault.getState().upsert(fileEntry('sub/New.md'))
    useMetadata.getState().reresolve()
    expect(useMetadata.getState().resolved['A.md']).toEqual({ 'sub/New.md': 2 })
    expect(useMetadata.getState().unresolved['A.md']).toEqual({})
  })

  it('remove drops the file meta and its targets become unresolved after the file is gone', async () => {
    await loadTestVault({ 'A.md': '[[B]]', 'B.md': '[[A]]' })
    useVault.getState().removeLocal('B.md')
    useMetadata.getState().remove('B.md')
    const s = useMetadata.getState()
    expect(s.metas['B.md']).toBeUndefined()
    expect(s.resolved['B.md']).toBeUndefined()
    expect(s.unresolved['A.md']).toEqual({ B: 1 })
    expect(getBacklinks('A.md')).toEqual([])
  })

  it('re-resolves ambiguous names when a closer file is added', async () => {
    await loadTestVault({ 'A.md': '[[Dup]]', 'deep/x/Dup.md': '' })
    expect(useMetadata.getState().resolved['A.md']).toEqual({ 'deep/x/Dup.md': 1 })
    useVault.getState().upsert(fileEntry('Dup.md'))
    useMetadata.getState().reresolve()
    expect(useMetadata.getState().resolved['A.md']).toEqual({ 'Dup.md': 1 })
  })
})

describe('store/metadata tags', () => {
  it('counts tags across files, merging case and keeping the first casing', async () => {
    await loadTestVault({
      'a.md': '#Project and #project and #area/sub',
      'b.md': '---\ntags: [project, "#idea"]\n---\n#todo',
      'c.md': '---\ntags:\n  - listed\n  - todo\n---\nbody',
      'd.md': '---\ntag: single other\n---\n',
      'e.md': '```\n#notatag\n```\n`#inline` # Heading #123 x#nope',
      'm.canvas': JSON.stringify({ nodes: [{ id: '1', type: 'text', text: '#canvas-tag' }], edges: [] })
    })
    const tags = Object.fromEntries(getAllTags().map((t) => [t.tag.toLowerCase(), t]))
    expect(tags.project.count).toBe(3)
    expect(tags.project.files.sort()).toEqual(['a.md', 'b.md'])
    expect(tags['area/sub'].count).toBe(1)
    expect(tags.idea.tag).toBe('idea')
    expect(tags.todo.count).toBe(2)
    expect(tags.listed.files).toEqual(['c.md'])
    expect(tags.single.count).toBe(1)
    expect(tags.other.count).toBe(1)
    expect(tags['canvas-tag'].files).toEqual(['m.canvas'])
    expect(tags.notatag).toBeUndefined()
    expect(tags.inline).toBeUndefined()
    expect(tags['123']).toBeUndefined()
    expect(tags.nope).toBeUndefined()
  })
})
