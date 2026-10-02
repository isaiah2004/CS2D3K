import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { clamp, debounce, escapeHtml, formatBytes, fuzzyMatch, hexId, isMac, uid } from '@/lib/util'

describe('lib/util fuzzyMatch', () => {
  it('matches everything with an empty query', () => {
    expect(fuzzyMatch('', 'anything')).toEqual({ score: 0, indices: [] })
  })
  it('returns null when characters are missing or out of order', () => {
    expect(fuzzyMatch('xyz', 'abc')).toBeNull()
    expect(fuzzyMatch('ba', 'ab')).toBeNull()
  })
  it('is case-insensitive and reports matched indices', () => {
    expect(fuzzyMatch('NT', 'my note')!.indices).toEqual([3, 5])
  })
  it('ignores spaces in the query', () => {
    expect(fuzzyMatch('a c', 'abc')!.indices).toEqual([0, 2])
  })
  it('ranks an exact prefix above a later substring above a scattered match', () => {
    const score = (t: string) => fuzzyMatch('note', t)!.score
    expect(score('note.md')).toBeGreaterThan(score('my note.md'))
    expect(score('my note.md')).toBeGreaterThan(score('n-o-t-e.md'))
  })
  it('prefers word-start matches', () => {
    expect(fuzzyMatch('fb', 'foo/bar')!.score).toBeGreaterThan(fuzzyMatch('fb', 'xfxb')!.score)
  })
  it('prefers shorter targets for the same match', () => {
    expect(fuzzyMatch('abc', 'abc')!.score).toBeGreaterThan(fuzzyMatch('abc', 'abc' + 'x'.repeat(40))!.score)
  })
})

describe('lib/util debounce', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('calls once with the latest arguments after the wait', () => {
    const fn = vi.fn()
    const d = debounce(fn, 100)
    d(1)
    vi.advanceTimersByTime(50)
    d(2)
    vi.advanceTimersByTime(99)
    expect(fn).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(fn).toHaveBeenCalledTimes(1)
    expect(fn).toHaveBeenCalledWith(2)
  })
  it('flush runs a pending call immediately and only once', () => {
    const fn = vi.fn()
    const d = debounce(fn, 100)
    d('a', 'b')
    d.flush()
    expect(fn).toHaveBeenCalledWith('a', 'b')
    vi.advanceTimersByTime(200)
    d.flush()
    expect(fn).toHaveBeenCalledTimes(1)
  })
  it('flush does nothing when nothing is pending', () => {
    const fn = vi.fn()
    debounce(fn, 100).flush()
    expect(fn).not.toHaveBeenCalled()
  })
  it('cancel drops the pending call', () => {
    const fn = vi.fn()
    const d = debounce(fn, 100)
    d(1)
    d.cancel()
    vi.advanceTimersByTime(200)
    d.flush()
    expect(fn).not.toHaveBeenCalled()
  })
  it('can be called again after firing', () => {
    const fn = vi.fn()
    const d = debounce(fn, 10)
    d(1)
    vi.advanceTimersByTime(10)
    d(2)
    vi.advanceTimersByTime(10)
    expect(fn.mock.calls).toEqual([[1], [2]])
  })
})

describe('lib/util escapeHtml', () => {
  it('escapes all html special characters', () => {
    expect(escapeHtml(`<a href="x" title='y'>&</a>`)).toBe('&lt;a href=&quot;x&quot; title=&#39;y&#39;&gt;&amp;&lt;/a&gt;')
  })
  it('leaves plain text untouched', () => {
    expect(escapeHtml('plain text ü')).toBe('plain text ü')
  })
})

describe('lib/util ids', () => {
  it('uid is prefixed, alphanumeric and unique', () => {
    const ids = new Set(Array.from({ length: 1000 }, () => uid('t-')))
    expect(ids.size).toBe(1000)
    for (const id of ids) expect(id).toMatch(/^t-[a-z0-9]+$/)
  })
  it('hexId is 16 lowercase hex chars and unique', () => {
    const ids = new Set(Array.from({ length: 1000 }, hexId))
    expect(ids.size).toBe(1000)
    for (const id of ids) expect(id).toMatch(/^[0-9a-f]{16}$/)
  })
})

describe('lib/util misc', () => {
  it('clamp keeps a value within bounds', () => {
    expect([clamp(-1, 0, 10), clamp(5, 0, 10), clamp(11, 0, 10)]).toEqual([0, 5, 10])
  })
  it('formatBytes picks B, KB or MB', () => {
    expect([formatBytes(512), formatBytes(1536), formatBytes(5 * 1024 * 1024)]).toEqual(['512 B', '1.5 KB', '5.0 MB'])
  })
  it('isMac reflects the platform reported by window.api', () => {
    expect(isMac()).toBe(false)
  })
})
