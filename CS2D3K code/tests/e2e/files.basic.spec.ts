// Disk truth + the file watcher: external create / edit / delete, unicode names, daily / random notes, new note location.
import { test, expect } from './fixtures'
import { Explorer } from './helpers/explorer'
import { Tabs } from './helpers/tabs'
import { Palette } from './helpers/palette'
import { SettingsModal } from './helpers/settings'
import type { Page } from '@playwright/test'

test.use({ vault: { source: 'shell' } })

const backlinksPane = (page: Page) => page.locator('.sidebar.right .pane-body', { hasText: 'Backlinks for' })
const linkedCount = (page: Page) => backlinksPane(page).locator('.tree-item', { hasText: 'Linked mentions' }).locator('.item-count')

function today(): string {
  const d = new Date()
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

test.describe('file watcher @basic', () => {
  test('a file created outside the app shows up in the explorer, the switcher and the link index', async ({ app, page }) => {
    const ex = new Explorer(app)
    await app.openFile('Alpha.md')
    await expect(linkedCount(page)).toHaveText('1')

    app.writeExternal('External note.md', '# External\n\nPoints at [[Alpha]].\n')
    app.writeExternal('Folder B/Sub/Inner.md', '# Inner\n')
    await expect(ex.item('External note.md')).toBeVisible()
    await expect(ex.name('External note.md')).toHaveText('External note')
    await ex.reveal('Folder B/Sub/Inner.md')

    // the open note's backlinks update live
    await expect(linkedCount(page)).toHaveText('2')
    await expect(backlinksPane(page)).toContainText('Points at [[Alpha]].')
    await expect(page.locator('.status-bar')).toContainText('2 backlinks')

    const palette = new Palette(page)
    await palette.openSwitcher()
    await palette.type('external')
    await expect(palette.items().first()).toContainText('External note')
    await palette.close()
  })

  test('an external edit updates the open editor and the backlinks of other notes', async ({ app, page }) => {
    await app.openFile('Alpha.md')
    await expect(app.activeView().locator('.cm-content')).toContainText('Alpha links to')
    app.writeExternal('Alpha.md', '# Alpha\n\nRewritten from outside.\n')
    await expect(app.activeView().locator('.cm-content')).toContainText('Rewritten from outside.')
    await expect(app.activeView().locator('.cm-content')).not.toContainText('Alpha links to')
    // the app does not write the file back
    await page.waitForTimeout(300)
    expect(app.read('Alpha.md')).toBe('# Alpha\n\nRewritten from outside.\n')

    // Beta stops linking to Alpha → Alpha has no backlinks any more
    await expect(linkedCount(page)).toHaveText('1')
    app.writeExternal('Beta.md', '# Beta\n\nNo links here.\n')
    await expect(linkedCount(page)).toHaveText('0')
    await expect(backlinksPane(page)).toContainText('No backlinks found.')
  })

  test('an external delete removes the file from the explorer and the index and closes its tab', async ({ app, page }) => {
    const ex = new Explorer(app)
    const tabs = new Tabs(app)
    await app.openFile('Alpha.md')
    await app.openFile('Beta.md', { newTab: true })
    await tabs.expectTitles([['Alpha', 'Beta']])
    app.removeExternal('Beta.md')
    await expect(ex.item('Beta.md')).toHaveCount(0)
    await tabs.expectTitles([['Alpha']])
    await expect.poll(() => app.state<string[]>('metadata', 's => Object.keys(s.unresolved["Alpha.md"] ?? {})')).toContain('Beta')

    // a whole folder
    app.removeExternal('Folder A')
    await expect(ex.item('Folder A')).toHaveCount(0)
    await expect(page.locator('[data-path^="Folder A/"]')).toHaveCount(0)
  })

  test('deleting the open file from the app closes its tab and moves it to the trash', async ({ app }) => {
    const tabs = new Tabs(app)
    const ex = new Explorer(app)
    await app.openFile('Alpha.md')
    await app.openFile('Beta.md', { newTab: true })
    await app.runPaletteCommand('Delete current file')
    await ex.dialogs.confirm('Delete file', true)
    await tabs.expectTitles([['Alpha']])
    expect(app.exists('Beta.md')).toBe(false)
  })
})

test.describe('file names @basic', () => {
  test('unicode and space names can be created, linked, opened and renamed', async ({ app, page }) => {
    const ex = new Explorer(app)
    const tabs = new Tabs(app)
    const palette = new Palette(page)
    const name = 'Über café 日本 🚀'
    await palette.openSwitcher()
    await palette.type(name)
    await expect(page.locator('.prompt-results .empty-state')).toContainText(`create ${name}`)
    await page.keyboard.press('Enter')
    await expect.poll(() => app.exists(`${name}.md`)).toBe(true)
    await expect(tabs.activeTab()).toHaveText(name)
    await expect(ex.name(`${name}.md`)).toHaveText(name)

    app.writeExternal('Linker.md', `# Linker\n\nSee [[${name}]].\n`)
    await expect(ex.item('Linker.md')).toBeVisible()
    await expect.poll(() => page.evaluate((n) => window.__cs2d3k!.resolveLink(n, 'Linker.md'), name)).toBe(`${name}.md`)

    await ex.renameInline(`${name}.md`, 'Ñandú – notes')
    await expect.poll(() => app.exists('Ñandú – notes.md')).toBe(true)
    await app.expectFile('Linker.md', (c) => c.includes('[[Ñandú – notes]]'))
    await expect(tabs.activeTab()).toHaveText('Ñandú – notes')
  })

  test('external files with unicode / spaces in nested folders open in the right view', async ({ app }) => {
    const ex = new Explorer(app)
    app.writeExternal('Données été/fichier avec espaces.md', '# Bonjour\n\nTexte accentué.\n')
    app.writeExternal('Données été/скрипт.py', 'print("привет")\n')
    await ex.reveal('Données été/fichier avec espaces.md')
    await ex.item('Données été/fichier avec espaces.md').click()
    await expect(app.activeView().locator('.cm-content')).toContainText('Texte accentué.')
    await ex.item('Données été/скрипт.py').click()
    await expect.poll(() => app.activeFile()).toBe('Données été/скрипт.py')
    await expect(app.activeView()).toHaveClass(/view-code/)
  })
})

test.describe('note commands @basic', () => {
  test("daily note: created from the template on first use, reused afterwards", async ({ app, page }) => {
    const tabs = new Tabs(app)
    const file = `${today()}.md`
    await app.runPaletteCommand("Open today's daily note")
    await expect.poll(() => app.exists(file)).toBe(true)
    expect(app.read(file)).toBe(`# ${today()}\n\n## Tasks\n- [ ] \n\n## Notes\n`)
    await expect(tabs.activeTab()).toHaveText(today())

    app.writeExternal(file, `# ${today()}\n\nmy own words\n`)
    await app.openFile('Alpha.md')
    await page.locator(".ribbon button[title=\"Open today's daily note\"]").click()
    await expect.poll(() => app.activeFile()).toBe(file)
    await expect(app.activeView().locator('.cm-content')).toContainText('my own words')
    expect(app.read(file)).toContain('my own words')
  })

  test('random note opens a markdown note', async ({ app, page }) => {
    const notes = ['Alpha.md', 'Beta.md', 'Folder A/Gamma.md', 'Folder A/Nested/Deep.md', 'Folder B/Delta.md']
    for (let i = 0; i < 3; i++) {
      await page.locator('.ribbon button[title="Open random note"]').click()
      await expect.poll(() => app.activeFile()).not.toBeNull()
      expect(notes).toContain(await app.activeFile())
    }
  })

  test.describe('in an empty vault', () => {
    test.use({ vault: { source: 'empty', files: { 'data.json': '{}' } } })
    test('random note explains that there are no notes', async ({ app, page }) => {
      await page.locator('.ribbon button[title="Open random note"]').click()
      await expect(page.locator('.notice', { hasText: 'No notes in vault' })).toBeVisible()
      expect(await app.activeFile()).toBeNull()
    })
  })

  test('new note location: same folder as current file, vault root, or a fixed folder', async ({ app, page }) => {
    const settings = new SettingsModal(app)
    const location = settings.item('Default location for new notes').locator('select')

    // default: same folder as the current file
    await app.openFile('Folder A/Gamma.md')
    await page.keyboard.press('Control+N')
    await expect.poll(() => app.activeFile()).toBe('Folder A/Untitled.md')

    await settings.open('Files and links')
    await location.selectOption('root')
    await settings.expectSaved('newNoteLocation', 'root')
    await settings.close()
    await app.openFile('Folder A/Gamma.md')
    await page.keyboard.press('Control+N')
    await expect.poll(() => app.activeFile()).toBe('Untitled.md')

    await settings.open('Files and links')
    await location.selectOption('folder')
    const folderInput = settings.item('Folder to create new notes in').locator('input')
    await folderInput.fill('Inbox/New')
    await folderInput.press('Enter')
    await settings.expectSaved('newNoteFolder', 'Inbox/New')
    await settings.close()
    await page.keyboard.press('Control+N')
    await expect.poll(() => app.activeFile()).toBe('Inbox/New/Untitled.md')
    expect(app.exists('Inbox/New/Untitled.md')).toBe(true)
    // the ribbon and the canvas command follow the same setting
    await page.locator('.ribbon button[title="Create new canvas"]').click()
    await expect.poll(() => app.activeFile()).toBe('Inbox/New/Untitled.canvas')
  })
})
