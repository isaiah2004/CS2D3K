// Appearance: base color scheme, accent, built-in and vault themes (live reload), CSS snippets, fonts, title bar overlay.
import { test, expect } from './fixtures'
import { SettingsModal } from './helpers/settings'
import { Dialogs } from './helpers/dialogs'
import { cssColor, cssVar, colorDistance } from './helpers/theme'

test.use({ vault: { source: 'shell' } })

test.describe('color scheme @basic', () => {
  test('dark / light / system buttons switch the body theme and persist', async ({ app, page }) => {
    const settings = new SettingsModal(app)
    const body = page.locator('body')
    await expect(body).toHaveClass(/theme-dark/)
    expect(await cssColor(page, '--background-primary')).toBe('#1e1e1e')

    await settings.open('Appearance')
    await settings.content().locator('.segmented-btn', { hasText: 'Light' }).click()
    await expect(body).toHaveClass(/theme-light/)
    await expect(body).not.toHaveClass(/theme-dark/)
    await expect(settings.content().locator('.segmented-btn', { hasText: 'Light' })).toHaveClass(/is-active/)
    expect(await cssColor(page, '--background-primary')).toBe('#ffffff')
    await settings.expectSaved('baseTheme', 'light')

    await page.emulateMedia({ colorScheme: 'dark' })
    await settings.content().locator('.segmented-btn', { hasText: 'System' }).click()
    await expect(body).toHaveClass(/theme-dark/)
    // follows the OS live
    await page.emulateMedia({ colorScheme: 'light' })
    await expect(body).toHaveClass(/theme-light/)
    await page.emulateMedia({ colorScheme: 'dark' })
    await expect(body).toHaveClass(/theme-dark/)
    await settings.expectSaved('baseTheme', 'system')

    await settings.content().locator('.segmented-btn', { hasText: 'Dark' }).click()
    await page.emulateMedia({ colorScheme: 'light' })
    await page.waitForTimeout(200)
    await expect(body).toHaveClass(/theme-dark/)
    await settings.close()

    await app.runPaletteCommand('Toggle light/dark mode')
    await expect(body).toHaveClass(/theme-light/)
    await app.runPaletteCommand('Toggle light/dark mode')
    await expect(body).toHaveClass(/theme-dark/)
  })
})

test.describe('accent color @basic', () => {
  test('swatches and the custom picker set --interactive-accent', async ({ app, page }) => {
    const settings = new SettingsModal(app)
    await settings.open('Appearance')
    expect(colorDistance(await cssColor(page, '--interactive-accent'), '#8a5cf5')).toBeLessThanOrEqual(3)

    await settings.content().getByRole('button', { name: '#e5534b' }).click()
    await expect(settings.content().getByRole('button', { name: '#e5534b' })).toHaveClass(/is-active/)
    await expect.poll(async () => colorDistance(await cssColor(page, '--interactive-accent'), '#e5534b')).toBeLessThanOrEqual(3)
    await expect.poll(async () => colorDistance(await cssColor(page, '--text-accent'), '#e5534b')).toBeLessThanOrEqual(3)
    await settings.expectSaved('accentColor', '#e5534b')

    await settings.content().locator('input.accent-picker').fill('#1e90ff')
    await expect.poll(async () => colorDistance(await cssColor(page, '--interactive-accent'), '#1e90ff')).toBeLessThanOrEqual(3)
    await settings.expectSaved('accentColor', '#1e90ff')
    // the accent is used by the UI, e.g. the active toggle
    await settings.go('Editor')
    const toggleColor = (): Promise<string> =>
      settings.toggle('Readable line length').evaluate((el) => {
        const m = /rgb\((\d+), (\d+), (\d+)\)/.exec(getComputedStyle(el).backgroundColor)!
        return '#' + [m[1], m[2], m[3]].map((x) => Number(x).toString(16).padStart(2, '0')).join('')
      })
    await expect.poll(async () => colorDistance(await toggleColor(), '#1e90ff')).toBeLessThanOrEqual(3)
  })
})

test.describe('themes @basic', () => {
  test('built-in themes change --background-primary in dark and light mode', async ({ app, page }) => {
    const settings = new SettingsModal(app)
    await settings.open('Appearance')
    const card = (name: string) => settings.content().locator('.theme-card', { hasText: name })
    await expect(card('Default')).toHaveClass(/is-active/)

    await card('Nord').click()
    await expect(card('Nord')).toHaveClass(/is-active/)
    await expect.poll(() => cssColor(page, '--background-primary')).toBe('#2e3440')
    await settings.expectSaved('theme', 'builtin:Nord')
    await settings.content().locator('.segmented-btn', { hasText: 'Light' }).click()
    await expect.poll(() => cssColor(page, '--background-primary')).toBe('#eceff4')

    await card('Dracula').click()
    // Dracula has no light variant: light defaults stay
    await expect.poll(() => cssColor(page, '--background-primary')).toBe('#ffffff')
    await settings.content().locator('.segmented-btn', { hasText: 'Dark' }).click()
    await expect.poll(() => cssColor(page, '--background-primary')).toBe('#282a36')
    await card('Midnight (GitHub)').click()
    await expect.poll(() => cssColor(page, '--background-primary')).toBe('#0d1117')
    // the whole app follows
    expect(await page.locator('.app-main .view-container').first().evaluate((el) => getComputedStyle(el).backgroundColor)).not.toBe('rgb(30, 30, 30)')

    await card('Default').click()
    await expect.poll(() => cssColor(page, '--background-primary')).toBe('#1e1e1e')
    await settings.expectSaved('theme', '')
  })

  test('"New theme…" creates a css file, applies it, and outside edits reload live', async ({ app, page }) => {
    const settings = new SettingsModal(app)
    const dialogs = new Dialogs(page)
    await settings.open('Appearance')
    await settings.content().locator('.theme-card-new').click()
    await dialogs.prompt('New theme', 'Ocean')
    await expect.poll(() => app.exists('.cs2d3k/themes/Ocean.css')).toBe(true)
    expect(app.read('.cs2d3k/themes/Ocean.css')).toContain('Ocean — a CS2D3K theme')
    await expect(settings.content().locator('.theme-card', { hasText: 'Ocean' })).toHaveClass(/is-active/)
    await expect.poll(() => cssColor(page, '--background-primary')).toBe('#1a1b26')
    await settings.expectSaved('theme', 'Ocean')
    await expect(dialogs.notice(/Created \.cs2d3k\/themes\/Ocean\.css/)).toBeVisible()

    app.writeExternal('.cs2d3k/themes/Ocean.css', 'body.theme-dark { --color-base-00: #102030; --color-base-20: #203040; }\n')
    await expect.poll(() => cssColor(page, '--background-primary')).toBe('#102030')
    await expect.poll(() => cssColor(page, '--background-secondary')).toBe('#203040')

    // a theme folder with theme.css is listed too
    app.writeExternal('.cs2d3k/themes/Forest/theme.css', 'body.theme-dark { --color-base-00: #0f2a1a; }\n')
    await expect(settings.content().locator('.theme-card', { hasText: 'Forest' })).toBeVisible()
    await settings.content().locator('.theme-card', { hasText: 'Forest' }).click()
    await expect.poll(() => cssColor(page, '--background-primary')).toBe('#0f2a1a')

    // deleting the active theme file falls back to the default look
    app.removeExternal('.cs2d3k/themes/Forest')
    await expect.poll(() => cssColor(page, '--background-primary')).toBe('#1e1e1e')
  })

  test('the vault theme is applied on startup', async ({ app, page, relaunch }) => {
    app.writeExternal('.cs2d3k/themes/Boot.css', 'body.theme-dark { --color-base-00: #332211; }\n')
    await app.setSetting('theme', 'Boot')
    await expect.poll(() => cssColor(page, '--background-primary')).toBe('#332211')
    await new SettingsModal(app).expectSaved('theme', 'Boot')
    const next = await relaunch()
    await expect.poll(() => cssColor(next.page, '--background-primary')).toBe('#332211')
  })
})

test.describe('css snippets @basic', () => {
  test('snippets appear when added, toggle on and off, and the + button creates one', async ({ app, page }) => {
    const settings = new SettingsModal(app)
    const dialogs = new Dialogs(page)
    await settings.open('Appearance')
    await expect(settings.content()).toContainText('No snippets yet.')
    const normal = await cssColor(page, '--text-normal')

    app.writeExternal('.cs2d3k/snippets/red-text.css', 'body.theme-dark { --text-normal: #ff0000; }\n')
    await expect(settings.toggle('red-text')).toBeVisible()
    await expect(settings.toggle('red-text')).toHaveAttribute('aria-checked', 'false')
    expect(await cssColor(page, '--text-normal')).toBe(normal)

    await settings.toggle('red-text').click()
    await expect.poll(() => cssColor(page, '--text-normal')).toBe('#ff0000')
    await settings.expectSaved('enabledSnippets', ['red-text'])
    // edits to an enabled snippet apply live
    app.writeExternal('.cs2d3k/snippets/red-text.css', 'body.theme-dark { --text-normal: #00ff00; }\n')
    await expect.poll(() => cssColor(page, '--text-normal')).toBe('#00ff00')

    await settings.toggle('red-text').click()
    await expect.poll(() => cssColor(page, '--text-normal')).toBe(normal)
    await settings.expectSaved('enabledSnippets', [])

    await settings.content().getByTitle('New snippet').click()
    await dialogs.prompt('New CSS snippet', 'tweaks')
    await expect.poll(() => app.exists('.cs2d3k/snippets/tweaks.css')).toBe(true)
    await expect(settings.toggle('tweaks')).toHaveAttribute('aria-checked', 'true')
    await settings.expectSaved('enabledSnippets', ['tweaks'])
  })
})

test.describe('fonts and interface @basic', () => {
  test('font families and sizes are applied as CSS variables', async ({ app, page }) => {
    const settings = new SettingsModal(app)
    await settings.open('Appearance')
    const setText = async (name: string, value: string): Promise<void> => {
      const input = settings.item(name).locator('input')
      await input.fill(value)
      await input.press('Enter')
    }
    await setText('Interface font', 'Comic Sans MS')
    await setText('Text font', 'Georgia')
    await setText('Monospace font', 'Consolas')
    await expect.poll(() => cssVar(page, '--font-interface')).toMatch(/^Comic Sans MS,/)
    await expect.poll(() => cssVar(page, '--font-text')).toMatch(/^Georgia,/)
    await expect.poll(() => cssVar(page, '--font-monospace')).toMatch(/^Consolas,/)
    expect(await page.locator('.titlebar-title').evaluate((el) => getComputedStyle(el).fontFamily)).toContain('Comic Sans MS')

    await settings.item('Interface font size').locator('input[type=range]').fill('16')
    await settings.item('Note font size').locator('input[type=range]').fill('22')
    await expect.poll(() => cssVar(page, '--font-ui-medium')).toBe('16px')
    await expect.poll(() => cssVar(page, '--font-ui-small')).toBe('15px')
    await expect.poll(() => cssVar(page, '--font-text-size')).toBe('22px')
    await settings.expectSaved('uiFontSize', 16)
    await settings.expectSaved('editorFontSize', 22)

    // clearing a font falls back to the theme font
    await setText('Interface font', '')
    await expect.poll(() => cssVar(page, '--font-interface')).not.toContain('Comic Sans MS')

    await settings.close()
    await app.openFile('Alpha.md')
    await expect.poll(() => app.activeView().locator('.cm-content').evaluate((el) => getComputedStyle(el).fontSize)).toBe('22px')
  })

  test('ribbon, status bar and inline title toggles', async ({ app, page }) => {
    const settings = new SettingsModal(app)
    await app.openFile('Alpha.md')
    await expect(page.locator('.md-inline-title')).toBeVisible()
    await settings.open('Appearance')
    await settings.toggle('Show ribbon').click()
    await settings.toggle('Show status bar').click()
    await settings.toggle('Show inline title').click()
    await settings.close()
    await expect(page.locator('.ribbon')).toBeHidden()
    await expect(page.locator('.status-bar')).toBeHidden()
    await expect(page.locator('.leaf.is-focused .md-inline-title')).toBeHidden()
    await settings.expectSaved('showRibbon', false)
  })

  test('the title bar overlay follows the theme without errors', async ({ app, page, electronApp }) => {
    await electronApp.evaluate(({ BrowserWindow }) => {
      const w = BrowserWindow.getAllWindows()[0]
      const g = globalThis as unknown as { __overlays: unknown[] }
      g.__overlays = []
      const orig = w.setTitleBarOverlay.bind(w)
      w.setTitleBarOverlay = (o) => {
        g.__overlays.push(o)
        orig(o)
      }
    })
    const last = (): Promise<{ color?: string; symbolColor?: string } | undefined> =>
      electronApp.evaluate(() => {
        const g = globalThis as unknown as { __overlays: { color?: string; symbolColor?: string }[] }
        return g.__overlays[g.__overlays.length - 1]
      })
    await app.setTheme('light')
    await expect.poll(async () => (await last())?.color).toBe(await cssColor(page, '--background-secondary'))
    expect((await last())?.symbolColor).toBe(await cssColor(page, '--text-muted'))
    await app.setTheme('dark')
    await expect.poll(async () => (await last())?.color).toBe('#262626')
    await app.setSetting('theme', 'builtin:Nord')
    await expect.poll(async () => (await last())?.color).toBe('#3b4252')
  })
})
