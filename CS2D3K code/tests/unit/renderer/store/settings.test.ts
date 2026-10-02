import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { memory } from '../../helpers/vault'
import { useSettings, getSettings, DEFAULT_SETTINGS } from '@/store/settings'

const st = () => useSettings.getState()
const persisted = () => memory().config.get('app') as Record<string, unknown> | undefined
const pristine = structuredClone(DEFAULT_SETTINGS)

beforeEach(() => {
  vi.useFakeTimers()
  memory().reset()
  useSettings.setState({ settings: structuredClone(DEFAULT_SETTINGS), loaded: false })
})

afterEach(() => {
  vi.clearAllTimers()
  vi.useRealTimers()
})

describe('store/settings defaults', () => {
  it('ships sensible defaults', () => {
    expect(DEFAULT_SETTINGS).toMatchObject({
      defaultViewMode: 'live',
      baseTheme: 'dark',
      accentColor: '#8a5cf5',
      tabSize: 4,
      confirmDelete: true,
      updateLinksOnRename: true,
      hotkeys: {},
      runners: {}
    })
    expect(Object.values(DEFAULT_SETTINGS.corePanes).every(Boolean)).toBe(true)
  })

  it('getSettings returns the current settings', () => {
    st().set('tabSize', 2)
    expect(getSettings().tabSize).toBe(2)
  })
})

describe('store/settings load', () => {
  it('uses the defaults when nothing was saved', async () => {
    await st().load()
    expect(st().loaded).toBe(true)
    expect(st().settings).toEqual(DEFAULT_SETTINGS)
  })

  it('overlays saved values on the defaults, filling in missing keys', async () => {
    memory().config.set('app', { baseTheme: 'light', editorFontSize: 18 })
    await st().load()
    expect(st().settings).toEqual({ ...DEFAULT_SETTINGS, baseTheme: 'light', editorFontSize: 18 })
  })

  it('merges corePanes so panes added later default to enabled', async () => {
    memory().config.set('app', { corePanes: { files: false } })
    await st().load()
    expect(st().settings.corePanes).toEqual({ ...DEFAULT_SETTINGS.corePanes, files: false })
  })

  it('keeps unknown keys so they survive the next save', async () => {
    memory().config.set('app', { futureFlag: 1 })
    await st().load()
    expect((st().settings as unknown as Record<string, unknown>).futureFlag).toBe(1)
    st().set('tabSize', 8)
    vi.advanceTimersByTime(300)
    expect(persisted()).toMatchObject({ futureFlag: 1, tabSize: 8 })
  })

  it('does not write anything while loading', async () => {
    memory().config.set('app', { tabSize: 3 })
    await st().load()
    vi.advanceTimersByTime(1000)
    expect(persisted()).toEqual({ tabSize: 3 })
  })

  it('falls back to the defaults for null values in a corrupt config', async () => {
    memory().config.set('app', { hotkeys: null, runners: null, corePanes: null, tabSize: 2 })
    await st().load()
    expect(st().settings.hotkeys).toEqual(DEFAULT_SETTINGS.hotkeys)
    expect(st().settings.runners).toEqual(DEFAULT_SETTINGS.runners)
    expect(st().settings.corePanes).toEqual(DEFAULT_SETTINGS.corePanes)
    expect(st().settings.tabSize).toBe(2)
  })

  it('ignores a saved config that is not an object', async () => {
    memory().config.set('app', 'garbage')
    await st().load()
    expect(st().settings).toEqual(DEFAULT_SETTINGS)
  })
})

describe('store/settings set / patch / reset', () => {
  it('set updates one key immutably', () => {
    const before = st().settings
    st().set('vimMode', true)
    expect(st().settings.vimMode).toBe(true)
    expect(st().settings).not.toBe(before)
    expect(before.vimMode).toBe(false)
  })

  it('patch merges several keys at once', () => {
    st().patch({ showRibbon: false, uiFontSize: 15 })
    expect(st().settings).toMatchObject({ showRibbon: false, uiFontSize: 15, showStatusBar: true })
  })

  it('persists to the app config 300ms after the last change (debounced)', () => {
    st().set('tabSize', 2)
    vi.advanceTimersByTime(200)
    st().patch({ spellcheck: true })
    vi.advanceTimersByTime(200)
    expect(persisted()).toBeUndefined()
    vi.advanceTimersByTime(100)
    expect(persisted()).toMatchObject({ tabSize: 2, spellcheck: true })
  })

  it('a saved change round-trips through load', async () => {
    st().set('hotkeys', { 'app:open-settings': ['Mod+;'] })
    vi.advanceTimersByTime(300)
    useSettings.setState({ settings: structuredClone(DEFAULT_SETTINGS), loaded: false })
    await st().load()
    expect(st().settings.hotkeys).toEqual({ 'app:open-settings': ['Mod+;'] })
  })

  it('reset restores and persists the defaults', () => {
    st().patch({ tabSize: 7, baseTheme: 'light' })
    st().reset()
    expect(st().settings).toEqual(DEFAULT_SETTINGS)
    vi.advanceTimersByTime(300)
    expect(persisted()).toEqual(DEFAULT_SETTINGS)
  })

  it('never mutates DEFAULT_SETTINGS', () => {
    st().reset()
    st().set('tabSize', 9)
    st().patch({ corePanes: { ...st().settings.corePanes, files: false } })
    expect(DEFAULT_SETTINGS).toEqual(pristine)
  })
})
