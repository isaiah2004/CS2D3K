// Regression tests from the robustness audit (QUALITY.md): delete vs pending saves, rename link rewriting.
import { beforeEach, describe, expect, it } from 'vitest'
import { flushPromises, loadTestVault } from '../../helpers/vault'
import { deletePath, notifyFileChanged, onExternalChange, openLinkText, registerFlusher, renamePath, saveFile } from '@/lib/fileops'
import { getActiveFile } from '@/store/workspace'
import { useSettings, type Settings } from '@/store/settings'
import { useUi } from '@/store/ui'
import { useBookmarks } from '@/store/bookmarks'

const setSettings = (patch: Partial<Settings>): void => useSettings.setState((s) => ({ settings: { ...s.settings, ...patch } }))

beforeEach(() => {
  useUi.setState({ notices: [], confirm: null, prompt: null })
  useBookmarks.setState({ items: [] })
})

describe('lib/fileops deletePath with a pending (debounced) save', () => {
  it('flushes the save before trashing, so the editor closing afterwards cannot recreate the file', async () => {
    const mem = await loadTestVault({ 'a.md': 'old' })
    setSettings({ confirmDelete: false })
    // an open editor with a debounced save pending (like MarkdownView's t.save)
    let pending: string | null = 'typed just now'
    const flush = (): void => {
      if (pending === null) return
      const c = pending
      pending = null
      void saveFile('a.md', c)
    }
    const unregister = registerFlusher(flush)
    try {
      expect(await deletePath('a.md')).toBe(true)
      // the tab closes → the view unmounts → it flushes again
      flush()
      await flushPromises()
      expect(mem.files.has('a.md')).toBe(false)
      // the last edit was written before the file went to the trash
      expect(mem.writes.map((w) => w.content)).toContain('typed just now')
    } finally {
      unregister()
    }
  })
})

describe('lib/fileops renamePath link rewriting', () => {
  it('leaves same-note heading links ([[#Heading]], [](#heading)) untouched when the note moves', async () => {
    const src = '# Head\nsee [[#Head]] and [x](#Head) and [[B]]\n'
    const mem = await loadTestVault({ 'f/A.md': src, 'f/B.md': '# B' })
    setSettings({ updateLinksOnRename: true })
    expect(await renamePath('f', 'g')).toBe(true)
    await flushPromises()
    expect(mem.files.get('g/A.md')).toBe(src)
  })

  it('still rewrites links to the renamed note', async () => {
    const mem = await loadTestVault({ 'A.md': 'see [[B#Part]] and [[#Self]]', 'B.md': '# Part' })
    setSettings({ updateLinksOnRename: true })
    expect(await renamePath('B.md', 'C.md')).toBe(true)
    await flushPromises()
    expect(mem.files.get('A.md')).toBe('see [[C#Part]] and [[#Self]]')
  })
})

describe('lib/fileops watcher echoes', () => {
  it('a late echo of an earlier save is not mistaken for an external edit', async () => {
    const mem = await loadTestVault({ 'n.md': 'v0' })
    const seen: string[] = []
    const off = onExternalChange('n.md', (c) => seen.push(c))
    try {
      await saveFile('n.md', 'v1')
      await saveFile('n.md', 'v2')
      // the watcher event for the v1 write is read back while the disk still has v1
      mem.files.set('n.md', 'v1')
      await notifyFileChanged('n.md')
      mem.files.set('n.md', 'v2')
      await notifyFileChanged('n.md')
      expect(seen).toEqual([])
      // a real external edit still comes through
      mem.files.set('n.md', 'from another app')
      await notifyFileChanged('n.md')
      expect(seen).toEqual(['from another app'])
    } finally {
      off()
    }
  })
})

describe('lib/fileops openLinkText for a name the file system rejects', () => {
  it('shows an error instead of an unhandled rejection, and opens nothing', async () => {
    const mem = await loadTestVault({ 'A.md': '[[Why?]]' })
    const createFile = mem.api.fs.createFile
    mem.api.fs.createFile = async () => {
      throw new Error("EINVAL: invalid argument, open 'Why?.md'")
    }
    try {
      await expect(openLinkText('Why?', 'A.md')).resolves.toBeUndefined()
      expect(useUi.getState().notices.map((n) => n.message)).toContainEqual(expect.stringMatching(/Couldn't create "Why\?\.md".*EINVAL/))
      expect(getActiveFile()).toBeNull()
    } finally {
      mem.api.fs.createFile = createFile
    }
  })
})
