// Sidebar panes: search, backlinks (linked + unlinked), outgoing links, outline, tags, bookmarks.
import { test, expect } from './fixtures'
import { Sidebars } from './helpers/sidebars'
import { Dialogs } from './helpers/dialogs'
import { Explorer } from './helpers/explorer'
import { Tabs } from './helpers/tabs'
import type { Locator, Page } from '@playwright/test'

const filler = Array.from({ length: 120 }, (_, i) => `Filler line ${i + 1}.`).join('\n')
test.use({ vault: { source: 'shell', files: { 'Long.md': `# Long\n\n## Top heading\n${filler}\n\n## Bottom heading\nThe end.\n` } } })

/** text of the editor line holding the caret / selection */
function caretLine(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    const n = window.getSelection()?.anchorNode
    const el = n instanceof Element ? n : n?.parentElement
    return el?.closest('.cm-line')?.textContent ?? null
  })
}

const searchPane = (page: Page) => page.locator('.sidebar-pane', { has: page.getByPlaceholder('Search files...') })
const searchSummary = (page: Page) => searchPane(page).locator('span', { hasText: /files · \d+ matches|Searching/ }).first()
const resultFiles = (page: Page) => searchPane(page).locator('.pane-body > div > .tree-item .item-name')
const rightPane = (page: Page) => page.locator('.sidebar.right .sidebar-group').first().locator('.sidebar-pane')

async function rowCount(group: Locator, title: string): Promise<string> {
  return group.locator('.tree-item', { has: group.page().locator('.item-name', { hasText: new RegExp(`^${title}`) }) }).first().locator('.item-count').innerText()
}

test.describe('search pane @basic', () => {
  test('Ctrl+Shift+F focuses search; results, counts and case / regex / notes-only toggles', async ({ page }) => {
    await page.keyboard.press('Control+Shift+F')
    const input = page.getByPlaceholder('Search files...')
    await expect(input).toBeFocused()
    await page.keyboard.type('needle')
    await expect(searchSummary(page)).toHaveText('2 files · 3 matches')
    await expect(resultFiles(page)).toHaveText(['code/script.py', 'Delta'], { useInnerText: true })
    await expect(searchPane(page).locator('.search-snippet mark').first()).toHaveText(/needle/i)

    await searchPane(page).getByTitle('Match case').click()
    await input.fill('NEEDLE')
    await expect(searchSummary(page)).toHaveText('1 files · 1 matches')
    await searchPane(page).getByTitle('Match case').click()
    await expect(searchSummary(page)).toHaveText('2 files · 3 matches')

    await input.fill('ne+dle')
    await expect(searchPane(page).locator('.empty-state')).toHaveText('No matches found.')
    await searchPane(page).getByTitle('Use regular expression').click()
    await expect(searchSummary(page)).toHaveText('2 files · 3 matches')
    await input.fill('ne+dle (in|\\()')
    await expect(searchSummary(page)).toHaveText('2 files · 2 matches')

    await searchPane(page).getByTitle(/click for notes only/).click()
    await expect(searchSummary(page)).toHaveText('1 files · 1 matches')
    await expect(resultFiles(page)).toHaveText(['Delta'])
    await searchPane(page).getByTitle(/click to include code files/).click()
    await expect(searchSummary(page)).toHaveText('2 files · 2 matches')

    // Escape clears the query
    await input.press('Escape')
    await expect(input).toHaveValue('')
    await expect(resultFiles(page)).toHaveCount(0)
  })

  test('clicking a result opens the file at the matching line; Ctrl+click opens a new tab', async ({ app, page }) => {
    const tabs = new Tabs(app)
    await page.keyboard.press('Control+Shift+F')
    await expect(page.getByPlaceholder('Search files...')).toBeFocused()
    await page.keyboard.type('Bottom heading')
    await searchPane(page).locator('.search-snippet', { hasText: 'Bottom heading' }).click()
    await expect.poll(() => app.activeFile()).toBe('Long.md')
    await expect.poll(() => page.evaluate(() => window.getSelection()?.toString())).toBe('Bottom heading')
    await expect(app.activeView().locator('.cm-line', { hasText: 'Bottom heading' })).toBeInViewport()

    await page.getByPlaceholder('Search files...').fill('needle')
    await searchPane(page).locator('.search-snippet', { hasText: 'uppercase' }).click({ modifiers: ['Control'] })
    await tabs.expectTitles([['Long', 'Delta']])
    await expect.poll(() => page.evaluate(() => window.getSelection()?.toString())).toBe('NEEDLE')
    // file-name-only matches
    await page.getByPlaceholder('Search files...').fill('readme')
    await expect(searchPane(page).locator('.pane-body')).toContainText('readme.txt')
  })

  test('results follow file changes', async ({ app, page }) => {
    await page.keyboard.press('Control+Shift+F')
    await expect(page.getByPlaceholder('Search files...')).toBeFocused()
    await page.keyboard.type('needle')
    await expect(searchSummary(page)).toHaveText('2 files · 3 matches')
    app.writeExternal('New needle.md', 'needle again\n')
    await expect(searchSummary(page)).toHaveText('3 files · 4 matches')
  })
})

test.describe('backlinks pane @basic', () => {
  test('linked mentions list linking lines, update live and open the source at the line', async ({ app, page }) => {
    const tabs = new Tabs(app)
    await app.openFile('Beta.md')
    const pane = rightPane(page)
    await expect(pane).toContainText('Backlinks for Beta')
    const linked = pane.locator('.tree-item', { hasText: 'Linked mentions' })
    await expect(linked.locator('.item-count')).toHaveText('2')
    await expect(pane).toContainText('Alpha links to [[Beta]] and [[Folder A/Gamma|gamma]].')
    await expect(pane).toContainText('Gamma links [[Beta]] too.')

    // add a link from another note in a split, typed in the editor
    await page.keyboard.press('Control+\\')
    await app.openFile('Folder B/Delta.md')
    await app.activeView().locator('.cm-content').click()
    await page.keyboard.press('Control+End')
    await page.keyboard.insertText('\nDelta now links [[Beta]].')
    await app.expectFile('Folder B/Delta.md', (c) => c.includes('Delta now links [[Beta]].'))
    await tabs.leaf(0).locator('.tab', { hasText: 'Beta' }).click()
    await expect(pane).toContainText('Backlinks for Beta')
    await expect(linked.locator('.item-count')).toHaveText('3')
    await expect(pane).toContainText('Delta now links [[Beta]].')
    await expect(page.locator('.status-bar')).toContainText('3 backlinks')

    await pane.getByText('Gamma links [[Beta]] too.').click()
    await expect.poll(() => app.activeFile()).toBe('Folder A/Gamma.md')
    expect(await caretLine(page)).toContain('Gamma links')
  })

  test('unlinked mentions find plain-text occurrences on demand', async ({ app, page }) => {
    await app.openFile('Beta.md')
    const pane = rightPane(page)
    await pane.getByText('Unlinked mentions (click to search)').click()
    await expect(pane).toContainText('Some text about beta without a link.')
    await expect(pane.locator('div', { hasText: /^Some text about beta/ })).toHaveCount(1)
    await pane.getByText('Some text about beta without a link.').click()
    await expect.poll(() => app.activeFile()).toBe('Alpha.md')
  })

  test('the status bar backlink count reveals the backlinks pane', async ({ app, page }) => {
    const sb = new Sidebars(app)
    await app.openFile('Alpha.md')
    await sb.icon('Tags').click()
    await page.locator('.status-bar-item', { hasText: '1 backlink' }).click()
    await expect(sb.icon('Backlinks')).toHaveClass(/is-active/)
    await expect(rightPane(page)).toContainText('Backlinks for Alpha')
  })
})

test.describe('outgoing links pane @basic', () => {
  test('lists resolved and unresolved links; clicking opens or creates notes', async ({ app, page }) => {
    const sb = new Sidebars(app)
    await app.openFile('Alpha.md')
    await sb.icon('Outgoing links').click()
    const pane = rightPane(page)
    await expect(pane).toContainText('Outgoing links from Alpha')
    const links = pane.locator('.tree-item[title]')
    await expect(links).toHaveText(['Beta', 'Gamma', 'Unresolved idea'])
    await expect(pane.locator('.tree-item[title="Click to create"]')).toHaveText('Unresolved idea')

    await pane.locator('.tree-item[title="Click to create"]').click()
    await expect.poll(() => app.activeFile()).toBe('Unresolved idea.md')
    expect(app.exists('Unresolved idea.md')).toBe(true)
    await expect(pane).toContainText('Outgoing links from Unresolved idea')

    await app.openFile('Alpha.md')
    await expect(pane.locator('.tree-item[title="Click to create"]')).toHaveCount(0)
    await expect(pane.locator('.tree-item[title]')).toHaveText(['Beta', 'Gamma', 'Unresolved idea'])
    await pane.locator('.tree-item[title="Beta.md"]').click()
    await expect.poll(() => app.activeFile()).toBe('Beta.md')
  })
})

test.describe('outline pane @basic', () => {
  test('shows the heading tree, collapses, and clicking scrolls the editor to the heading', async ({ app, page }) => {
    const outline = page.locator('.sidebar.right .sidebar-group').nth(1).locator('.sidebar-pane')
    await expect(outline).toContainText('Open a note to see its outline.')
    await app.openFile('Alpha.md')
    await expect(outline.locator('.item-name')).toHaveText(['Alpha', 'Section one', 'Sub section', 'Section two'])
    await outline.locator('.tree-item', { hasText: 'Section one' }).locator('.chevron').click()
    await expect(outline.locator('.item-name')).toHaveText(['Alpha', 'Section one', 'Section two'])

    await app.openFile('Long.md')
    await expect(outline.locator('.item-name')).toHaveText(['Long', 'Top heading', 'Bottom heading'])
    const bottom = app.activeView().locator('.cm-line', { hasText: 'Bottom heading' })
    await expect(bottom).not.toBeInViewport()
    await outline.locator('.tree-item', { hasText: 'Bottom heading' }).click()
    await expect(bottom).toBeInViewport()
    await expect.poll(() => caretLine(page)).toContain('Bottom heading')
    await outline.locator('.tree-item', { hasText: 'Top heading' }).click()
    await expect(app.activeView().locator('.cm-line', { hasText: 'Top heading' })).toBeInViewport()

    // live: a new heading appears while typing
    await page.keyboard.press('Control+End')
    await page.keyboard.insertText('\n## Fresh heading\n')
    await expect(outline.locator('.item-name')).toHaveText(['Long', 'Top heading', 'Bottom heading', 'Fresh heading'])
  })
})

test.describe('tags pane @basic', () => {
  test('nested tags with counts, sorting, and click to search', async ({ app, page }) => {
    const sb = new Sidebars(app)
    await sb.icon('Tags').click()
    const pane = rightPane(page)
    await expect(pane.locator('.tree-item .item-name')).toHaveText(['project', 'alpha', 'beta', 'status'])
    expect(await rowCount(pane, 'project')).toBe('3')
    expect(await rowCount(pane, 'alpha')).toBe('2')
    expect(await rowCount(pane, 'beta')).toBe('1')
    expect(await rowCount(pane, 'status')).toBe('2')

    // collapse the hierarchy
    await pane.locator('.tree-item', { hasText: 'project' }).locator('.chevron').click()
    await expect(pane.locator('.tree-item .item-name')).toHaveText(['project', 'status'])
    await pane.locator('.tree-item', { hasText: 'project' }).locator('.chevron').click()

    // a new tag shows up when a note changes
    app.writeExternal('Tagged.md', '#status #zeta\n')
    await expect(pane.locator('.tree-item .item-name', { hasText: 'zeta' })).toBeVisible()
    await expect.poll(() => rowCount(pane, 'status')).toBe('3')
    await pane.getByTitle('Sort by name').click()
    await expect(pane.locator('.tree-item .item-name')).toHaveText(['project', 'alpha', 'beta', 'status', 'zeta'])

    await pane.locator('.tree-item', { hasText: 'alpha' }).click()
    await expect(sb.icon('Search')).toHaveClass(/is-active/)
    await expect(page.getByPlaceholder('Search files...')).toHaveValue('#project/alpha')
    await expect(resultFiles(page)).toHaveText(['Alpha', 'Gamma'])
  })
})

test.describe('bookmarks pane @basic', () => {
  test('add (explorer, command, pane button), open, reorder, follow renames and remove', async ({ app, page }) => {
    const sb = new Sidebars(app)
    const ex = new Explorer(app)
    const dialogs = new Dialogs(page)
    const pane = page.locator('.sidebar.left .sidebar-pane')
    const items = pane.locator('.pane-body .tree-item .item-name')
    const saved = (): string[] | null => {
      try {
        return app.readJson<{ items: { path: string }[] }>('.cs2d3k/bookmarks.json').items.map((b) => b.path)
      } catch {
        return null
      }
    }

    await ex.contextMenu('Alpha.md', /^Bookmark$/)
    await app.openFile('Beta.md')
    await app.runPaletteCommand('Bookmark current file')
    await app.openFile('readme.txt')
    await sb.icon('Bookmarks').click()
    await pane.getByTitle('Bookmark current file').click()
    await expect(items).toHaveText(['Alpha', 'Beta', 'readme.txt'])
    await expect.poll(saved).toEqual(['Alpha.md', 'Beta.md', 'readme.txt'])

    await items.filter({ hasText: 'Alpha' }).click()
    await expect.poll(() => app.activeFile()).toBe('Alpha.md')

    // drag to reorder
    await pane.locator('.pane-body .tree-item', { hasText: 'readme.txt' }).dragTo(pane.locator('.pane-body .tree-item', { hasText: 'Alpha' }))
    await expect(items).toHaveText(['readme.txt', 'Alpha', 'Beta'])
    await expect.poll(saved).toEqual(['readme.txt', 'Alpha.md', 'Beta.md'])

    // renaming the file keeps the bookmark
    await sb.icon('Files').click()
    await ex.renameInline('Beta.md', 'Beta renamed')
    await sb.icon('Bookmarks').click()
    await expect(items).toHaveText(['readme.txt', 'Alpha', 'Beta renamed'])
    await expect.poll(saved).toEqual(['readme.txt', 'Alpha.md', 'Beta renamed.md'])

    // the toggle command removes it again; the context menu removes too
    await items.filter({ hasText: 'Alpha' }).click()
    await expect.poll(() => app.activeFile()).toBe('Alpha.md')
    await app.runPaletteCommand('Bookmark current file')
    await expect(items).toHaveText(['readme.txt', 'Beta renamed'])
    await dialogs.contextMenu(pane.locator('.pane-body .tree-item', { hasText: 'readme.txt' }), 'Remove bookmark')
    await expect(items).toHaveText(['Beta renamed'])
    await expect.poll(saved).toEqual(['Beta renamed.md'])
  })

  test('bookmarks survive a restart', async ({ app, relaunch }) => {
    await app.openFile('Alpha.md')
    await app.runPaletteCommand('Bookmark current file')
    await app.expectFile('.cs2d3k/bookmarks.json', (c) => c.includes('Alpha.md'))
    const next = await relaunch()
    await next.page.locator('.sidebar-tab[aria-label="Bookmarks"]').click()
    await expect(next.page.locator('.sidebar.left .sidebar-pane .pane-body .tree-item')).toHaveText(['Alpha'])
  })
})
