import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  useCommands,
  registerCommands,
  executeCommand,
  eventToHotkey,
  formatHotkey,
  hotkeysFor,
  normalizeHotkey,
  handleHotkey,
  hotkeyRecorder,
  type Command
} from '@/store/commands'
import { useSettings, DEFAULT_SETTINGS } from '@/store/settings'

type KeyInit = { key: string; code?: string; ctrl?: boolean; meta?: boolean; alt?: boolean; shift?: boolean }
const key = ({ key, code = '', ctrl, meta, alt, shift }: KeyInit): KeyboardEvent =>
  new KeyboardEvent('keydown', { key, code, ctrlKey: !!ctrl, metaKey: !!meta, altKey: !!alt, shiftKey: !!shift, cancelable: true, bubbles: true })

const setPlatform = (p: string): void => {
  ;(window.api as { platform: string }).platform = p
}
const setUserHotkeys = (hotkeys: Record<string, string[]>): void =>
  useSettings.setState({ settings: { ...structuredClone(DEFAULT_SETTINGS), hotkeys } })

const cmd = (id: string, extra: Partial<Command> = {}): Command => ({ id, name: id, run: vi.fn(), ...extra })

beforeEach(() => {
  setPlatform('win32')
  hotkeyRecorder.active = false
  useCommands.setState({ commands: {}, recent: [] })
  setUserHotkeys({})
})

afterEach(() => {
  setPlatform('win32')
  hotkeyRecorder.active = false
  vi.restoreAllMocks()
})

describe('store/commands eventToHotkey', () => {
  it('maps Ctrl to Mod on Windows/Linux and keeps Meta separate', () => {
    expect(eventToHotkey(key({ key: 'p', code: 'KeyP', ctrl: true }))).toBe('Mod+P')
    expect(eventToHotkey(key({ key: 'p', code: 'KeyP', meta: true }))).toBe('Meta+P')
  })

  it('maps Cmd to Mod on macOS and keeps Ctrl separate', () => {
    setPlatform('darwin')
    expect(eventToHotkey(key({ key: 'p', code: 'KeyP', meta: true }))).toBe('Mod+P')
    expect(eventToHotkey(key({ key: '`', code: 'Backquote', ctrl: true }))).toBe('Ctrl+`')
    expect(eventToHotkey(key({ key: 'p', code: 'KeyP', meta: true, ctrl: true }))).toBe('Mod+Ctrl+P')
  })

  it('emits modifiers in canonical order Mod, Alt, Shift', () => {
    expect(eventToHotkey(key({ key: 'K', code: 'KeyK', ctrl: true, alt: true, shift: true }))).toBe('Mod+Alt+Shift+K')
  })

  it('uses the physical key for letters and digits so Shift/Alt combos are stable', () => {
    expect(eventToHotkey(key({ key: 'Ω', code: 'KeyZ', alt: true }))).toBe('Alt+Z')
    expect(eventToHotkey(key({ key: '!', code: 'Digit1', shift: true }))).toBe('Shift+1')
    expect(eventToHotkey(key({ key: 'f', code: 'KeyF', ctrl: true, shift: true }))).toBe('Mod+Shift+F')
  })

  it('maps punctuation by physical key', () => {
    expect(eventToHotkey(key({ key: '~', code: 'Backquote', ctrl: true, shift: true }))).toBe('Mod+Shift+`')
    expect(eventToHotkey(key({ key: ',', code: 'Comma', ctrl: true }))).toBe('Mod+,')
    expect(eventToHotkey(key({ key: '>', code: 'Period', shift: true }))).toBe('Shift+.')
    expect(eventToHotkey(key({ key: '/', code: 'Slash', ctrl: true }))).toBe('Mod+/')
    expect(eventToHotkey(key({ key: '{', code: 'BracketLeft', shift: true }))).toBe('Shift+[')
    expect(eventToHotkey(key({ key: ']', code: 'BracketRight', ctrl: true }))).toBe('Mod+]')
  })

  it('names special keys', () => {
    expect(eventToHotkey(key({ key: ' ', code: 'Space', ctrl: true }))).toBe('Mod+Space')
    expect(eventToHotkey(key({ key: 'ArrowLeft', code: 'ArrowLeft', alt: true }))).toBe('Alt+ArrowLeft')
    expect(eventToHotkey(key({ key: 'F5', code: 'F5' }))).toBe('F5')
    expect(eventToHotkey(key({ key: 'Enter', code: 'Enter', ctrl: true, shift: true }))).toBe('Mod+Shift+Enter')
    expect(eventToHotkey(key({ key: 'Tab', code: 'Tab', ctrl: true }))).toBe('Mod+Tab')
  })

  it('uppercases single-character keys when there is no physical code', () => {
    expect(eventToHotkey(key({ key: 'e', ctrl: true }))).toBe('Mod+E')
  })

  it('returns null for a lone modifier key', () => {
    for (const k of ['Control', 'Shift', 'Alt', 'Meta']) expect(eventToHotkey(key({ key: k, ctrl: k === 'Control' }))).toBeNull()
  })
})

describe('store/commands normalizeHotkey / formatHotkey', () => {
  it('orders modifiers canonically and uppercases single-character keys', () => {
    expect(normalizeHotkey('Shift+Alt+f')).toBe('Alt+Shift+F')
    expect(normalizeHotkey('Shift+Mod+p')).toBe('Mod+Shift+P')
    expect(normalizeHotkey('Alt+Ctrl+Mod+x')).toBe('Mod+Ctrl+Alt+X')
    expect(normalizeHotkey('F2')).toBe('F2')
    expect(normalizeHotkey('Alt+ArrowLeft')).toBe('Alt+ArrowLeft')
  })

  it('matches what eventToHotkey produces', () => {
    expect(normalizeHotkey('Shift+Alt+F')).toBe(eventToHotkey(key({ key: 'F', code: 'KeyF', alt: true, shift: true })))
  })

  it('formats with words and + on Windows', () => {
    expect(formatHotkey('Mod+Shift+P')).toBe('Ctrl+Shift+P')
    expect(formatHotkey('Alt+ArrowLeft')).toBe('Alt+←')
  })

  it('formats with symbols and no separator on macOS', () => {
    setPlatform('darwin')
    expect(formatHotkey('Mod+Shift+P')).toBe('⌘⇧P')
    expect(formatHotkey('Ctrl+Alt+ArrowUp')).toBe('⌃⌥↑')
  })
})

describe('store/commands registry', () => {
  it('registerCommands adds commands and the returned function removes them', () => {
    const off = registerCommands([cmd('a'), cmd('b')])
    expect(Object.keys(useCommands.getState().commands).sort()).toEqual(['a', 'b'])
    off()
    expect(useCommands.getState().commands).toEqual({})
  })

  it('a stale unregister does not remove a newer command with the same id', () => {
    const offOld = registerCommands([cmd('a')])
    const newer = cmd('a')
    registerCommands([newer])
    offOld()
    expect(useCommands.getState().commands.a).toBe(newer)
  })

  it('executeCommand runs the command and records it as most recent', () => {
    const a = cmd('a')
    registerCommands([a, cmd('b')])
    expect(executeCommand('a')).toBe(true)
    expect(executeCommand('b')).toBe(true)
    expect(executeCommand('a')).toBe(true)
    expect(a.run).toHaveBeenCalledTimes(2)
    expect(useCommands.getState().recent).toEqual(['a', 'b'])
  })

  it('keeps at most 10 recent commands', () => {
    const ids = Array.from({ length: 12 }, (_, i) => `c${i}`)
    registerCommands(ids.map((id) => cmd(id)))
    ids.forEach(executeCommand)
    expect(useCommands.getState().recent).toEqual(ids.slice(2).reverse())
  })

  it('executeCommand returns false for unknown commands', () => {
    expect(executeCommand('nope')).toBe(false)
  })

  it('executeCommand does not run a command whose check fails', () => {
    const c = cmd('a', { check: () => false })
    registerCommands([c])
    expect(executeCommand('a')).toBe(false)
    expect(c.run).not.toHaveBeenCalled()
    expect(useCommands.getState().recent).toEqual([])
  })

  it('logs (and swallows) an async command failure', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    registerCommands([cmd('a', { run: () => Promise.reject(new Error('boom')) })])
    expect(executeCommand('a')).toBe(true)
    await Promise.resolve()
    await Promise.resolve()
    expect(err).toHaveBeenCalledWith('command a failed', expect.any(Error))
  })

  it('logs (and swallows) a command that throws synchronously', () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    registerCommands([
      cmd('a', {
        run: () => {
          throw new Error('boom')
        }
      })
    ])
    expect(() => executeCommand('a')).not.toThrow()
    expect(err).toHaveBeenCalledWith('command a failed', expect.any(Error))
  })

  it('hotkeysFor returns defaults, user overrides, or nothing when the user removed them', () => {
    registerCommands([cmd('a', { hotkeys: ['Mod+A'] }), cmd('b', { hotkeys: ['Mod+B'] }), cmd('c', { hotkeys: ['Mod+C'] })])
    setUserHotkeys({ b: ['Alt+B'], c: [] })
    expect(hotkeysFor('a')).toEqual(['Mod+A'])
    expect(hotkeysFor('b')).toEqual(['Alt+B'])
    expect(hotkeysFor('c')).toEqual([])
    expect(hotkeysFor('unknown')).toEqual([])
  })
})

describe('store/commands handleHotkey', () => {
  it('runs the command bound to the pressed combo and swallows the event', () => {
    const c = cmd('palette', { hotkeys: ['Mod+P'] })
    registerCommands([c])
    const e = key({ key: 'p', code: 'KeyP', ctrl: true })
    const stop = vi.spyOn(e, 'stopPropagation')
    expect(handleHotkey(e)).toBe(true)
    expect(c.run).toHaveBeenCalledOnce()
    expect(e.defaultPrevented).toBe(true)
    expect(stop).toHaveBeenCalled()
  })

  it('matches default hotkeys written with modifiers in any order', () => {
    const c = cmd('format', { hotkeys: ['Shift+Alt+F'] })
    registerCommands([c])
    expect(handleHotkey(key({ key: 'F', code: 'KeyF', alt: true, shift: true }))).toBe(true)
    expect(c.run).toHaveBeenCalledOnce()
  })

  it('leaves unbound combos alone', () => {
    registerCommands([cmd('palette', { hotkeys: ['Mod+P'] })])
    const e = key({ key: 'p', code: 'KeyP' })
    expect(handleHotkey(e)).toBe(false)
    expect(e.defaultPrevented).toBe(false)
  })

  it('ignores lone modifier presses', () => {
    expect(handleHotkey(key({ key: 'Control', ctrl: true }))).toBe(false)
  })

  it('skips commands whose check fails and falls through to the next match', () => {
    const editor = cmd('code:run', { hotkeys: ['Mod+Shift+Enter'], check: () => false })
    const md = cmd('md:run', { hotkeys: ['Mod+Shift+Enter'], check: () => true })
    registerCommands([editor, md])
    expect(handleHotkey(key({ key: 'Enter', code: 'Enter', ctrl: true, shift: true }))).toBe(true)
    expect(editor.run).not.toHaveBeenCalled()
    expect(md.run).toHaveBeenCalledOnce()
  })

  it('does not swallow the event when every matching command is unavailable', () => {
    registerCommands([cmd('a', { hotkeys: ['Mod+E'], check: () => false })])
    const e = key({ key: 'e', code: 'KeyE', ctrl: true })
    expect(handleHotkey(e)).toBe(false)
    expect(e.defaultPrevented).toBe(false)
  })

  it('user overrides replace the default hotkey', () => {
    const c = cmd('a', { hotkeys: ['Mod+E'] })
    registerCommands([c])
    setUserHotkeys({ a: ['Mod+Shift+K'] })
    expect(handleHotkey(key({ key: 'e', code: 'KeyE', ctrl: true }))).toBe(false)
    expect(handleHotkey(key({ key: 'K', code: 'KeyK', ctrl: true, shift: true }))).toBe(true)
    expect(c.run).toHaveBeenCalledOnce()
  })

  it('an empty user override removes the default hotkey', () => {
    const c = cmd('a', { hotkeys: ['Mod+E'] })
    registerCommands([c])
    setUserHotkeys({ a: [] })
    expect(handleHotkey(key({ key: 'e', code: 'KeyE', ctrl: true }))).toBe(false)
    expect(c.run).not.toHaveBeenCalled()
  })

  it('uses the platform Mod key', () => {
    const c = cmd('a', { hotkeys: ['Mod+E'] })
    registerCommands([c])
    setPlatform('darwin')
    expect(handleHotkey(key({ key: 'e', code: 'KeyE', ctrl: true }))).toBe(false)
    expect(handleHotkey(key({ key: 'e', code: 'KeyE', meta: true }))).toBe(true)
  })

  it('does nothing while the hotkey recorder is active', () => {
    const c = cmd('a', { hotkeys: ['Mod+E'] })
    registerCommands([c])
    hotkeyRecorder.active = true
    const e = key({ key: 'e', code: 'KeyE', ctrl: true })
    expect(handleHotkey(e)).toBe(false)
    expect(c.run).not.toHaveBeenCalled()
    expect(e.defaultPrevented).toBe(false)
    hotkeyRecorder.active = false
    expect(handleHotkey(key({ key: 'e', code: 'KeyE', ctrl: true }))).toBe(true)
  })
})
