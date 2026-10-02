// Settings modal: every tab renders, values persist to .cs2d3k/app.json and survive a restart, search, reset.
import { test, expect } from './fixtures'
import { SettingsModal } from './helpers/settings'
import { Dialogs } from './helpers/dialogs'

test.use({ vault: { source: 'shell' } })

const TABS: [string, string, string][] = [
  ['Editor', 'General', 'Default view for new tabs'],
  ['Files and links', 'Files', 'Confirm file deletion'],
  ['Appearance', 'Base color scheme', 'Accent color'],
  ['Hotkeys', 'Hotkeys', 'Open command palette'],
  ['Code editor', 'Code editor (Monaco)', 'Minimap'],
  ['Code runner', 'Code runner', 'Python'],
  ['Terminal', 'Terminal', 'Cursor blink'],
  ['Core panes', 'Core panes', 'Bookmarks'],
  ['About', 'About', 'Current vault']
]

test.describe('settings modal @basic', () => {
  test('opens with Ctrl+, and every tab renders its settings', async ({ app, page }) => {
    const settings = new SettingsModal(app)
    await settings.open()
    await expect(settings.modal().locator('.settings-nav-group')).toHaveText(['Options', 'Code', 'Core plugins'])
    await expect(settings.modal().locator('.settings-nav-item')).toHaveText(TABS.map((t) => t[0]))
    await expect(settings.navItem('Editor')).toHaveClass(/is-active/)
    for (const [tab, heading, item] of TABS) {
      await settings.go(tab)
      await expect(settings.content().locator('.setting-heading').first()).toHaveText(heading)
      await expect(settings.content().locator('.setting-item-name', { hasText: item }).first()).toBeVisible()
    }
    await expect(settings.content()).toContainText(app.vaultDir)
    await page.keyboard.press('Escape')
    await expect(settings.modal()).toHaveCount(0)

    // the close button and the backdrop close it too
    await settings.open()
    await settings.close()
    await settings.open()
    await page.mouse.click(5, 300)
    await expect(settings.modal()).toHaveCount(0)
  })

  test('toggles, selects, sliders and text fields persist to app.json and survive a restart', async ({ app, page, relaunch }) => {
    const settings = new SettingsModal(app)
    await settings.open('Editor')
    await expect(settings.toggle('Readable line length')).toHaveAttribute('aria-checked', 'true')
    await settings.toggle('Readable line length').click()
    await expect(settings.toggle('Readable line length')).toHaveAttribute('aria-checked', 'false')
    await expect(page.locator('body')).not.toHaveClass(/readable-line-width/)
    await settings.toggle('Show line numbers').click()
    await settings.item('Default view for new tabs').locator('select').selectOption('source')
    await settings.item('Tab indent size').locator('select').selectOption('2')
    await settings.item('Font size').locator('input[type=range]').fill('20')
    await expect(settings.item('Font size').locator('.slider-value')).toHaveText('20px')

    await settings.go('Files and links')
    await settings.toggle('Confirm file deletion').click()
    await settings.go('Code editor')
    await settings.toggle('Minimap').click()
    await settings.go('Terminal')
    const shell = settings.item('Shell').locator('input')
    await shell.fill('pwsh.exe')
    await shell.press('Enter')
    await settings.go('Code runner')
    const python = settings.item('Python').locator('input')
    await python.fill('py -3 "{file}"')
    await python.blur()

    const expected = {
      readableLineLength: false,
      showLineNumbers: true,
      defaultViewMode: 'source',
      tabSize: 2,
      editorFontSize: 20,
      confirmDelete: false,
      codeMinimap: false,
      terminalShell: 'pwsh.exe',
      runners: { python: 'py -3 "{file}"' }
    }
    await expect.poll(() => settings.appJson()).toMatchObject(expected)
    expect(await app.state('settings', 's => s.settings.tabSize')).toBe(2)

    const next = await relaunch()
    const settings2 = new SettingsModal(next.app)
    expect(await next.app.state('settings', 's => s.settings')).toMatchObject(expected)
    await expect(next.page.locator('body')).not.toHaveClass(/readable-line-width/)
    await settings2.open('Editor')
    await expect(settings2.toggle('Readable line length')).toHaveAttribute('aria-checked', 'false')
    await expect(settings2.item('Default view for new tabs').locator('select')).toHaveValue('source')
    await expect(settings2.item('Font size').locator('.slider-value')).toHaveText('20px')
    await settings2.go('Terminal')
    await expect(settings2.item('Shell').locator('input')).toHaveValue('pwsh.exe')
  })

  test('the default view setting applies to newly opened notes', async ({ app, page }) => {
    const settings = new SettingsModal(app)
    await settings.open('Editor')
    await settings.item('Default view for new tabs').locator('select').selectOption('reading')
    await settings.close()
    await app.openFile('Alpha.md')
    await expect(app.activeView().locator('.markdown-view')).toHaveClass(/is-reading/)
    await expect(page.locator('.leaf.is-focused .md-reading')).toContainText('Alpha links to')
  })

  test('search filters the tabs by name and keywords', async ({ app }) => {
    const settings = new SettingsModal(app)
    await settings.open()
    await settings.search().fill('minimap')
    await expect(settings.modal().locator('.settings-nav-item')).toHaveText(['Code editor'])
    await expect(settings.navItem('Code editor')).toHaveClass(/is-active/)
    await expect(settings.content()).toContainText('Minimap')

    await settings.search().fill('theme')
    await expect(settings.modal().locator('.settings-nav-item')).toHaveText(['Appearance'])
    await expect(settings.modal().locator('.settings-nav-group')).toHaveText(['Options'])
    await settings.search().fill('shell')
    await expect(settings.modal().locator('.settings-nav-item')).toHaveText(['Terminal'])
    await settings.search().fill('zzzz-nothing')
    await expect(settings.modal().locator('.settings-nav-item')).toHaveCount(0)
    await settings.search().fill('')
    await expect(settings.modal().locator('.settings-nav-item')).toHaveCount(TABS.length)
  })

  test('"Reset all settings" asks first and restores the defaults', async ({ app, page }) => {
    const settings = new SettingsModal(app)
    const dialogs = new Dialogs(page)
    await app.setSetting('accentColor', '#e5534b')
    await app.setSetting('baseTheme', 'light')
    await app.setSetting('showRibbon', false)
    await settings.expectSaved('showRibbon', false)
    await expect(page.locator('body')).toHaveClass(/theme-light/)

    await settings.open('About')
    await settings.item('Reset all settings').locator('.btn').click()
    await dialogs.confirm('Reset settings', false)
    await expect(settings.modal()).toBeVisible()
    expect(await app.state('settings', 's => s.settings.baseTheme')).toBe('light')

    await settings.item('Reset all settings').locator('.btn').click()
    await dialogs.confirm('Reset settings', true)
    await expect(page.locator('body')).toHaveClass(/theme-dark/)
    await expect(page.locator('.ribbon')).toBeVisible()
    await expect.poll(() => settings.appJson()).toMatchObject({ accentColor: '#8a5cf5', baseTheme: 'dark', showRibbon: true, hotkeys: {} })
  })
})
