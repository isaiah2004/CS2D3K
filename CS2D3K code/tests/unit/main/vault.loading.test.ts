// Vault loading: batch reads, the metadata cache file, prefetching on open and the parallel listing.
import fs from 'fs'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { makeTempDir, removeDir, writeTree } from './helpers'

vi.mock('electron', () => ({ shell: { trashItem: vi.fn() } }))

import { Vault } from '../../../src/main/vault'
import { statMany, STAT_FIELDS } from '../../../src/main/statMany'

let dir: string
let vault: Vault

beforeEach(() => {
  dir = makeTempDir()
  vault = new Vault(dir)
})

afterEach(async () => {
  await vault?.dispose()
  removeDir(dir)
})

describe('main/vault readMany', () => {
  it('returns the contents in request order, null for missing, escaping or oversized files', async () => {
    writeTree(dir, { 'a.md': 'A', 'sub/b.md': 'B', 'big.md': 'x'.repeat(2 * 1024 * 1024 + 1) })
    expect(await vault.readMany(['sub/b.md', 'nope.md', 'a.md', '../outside.md', 'big.md'])).toEqual(['B', null, 'A', null, null])
  })

  it('reads hundreds of files with bounded concurrency', async () => {
    const files: Record<string, string> = {}
    for (let i = 0; i < 300; i++) files[`n/${i}.md`] = String(i)
    writeTree(dir, files)
    const out = await vault.readMany(Object.keys(files))
    expect(out).toEqual(Object.values(files))
  })
})

describe('main/vault cache files', () => {
  it('are missing at first, then written atomically and read back', async () => {
    expect(await vault.readCache('metadata')).toBeNull()
    await vault.writeCache('metadata', 'one\ntwo')
    expect(await vault.readCache('metadata')).toBe('one\ntwo')
    await vault.writeCache('metadata', 'three')
    expect(await vault.readCache('metadata')).toBe('three')
    const cacheDir = path.join(dir, '.cs2d3k', 'cache')
    // no temp files left behind; kept out of version control
    expect(fs.readdirSync(cacheDir).sort()).toEqual(['.gitignore', 'metadata.json'])
  })

  it('refuses names that could escape the cache folder', async () => {
    await expect(vault.writeCache('../app', 'x')).rejects.toThrow(/Invalid cache name/)
    expect(await vault.readCache('../app')).toBeNull()
  })

  it('stay out of the file list', async () => {
    await vault.writeCache('metadata', 'x')
    writeTree(dir, { 'n.md': '' })
    expect((await vault.list()).map((e) => e.path)).toEqual(['n.md'])
  })
})

describe('main/vault prefetch', () => {
  it('hands the prefetched list and cache to the first request, later requests read fresh', async () => {
    writeTree(dir, { 'a.md': 'A' })
    await vault.writeCache('metadata', 'cached')
    vault.prefetch(['metadata'])
    writeTree(dir, { 'b.md': 'B' })
    await vault.writeCache('metadata', 'newer')
    expect(await vault.takeCache('metadata')).toBe('cached')
    expect(await vault.takeCache('metadata')).toBe('newer')
    const first = (await vault.takeList()).map((e) => e.path).sort()
    expect(first.length).toBeGreaterThanOrEqual(1)
    expect((await vault.takeList()).map((e) => e.path).sort()).toEqual(['a.md', 'b.md'])
  })
})

describe('main/statMany', () => {
  it('gives the same stats in worker threads as in this thread', async () => {
    const files: Record<string, string> = {}
    for (let i = 0; i < 40; i++) files[`f${i % 4}/n${i}.md`] = 'x'.repeat(i)
    writeTree(dir, files)
    const paths = [...Object.keys(files).map((p) => path.join(dir, p)), path.join(dir, 'f1'), path.join(dir, 'missing.md')]
    const here = await statMany(paths, 0)
    const threads = await statMany(paths, 3)
    expect(Array.from(threads)).toEqual(Array.from(here))
    const n = paths.length
    expect(here[(n - 2) * STAT_FIELDS + 3]).toBe(1) // folder
    expect(Number.isNaN(here[(n - 1) * STAT_FIELDS])).toBe(true) // missing
    expect(here[5 * STAT_FIELDS + 2]).toBe(5) // size
    expect(here[0]).toBe(fs.statSync(paths[0]).mtimeMs)
  })

  it('lists a big vault (worker path) exactly like stat-ing every entry', async () => {
    const files: Record<string, string> = {}
    for (let i = 0; i < 3200; i++) files[`d${i % 20}/sub${i % 3}/n${i}.md`] = String(i)
    writeTree(dir, files)
    const list = await vault.list()
    expect(list).toHaveLength(3200 + 20 + 60)
    for (const e of list.filter((_, i) => i % 97 === 0)) {
      const st = fs.statSync(path.join(dir, e.path))
      expect(e).toEqual({
        path: e.path,
        name: path.basename(e.path),
        isDir: st.isDirectory(),
        ext: st.isDirectory() ? '' : 'md',
        mtime: st.mtimeMs,
        ctime: st.birthtimeMs || st.ctimeMs,
        size: st.size
      })
    }
  }, 60_000)
})
