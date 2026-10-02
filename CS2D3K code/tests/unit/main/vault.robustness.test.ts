// Regression tests from the robustness audit (QUALITY.md): path containment, config names,
// corrupt config backups, write/rename/delete ordering, symlink loops.
import fs from 'fs'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { makeTempDir, removeDir, writeTree } from './helpers'

const electron = vi.hoisted(() => ({ trashItem: vi.fn() }))
vi.mock('electron', () => ({ shell: { trashItem: electron.trashItem } }))

import { Vault } from '../../../src/main/vault'

let dir: string
let vault: Vault

const file = (rel: string): string => path.join(dir, ...rel.split('/'))

beforeEach(() => {
  dir = makeTempDir()
  electron.trashItem.mockReset()
  // behave like the OS trash: the item disappears
  electron.trashItem.mockImplementation(async (p: string) => fs.rmSync(p, { recursive: true, force: true }))
  vault = new Vault(dir)
})

afterEach(async () => {
  await vault?.dispose()
  removeDir(dir)
})

describe('main/vault robustness', () => {
  describe('abs() at a drive / file-system root', () => {
    // a vault opened at "C:\" (or "/") — build it without the constructor so nothing is written there
    const atRoot = (): Vault => Object.assign(Object.create(Vault.prototype) as Vault, { root: path.parse(dir).root, name: '' })

    it('accepts paths inside a root vault', () => {
      const v = atRoot()
      expect(v.abs('notes/a.md')).toBe(path.join(path.parse(dir).root, 'notes', 'a.md'))
      expect(v.abs('')).toBe(path.parse(dir).root)
    })

    it('still refuses escapes from a normal vault', () => {
      expect(() => vault.abs('../x.md')).toThrow(/escapes vault/)
    })
  })

  describe('config names cannot escape .cs2d3k', () => {
    it('rejects traversal in readConfig / writeConfig', async () => {
      writeTree(dir, { 'secret.json': '{"token":1}' })
      await expect(vault.readConfig('../secret')).rejects.toThrow(/Invalid config name/)
      await expect(vault.writeConfig('../../evil', { x: 1 })).rejects.toThrow(/Invalid config name/)
      await expect(vault.writeConfig('a/b', { x: 1 })).rejects.toThrow(/Invalid config name/)
      expect(fs.existsSync(path.join(dir, '..', 'evil.json'))).toBe(false)
    })

    it('rejects traversal in configPath', () => {
      expect(() => vault.configPath('..', 'outside')).toThrow(/escapes the config folder/)
      expect(() => vault.configPath('../../x')).toThrow(/escapes the config folder/)
      expect(vault.configPath('themes')).toBe(path.join(vault.root, '.cs2d3k', 'themes'))
    })

    it('still round-trips normal names', async () => {
      await vault.writeConfig('workspace', { a: 1 })
      expect(await vault.readConfig('workspace')).toEqual({ a: 1 })
    })
  })

  describe('corrupt config', () => {
    it('keeps a .bak copy before the app overwrites an unparsable config with defaults', async () => {
      const broken = '{ "baseTheme": "light", }'
      writeTree(dir, { '.cs2d3k/app.json': broken })
      expect(await vault.readConfig('app')).toBeNull()
      expect(fs.readFileSync(file('.cs2d3k/app.json.bak'), 'utf8')).toBe(broken)
      await vault.writeConfig('app', { baseTheme: 'dark' })
      // the user's hand-edited settings survive in the backup
      expect(fs.readFileSync(file('.cs2d3k/app.json.bak'), 'utf8')).toBe(broken)
    })

    it('does not create a backup for a missing config', async () => {
      expect(await vault.readConfig('bookmarks')).toBeNull()
      expect(fs.existsSync(file('.cs2d3k/bookmarks.json.bak'))).toBe(false)
    })
  })

  describe('mutations run in call order', () => {
    it('a save issued right before a rename lands on the old path first (no resurrected file)', async () => {
      writeTree(dir, { 'a.md': 'old' })
      for (let i = 0; i < 10; i++) {
        const from = i % 2 ? 'b.md' : 'a.md'
        const to = i % 2 ? 'a.md' : 'b.md'
        // issued in the same tick, like flushAll() followed by fs.rename over IPC
        const w = vault.writeText(from, `v${i}`)
        const r = vault.rename(from, to)
        await Promise.all([w, r])
        expect(fs.existsSync(file(from)), `round ${i}: ${from} must not come back`).toBe(false)
        expect(fs.readFileSync(file(to), 'utf8')).toBe(`v${i}`)
      }
    })

    it('a save issued right before a delete does not recreate the file', async () => {
      writeTree(dir, { 'a.md': 'old' })
      const w = vault.writeText('a.md', 'latest')
      const t = vault.trash('a.md')
      await Promise.all([w, t])
      expect(fs.existsSync(file('a.md'))).toBe(false)
    })

    it('a failing mutation does not block the queue', async () => {
      await expect(vault.rename('missing.md', 'x.md')).rejects.toThrow()
      await vault.writeText('ok.md', 'fine')
      expect(fs.readFileSync(file('ok.md'), 'utf8')).toBe('fine')
    })

    it('idle() waits for queued writes', async () => {
      const big = 'x'.repeat(2_000_000)
      void vault.writeText('big.md', big)
      await vault.idle()
      expect(fs.statSync(file('big.md')).size).toBe(big.length)
    })
  })

  describe('symlink loops', () => {
    it('list() terminates when a folder links back to an ancestor', async () => {
      writeTree(dir, { 'a/note.md': 'x' })
      try {
        fs.symlinkSync(dir, file('a/loop'), process.platform === 'win32' ? 'junction' : 'dir')
      } catch {
        return // symlinks not permitted here
      }
      const list = await vault.list()
      const paths = list.map((e) => e.path)
      expect(paths).toContain('a/note.md')
      expect(paths.length).toBeLessThan(20)
    })
  })
})
