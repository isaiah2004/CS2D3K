import fs from 'fs'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { FsEvent } from '@shared/types'
import { isCaseInsensitiveFs, makeCaseSensitiveDir, makeTempDir, removeDir, writeTree } from './helpers'

const electron = vi.hoisted(() => ({ trashItem: vi.fn() }))
vi.mock('electron', () => ({ shell: { trashItem: electron.trashItem } }))

import { Vault } from '../../../src/main/vault'

const caseInsensitive = isCaseInsensitiveFs()

let dir: string
let vault: Vault

const file = (rel: string): string => path.join(dir, ...rel.split('/'))
const read = (rel: string): string => fs.readFileSync(file(rel), 'utf8')
const paths = async (): Promise<string[]> => (await vault.list()).map((e) => e.path).sort()

beforeEach(() => {
  dir = makeTempDir()
  electron.trashItem.mockReset()
  electron.trashItem.mockResolvedValue(undefined)
  vault = new Vault(dir)
})

afterEach(async () => {
  await vault?.dispose()
  removeDir(dir)
})

describe('main/vault', () => {
  describe('constructor', () => {
    it('resolves the root, takes its folder name and creates the config folders', () => {
      expect(vault.root).toBe(path.resolve(dir))
      expect(vault.name).toBe(path.basename(dir))
      expect(fs.statSync(file('.cs2d3k/themes')).isDirectory()).toBe(true)
      expect(fs.statSync(file('.cs2d3k/snippets')).isDirectory()).toBe(true)
    })

    it('migrates a legacy .cs2dek config folder', () => {
      const root = path.join(dir, 'legacy1')
      writeTree(root, { '.cs2dek/settings.json': '{"a":1}' })
      const v = new Vault(root)
      expect(fs.existsSync(path.join(root, '.cs2dek'))).toBe(false)
      expect(fs.readFileSync(path.join(root, '.cs2d3k', 'settings.json'), 'utf8')).toBe('{"a":1}')
      expect(fs.existsSync(path.join(root, '.cs2d3k', 'themes'))).toBe(true)
      expect(v.root).toBe(root)
    })

    it('migrates a legacy .vaultide config folder', () => {
      const root = path.join(dir, 'legacy2')
      writeTree(root, { '.vaultide/workspace.json': '{}' })
      new Vault(root)
      expect(fs.existsSync(path.join(root, '.vaultide'))).toBe(false)
      expect(fs.existsSync(path.join(root, '.cs2d3k', 'workspace.json'))).toBe(true)
    })

    it('does not overwrite an existing .cs2d3k folder with a legacy one', () => {
      const root = path.join(dir, 'legacy3')
      writeTree(root, { '.cs2dek/settings.json': 'old', '.cs2d3k/settings.json': 'new' })
      new Vault(root)
      expect(fs.readFileSync(path.join(root, '.cs2d3k', 'settings.json'), 'utf8')).toBe('new')
      expect(fs.existsSync(path.join(root, '.cs2dek', 'settings.json'))).toBe(true)
    })

    it('migrates only the first legacy folder when both exist', async () => {
      const root = path.join(dir, 'legacy4')
      writeTree(root, { '.cs2dek/a.json': '1', '.vaultide/b.json': '2' })
      const v = new Vault(root)
      expect(await v.readConfig('a')).toBe(1)
      expect(await v.readConfig('b')).toBeNull()
      expect(fs.existsSync(path.join(root, '.vaultide', 'b.json'))).toBe(true)
    })

    it('opening an existing vault twice keeps its config', async () => {
      await vault.writeConfig('settings', { x: 1 })
      const again = new Vault(dir)
      expect(await again.readConfig('settings')).toEqual({ x: 1 })
    })
  })

  describe('abs / rel', () => {
    it('maps vault paths to absolute paths and back', () => {
      expect(vault.abs('a/b.md')).toBe(path.join(vault.root, 'a', 'b.md'))
      expect(vault.rel(path.join(vault.root, 'a', 'b.md'))).toBe('a/b.md')
    })

    it('maps the empty path to the vault root', () => {
      expect(vault.abs('')).toBe(vault.root)
      expect(vault.abs('.')).toBe(vault.root)
      expect(vault.rel(vault.root)).toBe('')
    })

    it('normalizes inner ../ segments that stay inside the vault', () => {
      expect(vault.abs('a/../b.md')).toBe(path.join(vault.root, 'b.md'))
    })

    it('rejects paths that escape the vault', () => {
      expect(() => vault.abs('../outside.md')).toThrow(/escapes vault/)
      expect(() => vault.abs('a/../../outside.md')).toThrow(/escapes vault/)
      expect(() => vault.abs(path.resolve(dir, '..', 'elsewhere.md'))).toThrow(/escapes vault/)
    })

    it('rejects sibling folders that share the vault name as a prefix', () => {
      expect(() => vault.abs(`../${vault.name}-evil/x.md`)).toThrow(/escapes vault/)
    })

    it('does not touch the disk outside the vault on escaping writes', async () => {
      await expect(vault.writeText('../escaped.md', 'x')).rejects.toThrow(/escapes vault/)
      await expect(vault.createFile('../escaped.md')).rejects.toThrow(/escapes vault/)
      await expect(vault.mkdir('../escaped')).rejects.toThrow(/escapes vault/)
      await expect(vault.rename('a.md', '../escaped.md')).rejects.toThrow(/escapes vault/)
      await expect(vault.copy('a.md', '../escaped.md')).rejects.toThrow(/escapes vault/)
      await expect(vault.trash('../')).rejects.toThrow(/escapes vault/)
      expect(fs.existsSync(path.join(dir, '..', 'escaped.md'))).toBe(false)
      expect(fs.existsSync(path.join(dir, '..', 'escaped'))).toBe(false)
    })
  })

  describe('isHidden', () => {
    it('hides dot-files and well-known tool folders', () => {
      for (const n of ['.git', '.obsidian', '.cs2d3k', '.trash', '.env', 'node_modules', '__pycache__', '.venv', 'target', '.next', 'out', 'dist']) {
        expect(Vault.isHidden(n), n).toBe(true)
      }
    })

    it('shows ordinary names', () => {
      for (const n of ['notes', 'a.md', 'outline.md', 'dist.md', 'Target', 'src']) {
        expect(Vault.isHidden(n), n).toBe(false)
      }
    })
  })

  describe('list', () => {
    it('lists files and folders recursively with vault-relative forward-slash paths', async () => {
      writeTree(dir, { 'a.md': '# a', 'folder/b.md': 'b', 'folder/sub/c.ts': 'c' })
      expect(await paths()).toEqual(['a.md', 'folder', 'folder/b.md', 'folder/sub', 'folder/sub/c.ts'])
    })

    it('returns an empty list for an empty vault (config folder hidden)', async () => {
      expect(await vault.list()).toEqual([])
    })

    it('skips hidden and ignored folders at any depth', async () => {
      writeTree(dir, {
        'keep.md': '',
        '.git/HEAD': 'ref',
        '.obsidian/app.json': '{}',
        '.cs2d3k/settings.json': '{}',
        '.hidden.md': '',
        'node_modules/pkg/index.js': '',
        'proj/node_modules/x.js': '',
        'proj/dist/bundle.js': '',
        'proj/out/a.js': '',
        'proj/target/debug.txt': '',
        'proj/__pycache__/m.pyc': '',
        'proj/.venv/bin/python': '',
        'proj/src/main.rs': ''
      })
      expect(await paths()).toEqual(['keep.md', 'proj', 'proj/src', 'proj/src/main.rs'])
    })

    it('describes files and folders with name, ext, size and times', async () => {
      writeTree(dir, { 'Folder/Note.MD': 'hello' })
      const list = await vault.list()
      const f = list.find((e) => e.path === 'Folder/Note.MD')!
      const d = list.find((e) => e.path === 'Folder')!
      expect(f).toMatchObject({ name: 'Note.MD', isDir: false, ext: 'md', size: 5 })
      expect(f.mtime).toBeGreaterThan(0)
      expect(f.ctime).toBeGreaterThan(0)
      expect(d).toMatchObject({ name: 'Folder', isDir: true, ext: '' })
    })

    it('gives files without an extension an empty ext', async () => {
      writeTree(dir, { Makefile: 'all:' })
      expect((await vault.list())[0]).toMatchObject({ path: 'Makefile', ext: '' })
    })
  })

  describe('readText / writeText', () => {
    it('reads utf8 text', async () => {
      writeTree(dir, { 'n.md': 'héllo ✓' })
      expect(await vault.readText('n.md')).toBe('héllo ✓')
    })

    it('rejects when the file does not exist', async () => {
      await expect(vault.readText('missing.md')).rejects.toThrow()
    })

    it('writes text, creating parent folders, and returns the entry', async () => {
      const e = await vault.writeText('deep/er/n.md', 'content')
      expect(read('deep/er/n.md')).toBe('content')
      expect(e).toMatchObject({ path: 'deep/er/n.md', name: 'n.md', isDir: false, ext: 'md', size: 7 })
    })

    it('overwrites existing files', async () => {
      writeTree(dir, { 'n.md': 'old content' })
      await vault.writeText('n.md', 'new')
      expect(read('n.md')).toBe('new')
    })
  })

  describe('createFile', () => {
    it('creates a file with content, creating parent folders', async () => {
      const e = await vault.createFile('a/b/new.md', '# new')
      expect(read('a/b/new.md')).toBe('# new')
      expect(e.path).toBe('a/b/new.md')
    })

    it('creates an empty file by default', async () => {
      await vault.createFile('empty.md')
      expect(read('empty.md')).toBe('')
    })

    it('refuses to overwrite an existing file', async () => {
      writeTree(dir, { 'n.md': 'keep me' })
      await expect(vault.createFile('n.md', 'x')).rejects.toThrow(/already exists/)
      expect(read('n.md')).toBe('keep me')
    })

    it('refuses to create a file where a folder exists', async () => {
      fs.mkdirSync(file('folder'))
      await expect(vault.createFile('folder')).rejects.toThrow(/already exists/)
    })
  })

  describe('mkdir', () => {
    it('creates nested folders and returns a folder entry', async () => {
      const e = await vault.mkdir('x/y/z')
      expect(fs.statSync(file('x/y/z')).isDirectory()).toBe(true)
      expect(e).toMatchObject({ path: 'x/y/z', name: 'z', isDir: true, ext: '' })
    })

    it('succeeds when the folder already exists', async () => {
      fs.mkdirSync(file('x'))
      await expect(vault.mkdir('x')).resolves.toMatchObject({ isDir: true })
    })
  })

  describe('rename', () => {
    it('moves a file into a new folder, creating it', async () => {
      writeTree(dir, { 'a.md': 'A' })
      await vault.rename('a.md', 'new/folder/b.md')
      expect(fs.existsSync(file('a.md'))).toBe(false)
      expect(read('new/folder/b.md')).toBe('A')
    })

    it('renames folders with their contents', async () => {
      writeTree(dir, { 'f/one.md': '1', 'f/sub/two.md': '2' })
      await vault.rename('f', 'g')
      expect(await paths()).toEqual(['g', 'g/one.md', 'g/sub', 'g/sub/two.md'])
    })

    it('is a no-op when source and target are the same', async () => {
      writeTree(dir, { 'a.md': 'A' })
      await vault.rename('a.md', 'a.md')
      await vault.rename('a.md', './x/../a.md')
      expect(read('a.md')).toBe('A')
    })

    it('refuses to overwrite an existing target', async () => {
      writeTree(dir, { 'a.md': 'A', 'b.md': 'B' })
      await expect(vault.rename('a.md', 'b.md')).rejects.toThrow(/already exists/)
      expect(read('a.md')).toBe('A')
      expect(read('b.md')).toBe('B')
    })

    it('rejects when the source does not exist', async () => {
      await expect(vault.rename('missing.md', 'x.md')).rejects.toThrow()
    })

    it.runIf(caseInsensitive)('allows case-only renames of files on case-insensitive file systems', async () => {
      writeTree(dir, { 'note.md': 'n' })
      await vault.rename('note.md', 'Note.md')
      expect(fs.readdirSync(dir).filter((n) => !n.startsWith('.'))).toEqual(['Note.md'])
      expect(read('Note.md')).toBe('n')
    })

    it.runIf(caseInsensitive)('allows case-only renames of folders on case-insensitive file systems', async () => {
      writeTree(dir, { 'folder/a.md': 'a' })
      await vault.rename('folder', 'Folder')
      expect(fs.readdirSync(dir).filter((n) => !n.startsWith('.'))).toEqual(['Folder'])
      expect(await paths()).toEqual(['Folder', 'Folder/a.md'])
    })

    // regression: the case-only exception used to let `note.md` silently overwrite a distinct `Note.md`
    it('does not overwrite a distinct file differing only in case on case-sensitive file systems', async (ctx) => {
      const csDir = makeCaseSensitiveDir()
      if (!csDir) return ctx.skip()
      const v = new Vault(csDir)
      try {
        writeTree(csDir, { 'note.md': 'lower', 'Note.md': 'upper' })
        await expect(v.rename('note.md', 'Note.md')).rejects.toThrow(/already exists/)
        expect(fs.readFileSync(path.join(csDir, 'note.md'), 'utf8')).toBe('lower')
        expect(fs.readFileSync(path.join(csDir, 'Note.md'), 'utf8')).toBe('upper')
        await v.rename('note.md', 'NOTE.md')
        expect(fs.readFileSync(path.join(csDir, 'NOTE.md'), 'utf8')).toBe('lower')
      } finally {
        removeDir(csDir)
      }
    })
  })

  describe('copy', () => {
    it('copies a file', async () => {
      writeTree(dir, { 'a.md': 'A' })
      await vault.copy('a.md', 'b.md')
      expect(read('a.md')).toBe('A')
      expect(read('b.md')).toBe('A')
    })

    it('copies folders recursively', async () => {
      writeTree(dir, { 'f/one.md': '1', 'f/sub/two.md': '2' })
      await vault.copy('f', 'g')
      expect(read('g/one.md')).toBe('1')
      expect(read('g/sub/two.md')).toBe('2')
      expect(read('f/sub/two.md')).toBe('2')
    })

    it('refuses to overwrite an existing target', async () => {
      writeTree(dir, { 'a.md': 'A', 'b.md': 'B' })
      await expect(vault.copy('a.md', 'b.md')).rejects.toThrow(/already exists/)
      expect(read('b.md')).toBe('B')
    })

    it('rejects when the source does not exist', async () => {
      await expect(vault.copy('missing.md', 'x.md')).rejects.toThrow()
      expect(fs.existsSync(file('x.md'))).toBe(false)
    })
  })

  describe('trash', () => {
    it('moves the item to the OS trash via electron', async () => {
      writeTree(dir, { 'a.md': 'A' })
      await vault.trash('a.md')
      expect(electron.trashItem).toHaveBeenCalledWith(file('a.md'))
    })

    it('falls back to deleting the file when the OS trash fails', async () => {
      writeTree(dir, { 'a.md': 'A' })
      electron.trashItem.mockRejectedValueOnce(new Error('no trash'))
      await vault.trash('a.md')
      expect(fs.existsSync(file('a.md'))).toBe(false)
    })

    it('falls back to deleting a whole folder when the OS trash fails', async () => {
      writeTree(dir, { 'f/a.md': 'A', 'f/sub/b.md': 'B', 'other.md': 'keep' })
      electron.trashItem.mockRejectedValueOnce(new Error('no trash'))
      await vault.trash('f')
      expect(fs.existsSync(file('f'))).toBe(false)
      expect(read('other.md')).toBe('keep')
    })

    it('refuses to delete the vault root', async () => {
      await expect(vault.trash('')).rejects.toThrow(/vault root/)
      await expect(vault.trash('.')).rejects.toThrow(/vault root/)
      await expect(vault.trash('a/..')).rejects.toThrow(/vault root/)
      expect(electron.trashItem).not.toHaveBeenCalled()
      expect(fs.existsSync(dir)).toBe(true)
    })
  })

  describe('exists / stat', () => {
    it('reports whether files and folders exist', async () => {
      writeTree(dir, { 'f/a.md': 'A' })
      expect(await vault.exists('f/a.md')).toBe(true)
      expect(await vault.exists('f')).toBe(true)
      expect(await vault.exists('nope.md')).toBe(false)
      expect(await vault.exists('')).toBe(true)
    })

    it('stats a file', async () => {
      writeTree(dir, { 'f/a.txt': 'abc' })
      expect(await vault.stat('f/a.txt')).toMatchObject({ path: 'f/a.txt', name: 'a.txt', isDir: false, ext: 'txt', size: 3 })
    })

    it('returns null for missing paths and paths outside the vault', async () => {
      expect(await vault.stat('nope.md')).toBeNull()
      expect(await vault.stat('../x')).toBeNull()
    })
  })

  describe('readAll', () => {
    it('reads every file with one of the given extensions (case-insensitive)', async () => {
      writeTree(dir, { 'a.md': 'A', 'sub/B.MD': 'B', 'c.canvas': '{}', 'd.ts': 'x', '.git/e.md': 'hidden' })
      const all = await vault.readAll(['MD', 'canvas'])
      expect(all.map((f) => [f.path, f.content]).sort()).toEqual([
        ['a.md', 'A'],
        ['c.canvas', '{}'],
        ['sub/B.MD', 'B']
      ])
      expect(all[0].mtime).toBeGreaterThan(0)
    })

    it('skips files larger than 2 MB', async () => {
      writeTree(dir, { 'small.md': 'x', 'big.md': 'x'.repeat(2 * 1024 * 1024 + 1) })
      expect((await vault.readAll(['md'])).map((f) => f.path)).toEqual(['small.md'])
    })

    it('returns an empty list when nothing matches', async () => {
      writeTree(dir, { 'a.md': 'A' })
      expect(await vault.readAll([])).toEqual([])
      expect(await vault.readAll(['ts'])).toEqual([])
    })

    it('reads every file of a large vault within the open-file limit', async () => {
      const tree: Record<string, string> = {}
      for (let i = 0; i < 600; i++) tree[`notes/${i}.md`] = `note ${i}`
      writeTree(dir, tree)
      // simulate the OS limit on open files: reading 32k notes at once used to lose most of them to EMFILE
      const readText = vault.readText.bind(vault)
      let open = 0
      vi.spyOn(vault, 'readText').mockImplementation(async (p) => {
        if (open >= 100) throw Object.assign(new Error('EMFILE: too many open files'), { code: 'EMFILE' })
        open++
        try {
          return await readText(p)
        } finally {
          open--
        }
      })
      const all = await vault.readAll(['md'])
      expect(all).toHaveLength(600)
      expect(all.find((f) => f.path === 'notes/599.md')?.content).toBe('note 599')
    })
  })

  describe('search', () => {
    it('finds plain-text matches with 0-based line numbers and column offsets', async () => {
      writeTree(dir, { 'a.md': 'first line\nsecond needle here\r\nthird' })
      expect(await vault.search({ query: 'needle' })).toEqual([
        { path: 'a.md', matches: [{ line: 1, text: 'second needle here', start: 7, end: 13 }] }
      ])
    })

    it('reports only the first match per line and at most 50 lines per file', async () => {
      writeTree(dir, { 'a.md': Array.from({ length: 80 }, () => 'x x x').join('\n') })
      const [r] = await vault.search({ query: 'x' })
      expect(r.matches).toHaveLength(50)
      expect(r.matches[0]).toMatchObject({ line: 0, start: 0, end: 1 })
    })

    it('is case-insensitive by default and case-sensitive on request', async () => {
      writeTree(dir, { 'a.md': 'Hello World' })
      expect(await vault.search({ query: 'hello' })).toHaveLength(1)
      expect(await vault.search({ query: 'hello', caseSensitive: true })).toEqual([])
      expect(await vault.search({ query: 'Hello', caseSensitive: true })).toHaveLength(1)
    })

    it('treats the query literally unless regex is enabled', async () => {
      writeTree(dir, { 'a.md': 'cost: $5 (approx.)\nfoo123' })
      const [lit] = await vault.search({ query: '$5 (approx.)' })
      expect(lit.matches).toEqual([{ line: 0, text: 'cost: $5 (approx.)', start: 6, end: 18 }])
      expect(await vault.search({ query: 'foo\\d+' })).toEqual([])
      const [re] = await vault.search({ query: 'foo\\d+', regex: true })
      expect(re.matches).toEqual([{ line: 1, text: 'foo123', start: 0, end: 6 }])
    })

    it('returns nothing for an invalid regex or a blank query', async () => {
      writeTree(dir, { 'a.md': 'abc (' })
      expect(await vault.search({ query: '(', regex: true })).toEqual([])
      expect(await vault.search({ query: '   ' })).toEqual([])
      expect(await vault.search({ query: '' })).toEqual([])
    })

    it('gives zero-length regex matches a minimum width of one', async () => {
      writeTree(dir, { 'a.md': 'abc' })
      const [r] = await vault.search({ query: '^', regex: true })
      expect(r.matches[0]).toMatchObject({ start: 0, end: 1 })
    })

    it('includes files whose name matches even without content matches', async () => {
      writeTree(dir, { 'Project Plan.md': 'nothing relevant', 'other.md': 'nothing' })
      expect(await vault.search({ query: 'plan' })).toEqual([{ path: 'Project Plan.md', matches: [] }])
    })

    it('trims long lines around the match and shifts the offsets', async () => {
      const line = 'a'.repeat(300) + 'NEEDLE' + 'b'.repeat(300)
      writeTree(dir, { 'a.md': line })
      const [r] = await vault.search({ query: 'needle' })
      const m = r.matches[0]
      expect(m.text.startsWith('…')).toBe(true)
      expect(m.text.length).toBe(241)
      expect(m.text.slice(m.start, m.end)).toBe('NEEDLE')
      expect(m.start).toBe(81)
    })

    it('does not prefix an ellipsis when a long line matches near its start', async () => {
      writeTree(dir, { 'a.md': 'xx NEEDLE ' + 'b'.repeat(400) })
      const m = (await vault.search({ query: 'needle' }))[0].matches[0]
      expect(m.text.length).toBe(240)
      expect(m.text.startsWith('xx NEEDLE')).toBe(true)
      expect(m).toMatchObject({ start: 3, end: 9 })
    })

    it('skips binary files by extension and by NUL bytes', async () => {
      writeTree(dir, {
        'img.png': 'needle',
        'data.bin': 'needle',
        'weird.txt': Buffer.from('needle\u0000\u0001', 'utf8'),
        'ok.txt': 'needle'
      })
      expect((await vault.search({ query: 'needle' })).map((r) => r.path)).toEqual(['ok.txt'])
    })

    it('skips hidden folders', async () => {
      writeTree(dir, { '.git/config': 'needle', 'node_modules/a.js': 'needle', '.cs2d3k/settings.json': '"needle"', 'a.md': 'needle' })
      expect((await vault.search({ query: 'needle' })).map((r) => r.path)).toEqual(['a.md'])
    })

    it('restricts results to the given extensions', async () => {
      writeTree(dir, { 'a.md': 'needle', 'b.ts': 'needle', 'c.canvas': 'needle' })
      const res = await vault.search({ query: 'needle', exts: ['md', 'canvas'] })
      expect(res.map((r) => r.path).sort()).toEqual(['a.md', 'c.canvas'])
    })

    it('stops adding files once maxResults matches have been collected', async () => {
      const files: Record<string, string> = {}
      for (let i = 0; i < 10; i++) files[`n${i}.md`] = 'needle\nneedle'
      writeTree(dir, files)
      expect(await vault.search({ query: 'needle', maxResults: 4 })).toHaveLength(2)
      expect(await vault.search({ query: 'needle', maxResults: 1 })).toHaveLength(1)
      expect(await vault.search({ query: 'needle' })).toHaveLength(10)
    })
  })

  describe('config', () => {
    it('round-trips JSON config files inside .cs2d3k', async () => {
      await vault.writeConfig('workspace', { tabs: [1, 2], open: true })
      expect(await vault.readConfig('workspace')).toEqual({ tabs: [1, 2], open: true })
      expect(JSON.parse(read('.cs2d3k/workspace.json'))).toEqual({ tabs: [1, 2], open: true })
    })

    it('recreates the config folder if it was deleted', async () => {
      fs.rmSync(file('.cs2d3k'), { recursive: true })
      await vault.writeConfig('settings', { a: 1 })
      expect(await vault.readConfig('settings')).toEqual({ a: 1 })
    })

    it('returns null for missing or corrupt config', async () => {
      expect(await vault.readConfig('missing')).toBeNull()
      writeTree(dir, { '.cs2d3k/broken.json': '{ not json' })
      expect(await vault.readConfig('broken')).toBeNull()
    })

    it('builds paths inside the config folder', () => {
      expect(vault.configPath('themes', 'x.css')).toBe(path.join(vault.root, '.cs2d3k', 'themes', 'x.css'))
    })
  })

  describe('themes and snippets', () => {
    it('lists css themes (files and folders with theme.css) sorted by name', async () => {
      writeTree(dir, {
        '.cs2d3k/themes/zeta.css': '',
        '.cs2d3k/themes/Alpha/theme.css': '',
        '.cs2d3k/themes/NoTheme/readme.md': '',
        '.cs2d3k/themes/notes.txt': ''
      })
      expect(await vault.listThemes()).toEqual([
        { name: 'Alpha', path: '.cs2d3k/themes/Alpha/theme.css' },
        { name: 'zeta', path: '.cs2d3k/themes/zeta.css' }
      ])
    })

    it('lists css snippets', async () => {
      writeTree(dir, { '.cs2d3k/snippets/b.css': '', '.cs2d3k/snippets/a.css': '' })
      expect(await vault.listSnippets()).toEqual([
        { name: 'a', path: '.cs2d3k/snippets/a.css' },
        { name: 'b', path: '.cs2d3k/snippets/b.css' }
      ])
    })

    it('returns empty lists when the folders are missing', async () => {
      fs.rmSync(file('.cs2d3k'), { recursive: true })
      expect(await vault.listThemes()).toEqual([])
      expect(await vault.listSnippets()).toEqual([])
    })

    it('reads css by the listed path and refuses other files', async () => {
      writeTree(dir, { '.cs2d3k/snippets/a.css': 'body{}', 'a.md': 'x' })
      const [s] = await vault.listSnippets()
      expect(await vault.readCss(s.path)).toBe('body{}')
      await expect(vault.readCss('a.md')).rejects.toThrow(/css/)
      await expect(vault.readCss('../x.css')).rejects.toThrow(/escapes vault/)
    })
  })

  describe('watching', () => {
    // wait for chokidar's initial scan instead of a fixed sleep (flaky under full-suite load)
    const watcherReady = (v: Vault): Promise<void> =>
      new Promise((r) => (v as unknown as { watcher: { once(e: 'ready', cb: () => void): void } }).watcher.once('ready', () => r()))

    it('batches file system events with entries for added files', async () => {
      const events: FsEvent[] = []
      const onCss = vi.fn()
      vault.startWatching((evs) => events.push(...evs), onCss)
      await watcherReady(vault)
      writeTree(dir, { 'watched.md': 'hi' })
      await vi.waitFor(() => expect(events.find((e) => e.path === 'watched.md' && e.type === 'add')).toBeTruthy(), { timeout: 8000, interval: 50 })
      const add = events.find((e) => e.path === 'watched.md')!
      expect(add.entry).toMatchObject({ path: 'watched.md', isDir: false, size: 2 })
    }, 15000)

    it('reports css changes in the config folder separately and ignores hidden folders', async () => {
      const events: FsEvent[] = []
      const onCss = vi.fn()
      vault.startWatching((evs) => events.push(...evs), onCss)
      await watcherReady(vault)
      writeTree(dir, { '.cs2d3k/snippets/s.css': 'a{}', '.git/x': 'x', 'marker.md': 'm' })
      await vi.waitFor(() => expect(onCss).toHaveBeenCalled(), { timeout: 8000, interval: 50 })
      await vi.waitFor(() => expect(events.some((e) => e.path === 'marker.md')).toBe(true), { timeout: 8000, interval: 50 })
      expect(events.some((e) => e.path.startsWith('.git') || e.path.startsWith('.cs2d3k'))).toBe(false)
    }, 15000)

    it('reports changes and deletions of files', async () => {
      writeTree(dir, { 'a.md': 'one', 'b.md': 'two' })
      const events: FsEvent[] = []
      vault.startWatching((evs) => events.push(...evs), () => {})
      await watcherReady(vault)
      fs.writeFileSync(file('a.md'), 'changed content')
      fs.rmSync(file('b.md'))
      await vi.waitFor(
        () => {
          expect(events.find((e) => e.path === 'a.md' && e.type === 'change')?.entry).toMatchObject({ path: 'a.md', size: 15 })
          expect(events.some((e) => e.path === 'b.md' && e.type === 'unlink')).toBe(true)
        },
        { timeout: 8000, interval: 50 }
      )
      expect(events.some((e) => e.path === 'a.md' && e.type === 'add')).toBe(false)
    }, 15000)

    it('reports the contents of folders moved in and out', async () => {
      const outside = makeTempDir()
      try {
        writeTree(outside, { 'pkg/x.md': 'x', 'pkg/deep/y.md': 'y' })
        writeTree(dir, { 'old/z.md': 'z', 'old/sub/w.md': 'w' })
        const events: FsEvent[] = []
        vault.startWatching((evs) => events.push(...evs), () => {})
        await watcherReady(vault)
        fs.renameSync(path.join(outside, 'pkg'), file('pkg'))
        fs.rmSync(file('old'), { recursive: true })
        const has = (type: FsEvent['type'], p: string): boolean => events.some((e) => e.type === type && e.path === p)
        await vi.waitFor(
          () => {
            expect(has('addDir', 'pkg') && has('add', 'pkg/x.md') && has('addDir', 'pkg/deep') && has('add', 'pkg/deep/y.md')).toBe(true)
            expect(has('unlinkDir', 'old') && has('unlink', 'old/z.md') && has('unlink', 'old/sub/w.md')).toBe(true)
          },
          { timeout: 8000, interval: 50 }
        )
        expect(events.find((e) => e.path === 'pkg/deep/y.md')?.entry).toMatchObject({ isDir: false, size: 1 })
      } finally {
        removeDir(outside)
      }
    }, 15000)

    it('reports a file replaced by a rename (atomic save) as a change', async () => {
      writeTree(dir, { 'note.md': 'v1' })
      const events: FsEvent[] = []
      vault.startWatching((evs) => events.push(...evs), () => {})
      await watcherReady(vault)
      fs.writeFileSync(file('note.md.tmp'), 'version 2')
      fs.renameSync(file('note.md.tmp'), file('note.md'))
      await vi.waitFor(() => expect(events.some((e) => e.path === 'note.md' && (e.type === 'change' || e.type === 'add'))).toBe(true), {
        timeout: 8000,
        interval: 50
      })
      await new Promise((r) => setTimeout(r, 300))
      // the note never disappears for good, and the temp file is gone again
      const last = [...events].reverse().find((e) => e.path === 'note.md')
      expect(last?.type).not.toBe('unlink')
      expect(fs.readFileSync(file('note.md'), 'utf8')).toBe('version 2')
    }, 15000)

    it('stops delivering events after dispose', async () => {
      const onEvents = vi.fn()
      vault.startWatching(onEvents, () => {})
      await watcherReady(vault)
      await vault.dispose()
      writeTree(dir, { 'late.md': 'x' })
      await new Promise((r) => setTimeout(r, 500))
      expect(onEvents).not.toHaveBeenCalled()
    }, 15000)
  })
})
