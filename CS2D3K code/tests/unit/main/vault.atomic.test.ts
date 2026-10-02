import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

vi.mock('electron', () => ({ shell: { trashItem: vi.fn() }, app: { getPath: () => tmpdir() } }))
const { durableWrite, journalPath, Vault } = await import('../../../src/main/vault')

const dirs: string[] = []
const tmp = (): string => {
  const d = mkdtempSync(join(tmpdir(), 'cs2d3k-durable-'))
  dirs.push(d)
  return d
}
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

describe('main/vault durableWrite', () => {
  it('replaces the content and leaves no journal behind', async () => {
    const d = tmp()
    const f = join(d, 'note.md')
    writeFileSync(f, 'old')
    await durableWrite(f, 'new content')
    expect(readFileSync(f, 'utf8')).toBe('new content')
    expect(readdirSync(d)).toEqual(['note.md'])
  })

  it('keeps the file identity (created time) across saves', async () => {
    const d = tmp()
    const f = join(d, 'note.md')
    writeFileSync(f, 'v1')
    const born = statSync(f).birthtimeMs
    await new Promise((r) => setTimeout(r, 30))
    await durableWrite(f, 'v2')
    expect(statSync(f).birthtimeMs).toBe(born)
  })
})

describe('main/vault recoverInterruptedWrites', () => {
  it('restores a note whose in-place write was cut short (crash after the journal was complete)', async () => {
    const root = tmp()
    mkdirSync(join(root, 'notes'))
    const f = join(root, 'notes', 'idea.md')
    writeFileSync(f, 'FULL NEW CONTENT'.slice(0, 4)) // torn target
    writeFileSync(journalPath(f), 'FULL NEW CONTENT')
    const v = new Vault(root)
    expect(await v.recoverInterruptedWrites()).toEqual(['notes/idea.md'])
    expect(readFileSync(f, 'utf8')).toBe('FULL NEW CONTENT')
    expect(readdirSync(join(root, 'notes'))).toEqual(['idea.md'])
  })

  it('discards an incomplete journal and leaves the untouched target alone', async () => {
    const root = tmp()
    const f = join(root, 'a.md')
    writeFileSync(f, 'old and intact')
    writeFileSync(`${journalPath(f)}.tmp`, 'half wri')
    const v = new Vault(root)
    expect(await v.recoverInterruptedWrites()).toEqual([])
    expect(readFileSync(f, 'utf8')).toBe('old and intact')
    expect(readdirSync(root).filter((n) => n !== '.cs2d3k')).toEqual(['a.md'])
  })

  it('also recovers config files inside .cs2d3k', async () => {
    const root = tmp()
    const v = new Vault(root)
    const cfg = join(root, '.cs2d3k', 'app.json')
    writeFileSync(cfg, '{"broken')
    writeFileSync(journalPath(cfg), '{"ok":true}')
    expect(await v.recoverInterruptedWrites()).toEqual(['.cs2d3k/app.json'])
    expect(JSON.parse(readFileSync(cfg, 'utf8'))).toEqual({ ok: true })
  })

  it('hidden journal files never show up in the file list', async () => {
    const root = tmp()
    writeFileSync(join(root, 'n.md'), 'x')
    writeFileSync(journalPath(join(root, 'n.md')), 'x')
    const v = new Vault(root)
    expect((await v.list()).map((e) => e.path)).toEqual(['n.md'])
  })
})
