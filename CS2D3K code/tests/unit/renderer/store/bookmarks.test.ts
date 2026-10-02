import { beforeEach, describe, expect, it } from 'vitest'
import { memory } from '../../helpers/vault'
import { useBookmarks, type Bookmark } from '@/store/bookmarks'

const bm = () => useBookmarks.getState()
const saved = () => (memory().config.get('bookmarks') as { items: Bookmark[] } | undefined)?.items
const files = (...paths: string[]): Bookmark[] => paths.map((path) => ({ type: 'file', path }))

beforeEach(() => {
  memory().reset()
  useBookmarks.setState({ items: [] })
})

describe('store/bookmarks', () => {
  it('load reads saved bookmarks', async () => {
    memory().config.set('bookmarks', { items: files('a.md') })
    await bm().load()
    expect(bm().items).toEqual(files('a.md'))
  })

  it('load falls back to no bookmarks when nothing (or nothing usable) was saved', async () => {
    useBookmarks.setState({ items: files('stale.md') })
    await bm().load()
    expect(bm().items).toEqual([])
    memory().config.set('bookmarks', {})
    await bm().load()
    expect(bm().items).toEqual([])
  })

  it('toggleFile adds then removes a file bookmark and persists each time', () => {
    bm().toggleFile('a.md')
    expect(bm().items).toEqual(files('a.md'))
    expect(saved()).toEqual(files('a.md'))
    expect(bm().isBookmarked('a.md')).toBe(true)
    bm().toggleFile('a.md')
    expect(bm().items).toEqual([])
    expect(saved()).toEqual([])
    expect(bm().isBookmarked('a.md')).toBe(false)
  })

  it('add appends non-file bookmarks, which never count as a bookmarked file', () => {
    bm().add({ type: 'search', query: 'a.md', title: 'Find a' })
    bm().add({ type: 'graph' })
    expect(bm().items.map((b) => b.type)).toEqual(['search', 'graph'])
    expect(saved()).toHaveLength(2)
    expect(bm().isBookmarked('a.md')).toBe(false)
  })

  it('remove deletes by index and persists', () => {
    useBookmarks.setState({ items: files('a.md', 'b.md', 'c.md') })
    bm().remove(1)
    expect(bm().items).toEqual(files('a.md', 'c.md'))
    expect(saved()).toEqual(files('a.md', 'c.md'))
  })

  it('move reorders and persists', () => {
    useBookmarks.setState({ items: files('a.md', 'b.md', 'c.md') })
    bm().move(2, 0)
    expect(bm().items).toEqual(files('c.md', 'a.md', 'b.md'))
    bm().move(0, 2)
    expect(bm().items).toEqual(files('a.md', 'b.md', 'c.md'))
    expect(saved()).toEqual(files('a.md', 'b.md', 'c.md'))
  })

  it('move with a stale index leaves the list intact', () => {
    useBookmarks.setState({ items: files('a.md', 'b.md') })
    bm().move(5, 0)
    expect(bm().items).toEqual(files('a.md', 'b.md'))
  })

  it('onRename follows a renamed file', () => {
    useBookmarks.setState({ items: [...files('a.md', 'b.md'), { type: 'search', query: 'x' }] })
    bm().onRename('a.md', 'z.md')
    expect(bm().items).toEqual([...files('z.md', 'b.md'), { type: 'search', query: 'x' }])
    expect(saved()).toEqual(bm().items)
  })

  it('onRename follows files inside a renamed folder but not look-alike siblings', () => {
    useBookmarks.setState({ items: files('notes/a.md', 'notes/deep/b.md', 'notes2/c.md') })
    bm().onRename('notes', 'archive')
    expect(bm().items).toEqual(files('archive/a.md', 'archive/deep/b.md', 'notes2/c.md'))
  })

  it('onRename does not write when no bookmark is affected', () => {
    useBookmarks.setState({ items: files('a.md') })
    bm().onRename('other.md', 'x.md')
    expect(saved()).toBeUndefined()
  })
})
