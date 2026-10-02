import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { applyTheme, cssVar, effectiveMode, hexToHsl, initTheme, onThemeChange, resolveColor, themePalette } from '@/theme/theme'
import { BUILTIN_THEMES } from '@/theme/builtin'
import { useSettings, DEFAULT_SETTINGS, type Settings } from '@/store/settings'
import { memory } from '../../helpers/vault'

const settings = (p: Partial<Settings> = {}): Settings => ({ ...structuredClone(DEFAULT_SETTINGS), ...p })
const body = document.body
const prop = (name: string): string => body.style.getPropertyValue(name)
const styleText = (id: string): string | null | undefined => document.getElementById(id)?.textContent

/** Stub prefers-color-scheme; returns a function that flips it and fires 'change'. */
function stubSystemDark(initial: boolean): (dark: boolean) => void {
  let dark = initial
  const listeners = new Set<() => void>()
  vi.spyOn(window, 'matchMedia').mockImplementation(
    (q: string) =>
      ({
        get matches() {
          return q.includes('dark') ? dark : false
        },
        media: q,
        addEventListener: (_: string, cb: () => void) => listeners.add(cb),
        removeEventListener: (_: string, cb: () => void) => listeners.delete(cb)
      }) as unknown as MediaQueryList
  )
  return (d) => {
    dark = d
    listeners.forEach((cb) => cb())
  }
}

const nextFrame = (): Promise<void> => new Promise((r) => requestAnimationFrame(() => r()))
/** let applyTheme's awaited IPC calls settle */
const settle = async (): Promise<void> => {
  for (let i = 0; i < 10; i++) await Promise.resolve()
}

let cleanups: (() => void)[] = []
const init = (): (() => void) => {
  const stop = initTheme()
  cleanups.push(stop)
  return stop
}

beforeEach(async () => {
  await nextFrame()
  memory().reset()
  useSettings.setState({ settings: settings(), loaded: true })
  body.className = ''
  body.removeAttribute('style')
  document.getElementById('cs2d3k-theme')?.remove()
  document.getElementById('cs2d3k-snippets')?.remove()
})

afterEach(() => {
  cleanups.forEach((c) => c())
  cleanups = []
  vi.restoreAllMocks()
})

describe('theme hexToHsl', () => {
  it.each([
    ['#ff0000', { h: 0, s: 100, l: 50 }],
    ['#00ff00', { h: 120, s: 100, l: 50 }],
    ['#0000ff', { h: 240, s: 100, l: 50 }],
    ['#ffffff', { h: 0, s: 0, l: 100 }],
    ['#000000', { h: 0, s: 0, l: 0 }],
    ['#808080', { h: 0, s: 0, l: 50 }],
    ['#8a5cf5', { h: 258, s: 88, l: 66 }]
  ])('converts %s', (hex, hsl) => {
    expect(hexToHsl(hex)).toEqual(hsl)
  })

  it('accepts 3-digit shorthand and a missing #', () => {
    expect(hexToHsl('#f00')).toEqual(hexToHsl('#ff0000'))
    expect(hexToHsl('00ff00')).toEqual({ h: 120, s: 100, l: 50 })
  })

  it('keeps hue in [0, 360) for magenta-ish colors', () => {
    expect(hexToHsl('#ff00ff')).toEqual({ h: 300, s: 100, l: 50 })
    expect(hexToHsl('#ff0080').h).toBe(330)
  })
})

describe('theme effectiveMode', () => {
  it('returns explicit modes regardless of the system preference', () => {
    stubSystemDark(true)
    expect(effectiveMode(settings({ baseTheme: 'light' }))).toBe('light')
    stubSystemDark(false)
    expect(effectiveMode(settings({ baseTheme: 'dark' }))).toBe('dark')
  })

  it('follows prefers-color-scheme when set to system', () => {
    stubSystemDark(true)
    expect(effectiveMode(settings({ baseTheme: 'system' }))).toBe('dark')
    stubSystemDark(false)
    expect(effectiveMode(settings({ baseTheme: 'system' }))).toBe('light')
  })
})

describe('theme applyTheme', () => {
  it('toggles body.theme-dark / body.theme-light', async () => {
    await applyTheme(settings({ baseTheme: 'dark' }))
    expect(body.classList.contains('theme-dark')).toBe(true)
    expect(body.classList.contains('theme-light')).toBe(false)
    await applyTheme(settings({ baseTheme: 'light' }))
    expect(body.classList.contains('theme-dark')).toBe(false)
    expect(body.classList.contains('theme-light')).toBe(true)
  })

  it('uses the system scheme for baseTheme system', async () => {
    stubSystemDark(false)
    await applyTheme(settings({ baseTheme: 'system' }))
    expect(body.classList.contains('theme-light')).toBe(true)
  })

  it('defaults to the current settings when called without arguments', async () => {
    useSettings.setState({ settings: settings({ baseTheme: 'light' }) })
    await applyTheme()
    expect(body.classList.contains('theme-light')).toBe(true)
  })

  it('sets the accent HSL variables, falling back to the default accent', async () => {
    await applyTheme(settings({ accentColor: '#ff0000' }))
    expect([prop('--accent-h'), prop('--accent-s'), prop('--accent-l')]).toEqual(['0', '100%', '50%'])
    await applyTheme(settings({ accentColor: '' }))
    expect([prop('--accent-h'), prop('--accent-s'), prop('--accent-l')]).toEqual(['258', '88%', '66%'])
  })

  it('sets font families with the theme font as fallback', async () => {
    await applyTheme(settings({ textFont: '  Inter ', monoFont: '', interfaceFont: 'Segoe UI' }))
    expect(prop('--font-text')).toBe('Inter, var(--font-text-theme)')
    expect(prop('--font-monospace')).toBe('var(--font-monospace-theme)')
    expect(prop('--font-interface')).toBe('Segoe UI, var(--font-interface-theme)')
  })

  it('sets font size variables', async () => {
    await applyTheme(settings({ editorFontSize: 18, codeFontSize: 12, uiFontSize: 14 }))
    expect(prop('--font-text-size')).toBe('18px')
    expect(prop('--font-code-size')).toBe('12px')
    expect(prop('--font-ui-medium')).toBe('14px')
    expect(prop('--font-ui-small')).toBe('13px')
    expect(prop('--font-ui-smaller')).toBe('12px')
  })

  it('toggles layout body classes from settings', async () => {
    await applyTheme(settings({ readableLineLength: true, showRibbon: false, showStatusBar: false, showInlineTitle: true }))
    for (const c of ['readable-line-width', 'hide-ribbon', 'hide-status-bar', 'show-inline-title']) expect(body.classList.contains(c)).toBe(true)
    await applyTheme(settings({ readableLineLength: false, showRibbon: true, showStatusBar: true, showInlineTitle: false }))
    for (const c of ['readable-line-width', 'hide-ribbon', 'hide-status-bar', 'show-inline-title']) expect(body.classList.contains(c)).toBe(false)
  })

  it('injects the CSS of a built-in theme, and clears it for the default theme', async () => {
    await applyTheme(settings({ theme: 'builtin:Nord' }))
    expect(styleText('cs2d3k-theme')).toBe(BUILTIN_THEMES.find((t) => t.name === 'Nord')!.css)
    await applyTheme(settings({ theme: '' }))
    expect(styleText('cs2d3k-theme')).toBe('')
    expect(document.querySelectorAll('#cs2d3k-theme')).toHaveLength(1)
  })

  it('loads a vault theme by name', async () => {
    vi.spyOn(window.api.config, 'listThemes').mockResolvedValue([{ name: 'Minimal', path: 'themes/Minimal.css' }] as never)
    const readCss = vi.spyOn(window.api.config, 'readCss').mockResolvedValue('body { --x: 1 }')
    await applyTheme(settings({ theme: 'Minimal' }))
    expect(readCss).toHaveBeenCalledWith('themes/Minimal.css')
    expect(styleText('cs2d3k-theme')).toBe('body { --x: 1 }')
  })

  it('uses no theme CSS when the theme is unknown or unreadable', async () => {
    await applyTheme(settings({ theme: 'builtin:Nope' }))
    expect(styleText('cs2d3k-theme')).toBe('')
    await applyTheme(settings({ theme: 'Missing' }))
    expect(styleText('cs2d3k-theme')).toBe('')
    vi.spyOn(window.api.config, 'listThemes').mockResolvedValue([{ name: 'Broken', path: 'b.css' }] as never)
    vi.spyOn(window.api.config, 'readCss').mockRejectedValue(new Error('EACCES'))
    await applyTheme(settings({ theme: 'Broken' }))
    expect(styleText('cs2d3k-theme')).toBe('')
  })

  it('concatenates only the enabled snippets and skips unreadable ones', async () => {
    vi.spyOn(window.api.config, 'listSnippets').mockResolvedValue([
      { name: 'a', path: 'a.css' },
      { name: 'b', path: 'b.css' },
      { name: 'bad', path: 'bad.css' }
    ] as never)
    vi.spyOn(window.api.config, 'readCss').mockImplementation(async (p: string) => {
      if (p === 'bad.css') throw new Error('gone')
      return `.${p.replace('.css', '')} {}`
    })
    await applyTheme(settings({ enabledSnippets: ['b', 'bad'] }))
    expect(styleText('cs2d3k-snippets')).toBe('/* snippet: b */\n.b {}')
  })

  it('updates the title bar overlay colors', async () => {
    const overlay = vi.spyOn(window.api.app, 'setTitleBarOverlay')
    await applyTheme(settings())
    expect(overlay).toHaveBeenCalledOnce()
    const [bg, fg] = overlay.mock.calls[0] as [string, string]
    expect(bg).toMatch(/^#[0-9a-f]{6}$/)
    expect(fg).toMatch(/^#[0-9a-f]{6}$/)
  })

  it('the latest call wins when applies overlap', async () => {
    let release!: (v: never) => void
    vi.spyOn(window.api.config, 'listThemes').mockReturnValueOnce(new Promise((r) => (release = r)))
    const slow = applyTheme(settings({ theme: 'Slow' }))
    await applyTheme(settings({ theme: 'builtin:Dracula' }))
    release([{ name: 'Slow', path: 'slow.css' }] as never)
    await slow
    expect(styleText('cs2d3k-theme')).toBe(BUILTIN_THEMES.find((t) => t.name === 'Dracula')!.css)
  })
})

describe('theme onThemeChange', () => {
  it('notifies listeners on the next frame after a theme is applied, until unsubscribed', async () => {
    const cb = vi.fn()
    const off = onThemeChange(cb)
    await applyTheme(settings())
    expect(cb).not.toHaveBeenCalled()
    await nextFrame()
    expect(cb).toHaveBeenCalledOnce()
    off()
    await applyTheme(settings())
    await nextFrame()
    expect(cb).toHaveBeenCalledOnce()
  })

  it('does not notify for a superseded apply', async () => {
    const cb = vi.fn()
    const off = onThemeChange(cb)
    const first = applyTheme(settings({ baseTheme: 'light' }))
    const second = applyTheme(settings({ baseTheme: 'dark' }))
    await Promise.all([first, second])
    await nextFrame()
    expect(cb).toHaveBeenCalledOnce()
    off()
  })
})

describe('theme initTheme', () => {
  it('applies immediately and re-applies when an appearance setting changes', async () => {
    stubSystemDark(true)
    const stop = init()
    expect(body.classList.contains('theme-dark')).toBe(true)
    useSettings.setState({ settings: settings({ baseTheme: 'light' }) })
    expect(body.classList.contains('theme-light')).toBe(true)
    useSettings.setState({ settings: settings({ baseTheme: 'light', showRibbon: false }) })
    expect(body.classList.contains('hide-ribbon')).toBe(true)
    stop()
    await settle()
  })

  it('ignores unrelated settings changes', async () => {
    stubSystemDark(true)
    const stop = init()
    await settle()
    body.classList.remove('theme-dark')
    useSettings.setState({ settings: { ...useSettings.getState().settings, vimMode: true } })
    expect(body.classList.contains('theme-dark')).toBe(false)
    stop()
  })

  it('follows system scheme changes only while baseTheme is system', async () => {
    const setDark = stubSystemDark(true)
    useSettings.setState({ settings: settings({ baseTheme: 'system' }) })
    const stop = init()
    expect(body.classList.contains('theme-dark')).toBe(true)
    setDark(false)
    expect(body.classList.contains('theme-light')).toBe(true)
    useSettings.setState({ settings: settings({ baseTheme: 'dark' }) })
    setDark(true)
    setDark(false)
    expect(body.classList.contains('theme-dark')).toBe(true)
    stop()
    await settle()
  })

  it('re-applies when theme/snippet CSS files change', async () => {
    let onCss: (() => void) | undefined
    vi.spyOn(window.api.config, 'onCssChange').mockImplementation((cb) => {
      onCss = cb as () => void
      return () => (onCss = undefined)
    })
    const stop = init()
    await settle()
    body.classList.remove('theme-dark')
    onCss!()
    expect(body.classList.contains('theme-dark')).toBe(true)
    stop()
    expect(onCss).toBeUndefined()
  })

  it('stops reacting after cleanup', async () => {
    const setDark = stubSystemDark(true)
    useSettings.setState({ settings: settings({ baseTheme: 'system' }) })
    const stop = init()
    stop()
    await settle()
    useSettings.setState({ settings: settings({ baseTheme: 'light' }) })
    expect(body.classList.contains('theme-light')).toBe(false)
    setDark(false)
    expect(body.classList.contains('theme-light')).toBe(false)
  })
})

describe('theme colors', () => {
  it('resolveColor converts rgb/hex expressions to #rrggbb', () => {
    expect(resolveColor('rgb(255, 0, 0)')).toBe('#ff0000')
    expect(resolveColor('#00ff00')).toBe('#00ff00')
  })

  it('resolveColor appends alpha for translucent colors', () => {
    expect(resolveColor('rgba(0, 0, 255, 0.5)')).toBe('#0000ff80')
  })

  it('cssVar reads a variable set on body', () => {
    body.style.setProperty('--my-var', ' 12px ')
    expect(cssVar('--my-var')).toBe('12px')
  })

  it('themePalette resolves every token to a color and reports the mode', async () => {
    await applyTheme(settings({ baseTheme: 'light' }))
    const pal = themePalette()
    for (const k of ['background-primary', 'text-normal', 'interactive-accent', 'code-keyword', 'graph-node', 'color-red'])
      expect(pal[k]).toMatch(/^#[0-9a-f]{6}([0-9a-f]{2})?$/)
    expect(pal.mode).toBe('light')
    await applyTheme(settings({ baseTheme: 'dark' }))
    expect(themePalette().mode).toBe('dark')
  })
})
