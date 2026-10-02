// Persistent metadata cache + streamed indexing (store/metadata indexAll).
import { beforeEach, describe, expect, it } from 'vitest'
import { loadTestVault, memory } from '../../helpers/vault'
import { useMetadata, saveMetadataCache, lastIndexStats, type IndexProgress, type IndexedNote } from '@/store/metadata'
import { useVault } from '@/store/vault'
import { saveFile } from '@/lib/fileops'
import { CACHE_NAME } from '@/lib/metaCache'
import { PARSER_VERSION } from '@/lib/mdparse'

const VAULT = {
  'Home.md': '# Home\n\n[[Projects/Alpha]] [[Beta]] [[Missing]] #root',
  'Projects/Alpha.md': '---\ntags: [project]\n---\n# Alpha\n[[Home]] [[Beta|b]] ![[pic.png]]\n- [ ] task',
  'Projects/Beta.md': '# Beta\n[[Alpha]] [[../Home]] [link](Alpha.md#x)',
  'Board.canvas': JSON.stringify({ nodes: [{ id: 'a', type: 'file', file: 'Home.md' }, { id: 'b', type: 'text', text: '[[Gamma]]' }] }),
  'pic.png': 'png',
  'notes.txt': 'not indexed [[Home]]'
}

/** a new app start on the same (memory) vault: fresh stores, same files and cache */
async function reopen(): Promise<void> {
  const mem = memory()
  useVault.getState().setInfo({ path: '/vault', name: 'vault' })
  await useVault.getState().loadFiles()
  useMetadata.setState({ metas: {}, resolved: {}, unresolved: {}, ready: false, version: 0 })
  mem.reads.length = 0
  await useMetadata.getState().indexAll()
}

const index = () => {
  const { metas, resolved, unresolved } = useMetadata.getState()
  return { metas, resolved, unresolved }
}

/** what a full index (no cache) of the current files gives */
async function fullIndex(): Promise<ReturnType<typeof index>> {
  const mem = memory()
  const saved = mem.caches.get(CACHE_NAME)
  mem.caches.delete(CACHE_NAME)
  await reopen()
  const out = index()
  if (saved !== undefined) mem.caches.set(CACHE_NAME, saved)
  return out
}

const writeExternal = (path: string, content: string, mtime: number): void => {
  memory().files.set(path, content)
  memory().mtimes.set(path, mtime)
}

beforeEach(async () => {
  await loadTestVault(VAULT)
  await saveMetadataCache()
})

describe('store/metadata cache', () => {
  it('is written after indexing', () => {
    const text = memory().caches.get(CACHE_NAME)!
    expect(text).toBeTruthy()
    expect(JSON.parse(text.split('\n')[0])).toMatchObject({ parser: PARSER_VERSION })
    expect(text.split('\n')).toHaveLength(1 + 4)
  })

  it('miss: without a cache every note is read', async () => {
    memory().caches.clear()
    await reopen()
    expect(lastIndexStats).toMatchObject({ total: 4, cached: 0, read: 4, cacheFound: false })
    expect(memory().reads.sort()).toEqual(['Board.canvas', 'Home.md', 'Projects/Alpha.md', 'Projects/Beta.md'])
  })

  it('hit: a restart reads no files and gives the same index as a full re-index', async () => {
    const before = index()
    await reopen()
    expect(memory().reads).toEqual([])
    expect(lastIndexStats).toMatchObject({ total: 4, cached: 4, read: 0, cacheFound: true })
    expect(useMetadata.getState().ready).toBe(true)
    expect(index()).toStrictEqual(before)
  })

  it('re-reads exactly the notes whose mtime or size changed', async () => {
    writeExternal('Projects/Beta.md', '# Beta v2\n[[Home]] #changed', 1_800_000_000_000)
    // same size, other mtime
    const alpha = memory().files.get('Projects/Alpha.md')!
    writeExternal('Projects/Alpha.md', alpha.replace('Alpha', 'ALPHA'), 1_800_000_000_001)
    await reopen()
    expect(memory().reads.sort()).toEqual(['Projects/Alpha.md', 'Projects/Beta.md'])
    expect(useMetadata.getState().metas['Projects/Beta.md'].tags.map((t) => t.tag)).toEqual(['changed'])
    expect(useMetadata.getState().resolved['Projects/Beta.md']).toEqual({ 'Home.md': 1 })
    expect(index()).toStrictEqual(await fullIndex())
  })

  it('drops deleted notes and re-links notes that pointed at them', async () => {
    memory().files.delete('Projects/Beta.md')
    await reopen()
    expect(memory().reads).toEqual([])
    const s = useMetadata.getState()
    expect(s.metas['Projects/Beta.md']).toBeUndefined()
    expect(s.resolved['Home.md']).toEqual({ 'Projects/Alpha.md': 1 })
    expect(s.unresolved['Home.md']).toEqual({ Beta: 1, Missing: 1 })
    expect(index()).toStrictEqual(await fullIndex())
    // the next save forgets the deleted note
    await saveMetadataCache()
    expect(memory().caches.get(CACHE_NAME)!).not.toContain('Projects/Beta.md"')
  })

  it('resolves links to notes added while the app was closed', async () => {
    writeExternal('Missing.md', '# now exists', 1_800_000_000_000)
    writeExternal('Deep/Gamma.md', '', 1_800_000_000_000)
    await reopen()
    expect(memory().reads.sort()).toEqual(['Deep/Gamma.md', 'Missing.md'])
    const s = useMetadata.getState()
    expect(s.resolved['Home.md']).toEqual({ 'Projects/Alpha.md': 1, 'Projects/Beta.md': 1, 'Missing.md': 1 })
    expect(s.unresolved['Home.md']).toEqual({})
    expect(s.resolved['Board.canvas']).toEqual({ 'Home.md': 1, 'Deep/Gamma.md': 1 })
    expect(index()).toStrictEqual(await fullIndex())
  })

  it('a corrupt cache falls back to a full index (and is replaced)', async () => {
    memory().caches.set(CACHE_NAME, '{"format":1,"par')
    await reopen()
    expect(lastIndexStats).toMatchObject({ cached: 0, read: 4, cacheFound: false })
    expect(index()).toStrictEqual(await fullIndex())
    await saveMetadataCache()
    expect(JSON.parse(memory().caches.get(CACHE_NAME)!.split('\n')[0]).parser).toBe(PARSER_VERSION)
  })

  it('a corrupt entry only costs that note a re-read', async () => {
    const lines = memory().caches.get(CACHE_NAME)!.split('\n')
    const i = lines.findIndex((l) => l.startsWith('["Home.md"'))
    lines[i] = '["Home.md", garbage'
    memory().caches.set(CACHE_NAME, lines.join('\n'))
    await reopen()
    expect(memory().reads).toEqual(['Home.md'])
    expect(index()).toStrictEqual(await fullIndex())
  })

  it('a cache from another parser version is ignored', async () => {
    const lines = memory().caches.get(CACHE_NAME)!.split('\n')
    lines[0] = JSON.stringify({ ...JSON.parse(lines[0]), parser: PARSER_VERSION - 1 })
    memory().caches.set(CACHE_NAME, lines.join('\n'))
    await reopen()
    expect(lastIndexStats).toMatchObject({ cached: 0, read: 4, cacheFound: false })
  })

  it('notes saved in the app are stored with their new mtime, so the next start does not read them', async () => {
    await saveFile('Home.md', '# Home edited\n[[Beta]]')
    await saveMetadataCache()
    await reopen()
    expect(memory().reads).toEqual([])
    expect(useMetadata.getState().metas['Home.md'].headings[0].text).toBe('Home edited')
    expect(index()).toStrictEqual(await fullIndex())
  })

  it('belongs to its vault: a pending save is dropped when another vault is indexed', async () => {
    await reopen()
    const cache = memory().caches.get(CACHE_NAME)
    useVault.getState().setInfo({ path: '/other', name: 'other' })
    await saveMetadataCache()
    expect(memory().caches.get(CACHE_NAME)).toBe(cache)
  })
})

describe('store/metadata cache relinking (randomized)', () => {
  it('matches a full re-index after random adds, deletes, renames and folder changes', async () => {
    let seed = 7
    const rnd = (n: number): number => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff
      return seed % n
    }
    const names = ['A', 'b', 'Note', 'note', 'x/Note', 'Deep/x/C', 'C', '../A', './b', 'img.png', 'Folder', 'Folder.md', 'sub/', 'd/e']
    const dirs = ['', 'x/', 'Deep/x/', 'Folder/', 'y/']
    const randomNote = (): string => names.map(() => `[[${names[rnd(names.length)]}]]`).slice(0, 1 + rnd(5)).join(' ')
    for (let round = 0; round < 12; round++) {
      const files: Record<string, string> = {}
      for (let i = 0; i < 25; i++) files[`${dirs[rnd(dirs.length)]}${['A', 'b', 'Note', 'C', 'D', 'Folder'][rnd(6)]}${i % 3 ? '' : i}.md`] = randomNote()
      files['img.png'] = 'x'
      await loadTestVault(files)
      await saveMetadataCache()
      const mem = memory()
      // mutate while "closed"
      for (let k = 0; k < 4; k++) {
        const paths = [...mem.files.keys()]
        const p = paths[rnd(paths.length)]
        switch (rnd(4)) {
          case 0:
            mem.files.delete(p)
            break
          case 1:
            writeExternal(`${dirs[rnd(dirs.length)]}${names[rnd(names.length)].replace(/[./]/g, '')}.md`, randomNote(), 1_900_000_000_000 + k)
            break
          case 2: {
            const c = mem.files.get(p)!
            mem.files.delete(p)
            writeExternal(`y/${p.split('/').pop()}`, c, mem.mtimes.get(p) ?? 1)
            break
          }
          default:
            writeExternal(p, randomNote(), 1_900_000_000_100 + k)
        }
      }
      // folders follow their files
      for (const d of [...mem.dirs]) if (![...mem.files.keys()].some((f) => f.startsWith(d + '/'))) mem.dirs.delete(d)
      for (const f of mem.files.keys()) for (let d = f.slice(0, f.lastIndexOf('/')); d && f.includes('/'); d = d.includes('/') ? d.slice(0, d.lastIndexOf('/')) : '') mem.dirs.add(d)
      await reopen()
      const cached = index()
      expect(cached).toStrictEqual(await fullIndex())
    }
  })
})

describe('store/metadata streamed indexing', () => {
  it('reports progress through the stages and hands out every note with its link targets', async () => {
    const files: Record<string, string> = {}
    for (let i = 0; i < 300; i++) files[`n/Note ${i}.md`] = `[[Note ${(i + 1) % 300}]] [[nowhere]]`
    await loadTestVault(files)
    memory().caches.clear()
    useMetadata.setState({ metas: {}, resolved: {}, unresolved: {}, ready: false })
    const progress: IndexProgress[] = []
    const notes: IndexedNote[] = []
    await useMetadata.getState().indexAll({ onProgress: (p) => progress.push(p), onNotes: (n) => notes.push(...n) })
    expect(progress[0].stage).toBe('scanning')
    expect(progress.some((p) => p.stage === 'reading' && p.total === 300)).toBe(true)
    expect(progress[progress.length - 1]).toMatchObject({ stage: 'linking', done: 300, total: 300 })
    expect(notes).toHaveLength(300)
    expect(notes.find((n) => n.path === 'n/Note 5.md')!.targets).toEqual(['n/Note 6.md'])
    expect(Object.keys(useMetadata.getState().metas)).toHaveLength(300)
  })

  it('cached notes are handed out before the vault listing is needed', async () => {
    useMetadata.setState({ metas: {}, resolved: {}, unresolved: {}, ready: false })
    let listed!: () => void
    const files = new Promise<void>((r) => (listed = r))
    const notes: string[] = []
    const done = useMetadata.getState().indexAll({ files, onNotes: (n) => notes.push(...n.map((x) => x.path)) })
    await new Promise((r) => setTimeout(r, 10))
    expect(notes.sort()).toEqual(['Board.canvas', 'Home.md', 'Projects/Alpha.md', 'Projects/Beta.md'])
    expect(useMetadata.getState().ready).toBe(false)
    listed()
    await done
    expect(useMetadata.getState().ready).toBe(true)
  })
})
