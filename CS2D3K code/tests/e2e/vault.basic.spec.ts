// Vault lifecycle: picker on first launch, open / create / switch vaults, recent list, .cs2d3k config folder + legacy migration.
import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'fs'
import { dirname, join } from 'path'
import type { ElectronApplication, Page } from '@playwright/test'
import { test, expect } from './fixtures'
import { Dialogs } from './helpers/dialogs'
import { SettingsModal } from './helpers/settings'

/** make the native folder picker return `folder` (the next calls) */
async function stubFolderPicker(electronApp: ElectronApplication, folder: string): Promise<void> {
  await electronApp.evaluate(({ dialog }, p) => {
    dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [p] })) as unknown as typeof dialog.showOpenDialog
  }, folder)
}

function userState(userDataDir: string): { recentVaults: { path: string; name: string }[]; lastVault: string | null } {
  try {
    return JSON.parse(readFileSync(join(userDataDir, 'cs2d3k-state.json'), 'utf8'))
  } catch {
    return { recentVaults: [], lastVault: null }
  }
}

async function switchToPicker(settings: SettingsModal): Promise<void> {
  await settings.open('About')
  await settings.item('Switch vault').locator('.btn').click()
  await expect(settings.page.locator('.vault-picker')).toBeVisible()
}

const picker = (page: Page) => page.locator('.vault-picker')
const recentItems = (page: Page) => page.locator('.vault-recent-item')

test.describe('vault picker @basic', () => {
  test.use({ vault: { source: 'sample', noVault: true } })

  test('first launch without a vault shows the picker with no recent vaults', async ({ page }) => {
    await expect(picker(page)).toBeVisible()
    await expect(page.locator('.vault-picker h1')).toHaveText('CS2D3K')
    await expect(page.locator('.vault-picker-recent .empty-state')).toHaveText('No recent vaults')
    await expect(page.locator('.vault-picker-main')).toContainText(/Version \d+\.\d+\.\d+/)
    await expect(page.locator('.titlebar')).toHaveCount(0)
  })

  test('"Open folder as vault" opens the chosen folder and creates .cs2d3k', async ({ page, electronApp, vaultDir, userDataDir, app }) => {
    expect(existsSync(join(vaultDir, '.cs2d3k'))).toBe(false)
    await stubFolderPicker(electronApp, vaultDir)
    await page.locator('.vault-action', { hasText: 'Open folder as vault' }).locator('.btn').click()
    await expect(page.locator('.titlebar-title')).toHaveText('vault — CS2D3K')
    await expect(app.treeItem('Welcome.md')).toBeVisible()
    expect(existsSync(join(vaultDir, '.cs2d3k', 'themes'))).toBe(true)
    expect(existsSync(join(vaultDir, '.cs2d3k', 'snippets'))).toBe(true)
    await expect.poll(() => userState(userDataDir).lastVault).toBe(vaultDir)
    expect(userState(userDataDir).recentVaults.map((v) => v.path)).toEqual([vaultDir])
  })

  test('"Create new vault" validates the name, creates the folder with a welcome note and opens it', async ({ page, electronApp, vaultDir }) => {
    const parent = dirname(vaultDir)
    await stubFolderPicker(electronApp, parent)
    const dialogs = new Dialogs(page)
    await page.locator('.vault-action', { hasText: 'Create new vault' }).locator('.btn').click()
    const modal = dialogs.modal('Create new vault')
    await modal.locator('input').fill('bad/name')
    await modal.locator('input').press('Enter')
    await expect(modal.locator('.modal-error')).toContainText('cannot contain')
    await modal.locator('input').fill('Fresh vault')
    await modal.locator('.btn', { hasText: 'Next' }).click()

    await expect(page.locator('.titlebar-title')).toHaveText('Fresh vault — CS2D3K')
    const fresh = join(parent, 'Fresh vault')
    await expect.poll(() => existsSync(join(fresh, 'Welcome.md'))).toBe(true)
    expect(readFileSync(join(fresh, 'Welcome.md'), 'utf8')).toContain('# Welcome to Fresh vault')
    expect(existsSync(join(fresh, '.cs2d3k'))).toBe(true)
    await expect(page.locator('.tree-item[data-path="Welcome.md"]')).toBeVisible()
    await expect(page.locator('.leaf.is-focused .tab.is-active .tab-title')).toHaveText('Welcome')
  })

  test('cancelling the folder picker keeps the picker open', async ({ page, electronApp }) => {
    await electronApp.evaluate(({ dialog }) => {
      dialog.showOpenDialog = (async () => ({ canceled: true, filePaths: [] })) as unknown as typeof dialog.showOpenDialog
    })
    await page.locator('.vault-action', { hasText: 'Open folder as vault' }).locator('.btn').click()
    await page.waitForTimeout(200)
    await expect(picker(page)).toBeVisible()
  })
})

test.describe('recent vaults @basic', () => {
  test('recent list opens a vault, remembers it after switching back and can remove it', async ({ page, app, userDataDir, vaultDir }) => {
    const settings = new SettingsModal(app)
    // the opened vault is recorded as recent
    await expect.poll(() => userState(userDataDir).recentVaults.map((v) => v.path)).toEqual([vaultDir])

    await settings.open('About')
    await settings.item('Switch vault').locator('.btn').click()
    await expect(picker(page)).toBeVisible()
    await expect.poll(() => userState(userDataDir).lastVault).toBeNull()

    await expect(recentItems(page)).toHaveCount(1)
    await expect(recentItems(page).locator('.name')).toHaveText('vault')
    await expect(recentItems(page).locator('.path')).toHaveText(vaultDir)

    // open it again from the list
    await recentItems(page).click()
    await expect(page.locator('.titlebar-title')).toHaveText('vault — CS2D3K')
    await expect(app.treeItem('Welcome.md')).toBeVisible()

    // back to the picker and remove it from the list (the folder itself stays)
    await settings.open('About')
    await settings.item('Switch vault').locator('.btn').click()
    await recentItems(page).hover()
    await recentItems(page).getByRole('button', { name: 'Remove from list' }).click()
    await expect(recentItems(page)).toHaveCount(0)
    await expect(page.locator('.vault-picker-recent .empty-state')).toHaveText('No recent vaults')
    await expect.poll(() => userState(userDataDir).recentVaults).toEqual([])
    expect(existsSync(join(vaultDir, 'Welcome.md'))).toBe(true)
  })

  test('recent vaults are listed most recent first', async ({ page, app, vaultDir, electronApp }) => {
    const other = join(dirname(vaultDir), 'Other vault')
    mkdirSync(other, { recursive: true })
    writeFileSync(join(other, 'Elsewhere.md'), '# Elsewhere\n')
    const settings = new SettingsModal(app)

    await switchToPicker(settings)
    await stubFolderPicker(electronApp, other)
    await page.locator('.vault-action', { hasText: 'Open folder as vault' }).locator('.btn').click()
    await expect(page.locator('.titlebar-title')).toHaveText('Other vault — CS2D3K')
    await expect(page.locator('.tree-item[data-path="Elsewhere.md"]')).toBeVisible()
    await settings.open('About')
    await settings.item('Switch vault').locator('.btn').click()
    await expect(recentItems(page).locator('.name')).toHaveText(['Other vault', 'vault'])
  })
})

test.describe('switching vaults @basic', () => {
  test('Settings → About → Switch returns to the picker and opens another vault', async ({ page, app, vaultDir, electronApp }) => {
    const other = join(dirname(vaultDir), 'Second')
    mkdirSync(join(other, 'Inbox'), { recursive: true })
    writeFileSync(join(other, 'Inbox', 'Todo.md'), '# Todo\n')
    const settings = new SettingsModal(app)

    await app.openFile('Welcome.md')
    await settings.open('About')
    await expect(settings.item('Current vault')).toContainText(vaultDir)
    await expect(settings.item('Current vault')).toContainText(/\d+ files/)
    await settings.item('Switch vault').locator('.btn').click()
    await expect(settings.modal()).toHaveCount(0)
    await expect(picker(page)).toBeVisible()

    // open the second vault: its own files, no tabs from the first one
    await stubFolderPicker(electronApp, other)
    await page.locator('.vault-action', { hasText: 'Open folder as vault' }).locator('.btn').click()
    await expect(page.locator('.titlebar-title')).toHaveText('Second — CS2D3K')
    await expect(page.locator('.tree-item[data-path="Inbox"]')).toBeVisible()
    await expect(page.locator('.tree-item[data-path="Welcome.md"]')).toHaveCount(0)
    await expect(page.locator('.empty-view')).toBeVisible()
    expect(existsSync(join(other, '.cs2d3k'))).toBe(true)

    // and back: the first vault's layout is restored
    await settings.open('About')
    await settings.item('Switch vault').locator('.btn').click()
    await recentItems(page).filter({ hasText: /^vault/ }).click()
    await expect(page.locator('.titlebar-title')).toHaveText('vault — CS2D3K')
    await expect(page.locator('.leaf .tab-title')).toHaveText(['Welcome'])
  })

  test('changes made right before switching are saved to the vault they belong to', async ({ page, app, vaultDir, electronApp }) => {
    const other = join(dirname(vaultDir), 'Third')
    mkdirSync(other, { recursive: true })
    const settings = new SettingsModal(app)
    await settings.open('Appearance')
    await settings.content().getByRole('button', { name: '#e5534b' }).click()
    await settings.go('About')
    await settings.item('Switch vault').locator('.btn').click()
    await expect(picker(page)).toBeVisible()
    await stubFolderPicker(electronApp, other)
    await page.locator('.vault-action', { hasText: 'Open folder as vault' }).locator('.btn').click()
    await expect(page.locator('.titlebar-title')).toHaveText('Third — CS2D3K')
    await page.waitForTimeout(300)
    await expect.poll(() => JSON.parse(readFileSync(join(vaultDir, '.cs2d3k', 'app.json'), 'utf8')).accentColor).toBe('#e5534b')
    expect(existsSync(join(other, '.cs2d3k', 'app.json')) ? JSON.parse(readFileSync(join(other, '.cs2d3k', 'app.json'), 'utf8')).accentColor : undefined).not.toBe('#e5534b')
    expect(await app.state('settings', 's => s.settings.accentColor')).toBe('#8a5cf5')
  })

  test('the "Close vault" command goes back to the picker', async ({ page, app }) => {
    await app.runPaletteCommand('Close vault')
    await expect(picker(page)).toBeVisible()
    await expect(recentItems(page)).toHaveCount(1)
  })
})

test.describe('.cs2d3k config folder @basic', () => {
  test('is created on open, receives settings / workspace / bookmarks and stays hidden from the explorer', async ({ app, page }) => {
    expect(app.exists('.cs2d3k/themes')).toBe(true)
    expect(app.exists('.cs2d3k/snippets')).toBe(true)
    await app.setSetting('accentColor', '#e5534b')
    await app.expectFile('.cs2d3k/app.json', (c) => JSON.parse(c).accentColor === '#e5534b')
    await app.openFile('Welcome.md')
    await app.expectFile('.cs2d3k/workspace.json', (c) => c.includes('"Welcome.md"'))
    await app.command('file:bookmark')
    await app.expectFile('.cs2d3k/bookmarks.json', (c) => JSON.parse(c).items[0].path === 'Welcome.md')
    await expect(page.locator('.tree-item[data-path^=".cs2d3k"]')).toHaveCount(0)
  })

  test.describe('legacy .vaultide', () => {
    test.use({ vault: { source: 'sample', files: { '.vaultide/app.json': JSON.stringify({ baseTheme: 'light', accentColor: '#3fb950' }) } } })
    test('is migrated to .cs2d3k and its settings apply', async ({ app, page }) => {
      expect(app.exists('.vaultide')).toBe(false)
      expect(app.readJson('.cs2d3k/app.json')).toMatchObject({ baseTheme: 'light' })
      expect(app.exists('.cs2d3k/themes')).toBe(true)
      await expect(page.locator('body')).toHaveClass(/theme-light/)
      expect(await app.state('settings', 's => s.settings.accentColor')).toBe('#3fb950')
    })
  })

  test.describe('legacy .cs2dek', () => {
    test.use({ vault: { source: 'sample', files: { '.cs2dek/app.json': JSON.stringify({ baseTheme: 'light' }), '.cs2dek/themes/Old.css': 'body{}' } } })
    test('is migrated to .cs2d3k including themes', async ({ app, page }) => {
      expect(app.exists('.cs2dek')).toBe(false)
      expect(app.exists('.cs2d3k/themes/Old.css')).toBe(true)
      await expect(page.locator('body')).toHaveClass(/theme-light/)
    })
  })

  test.describe('legacy folder next to an existing .cs2d3k', () => {
    test.use({
      vault: {
        source: 'sample',
        files: { '.cs2d3k/app.json': JSON.stringify({ baseTheme: 'dark' }), '.vaultide/app.json': JSON.stringify({ baseTheme: 'light' }) }
      }
    })
    test('is left alone and the current config wins', async ({ app, page }) => {
      expect(app.exists('.vaultide/app.json')).toBe(true)
      await expect(page.locator('body')).toHaveClass(/theme-dark/)
      expect(app.readJson('.cs2d3k/app.json')).toMatchObject({ baseTheme: 'dark' })
    })
  })
})
