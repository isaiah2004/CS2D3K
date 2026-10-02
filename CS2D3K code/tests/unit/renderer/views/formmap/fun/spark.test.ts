import { afterEach, describe, expect, it, vi } from 'vitest'
import { randomSpark, SPARKS } from '@/views/formmap/fun/spark'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('formmap/fun/spark', () => {
  it('has plenty of unique, non-empty prompts phrased as questions', () => {
    expect(SPARKS.length).toBeGreaterThan(10)
    expect(new Set(SPARKS).size).toBe(SPARKS.length)
    for (const s of SPARKS) {
      expect(s.trim()).toBe(s)
      expect(s.endsWith('?')).toBe(true)
    }
  })

  it('returns one of the prompts', () => {
    for (let i = 0; i < 20; i++) expect(SPARKS).toContain(randomSpark())
  })

  it('never returns the same prompt twice in a row, even when the dice repeat', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5)
    const first = randomSpark()
    const second = randomSpark()
    expect(second).not.toBe(first)
  })

  it('wraps around from the last prompt to the first', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.99999)
    const last = randomSpark()
    // a repeat of the last index must wrap to index 0, unless the previous call already was the last one
    const next = randomSpark()
    expect([last, next]).toContain(SPARKS[SPARKS.length - 1])
    expect(next).not.toBe(last)
  })
})
