import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, loadTestVault } from '../../helpers/vault'
import {
  broadcastContent,
  convertCanvasToFormMap,
  createCanvas,
  createFile,
  createFolder,
  createNote,
  deletePath,
  duplicatePath,
  moveToFolder,
  notifyFileChanged,
  onExternalChange,
  openLinkText,
  readFile,
  registerFlusher,
  renamePath,
  saveFile
} from '@/lib/fileops'
import { useMetadata, getBacklinks } from '@/store/metadata'
import { useVault, fileExists } from '@/store/vault'
import { useWorkspace, allLeaves, getActiveTab } from '@/store/workspace'
import { useSettings, type Settings } from '@/store/settings'
import { useUi } from '@/store/ui'
import { useBookmarks } from '@/store/bookmarks'

const canvas = (nodes: unknown[]): string => JSON.stringify({ nodes, edges: [] })
const tabPaths = (): (string | undefined)[] => allLeaves(useWorkspace.getState().root).flatMap((l) => l.tabs.map((t) => t.path))
const setSettings = (patch: Partial<Settings>): void => useSettings.setState((s) => ({ settings: { ...s.settings, ...patch } }))
const notices = (): string[] => useUi.getState().notices.map((n) => n.message)

beforeEach(() => {
  useUi.setState({ notices: [], confirm: null, prompt: null })
  useBookmarks.setState({ items: [] })
})

describe('lib/fileops createNote / createCanvas / createFolder / createFile', () => {
  it('creates a note at the vault root when nothing is open, indexes and opens it', async () => {
    const mem = await loadTestVault({ 'A.md': '[[Untitled]]' })
    const p = await createNote()
    expect(p).toBe('Untitled.md')
    expect(mem.files.get('Untitled.md')).toBe('')
    expect(fileExists('Untitled.md')).toBe(true)
    expect(useMetadata.getState().metas['Untitled.md']).toBeDefined()
    expect(getActiveTab()?.path).toBe('Untitled.md')
    expect(getActiveTab()?.state?.focusTitle).toBe(true)
  })

  it('picks a unique name when the note already exists', async () => {
    const mem = await loadTestVault({ 'Untitled.md': 'keep', 'Untitled 1.md': 'keep' })
    expect(await createNote(undefined, 'Untitled', '', false)).toBe('Untitled 2.md')
    expect(mem.files.get('Untitled.md')).toBe('keep')
  })

  it('creates next to the active file by default ("current" location)', async () => {
    await loadTestVault({ 'notes/A.md': '' })
    useWorkspace.getState().openFile('notes/A.md')
    expect(await createNote(undefined, 'Untitled', '', false)).toBe('notes/Untitled.md')
  })

  it('honours the "folder" and "root" new note locations', async () => {
    await loadTestVault({ 'notes/A.md': '', 'Inbox/x.md': '' })
    useWorkspace.getState().openFile('notes/A.md')
    setSettings({ newNoteLocation: 'folder', newNoteFolder: 'Inbox' })
    expect(await createNote(undefined, 'N', '', false)).toBe('Inbox/N.md')
    setSettings({ newNoteLocation: 'root' })
    expect(await createNote(undefined, 'N', '', false)).toBe('N.md')
  })

  it('uses an explicit folder, name and content; opens in a new tab or not at all', async () => {
    const mem = await loadTestVault({ 'docs/x.md': '' })
    const p = await createNote('docs', 'Hello', '# Hi\n[[x]]', 'tab')
    expect(p).toBe('docs/Hello.md')
    expect(mem.files.get(p)).toBe('# Hi\n[[x]]')
    expect(useMetadata.getState().resolved[p]).toEqual({ 'docs/x.md': 1 })
    expect(tabPaths()).toEqual([undefined, 'docs/Hello.md'])
    await createNote('docs', 'Quiet', '', false)
    expect(tabPaths()).toEqual([undefined, 'docs/Hello.md'])
  })

  it('creates an empty canvas with a unique name and opens it', async () => {
    const mem = await loadTestVault({ 'maps/Untitled.canvas': '{}' })
    const p = await createCanvas('maps')
    expect(p).toBe('maps/Untitled 1.canvas')
    expect(JSON.parse(mem.files.get(p)!)).toEqual({ nodes: [], edges: [] })
    expect(getActiveTab()?.path).toBe(p)
  })

  it('creates folders with unique names', async () => {
    const mem = await loadTestVault({ 'Untitled/a.md': '' })
    expect(await createFolder()).toBe('Untitled 1')
    expect(await createFolder('Untitled', 'Sub')).toBe('Untitled/Sub')
    expect(mem.dirs.has('Untitled 1')).toBe(true)
    expect(useVault.getState().files['Untitled 1'].isDir).toBe(true)
  })

  it('createFile creates arbitrary files with unique names', async () => {
    const mem = await loadTestVault({ 'src/main.py': 'x' })
    const p = await createFile('src', 'main.py', 'print(1)', false)
    expect(p).toBe('src/main 1.py')
    expect(mem.files.get(p)).toBe('print(1)')
    expect(fileExists(p)).toBe(true)
  })
})

describe('lib/fileops openLinkText', () => {
  it('opens an existing note, passing the subpath', async () => {
    await loadTestVault({ 'A.md': '', 'deep/B.md': '# Head' })
    await openLinkText('B#Head|alias', 'A.md')
    expect(getActiveTab()?.path).toBe('deep/B.md')
    expect(getActiveTab()?.state).toEqual({ subpath: '#Head' })
  })

  it('opens the source itself for heading-only links and supports new tabs', async () => {
    await loadTestVault({ 'A.md': '# H' })
    await openLinkText('#H', 'A.md', true)
    expect(tabPaths()).toEqual([undefined, 'A.md'])
    expect(getActiveTab()?.state).toEqual({ subpath: '#H' })
  })

  it('creates and opens a note for an unresolved link, resolving the source link', async () => {
    const mem = await loadTestVault({ 'A.md': '[[New Note]]' })
    expect(useMetadata.getState().unresolved['A.md']).toEqual({ 'New Note': 1 })
    await openLinkText('New Note', 'A.md')
    expect(mem.files.get('New Note.md')).toBe('')
    expect(getActiveTab()?.path).toBe('New Note.md')
    expect(useMetadata.getState().resolved['A.md']).toEqual({ 'New Note.md': 1 })
    expect(useMetadata.getState().unresolved['A.md']).toEqual({})
  })

  it('creates unresolved links with a folder path inside that folder, keeping the subpath', async () => {
    const mem = await loadTestVault({ 'A.md': '[[projects/Plan#Goals]]' })
    await openLinkText('projects/Plan#Goals', 'A.md', true)
    expect(mem.files.has('projects/Plan.md')).toBe(true)
    expect(getActiveTab()?.path).toBe('projects/Plan.md')
    expect(getActiveTab()?.state).toEqual({ subpath: '#Goals' })
    expect(useMetadata.getState().resolved['A.md']).toEqual({ 'projects/Plan.md': 1 })
  })

  it('strips a .md extension and creates next to the active file for bare names', async () => {
    const mem = await loadTestVault({ 'notes/A.md': '' })
    useWorkspace.getState().openFile('notes/A.md')
    await openLinkText('Other.md', 'notes/A.md')
    expect(mem.files.has('notes/Other.md')).toBe(true)
    expect(getActiveTab()?.path).toBe('notes/Other.md')
  })
})

describe('lib/fileops renamePath', () => {
  it('rewrites wikilinks, markdown links and canvas file nodes', async () => {
    const mem = await loadTestVault({
      'A.md': 'see [[B]] and [[B#Head|alias]] and [b](B.md)',
      'notes/B.md': '# Head',
      'map.canvas': JSON.stringify({ nodes: [{ id: '1', type: 'file', file: 'notes/B.md', x: 0, y: 0, width: 1, height: 1 }], edges: [] })
    })
    expect(await renamePath('notes/B.md', 'notes/C.md')).toBe(true)
    expect(mem.files.get('A.md')).toBe('see [[C]] and [[C#Head|alias]] and [b](notes/C.md)')
    expect(JSON.parse(mem.files.get('map.canvas')!).nodes[0].file).toBe('notes/C.md')
    expect(useMetadata.getState().resolved['A.md']).toEqual({ 'notes/C.md': 3 })
  })

  it('rewrites every wikilink form: headings, block refs, aliases, embeds, .md and path forms', async () => {
    const mem = await loadTestVault({
      'A.md': '[[B]] [[B#Head]] [[B#^blk|al]] ![[B]] ![[B#Head|200]] [[B.md]] [[notes/B]] [[b]] [[B|]]',
      'notes/B.md': '# Head'
    })
    await renamePath('notes/B.md', 'notes/C.md')
    expect(mem.files.get('A.md')).toBe('[[C]] [[C#Head]] [[C#^blk|al]] ![[C]] ![[C#Head|200]] [[C]] [[C]] [[C]] [[C|]]')
    expect(notices()).toContain('Updated links in 1 file')
  })

  it('uses a path when the new name is ambiguous', async () => {
    const mem = await loadTestVault({ 'A.md': '[[B]] [b](notes/B.md)', 'notes/B.md': '', 'X.md': '' })
    await renamePath('notes/B.md', 'notes/X.md')
    expect(mem.files.get('A.md')).toBe('[[notes/X]] [b](notes/X.md)')
    expect(useMetadata.getState().resolved['A.md']).toEqual({ 'notes/X.md': 2 })
  })

  it('does not touch links that resolve to another file with the same name, or unrelated links', async () => {
    const src = '[[B]] [[other/B]] [o](other/B.md) [[Missing]] [w](https://x.org/B.md) [[Unrelated]] plain B'
    const mem = await loadTestVault({ 'A.md': src, 'n/B.md': '', 'other/B.md': '', 'Unrelated.md': '', 'Z.md': '[[Unrelated]]' })
    await renamePath('n/B.md', 'n/C.md')
    expect(mem.files.get('A.md')).toBe('[[C]] [[other/B]] [o](other/B.md) [[Missing]] [w](https://x.org/B.md) [[Unrelated]] plain B')
    expect(mem.writes.map((w) => w.path)).toEqual(['A.md'])
    expect(useMetadata.getState().resolved['A.md']).toEqual({ 'n/C.md': 1, 'other/B.md': 2, 'Unrelated.md': 1 })
  })

  it('leaves links resolving by name alone when the new location still resolves', async () => {
    const mem = await loadTestVault({ 'A.md': '[[B]]', 'notes/B.md': '' })
    await renamePath('notes/B.md', 'archive/B.md')
    expect(mem.files.get('A.md')).toBe('[[B]]')
    expect(mem.writes).toEqual([])
    expect(useMetadata.getState().resolved['A.md']).toEqual({ 'archive/B.md': 1 })
  })

  it('moves a folder with everything inside, updating links to and from moved files', async () => {
    const mem = await loadTestVault({
      'A.md': '[[B]] [[notes/sub/D]] ![[img.png]] [b](notes/B.md) [d](notes/sub/D.md)',
      'notes/B.md': '[[D]] [[sub/D]]',
      'notes/sub/D.md': '[[B]]',
      'notes/img.png': 'png',
      'notesX/E.md': '[[E]]'
    })
    useWorkspace.getState().openFile('notes/sub/D.md')
    useBookmarks.setState({ items: [{ type: 'file', path: 'notes/B.md' }] })
    expect(await renamePath('notes', 'archive/old')).toBe(true)
    expect([...mem.files.keys()].sort()).toEqual(['A.md', 'archive/old/B.md', 'archive/old/img.png', 'archive/old/sub/D.md', 'notesX/E.md'])
    expect(Object.keys(useVault.getState().files).filter((p) => p.startsWith('notes')).sort()).toEqual(['notesX', 'notesX/E.md'])
    expect(mem.files.get('A.md')).toBe('[[B]] [[D]] ![[img.png]] [b](archive/old/B.md) [d](archive/old/sub/D.md)')
    const { resolved, unresolved, metas } = useMetadata.getState()
    expect(resolved['A.md']).toEqual({ 'archive/old/B.md': 2, 'archive/old/sub/D.md': 2, 'archive/old/img.png': 1 })
    expect(resolved['archive/old/B.md']).toEqual({ 'archive/old/sub/D.md': 2 })
    expect(resolved['archive/old/sub/D.md']).toEqual({ 'archive/old/B.md': 1 })
    expect(Object.values(unresolved).every((u) => Object.keys(u).length === 0)).toBe(true)
    expect(Object.keys(metas).sort()).toEqual(['A.md', 'archive/old/B.md', 'archive/old/sub/D.md', 'notesX/E.md'])
    expect(metas['archive/old/B.md'].path).toBe('archive/old/B.md')
    expect(tabPaths()).toEqual(['archive/old/sub/D.md'])
    expect(useBookmarks.getState().items[0].path).toBe('archive/old/B.md')
  })

  it('keeps %20-encoded markdown links encoded, including the heading', async () => {
    const mem = await loadTestVault({
      'A.md': '[x](My%20Note.md) [y](My%20Note.md#Some%20Head) ![i](My%20Note.md) [[My Note#Some Head]]',
      'My Note.md': '# Some Head'
    })
    await renamePath('My Note.md', 'Your Note.md')
    expect(mem.files.get('A.md')).toBe('[x](Your%20Note.md) [y](Your%20Note.md#Some%20Head) ![i](Your%20Note.md) [[Your Note#Some Head]]')
    expect(useMetadata.getState().resolved['A.md']).toEqual({ 'Your Note.md': 4 })
  })

  it('updates markdown links that have a title', async () => {
    const mem = await loadTestVault({ 'A.md': '[x](B.md "The title")', 'B.md': '' })
    await renamePath('B.md', 'C.md')
    expect(mem.files.get('A.md')).toBe('[x](C.md "The title")')
  })

  it('keeps relative markdown links relative to the linking file', async () => {
    const mem = await loadTestVault({
      'sub/A.md': '[up](../B.md) [same](C.md) [dot](./C.md#H) [abs](sub/C.md)',
      'B.md': '',
      'sub/C.md': '# H',
      // same-named files next to the source must not capture the rewritten links
      'sub/B2.md': '',
      'C2.md': ''
    })
    await renamePath('B.md', 'B2.md')
    await renamePath('sub/C.md', 'sub/C2.md')
    expect(mem.files.get('sub/A.md')).toBe('[up](../B2.md) [same](C2.md) [dot](C2.md#H) [abs](sub/C2.md)')
    expect(useMetadata.getState().resolved['sub/A.md']).toEqual({ 'B2.md': 1, 'sub/C2.md': 3 })
  })

  it('fixes relative markdown links of moved sources, whether or not the target moved too', async () => {
    const mem = await loadTestVault({
      'docs/A.md': '[c](C.md) [up](../Top.md) [[Top]] [abs](https://x.org/Top.md)',
      'docs/C.md': '',
      'Top.md': '',
      'docs/m.canvas': canvas([{ id: '1', type: 'text', text: '[up](../Top.md)' }])
    })
    await renamePath('docs', 'archive/docs')
    expect(mem.files.get('archive/docs/A.md')).toBe('[c](C.md) [up](../../Top.md) [[Top]] [abs](https://x.org/Top.md)')
    expect(JSON.parse(mem.files.get('archive/docs/m.canvas')!).nodes[0].text).toBe('[up](../../Top.md)')
    expect(mem.writes.map((w) => w.path).sort()).toEqual(['archive/docs/A.md', 'archive/docs/m.canvas'])
    await renamePath('Top.md', 'Top2.md')
    expect(mem.files.get('archive/docs/A.md')).toBe('[c](C.md) [up](../../Top2.md) [[Top2]] [abs](https://x.org/Top.md)')
    expect(useMetadata.getState().resolved['archive/docs/A.md']).toEqual({ 'archive/docs/C.md': 1, 'Top2.md': 2 })
  })

  it('rewrites canvas file nodes and links inside canvas text nodes', async () => {
    const mem = await loadTestVault({
      'notes/B.md': '',
      'notes/Keep.md': '',
      'maps/m.canvas': canvas([
        { id: '1', type: 'file', file: 'notes/B.md', subpath: '#H' },
        { id: '2', type: 'file', file: 'notes/Keep.md' },
        { id: '3', type: 'text', text: 'see [[B|bee]] and [b](notes/B.md) and [[Keep]]' },
        { id: '4', type: 'link', url: 'https://example.com/notes/B.md' },
        { id: '5', type: 'group', label: 'notes/B.md' }
      ])
    })
    await renamePath('notes/B.md', 'notes/C.md')
    const nodes = JSON.parse(mem.files.get('maps/m.canvas')!).nodes
    expect(nodes[0]).toEqual({ id: '1', type: 'file', file: 'notes/C.md', subpath: '#H' })
    expect(nodes[1].file).toBe('notes/Keep.md')
    expect(nodes[2].text).toBe('see [[C|bee]] and [b](notes/C.md) and [[Keep]]')
    expect(nodes[3].url).toBe('https://example.com/notes/B.md')
    expect(nodes[4].label).toBe('notes/B.md')
    expect(useMetadata.getState().resolved['maps/m.canvas']).toEqual({ 'notes/C.md': 3, 'notes/Keep.md': 2 })
  })

  it('rewrites form-map form nodes (body text and linking fields) and file nodes', async () => {
    const mem = await loadTestVault({
      'B.md': '',
      'plan.formmap': JSON.stringify({
        nodes: [
          { id: '1', type: 'form', text: 'about [[B]]', fields: { owner: '[[B|Bob]]', other: 'B', count: 3 } },
          { id: '2', type: 'file', file: 'B.md' },
          { id: '3', type: 'text', text: '![[B]]' }
        ],
        edges: [],
        formmap: { version: 1 }
      })
    })
    await renamePath('B.md', 'C.md')
    const data = JSON.parse(mem.files.get('plan.formmap')!)
    expect(data.nodes[0]).toEqual({ id: '1', type: 'form', text: 'about [[C]]', fields: { owner: '[[C|Bob]]', other: 'B', count: 3 } })
    expect(data.nodes[1].file).toBe('C.md')
    expect(data.nodes[2].text).toBe('![[C]]')
    expect(data.formmap).toEqual({ version: 1 })
    expect(useMetadata.getState().resolved['plan.formmap']).toEqual({ 'C.md': 4 })
  })

  it('does not reformat canvases whose links did not change', async () => {
    const compact = canvas([{ id: '1', type: 'text', text: '[[Other]] [[B]]' }])
    const mem = await loadTestVault({ 'dir/B.md': '', 'Other.md': '', 'dir/m.canvas': compact })
    await renamePath('dir', 'dir2')
    expect(mem.files.get('dir2/m.canvas')).toBe(compact)
    expect(mem.writes).toEqual([])
  })

  it('handles case-only renames', async () => {
    const mem = await loadTestVault({ 'A.md': '[[Note]] [x](Note.md)', 'Note.md': '' })
    useWorkspace.getState().openFile('Note.md')
    expect(await renamePath('Note.md', 'note.md')).toBe(true)
    expect([...mem.files.keys()].sort()).toEqual(['A.md', 'note.md'])
    expect(mem.files.get('A.md')).toBe('[[note]] [x](note.md)')
    expect(getActiveTab()?.path).toBe('note.md')
    expect(useMetadata.getState().resolved['A.md']).toEqual({ 'note.md': 2 })
  })

  it('rewrites self links inside the renamed file', async () => {
    const mem = await loadTestVault({ 'B.md': '# H\n[[B#H]] [[#H]] [h](#H)' })
    await renamePath('B.md', 'C.md')
    expect(mem.files.get('C.md')).toBe('# H\n[[C#H]] [[#H]] [h](#H)')
    expect(mem.files.has('B.md')).toBe(false)
  })

  it('does not rewrite links when "update links on rename" is off', async () => {
    const mem = await loadTestVault({ 'A.md': '[[B]] [b](B.md)', 'B.md': '' })
    setSettings({ updateLinksOnRename: false })
    expect(await renamePath('B.md', 'C.md')).toBe(true)
    expect(mem.files.get('A.md')).toBe('[[B]] [b](B.md)')
    expect(useMetadata.getState().unresolved['A.md']).toEqual({ B: 1, 'B.md': 1 })
  })

  it('refuses to overwrite an existing file', async () => {
    const mem = await loadTestVault({ 'A.md': '[[B]]', 'B.md': 'b', 'C.md': 'c' })
    expect(await renamePath('B.md', 'C.md')).toBe(false)
    expect(mem.files.get('B.md')).toBe('b')
    expect(mem.files.get('C.md')).toBe('c')
    expect(mem.files.get('A.md')).toBe('[[B]]')
    expect(notices()).toContain('"C.md" already exists')
  })

  it('is a no-op for identical paths', async () => {
    const mem = await loadTestVault({ 'A.md': '' })
    expect(await renamePath('A.md', 'A.md')).toBe(true)
    expect(mem.writes).toEqual([])
  })

  it('reports a failed rename and leaves the stores untouched', async () => {
    const mem = await loadTestVault({ 'A.md': '[[B]]', 'B.md': '' })
    const spy = vi.spyOn(mem.api.fs, 'rename').mockRejectedValueOnce(new Error('EBUSY'))
    expect(await renamePath('B.md', 'C.md')).toBe(false)
    spy.mockRestore()
    expect(fileExists('B.md')).toBe(true)
    expect(mem.files.get('A.md')).toBe('[[B]]')
    expect(notices()).toContain('Rename failed: EBUSY')
  })

  it('runs registered flushers before reading links, so pending edits are rewritten too', async () => {
    const mem = await loadTestVault({ 'A.md': 'old text', 'B.md': '' })
    const flusher = vi.fn(() => void saveFile('A.md', 'typed [[B]] just now'))
    const unregister = registerFlusher(flusher)
    try {
      await renamePath('B.md', 'C.md')
    } finally {
      unregister()
    }
    expect(flusher).toHaveBeenCalledTimes(1)
    expect(mem.files.get('A.md')).toBe('typed [[C]] just now')
    expect(useMetadata.getState().resolved['A.md']).toEqual({ 'C.md': 1 })
  })

  it('keeps going when a flusher throws, and unregistered flushers are not called', async () => {
    await loadTestVault({ 'B.md': '' })
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    const bad = registerFlusher(() => {
      throw new Error('boom')
    })
    const gone = vi.fn()
    registerFlusher(gone)()
    expect(await renamePath('B.md', 'C.md')).toBe(true)
    bad()
    expect(gone).not.toHaveBeenCalled()
    expect(err).toHaveBeenCalled()
    err.mockRestore()
  })

  it('broadcasts rewritten content to open views of the linking file', async () => {
    await loadTestVault({ 'A.md': '[[B]]', 'B.md': '' })
    const cb = vi.fn()
    const off = onExternalChange('A.md', cb)
    await renamePath('B.md', 'C.md')
    off()
    expect(cb).toHaveBeenCalledWith('[[C]]')
  })

  it('moveToFolder moves into another folder but not into itself or the same folder', async () => {
    const mem = await loadTestVault({ 'A.md': '[[B]]', 'B.md': '', 'dir/x.md': '' })
    expect(await moveToFolder('B.md', '')).toBe(false)
    expect(await moveToFolder('dir', 'dir/sub')).toBe(false)
    expect(await moveToFolder('B.md', 'dir')).toBe(true)
    expect(mem.files.has('dir/B.md')).toBe(true)
    expect(useMetadata.getState().resolved['A.md']).toEqual({ 'dir/B.md': 1 })
  })
})

describe('lib/fileops deletePath', () => {
  it('asks for confirmation and does nothing when cancelled', async () => {
    const mem = await loadTestVault({ 'A.md': '[[B]]', 'B.md': 'b' })
    useWorkspace.getState().openFile('B.md')
    const p = deletePath('B.md')
    const req = useUi.getState().confirm!
    expect(req.title).toBe('Delete file')
    expect(req.message).toContain('"B.md"')
    expect(req.danger).toBe(true)
    req.resolve(false)
    expect(await p).toBe(false)
    expect(mem.files.get('B.md')).toBe('b')
    expect(fileExists('B.md')).toBe(true)
    expect(tabPaths()).toEqual(['B.md'])
    expect(useMetadata.getState().resolved['A.md']).toEqual({ 'B.md': 1 })
  })

  it('deletes after confirmation, closes tabs and unresolves links', async () => {
    const mem = await loadTestVault({ 'A.md': '[[B]]', 'B.md': '[[A]]' })
    useWorkspace.getState().openFile('B.md')
    useWorkspace.getState().openFile('A.md', { target: 'tab' })
    const p = deletePath('B.md')
    useUi.getState().confirm!.resolve(true)
    expect(await p).toBe(true)
    expect(mem.files.has('B.md')).toBe(false)
    expect(fileExists('B.md')).toBe(false)
    expect(tabPaths()).toEqual(['A.md'])
    expect(useMetadata.getState().metas['B.md']).toBeUndefined()
    expect(useMetadata.getState().unresolved['A.md']).toEqual({ B: 1 })
    expect(getBacklinks('A.md')).toEqual([])
  })

  it('skips the dialog when "confirm delete" is off', async () => {
    const mem = await loadTestVault({ 'B.md': '' })
    setSettings({ confirmDelete: false })
    expect(await deletePath('B.md')).toBe(true)
    expect(useUi.getState().confirm).toBeNull()
    expect(mem.files.has('B.md')).toBe(false)
  })

  it('deletes folders with everything in them', async () => {
    const mem = await loadTestVault({ 'dir/a.md': '', 'dir/sub/b.md': '', 'dirX/c.md': '', 'L.md': '[[a]] [[b]] [[c]]' })
    useWorkspace.getState().openFile('dir/sub/b.md')
    const p = deletePath('dir')
    const req = useUi.getState().confirm!
    expect(req.title).toBe('Delete folder')
    expect(req.message).toContain('and everything in it')
    req.resolve(true)
    expect(await p).toBe(true)
    expect([...mem.files.keys()].sort()).toEqual(['L.md', 'dirX/c.md'])
    expect(Object.keys(useVault.getState().files).sort()).toEqual(['L.md', 'dirX', 'dirX/c.md'])
    expect(Object.keys(useMetadata.getState().metas).sort()).toEqual(['L.md', 'dirX/c.md'])
    expect(useMetadata.getState().unresolved['L.md']).toEqual({ a: 1, b: 1 })
    expect(tabPaths()).toEqual([undefined])
  })

  it('returns false for unknown paths and reports trash failures', async () => {
    const mem = await loadTestVault({ 'B.md': '' })
    setSettings({ confirmDelete: false })
    expect(await deletePath('nope.md')).toBe(false)
    const spy = vi.spyOn(mem.api.fs, 'trash').mockRejectedValueOnce(new Error('locked'))
    expect(await deletePath('B.md')).toBe(false)
    spy.mockRestore()
    expect(fileExists('B.md')).toBe(true)
    expect(notices()).toContain('Delete failed: locked')
  })
})

describe('lib/fileops duplicatePath', () => {
  it('copies next to the original with a unique " copy" name and indexes it', async () => {
    const mem = await loadTestVault({ 'notes/A.md': '[[B]]', 'B.md': '', 'notes/A copy.md': '' })
    const p = await duplicatePath('notes/A.md')
    expect(p).toBe('notes/A copy 1.md')
    expect(mem.files.get(p!)).toBe('[[B]]')
    expect(fileExists(p!)).toBe(true)
    expect(useMetadata.getState().resolved[p!]).toEqual({ 'B.md': 1 })
  })

  it('duplicates files without extension and reports failures', async () => {
    const mem = await loadTestVault({ Makefile: 'all:' })
    expect(await duplicatePath('Makefile')).toBe('Makefile copy')
    expect(mem.files.get('Makefile copy')).toBe('all:')
    expect(await duplicatePath('missing.md')).toBeNull()
    expect(notices().some((n) => n.startsWith('Duplicate failed'))).toBe(true)
  })
})

describe('lib/fileops convertCanvasToFormMap', () => {
  it('copies the canvas into a .formmap next to it, keeping the original', async () => {
    const src = canvas([{ id: '1', type: 'text', text: 'hi' }])
    const mem = await loadTestVault({ 'maps/Plan.canvas': src })
    const p = await convertCanvasToFormMap('maps/Plan.canvas')
    expect(p).toBe('maps/Plan.formmap')
    const data = JSON.parse(mem.files.get(p!)!)
    expect(data.nodes).toEqual([{ id: '1', type: 'text', text: 'hi' }])
    expect(data.formmap).toEqual({ version: 1, template: 'converted' })
    expect(mem.files.get('maps/Plan.canvas')).toBe(src)
    expect(getActiveTab()?.path).toBe(p)
  })

  it('handles empty canvases and picks a unique name', async () => {
    const mem = await loadTestVault({ 'Plan.canvas': '', 'Plan.formmap': '{}' })
    expect(await convertCanvasToFormMap('Plan.canvas')).toBe('Plan 1.formmap')
    expect(JSON.parse(mem.files.get('Plan 1.formmap')!)).toEqual({ nodes: [], edges: [], formmap: { version: 1, template: 'converted' } })
  })

  it('reports invalid canvas JSON', async () => {
    await loadTestVault({ 'Bad.canvas': '{nope' })
    expect(await convertCanvasToFormMap('Bad.canvas')).toBeNull()
    expect(notices().some((n) => n.startsWith('Could not convert'))).toBe(true)
  })
})

describe('lib/fileops save / external change tracking', () => {
  let unwatch: (() => void) | null = null
  // the fs watcher bridge (cf. lib/bootstrap): 'change'/'add' events → notifyFileChanged
  const watch = (): void => {
    unwatch = window.api.fs.onChange((evs) => {
      for (const ev of evs) if (ev.type === 'change' || ev.type === 'add') void notifyFileChanged(ev.path)
    })
  }
  afterEach(() => {
    unwatch?.()
    unwatch = null
  })

  it('saveFile writes, updates the vault entry and the metadata index', async () => {
    const mem = await loadTestVault({ 'A.md': '', 'B.md': '' })
    await saveFile('A.md', '[[B]] #tag')
    expect(mem.files.get('A.md')).toBe('[[B]] #tag')
    expect(useVault.getState().files['A.md'].size).toBe(10)
    expect(useMetadata.getState().resolved['A.md']).toEqual({ 'B.md': 1 })
    await saveFile('script.py', 'print()')
    expect(fileExists('script.py')).toBe(true)
    expect(useMetadata.getState().metas['script.py']).toBeUndefined()
  })

  it('ignores watcher echoes of our own writes', async () => {
    const mem = await loadTestVault({ 'echo.md': 'v0' })
    watch()
    const cb = vi.fn()
    const off = onExternalChange('echo.md', cb)
    await saveFile('echo.md', 'v1')
    mem.emitFs([{ type: 'change', path: 'echo.md' }])
    await flushPromises()
    expect(cb).not.toHaveBeenCalled()
    off()
  })

  it('ignores echoes of content we just read', async () => {
    const mem = await loadTestVault({ 'read.md': 'disk' })
    watch()
    const cb = vi.fn()
    const off = onExternalChange('read.md', cb)
    expect(await readFile('read.md')).toBe('disk')
    mem.emitFs([{ type: 'change', path: 'read.md' }])
    await flushPromises()
    expect(cb).not.toHaveBeenCalled()
    off()
  })

  it('notifies subscribers of real external edits and re-indexes them', async () => {
    const mem = await loadTestVault({ 'ext.md': 'v0', 'B.md': '' })
    watch()
    const cb = vi.fn()
    const off = onExternalChange('ext.md', cb)
    await saveFile('ext.md', 'v1')
    mem.files.set('ext.md', 'edited elsewhere [[B]]')
    mem.emitFs([{ type: 'change', path: 'ext.md' }])
    await flushPromises()
    expect(cb).toHaveBeenCalledTimes(1)
    expect(cb).toHaveBeenCalledWith('edited elsewhere [[B]]')
    expect(useMetadata.getState().resolved['ext.md']).toEqual({ 'B.md': 1 })
    // the same content arriving again (duplicate watcher event) is not re-delivered
    mem.emitFs([{ type: 'change', path: 'ext.md' }])
    await flushPromises()
    expect(cb).toHaveBeenCalledTimes(1)
    off()
    mem.files.set('ext.md', 'later')
    mem.emitFs([{ type: 'change', path: 'ext.md' }])
    await flushPromises()
    expect(cb).toHaveBeenCalledTimes(1)
  })

  it('indexes indexed files even without subscribers and survives vanished files', async () => {
    const mem = await loadTestVault({ 'idx.md': '' })
    mem.files.set('idx.md', '#fresh')
    await notifyFileChanged('idx.md')
    expect(useMetadata.getState().metas['idx.md'].tags.map((t) => t.tag)).toEqual(['fresh'])
    await expect(notifyFileChanged('gone.md')).resolves.toBeUndefined()
  })

  it('broadcastContent notifies other views of the same file, except the sender', async () => {
    await loadTestVault({ 'A.md': '' })
    const a = vi.fn()
    const b = vi.fn()
    const other = vi.fn()
    const offA = onExternalChange('A.md', a)
    const offB = onExternalChange('A.md', b)
    const offO = onExternalChange('B.md', other)
    broadcastContent('A.md', 'new', a)
    expect(a).not.toHaveBeenCalled()
    expect(b).toHaveBeenCalledWith('new')
    expect(other).not.toHaveBeenCalled()
    offA()
    offB()
    offO()
    broadcastContent('A.md', 'again')
    expect(b).toHaveBeenCalledTimes(1)
  })
})
