import { afterEach, describe, expect, it } from 'vitest'
import { nextTerminalCwd } from '@/lib/terminalCwd'

describe('lib/terminalCwd', () => {
  afterEach(() => nextTerminalCwd.set(null))

  it('has no pending cwd by default', () => {
    expect(nextTerminalCwd.take()).toBeNull()
  })
  it('returns the pending cwd once and then clears it', () => {
    nextTerminalCwd.set('/vault/notes')
    expect(nextTerminalCwd.value).toBe('/vault/notes')
    expect(nextTerminalCwd.take()).toBe('/vault/notes')
    expect(nextTerminalCwd.take()).toBeNull()
  })
  it('replaces an earlier pending cwd', () => {
    nextTerminalCwd.set('/a')
    nextTerminalCwd.set('/b')
    expect(nextTerminalCwd.take()).toBe('/b')
  })
  it('can be cleared by setting null', () => {
    nextTerminalCwd.set('/a')
    nextTerminalCwd.set(null)
    expect(nextTerminalCwd.take()).toBeNull()
  })
})
