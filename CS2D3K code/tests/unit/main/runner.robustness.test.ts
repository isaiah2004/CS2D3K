// Regression test from the robustness audit: runs must not outlive the vault / window.
import { describe, expect, it } from 'vitest'
import type { WebContents } from 'electron'
import { killAllRuns, run } from '../../../src/main/runner'
import { makeTempDir, removeDir } from './helpers'

const wc = { isDestroyed: () => false, send: () => {} } as unknown as WebContents

describe('main/runner robustness', () => {
  it('killAllRuns stops every running snippet', async () => {
    const cwd = makeTempDir()
    try {
      const cmd = `"${process.execPath}" "{file}"`
      const runs = [1, 2].map(() => run(wc, { lang: 'js', code: 'setInterval(() => {}, 1000)', command: cmd }, cwd))
      await new Promise((r) => setTimeout(r, 300))
      const started = Date.now()
      killAllRuns()
      const results = await Promise.all(runs)
      expect(Date.now() - started).toBeLessThan(10_000)
      for (const r of results) expect(r.code).not.toBe(0)
    } finally {
      removeDir(cwd)
    }
  }, 20_000)
})
