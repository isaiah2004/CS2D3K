import { afterEach, describe, expect, it, vi } from 'vitest'
import { emit, on, takeUnhandled } from '@/lib/events'

describe('lib/events', () => {
  afterEach(() => {
    vi.useRealTimers()
    // drain anything a test left behind
    takeUnhandled('reveal-file', Infinity)
    takeUnhandled('focus-search', Infinity)
  })

  it('delivers the payload to every subscriber of that event only', () => {
    const a = vi.fn()
    const b = vi.fn()
    const other = vi.fn()
    const offA = on('reveal-file', a)
    const offB = on('reveal-file', b)
    const offOther = on('focus-search', other)
    emit('reveal-file', { path: 'x.md' })
    expect(a).toHaveBeenCalledWith({ path: 'x.md' })
    expect(b).toHaveBeenCalledWith({ path: 'x.md' })
    expect(other).not.toHaveBeenCalled()
    offA()
    offB()
    offOther()
  })
  it('stops delivering after unsubscribing', () => {
    const fn = vi.fn()
    const off = on('focus-search', fn)
    off()
    emit('focus-search', { query: 'q' })
    expect(fn).not.toHaveBeenCalled()
  })
  it('does not keep events that were handled', () => {
    const off = on('reveal-file', () => {})
    emit('reveal-file', { path: 'handled.md' })
    off()
    expect(takeUnhandled('reveal-file')).toBeNull()
  })
  it('keeps the latest unhandled event for a late subscriber, once', () => {
    emit('focus-search', { query: 'first' })
    emit('focus-search', { query: 'latest' })
    expect(takeUnhandled('focus-search')).toEqual({ query: 'latest' })
    expect(takeUnhandled('focus-search')).toBeNull()
  })
  it('keeps an event when all subscribers have unsubscribed', () => {
    on('reveal-file', () => {})()
    emit('reveal-file', { path: 'later.md' })
    expect(takeUnhandled('reveal-file')).toEqual({ path: 'later.md' })
  })
  it('expires unhandled events after maxAgeMs', () => {
    vi.useFakeTimers()
    emit('reveal-file', { path: 'old.md' })
    vi.advanceTimersByTime(3001)
    expect(takeUnhandled('reveal-file')).toBeNull()
    emit('reveal-file', { path: 'old.md' })
    vi.advanceTimersByTime(5000)
    expect(takeUnhandled('reveal-file', 10_000)).toEqual({ path: 'old.md' })
  })
})
