import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { loadTestVault } from '../../../../helpers/vault'
import { calloutMeta, embedSize, imageSrc, toggleTaskAt } from '@/views/markdown/editor/widgets'
import { destroyViews, makeView } from './helpers'

// editor tests build real CodeMirror views: give them headroom on a loaded full-suite run
vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 })

afterEach(destroyViews)

describe('views/markdown/editor/widgets toggleTaskAt', () => {
  const toggle = (doc: string, pos: number): [boolean, string] => {
    const view = makeView(doc)
    const ok = toggleTaskAt(view, pos)
    return [ok, view.state.doc.toString()]
  }

  it('toggles the task on the line containing the position', () => {
    expect(toggle('- [ ] a\n- [x] b', 2)).toEqual([true, '- [x] a\n- [x] b'])
    expect(toggle('- [ ] a\n- [x] b', 10)).toEqual([true, '- [ ] a\n- [ ] b'])
  })

  it('handles ordered, indented and quoted tasks', () => {
    expect(toggle('  1. [ ] a', 0)[1]).toBe('  1. [x] a')
    expect(toggle('> * [ ] a', 0)[1]).toBe('> * [x] a')
  })

  it('treats any non-space status (e.g. [-]) as checked and clears it', () => {
    expect(toggle('- [-] a', 0)[1]).toBe('- [ ] a')
  })

  it('returns false and changes nothing on lines that are not tasks', () => {
    expect(toggle('plain [ ] text', 0)).toEqual([false, 'plain [ ] text'])
    expect(toggle('- item', 0)).toEqual([false, '- item'])
  })
})

describe('views/markdown/editor/widgets calloutMeta', () => {
  it('maps known callout types to a color and icon', () => {
    expect(calloutMeta('warning')).toEqual({ color: 'var(--color-orange-rgb)', icon: '⚠' })
    expect(calloutMeta('bug').icon).toBe('🐞')
  })

  it('falls back to the note style for unknown types', () => {
    expect(calloutMeta('whatever')).toEqual(calloutMeta('note'))
  })

  it('falls back to the note style for types named like Object.prototype keys', () => {
    expect(calloutMeta('constructor')).toEqual(calloutMeta('note'))
    expect(calloutMeta('__proto__')).toEqual(calloutMeta('note'))
  })
})

describe('views/markdown/editor/widgets embedSize', () => {
  it('parses "W" and "WxH" sizes', () => {
    expect(embedSize('300')).toEqual({ width: 300, height: undefined })
    expect(embedSize(' 300x200 ')).toEqual({ width: 300, height: 200 })
  })

  it('returns no size for anything else', () => {
    expect(embedSize('')).toEqual({})
    expect(embedSize('caption')).toEqual({})
    expect(embedSize('300x')).toEqual({})
  })
})

describe('views/markdown/editor/widgets imageSrc', () => {
  beforeEach(async () => {
    await loadTestVault({ 'img/a b.png': '', 'notes/n.md': '', 'notes/local.png': '' })
  })

  it('passes external URLs through untouched', () => {
    expect(imageSrc('https://x.y/a.png', 'notes/n.md')).toBe('https://x.y/a.png')
    expect(imageSrc('data:image/png;base64,AAA', 'notes/n.md')).toBe('data:image/png;base64,AAA')
  })

  it('resolves vault images (by name, relative, url-encoded) to resource urls', () => {
    expect(imageSrc('a b.png', 'notes/n.md')).toBe('vault://local/img/a b.png')
    expect(imageSrc('img/a%20b.png', 'notes/n.md')).toBe('vault://local/img/a b.png')
    expect(imageSrc('local.png', 'notes/n.md')).toBe('vault://local/notes/local.png')
  })

  it('ignores the size/alias part of the link', () => {
    expect(imageSrc('a b.png|100', 'notes/n.md')).toBe('vault://local/img/a b.png')
  })

  it('returns null for missing images and survives malformed escapes', () => {
    expect(imageSrc('nope.png', 'notes/n.md')).toBeNull()
    expect(imageSrc('100%.png', 'notes/n.md')).toBeNull()
  })
})
