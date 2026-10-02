import { describe, expect, it } from 'vitest'
import { loadTestVault } from '../../helpers/vault'
import { useVault, childrenMap, allFiles, fileExists, getFiles } from '@/store/vault'
import type { FileEntry } from '@shared/types'

const entry = (path: string, patch: Partial<FileEntry> = {}): FileEntry => {
  const name = path.split('/').pop()!
  const i = name.lastIndexOf('.')
  return { path, name, isDir: false, ext: i > 0 ? name.slice(i + 1).toLowerCase() : '', mtime: 1, ctime: 1, size: 0, ...patch }
}
const dir = (path: string): FileEntry => entry(path, { isDir: true, ext: '' })
const paths = (): string[] => Object.keys(getFiles()).sort()

describe('store/vault loading', () => {
  it('loads files and folders from the api', async () => {
    await loadTestVault({ 'a.md': '', 'notes/b.md': '', 'notes/deep/c.png': 'x' })
    expect(paths()).toEqual(['a.md', 'notes', 'notes/b.md', 'notes/deep', 'notes/deep/c.png'])
    expect(getFiles().notes.isDir).toBe(true)
    expect(getFiles()['notes/deep/c.png'].ext).toBe('png')
  })

  it('allFiles excludes folders; fileExists covers files and folders (case-sensitive)', async () => {
    await loadTestVault({ 'a.md': '', 'notes/b.md': '' })
    expect(allFiles().map((f) => f.path).sort()).toEqual(['a.md', 'notes/b.md'])
    expect(fileExists('notes')).toBe(true)
    expect(fileExists('notes/b.md')).toBe(true)
    expect(fileExists('A.md')).toBe(false)
    expect(fileExists('missing.md')).toBe(false)
  })
})

describe('store/vault applyEvents', () => {
  it('adds files and creates missing parent folders', async () => {
    await loadTestVault({ 'a.md': '' })
    const v = useVault.getState().version
    useVault.getState().applyEvents([{ type: 'add', path: 'x/y/new.md', entry: entry('x/y/new.md') }])
    expect(paths()).toEqual(['a.md', 'x', 'x/y', 'x/y/new.md'])
    expect(getFiles().x.isDir).toBe(true)
    expect(getFiles()['x/y'].name).toBe('y')
    expect(useVault.getState().version).toBe(v + 1)
  })

  it('adds folders on addDir', async () => {
    await loadTestVault({})
    useVault.getState().applyEvents([{ type: 'addDir', path: 'p/q', entry: dir('p/q') }])
    expect(paths()).toEqual(['p', 'p/q'])
    expect(childrenMap().get('p')!.map((f) => f.path)).toEqual(['p/q'])
  })

  it('updates entries on change only when mtime or size differ', async () => {
    await loadTestVault({ 'a.md': '' })
    const prev = getFiles()['a.md']
    const v = useVault.getState().version
    useVault.getState().applyEvents([{ type: 'change', path: 'a.md', entry: { ...prev } }])
    expect(useVault.getState().version).toBe(v)
    useVault.getState().applyEvents([{ type: 'change', path: 'a.md', entry: { ...prev, size: 42 } }])
    expect(useVault.getState().version).toBe(v + 1)
    expect(getFiles()['a.md'].size).toBe(42)
    useVault.getState().applyEvents([{ type: 'change', path: 'a.md', entry: { ...prev, size: 42, mtime: prev.mtime + 5 } }])
    expect(getFiles()['a.md'].mtime).toBe(prev.mtime + 5)
  })

  it('ignores add/change events without an entry', async () => {
    await loadTestVault({ 'a.md': '' })
    const v = useVault.getState().version
    useVault.getState().applyEvents([{ type: 'add', path: 'b.md' }, { type: 'addDir', path: 'd' }])
    expect(paths()).toEqual(['a.md'])
    expect(useVault.getState().version).toBe(v)
  })

  it('removes files on unlink and folders with all their children on unlinkDir', async () => {
    await loadTestVault({ 'a.md': '', 'ab.md': '', 'notes/b.md': '', 'notes/deep/c.md': '', 'notes2/d.md': '' })
    useVault.getState().applyEvents([{ type: 'unlink', path: 'a.md' }])
    expect(fileExists('a.md')).toBe(false)
    expect(fileExists('ab.md')).toBe(true)
    useVault.getState().applyEvents([{ type: 'unlinkDir', path: 'notes' }])
    expect(paths()).toEqual(['ab.md', 'notes2', 'notes2/d.md'])
  })

  it('does not bump the version for events that change nothing', async () => {
    await loadTestVault({ 'a.md': '' })
    const v = useVault.getState().version
    useVault.getState().applyEvents([{ type: 'unlink', path: 'missing.md' }])
    expect(useVault.getState().version).toBe(v)
  })

  it('applies a batch of mixed events in order', async () => {
    await loadTestVault({ 'old.md': '' })
    useVault.getState().applyEvents([
      { type: 'unlink', path: 'old.md' },
      { type: 'add', path: 'new.md', entry: entry('new.md') },
      { type: 'add', path: 'tmp.md', entry: entry('tmp.md') },
      { type: 'unlink', path: 'tmp.md' }
    ])
    expect(paths()).toEqual(['new.md'])
  })
})

describe('store/vault local updates', () => {
  it('upsert adds or replaces an entry', async () => {
    await loadTestVault({ 'a.md': '' })
    useVault.getState().upsert(entry('b.md'))
    useVault.getState().upsert(entry('a.md', { size: 9 }))
    expect(paths()).toEqual(['a.md', 'b.md'])
    expect(getFiles()['a.md'].size).toBe(9)
  })

  it('renameLocal moves a folder with everything inside and fixes names', async () => {
    await loadTestVault({ 'notes/a.md': '', 'notes/sub/b.md': '', 'notes2/c.md': '' })
    useVault.getState().renameLocal('notes', 'archive/old')
    expect(paths()).toEqual(['archive/old', 'archive/old/a.md', 'archive/old/sub', 'archive/old/sub/b.md', 'notes2', 'notes2/c.md'])
    expect(getFiles()['archive/old'].name).toBe('old')
    expect(getFiles()['archive/old/sub/b.md'].path).toBe('archive/old/sub/b.md')
  })

  it('renameLocal handles case-only renames', async () => {
    await loadTestVault({ 'Note.md': '' })
    useVault.getState().renameLocal('Note.md', 'note.md')
    expect(paths()).toEqual(['note.md'])
    expect(getFiles()['note.md'].name).toBe('note.md')
  })

  it('removeLocal removes a folder and its children only', async () => {
    await loadTestVault({ 'notes/a.md': '', 'notes/sub/b.md': '', 'notesX.md': '' })
    useVault.getState().removeLocal('notes')
    expect(paths()).toEqual(['notesX.md'])
  })

  it('setInfo clears the file list', async () => {
    await loadTestVault({ 'a.md': '' })
    useVault.getState().setInfo({ path: '/other', name: 'other' })
    expect(paths()).toEqual([])
    expect(useVault.getState().info?.name).toBe('other')
  })
})

describe('store/vault childrenMap', () => {
  it('groups entries by parent folder, with an entry for every folder (even empty ones)', async () => {
    const mem = await loadTestVault({ 'a.md': '', 'notes/b.md': '', 'notes/sub/c.md': '' })
    mem.dirs.add('empty')
    await useVault.getState().loadFiles()
    const map = childrenMap()
    expect(map.get('')!.map((f) => f.path).sort()).toEqual(['a.md', 'empty', 'notes'])
    expect(map.get('notes')!.map((f) => f.path).sort()).toEqual(['notes/b.md', 'notes/sub'])
    expect(map.get('notes/sub')!.map((f) => f.path)).toEqual(['notes/sub/c.md'])
    expect(map.get('empty')).toEqual([])
  })

  it('has an empty root for an empty vault', async () => {
    await loadTestVault({})
    expect(childrenMap().get('')).toEqual([])
  })

  it('is memoized per version and recomputed after changes', async () => {
    await loadTestVault({ 'a.md': '' })
    const first = childrenMap()
    expect(childrenMap()).toBe(first)
    useVault.getState().upsert(entry('b.md'))
    const second = childrenMap()
    expect(second).not.toBe(first)
    expect(second.get('')!.map((f) => f.path).sort()).toEqual(['a.md', 'b.md'])
  })
})
