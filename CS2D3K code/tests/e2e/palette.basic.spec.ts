// Command palette, quick switcher and the hotkeys editor.
import { test, expect } from './fixtures'
import { Palette } from './helpers/palette'
import { Tabs } from './helpers/tabs'
import { Sidebars } from './helpers/sidebars'
import { SettingsModal } from './helpers/settings'

test.use({ vault: { source: 'shell' } })

test.describe('command palette @basic', () => {
  test('fuzzy search with highlights and hotkey hints; Enter runs the command', async ({ app, page }) => {
    const palette = new Palette(page)
    const tabs = new Tabs(app)
    await app.openFile('Alpha.md')
    await palette.openCommands()
    await palette.type('splt rght')
    await expect(palette.items().first().locator('.suggestion-main')).toHaveText('Split right')
    await expect(palette.selected()).toHaveText(/Split right/)
    await expect(palette.items().first().locator('.suggestion-highlight').first()).toBeVisible()
    await expect(palette.items().first().locator('kbd')).toHaveText('Ctrl+\\')
    await page.keyboard.press('Enter')
    await expect(palette.modal()).toHaveCount(0)
    await expect(tabs.leaves()).toHaveCount(2)

    // no match
    await palette.openCommands()
    await palette.type('qqqzzz')
    await expect(page.locator('.prompt-results .empty-state')).toHaveText('No commands found.')
    await palette.close()
  })

  test('arrow keys and mouse pick a command; unavailable commands are hidden', async ({ app, page }) => {
    const palette = new Palette(page)
    const sb = new Sidebars(app)
    await palette.openCommands()
    await palette.type('toggle sidebar')
    const texts = await palette.texts()
    expect(texts.slice(0, 2).sort()).toEqual(['Toggle left sidebar', 'Toggle right sidebar'])
    await page.keyboard.press('ArrowDown')
    await expect(palette.selected().locator('.suggestion-main')).toHaveText(texts[1])
    await page.keyboard.press('ArrowUp')
    await expect(palette.selected().locator('.suggestion-main')).toHaveText(texts[0])
    await palette.items().filter({ hasText: 'Toggle right sidebar' }).click()
    await sb.expectOpen('right', false)

    // file commands need an active file
    await palette.openCommands()
    await palette.type('Delete current file')
    await expect(palette.items().filter({ hasText: 'Delete current file' })).toHaveCount(0)
    await palette.close()
    await app.openFile('Beta.md')
    await palette.openCommands()
    await palette.type('Delete current file')
    await expect(palette.items().first()).toHaveText('Delete current file')
    await palette.close()
  })

  test('a note that finishes loading does not steal focus from the palette', async ({ app, page }) => {
    const palette = new Palette(page)
    const sb = new Sidebars(app)
    for (const note of ['Alpha.md', 'Beta.md', 'Folder A/Gamma.md']) {
      await app.treeItem(note.includes('/') ? 'Folder A' : note).click()
      if (note.includes('/')) await app.treeItem(note).click()
      await page.keyboard.press('Control+P')
      await page.keyboard.type('toggle right sidebar')
      await expect(palette.input()).toBeFocused()
      await expect(palette.input()).toHaveValue('toggle right sidebar')
      await page.keyboard.press('Enter')
      await expect(palette.modal()).toHaveCount(0)
    }
    await sb.expectOpen('right', false)
    for (const note of ['Alpha.md', 'Beta.md', 'Folder A/Gamma.md']) expect(app.read(note)).not.toContain('toggle')
  })

  test('recently used commands are listed first', async ({ app, page }) => {
    const palette = new Palette(page)
    await app.runPaletteCommand('Toggle left sidebar')
    await app.runPaletteCommand('Toggle left sidebar')
    await app.runPaletteCommand('New tab')
    await palette.openCommands()
    const texts = await palette.texts()
    expect(texts.slice(0, 2)).toEqual(['New tab', 'Toggle left sidebar'])
    // the rest is alphabetical
    const rest = texts.slice(2)
    expect(rest).toEqual([...rest].sort((a, b) => a.localeCompare(b)))
    await palette.close()
  })
})

test.describe('quick switcher @basic', () => {
  test('fuzzy matches note names and paths; Enter opens; code files show their extension', async ({ app, page }) => {
    const palette = new Palette(page)
    await palette.openSwitcher()
    // empty query: recent files
    await expect(palette.items()).toHaveCount(7)
    await palette.type('gam')
    await expect(palette.items().first().locator('.suggestion-main')).toHaveText('Folder A/Gamma')
    await expect(palette.items().first().locator('.suggestion-highlight')).toHaveText(['Gam'])
    await palette.type('fbdlt')
    await expect(palette.items().first().locator('.suggestion-main')).toHaveText('Folder B/Delta')
    await palette.type('script')
    await expect(palette.items().first()).toContainText('code/script.py')
    await expect(palette.items().first().locator('.kbd')).toHaveText('PY')
    await palette.type('gam')
    await page.keyboard.press('Enter')
    await expect.poll(() => app.activeFile()).toBe('Folder A/Gamma.md')
    await expect(palette.modal()).toHaveCount(0)
  })

  test('Enter on a missing name creates the note (also in a sub folder); unresolved links are offered', async ({ app, page }) => {
    const palette = new Palette(page)
    await palette.openSwitcher()
    await palette.type('Brand new note')
    await expect(page.locator('.prompt-results .empty-state')).toContainText('Press Enter to create Brand new note')
    await page.keyboard.press('Enter')
    await expect.poll(() => app.activeFile()).toBe('Brand new note.md')
    expect(app.read('Brand new note.md')).toBe('')

    await palette.openSwitcher()
    await palette.type('Inbox/Idea one')
    await page.keyboard.press('Enter')
    await expect.poll(() => app.activeFile()).toBe('Inbox/Idea one.md')
    expect(app.exists('Inbox/Idea one.md')).toBe(true)

    await palette.openSwitcher()
    await palette.type('unresolved id')
    const unresolved = palette.items().filter({ hasText: 'not created yet' })
    await expect(unresolved).toHaveText(/Unresolved idea — not created yet/)
    await unresolved.click()
    // created next to the active note (default "same folder as current file")
    await expect.poll(() => app.activeFile()).toBe('Inbox/Unresolved idea.md')
  })

  test('Ctrl+Enter opens in a new tab, Shift+Enter to the right', async ({ app, page }) => {
    const palette = new Palette(page)
    const tabs = new Tabs(app)
    await app.openFile('Alpha.md')
    await palette.openSwitcher()
    await palette.type('beta')
    await page.keyboard.press('Control+Enter')
    await tabs.expectTitles([['Alpha', 'Beta']])
    await palette.openSwitcher()
    await palette.type('delta')
    await page.keyboard.press('Shift+Enter')
    await tabs.expectTitles([['Alpha', 'Beta'], ['Delta']])
    await palette.openSwitcher()
    await palette.type('Totally new')
    await page.keyboard.press('Control+Enter')
    await tabs.expectTitles([['Alpha', 'Beta'], ['Delta', 'Totally new']])
  })
})

test.describe('hotkeys editor @basic', () => {
  const row = (settings: SettingsModal, name: string) => settings.content().locator('.setting-item', { has: settings.page.locator('.setting-item-name', { hasText: new RegExp(`^${name}$`) }) })

  test('add a hotkey that then triggers the command; remove and reset defaults', async ({ app, page }) => {
    const settings = new SettingsModal(app)
    const sb = new Sidebars(app)
    await settings.open('Hotkeys')
    await settings.content().getByPlaceholder(/Filter by command name/).fill('toggle left sidebar')
    const r = row(settings, 'Toggle left sidebar')
    await expect(r.locator('.hotkey-pill')).toHaveText(['Ctrl+Shift+L'])

    await r.getByTitle('Add hotkey').click()
    await expect(r.locator('.hotkey-pill.is-recording')).toBeVisible()
    await page.keyboard.press('Control+Alt+J')
    await expect(r.locator('.hotkey-pill')).toHaveText(['Ctrl+Shift+L', 'Ctrl+Alt+J'])
    await expect(r).toContainText('Customized')
    await settings.expectSaved('hotkeys', { 'sidebar:toggle-left': ['Mod+Shift+L', 'Mod+Alt+J'] })
    await settings.close()

    await page.keyboard.press('Control+Alt+J')
    await sb.expectOpen('left', false)
    await page.keyboard.press('Control+Shift+L')
    await sb.expectOpen('left', true)

    // remove the default
    await settings.open('Hotkeys')
    await settings.content().getByPlaceholder(/Filter by command name/).fill('toggle left sidebar')
    await r.locator('.hotkey-pill', { hasText: 'Ctrl+Shift+L' }).getByRole('button', { name: 'Remove hotkey' }).click()
    await expect(r.locator('.hotkey-pill')).toHaveText(['Ctrl+Alt+J'])
    await settings.close()
    await page.keyboard.press('Control+Shift+L')
    await page.waitForTimeout(200)
    await sb.expectOpen('left', true)
    await expect(page.locator('.palette, .modal.prompt')).toHaveCount(0)

    // restore default
    await settings.open('Hotkeys')
    await settings.content().getByPlaceholder(/Filter by command name/).fill('toggle left sidebar')
    await r.getByTitle('Restore default').click()
    await expect(r.locator('.hotkey-pill')).toHaveText(['Ctrl+Shift+L'])
    await expect(r).not.toContainText('Customized')
    await settings.expectSaved('hotkeys', {})
    await settings.close()
    await page.keyboard.press('Control+Alt+J')
    await page.waitForTimeout(200)
    await sb.expectOpen('left', true)
  })

  test('a command without a default hotkey can get one; Escape cancels recording', async ({ app, page }) => {
    const settings = new SettingsModal(app)
    const tabs = new Tabs(app)
    await app.openFile('Alpha.md')
    await settings.open('Hotkeys')
    await settings.content().getByPlaceholder(/Filter by command name/).fill('split down')
    const r = row(settings, 'Split down')
    await expect(r.locator('.hotkey-pill')).toHaveCount(0)
    await r.getByTitle('Add hotkey').click()
    await page.keyboard.press('Escape')
    await expect(r.locator('.hotkey-pill')).toHaveCount(0)
    await expect(settings.modal()).toBeVisible()
    await r.getByTitle('Add hotkey').click()
    await page.keyboard.press('Control+Alt+D')
    await expect(r.locator('.hotkey-pill')).toHaveText(['Ctrl+Alt+D'])
    await settings.close()

    await page.keyboard.press('Control+Alt+D')
    await expect(tabs.leaves()).toHaveCount(2)
    expect(await tabs.rootSplit()).toBe('column')
    // the palette shows the new hint
    const palette = new Palette(page)
    await palette.openCommands()
    await palette.type('split down')
    await expect(palette.items().first().locator('kbd')).toHaveText('Ctrl+Alt+D')
    await palette.close()
  })

  test('conflicting hotkeys are flagged; filtering by hotkey works', async ({ app }) => {
    const settings = new SettingsModal(app)
    await settings.open('Hotkeys')
    const filter = settings.content().getByPlaceholder(/Filter by command name/)
    await filter.fill('New tab')
    const r = row(settings, 'New tab')
    await r.getByTitle('Add hotkey').click()
    await app.page.keyboard.press('Control+Shift+L')
    await expect(r.locator('.hotkey-pill', { hasText: 'Ctrl+Shift+L' })).toHaveClass(/is-conflict/)
    await expect(r.locator('.hotkey-pill', { hasText: 'Ctrl+T' })).not.toHaveClass(/is-conflict/)

    await filter.fill('ctrl+shift+l')
    await expect(settings.content().locator('.setting-item .setting-item-name')).toHaveText(['New tab', 'Toggle left sidebar'])
    await expect(row(settings, 'Toggle left sidebar').locator('.hotkey-pill')).toHaveClass(/is-conflict/)
  })
})
