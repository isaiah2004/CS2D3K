// File explorer: tree, hidden folders, expand/collapse, create / rename / move / delete / duplicate, multi-select,
// sort orders, file type filter, reveal, keyboard (Delete / F2).
import { utimesSync } from 'fs'
import { test, expect } from './fixtures'
import { Explorer } from './helpers/explorer'
import { Tabs } from './helpers/tabs'

test.use({ vault: { source: 'shell' } })

const ROOT_ORDER = ['code', 'Folder A', 'Folder B', 'Alpha.md', 'Beta.md', 'readme.txt']

test.describe('explorer tree @basic', () => {
  test.use({
    vault: {
      source: 'shell',
      files: { '.git/HEAD': 'ref: refs/heads/main\n', 'node_modules/pkg/index.js': 'module.exports = 1\n', '.obsidian/app.json': '{}', '.hidden.md': '# hidden\n' }
    }
  })

  test('renders folders first, hides note extensions and skips hidden / ignored folders', async ({ app, page }) => {
    const ex = new Explorer(app)
    await expect.poll(() => ex.visiblePaths()).toEqual(ROOT_ORDER)
    await expect(page.locator('.sidebar.left .pane-body .tree-item').first()).toHaveText('vault')
    await expect(ex.name('Alpha.md')).toHaveText('Alpha')
    await expect(ex.name('readme.txt')).toHaveText('readme.txt')
    await expect(ex.item('readme.txt').locator('.item-tag')).toHaveText('txt')
    await expect(ex.item('Alpha.md').locator('.item-tag')).toHaveCount(0)
    for (const hidden of ['.git', 'node_modules', '.cs2d3k', '.obsidian', '.hidden.md']) await expect(page.locator(`[data-path^="${hidden}"]`)).toHaveCount(0)
    expect(app.exists('.cs2d3k')).toBe(true)
  })

  test('expand / collapse folders and collapse-all / expand-all', async ({ app }) => {
    const ex = new Explorer(app)
    await ex.item('Folder A').click()
    await expect.poll(() => ex.visiblePaths()).toEqual(['code', 'Folder A', 'Folder A/Nested', 'Folder A/Gamma.md', 'Folder B', 'Alpha.md', 'Beta.md', 'readme.txt'])
    await ex.item('Folder A/Nested').click()
    await expect(ex.item('Folder A/Nested/Deep.md')).toBeVisible()
    await ex.item('Folder A').click()
    await expect(ex.item('Folder A/Gamma.md')).toHaveCount(0)
    // re-expanding remembers the nested state
    await ex.item('Folder A').click()
    await expect(ex.item('Folder A/Nested/Deep.md')).toBeVisible()

    await ex.button('Collapse all').click()
    await expect.poll(() => ex.visiblePaths()).toEqual(ROOT_ORDER)
    await ex.button('Expand all').click()
    await expect(ex.item('Folder A/Nested/Deep.md')).toBeVisible()
    await expect(ex.item('Folder B/Delta.md')).toBeVisible()
    await expect(ex.item('code/script.py')).toBeVisible()
    await expect(ex.button('Collapse all')).toBeVisible()
  })
})

test.describe('explorer create @basic', () => {
  test('header buttons create a note, a folder (with inline rename) and a canvas', async ({ app, page }) => {
    const ex = new Explorer(app)
    const tabs = new Tabs(app)

    await ex.button('New note').click()
    await expect(ex.item('Untitled.md')).toBeVisible()
    expect(app.read('Untitled.md')).toBe('')
    await expect(tabs.activeTab()).toHaveText('Untitled')
    await expect(ex.item('Untitled.md')).toHaveClass(/is-active/)
    await ex.button('New note').click()
    await expect(ex.item('Untitled 1.md')).toBeVisible()

    await ex.button('New folder').click()
    await expect(ex.renameInput()).toBeFocused()
    await expect(ex.renameInput()).toHaveValue('Untitled')
    expect(app.exists('Untitled')).toBe(true)
    await page.keyboard.type('My folder')
    await page.keyboard.press('Enter')
    await expect(ex.item('My folder')).toBeVisible()
    await expect.poll(() => app.exists('My folder') && !app.exists('Untitled')).toBe(true)

    await ex.button('New canvas').click()
    await expect(ex.item('Untitled.canvas')).toBeVisible()
    expect(JSON.parse(app.read('Untitled.canvas'))).toEqual({ nodes: [], edges: [] })
    await expect.poll(() => app.activeFile()).toBe('Untitled.canvas')
  })

  test('folder context menu creates note, canvas, form-map, folder and file inside the folder', async ({ app, page }) => {
    const ex = new Explorer(app)
    await ex.contextMenu('Folder B', /^New note$/)
    await expect.poll(() => app.activeFile()).toBe('Folder B/Untitled.md')
    expect(app.exists('Folder B/Untitled.md')).toBe(true)

    await ex.contextMenu('Folder B', /^New canvas$/)
    await expect.poll(() => app.activeFile()).toBe('Folder B/Untitled.canvas')

    await ex.contextMenu('Folder B', /^New form-map$/)
    await expect.poll(() => app.activeFile()).toBe('Folder B/Untitled form-map.formmap')
    expect(app.exists('Folder B/Untitled form-map.formmap')).toBe(true)

    await ex.contextMenu('Folder B', /^New file\.\.\.$/)
    await ex.dialogs.prompt('New file', 'main.py')
    await expect.poll(() => app.activeFile()).toBe('Folder B/main.py')
    await ex.expand('Folder B')
    await expect(ex.item('Folder B/main.py')).toBeVisible()
    await expect(ex.item('Folder B/Untitled.md')).toBeVisible()
    expect(app.read('Folder B/main.py')).toBe('')

    await ex.contextMenu('Folder B', /^New folder$/)
    await expect(ex.renameInput()).toBeFocused()
    await page.keyboard.press('Enter')
    await expect.poll(() => app.exists('Folder B/Untitled')).toBe(true)
    await expect(ex.item('Folder B/Untitled')).toBeVisible()
  })

  test('file context menu creates next to the file; pane background menu creates at the root', async ({ app, page }) => {
    const ex = new Explorer(app)
    await ex.contextMenu('Folder A/Gamma.md', /^New note$/)
    await expect.poll(() => app.activeFile()).toBe('Folder A/Untitled.md')

    // right-click the empty area below the tree
    const zone = ex.rootDropZone()
    const box = (await zone.boundingBox())!
    await zone.click({ button: 'right', position: { x: box.width / 2, y: box.height - 20 } })
    await ex.dialogs.menuItem(/^New file\.\.\.$/).click()
    await ex.dialogs.prompt('New file', 'bad:name')
    await expect(ex.dialogs.modal('New file').locator('.modal-error')).toBeVisible()
    await ex.dialogs.prompt('New file', 'notes.json')
    await expect.poll(() => app.exists('notes.json')).toBe(true)
    await expect(ex.item('notes.json')).toBeVisible()
    await expect.poll(() => app.activeFile()).toBe('notes.json')
    await expect(page.locator('.modal-backdrop')).toHaveCount(0)
  })
})

test.describe('explorer rename @basic', () => {
  test('inline rename renames on disk, keeps the extension and updates links', async ({ app }) => {
    const ex = new Explorer(app)
    await ex.renameInline('Beta.md', 'Beta renamed')
    await expect(ex.item('Beta renamed.md')).toBeVisible()
    expect(app.exists('Beta.md')).toBe(false)
    expect(app.read('Beta renamed.md')).toContain('Beta points back')
    await app.expectFile('Alpha.md', (c) => c.includes('[[Beta renamed]]') && !c.includes('[[Beta]]'))
    await app.expectFile('Folder A/Gamma.md', (c) => c.includes('[[Beta renamed]]'))
    await expect(ex.dialogs.notice('Updated links in 2 files')).toBeVisible()
  })

  test('Escape cancels, invalid and empty names are rejected', async ({ app, page }) => {
    const ex = new Explorer(app)
    await ex.contextMenu('Alpha.md', /^Rename\.\.\.$/)
    await ex.renameInput().fill('Nope')
    await ex.renameInput().press('Escape')
    await expect(ex.renameInput()).toHaveCount(0)
    await expect(ex.name('Alpha.md')).toHaveText('Alpha')

    await ex.renameInline('Alpha.md', 'bad/name')
    await expect(ex.dialogs.notice(/cannot contain/)).toBeVisible()
    await ex.renameInline('Alpha.md', '.dotted')
    await expect(ex.dialogs.notice(/cannot start with a dot/)).toBeVisible()
    await ex.renameInline('Alpha.md', '   ')
    await page.waitForTimeout(200)
    expect(app.exists('Alpha.md')).toBe(true)
    expect(await ex.visiblePaths()).toEqual(ROOT_ORDER)
  })

  test('renaming onto an existing name is refused', async ({ app }) => {
    const ex = new Explorer(app)
    await ex.renameInline('Alpha.md', 'Beta')
    await expect(ex.dialogs.notice('"Beta.md" already exists')).toBeVisible()
    expect(app.read('Alpha.md')).toContain('# Alpha')
    expect(app.read('Beta.md')).toContain('# Beta')
  })

  test('renaming a code file selects the stem and keeps the typed extension', async ({ app, page }) => {
    const ex = new Explorer(app)
    await ex.contextMenu('readme.txt', /^Rename\.\.\.$/)
    const sel = await ex.renameInput().evaluate((el: HTMLInputElement) => el.value.slice(el.selectionStart!, el.selectionEnd!))
    expect(sel).toBe('readme')
    await page.keyboard.type('notes')
    await page.keyboard.press('Enter')
    await expect.poll(() => app.exists('notes.txt')).toBe(true)
    await expect(ex.item('notes.txt')).toBeVisible()
  })

  test.describe('in the sample vault', () => {
    test.use({ vault: { source: 'sample' } })
    test('renaming a note and a folder rewrites links in other notes', async ({ app }) => {
      const ex = new Explorer(app)
      await ex.renameInline('Notes/Graph overview.md', 'Graph intro')
      await app.expectFile('Welcome.md', (c) => c.includes('[[Graph intro]]'))
      await app.expectFile('Daily/2026-10-01.md', (c) => c.includes('[[Graph intro]]'))
      expect(app.exists('Notes/Graph intro.md')).toBe(true)

      await ex.renameInline('Projects', 'Work')
      await expect.poll(() => app.exists('Work/api/README.md')).toBe(true)
      await app.expectFile('Welcome.md', (c) => !c.includes('Projects/api/README') && /\[\[(Work\/api\/)?README\|API project\]\]/.test(c))
      // the link still resolves to the moved note
      expect(await app.page.evaluate(() => window.__cs2d3k!.resolveLink('README', 'Welcome.md'))).toBe('Work/api/README.md')
    })
  })
})

test.describe('explorer move @basic', () => {
  test('drag a note into a folder and back to the vault root', async ({ app }) => {
    const ex = new Explorer(app)
    await ex.drag('Alpha.md', 'Folder B')
    await expect.poll(() => app.exists('Folder B/Alpha.md')).toBe(true)
    expect(app.exists('Alpha.md')).toBe(false)
    await expect(ex.item('Folder B/Alpha.md')).toBeVisible()
    // links by name still resolve
    expect(await app.page.evaluate(() => window.__cs2d3k!.resolveLink('Alpha', 'Beta.md'))).toBe('Folder B/Alpha.md')

    await ex.drag('Folder B/Alpha.md', null)
    await expect.poll(() => app.exists('Alpha.md')).toBe(true)
    expect(app.exists('Folder B/Alpha.md')).toBe(false)
    await expect(ex.item('Alpha.md')).toBeVisible()
  })

  test('drag a folder into another folder, never into itself', async ({ app }) => {
    const ex = new Explorer(app)
    await ex.drag('Folder B', 'Folder A')
    await expect.poll(() => app.exists('Folder A/Folder B/Delta.md')).toBe(true)
    await expect(ex.item('Folder A/Folder B')).toBeVisible()

    await ex.drag('Folder A', 'Folder A/Nested')
    await app.page.waitForTimeout(300)
    expect(app.exists('Folder A/Nested/Deep.md')).toBe(true)
    expect(app.exists('Folder A/Nested/Folder A')).toBe(false)
  })

  test('"Move to..." moves a file to a typed folder path', async ({ app }) => {
    const ex = new Explorer(app)
    await ex.contextMenu('Beta.md', /^Move to\.\.\.$/)
    await ex.dialogs.prompt('Move to folder', 'Folder A/Nested')
    await expect.poll(() => app.exists('Folder A/Nested/Beta.md')).toBe(true)
    await app.expectFile('Alpha.md', (c) => c.includes('[[Beta]]'))
  })
})

test.describe('explorer delete @basic', () => {
  test('delete asks for confirmation; cancel keeps the file, confirm trashes it and closes its tab', async ({ app }) => {
    const ex = new Explorer(app)
    const tabs = new Tabs(app)
    await app.openFile('Beta.md')
    await ex.delete('Beta.md', false)
    expect(app.exists('Beta.md')).toBe(true)
    await expect(ex.item('Beta.md')).toBeVisible()

    await ex.contextMenu('Beta.md', /^Delete$/)
    await expect(ex.dialogs.modal('Delete file')).toContainText('Are you sure you want to delete "Beta.md"?')
    await ex.dialogs.confirm('Delete file', true)
    await expect(ex.item('Beta.md')).toHaveCount(0)
    expect(app.exists('Beta.md')).toBe(false)
    await expect(tabs.tab('Beta')).toHaveCount(0)
    // the link from Alpha is now unresolved
    await expect.poll(() => app.state('metadata', 's => Object.keys(s.unresolved["Alpha.md"])')).toContain('Beta')
  })

  test('deleting a folder deletes its content; Escape cancels the dialog', async ({ app, page }) => {
    const ex = new Explorer(app)
    await ex.contextMenu('Folder A', /^Delete$/)
    await expect(ex.dialogs.modal('Delete folder')).toContainText('and everything in it')
    await page.keyboard.press('Escape')
    await expect(ex.dialogs.modal()).toHaveCount(0)
    expect(app.exists('Folder A/Gamma.md')).toBe(true)

    await ex.delete('Folder A', true)
    await expect.poll(() => app.exists('Folder A')).toBe(false)
    await expect(page.locator('[data-path^="Folder A"]')).toHaveCount(0)
  })

  test('with "Confirm file deletion" off, delete happens without a dialog', async ({ app }) => {
    const ex = new Explorer(app)
    await app.setSetting('confirmDelete', false)
    await ex.contextMenu('readme.txt', /^Delete$/)
    await expect.poll(() => app.exists('readme.txt')).toBe(false)
    await expect(ex.dialogs.modal()).toHaveCount(0)
  })

  test('Ctrl+click multi-select and bulk delete from the context menu', async ({ app, page }) => {
    const ex = new Explorer(app)
    await ex.item('Alpha.md').click({ modifiers: ['Control'] })
    await ex.item('readme.txt').click({ modifiers: ['Control'] })
    await ex.item('Folder B').click({ modifiers: ['Control'] })
    await expect(page.locator('.tree-item.is-selected')).toHaveCount(3)
    // Ctrl+click again deselects
    await ex.item('Folder B').click({ modifiers: ['Control'] })
    await expect(ex.item('Folder B')).not.toHaveClass(/is-selected/)

    await ex.item('Alpha.md').click({ button: 'right' })
    await ex.dialogs.menuItem('Delete 2 items').click()
    await ex.dialogs.confirm(/Delete/, true)
    await expect.poll(() => app.exists('Alpha.md') || app.exists('readme.txt')).toBe(false)
    await expect(ex.item('Alpha.md')).toHaveCount(0)
    await expect(ex.item('readme.txt')).toHaveCount(0)
    expect(app.exists('Beta.md')).toBe(true)
  })

  test('Shift+click selects a range; the Delete key deletes the selection', async ({ app, page }) => {
    const ex = new Explorer(app)
    await ex.item('Folder B').click({ modifiers: ['Control'] })
    await ex.item('Beta.md').click({ modifiers: ['Shift'] })
    await expect(page.locator('.tree-item.is-selected')).toHaveCount(3)
    await expect(ex.item('Alpha.md')).toHaveClass(/is-selected/)

    await ex.rootDropZone().focus()
    await page.keyboard.press('Escape')
    await expect(page.locator('.tree-item.is-selected')).toHaveCount(0)

    await ex.item('Folder B').click({ modifiers: ['Control'] })
    await ex.item('Alpha.md').click({ modifiers: ['Shift'] })
    await ex.rootDropZone().focus()
    await page.keyboard.press('Delete')
    await ex.dialogs.confirm(/Delete/, true)
    await expect.poll(() => app.exists('Folder B') || app.exists('Alpha.md')).toBe(false)
    expect(app.exists('Beta.md')).toBe(true)
  })

  test('F2 on a selected folder starts inline rename', async ({ app, page }) => {
    const ex = new Explorer(app)
    await ex.item('Folder B').click({ modifiers: ['Control'] })
    await ex.rootDropZone().focus()
    await page.keyboard.press('F2')
    await expect(ex.renameInput()).toBeFocused()
    await expect(ex.renameInput()).toHaveValue('Folder B')
    await page.keyboard.type('Renamed B')
    await page.keyboard.press('Enter')
    await expect.poll(() => app.exists('Renamed B/Delta.md')).toBe(true)
  })
})

test.describe('explorer misc @basic', () => {
  test('duplicate creates "<name> copy" files next to the original; disabled for folders', async ({ app, page }) => {
    const ex = new Explorer(app)
    await ex.contextMenu('Beta.md', /^Duplicate$/)
    await expect(ex.item('Beta copy.md')).toBeVisible()
    expect(app.read('Beta copy.md')).toBe(app.read('Beta.md'))
    await ex.contextMenu('Beta.md', /^Duplicate$/)
    await expect(ex.item('Beta copy 1.md')).toBeVisible()
    // indexed: the copy's link counts as a backlink of Alpha
    await expect.poll(() => page.evaluate(() => window.__cs2d3k!.getBacklinks('Alpha.md').map((b) => b.source))).toContain('Beta copy.md')

    await ex.item('Folder A').click({ button: 'right' })
    await expect(ex.dialogs.menuItem(/^Duplicate$/)).toHaveClass(/disabled/)
    await page.keyboard.press('Escape')
  })

  test('sort orders: name, modified time, created time (persisted in app.json)', async ({ app, page }) => {
    const ex = new Explorer(app)
    await ex.sortBy('File name (Z to A)')
    await expect.poll(() => ex.visiblePaths()).toEqual(['Folder B', 'Folder A', 'code', 'readme.txt', 'Beta.md', 'Alpha.md'])
    await app.expectFile('.cs2d3k/app.json', (c) => JSON.parse(c).fileSortOrder === 'name-desc')

    // three files with known modification times
    const times: Record<string, number> = { 'm-old.md': 2020, 'm-mid.md': 2021, 'm-new.md': 2022 }
    for (const [name, year] of Object.entries(times)) {
      app.writeExternal(name, `# ${name}\n`)
      const t = new Date(`${year}-01-01T00:00:00Z`)
      utimesSync(app.abs(name), t, t)
    }
    for (const name of Object.keys(times)) await expect(ex.item(name)).toBeVisible()
    const order = async (names: string[]): Promise<string[]> => (await ex.visiblePaths()).filter((p) => names.includes(p))

    await ex.sortBy('Modified time (new to old)')
    await expect.poll(() => order(Object.keys(times))).toEqual(['m-new.md', 'm-mid.md', 'm-old.md'])
    await ex.sortBy('Modified time (old to new)')
    await expect.poll(() => order(Object.keys(times))).toEqual(['m-old.md', 'm-mid.md', 'm-new.md'])
    // folders stay alphabetical and on top
    expect((await ex.visiblePaths()).slice(0, 3)).toEqual(['code', 'Folder A', 'Folder B'])

    await ex.sortBy('Created time (new to old)')
    await expect.poll(async () => (await ex.visiblePaths()).indexOf('m-new.md') < (await ex.visiblePaths()).indexOf('Alpha.md')).toBe(true)
    await ex.sortBy('Created time (old to new)')
    await expect.poll(async () => (await ex.visiblePaths()).indexOf('Alpha.md') < (await ex.visiblePaths()).indexOf('m-new.md')).toBe(true)

    // the active order is checked in the menu
    await ex.button('Change sort order').click()
    await expect(ex.dialogs.menuItem('Created time (old to new)').locator('.menu-icon svg')).toBeVisible()
    await expect(ex.dialogs.menuItem('File name (A to Z)').locator('.menu-icon svg')).toHaveCount(0)
    await page.keyboard.press('Escape')
    await ex.sortBy('File name (A to Z)')
    await expect.poll(() => ex.visiblePaths()).toEqual(['code', 'Folder A', 'Folder B', 'Alpha.md', 'Beta.md', 'm-mid.md', 'm-new.md', 'm-old.md', 'readme.txt'])
  })

  test('"Show all file types" toggle hides non-note files', async ({ app }) => {
    const ex = new Explorer(app)
    await ex.item('code').click()
    await expect(ex.item('code/script.py')).toBeVisible()
    await ex.sortBy('Show all file types')
    await expect(ex.item('readme.txt')).toHaveCount(0)
    await expect(ex.item('code/script.py')).toHaveCount(0)
    await expect(ex.item('code')).toBeVisible()
    await expect(ex.item('Alpha.md')).toBeVisible()
    await app.expectFile('.cs2d3k/app.json', (c) => JSON.parse(c).showAllFileTypes === false)
    await ex.sortBy('Show all file types')
    await expect(ex.item('readme.txt')).toBeVisible()
    await expect(ex.item('code/script.py')).toBeVisible()
  })

  test('"Reveal active file" expands parents, highlights the file and switches to the Files pane', async ({ app, page }) => {
    const ex = new Explorer(app)
    await page.evaluate(() => (window.__cs2d3k!.stores.workspace.getState() as { openFile(p: string): void }).openFile('Folder A/Nested/Deep.md'))
    await expect(ex.item('Folder A/Nested/Deep.md')).toHaveCount(0)
    await ex.button('Reveal active file').click()
    await expect(ex.item('Folder A/Nested/Deep.md')).toBeVisible()
    await expect(ex.item('Folder A/Nested/Deep.md')).toHaveClass(/is-active/)

    // from another pane via the tab menu
    await ex.button('Collapse all').click()
    await page.locator('.sidebar-tab[aria-label="Search"]').click()
    await expect(ex.header()).toHaveCount(0)
    await page.locator('.leaf.is-focused .tab.is-active').click({ button: 'right' })
    await ex.dialogs.menuItem('Reveal file in navigation').click()
    await expect(ex.item('Folder A/Nested/Deep.md')).toBeVisible()
    await expect(page.locator('.sidebar-tab[aria-label="Files"]')).toHaveClass(/is-active/)
  })

  test('clicking opens in the current tab, Ctrl+click and middle-click open new tabs', async ({ app }) => {
    const ex = new Explorer(app)
    const tabs = new Tabs(app)
    await ex.item('Alpha.md').click()
    await tabs.expectTitles([['Alpha']])
    await ex.item('Beta.md').click()
    await tabs.expectTitles([['Beta']])
    await ex.item('Alpha.md').click({ modifiers: ['Control'] })
    await tabs.expectTitles([['Beta', 'Alpha']])
    await ex.item('readme.txt').click({ button: 'middle' })
    await tabs.expectTitles([['Beta', 'Alpha', 'readme.txt']])
    await ex.contextMenu('Folder A/Gamma.md', /^Open to the right$/)
    await tabs.expectTitles([['Beta', 'Alpha', 'readme.txt'], ['Gamma']])
  })
})
