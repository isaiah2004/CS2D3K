// Tabs & splits: open / replace / new tab, close, pin, drag reorder, drag between splits, split by command and by
// dropping on an edge, focus next split, history navigation, rename → tab title, layout restored after restart.
import { test, expect } from './fixtures'
import { Explorer } from './helpers/explorer'
import { Tabs } from './helpers/tabs'
import { Dialogs } from './helpers/dialogs'
import type { App } from './helpers/app'
import type { Locator } from '@playwright/test'

test.use({ vault: { source: 'shell' } })

/** open notes as tabs of the focused leaf: first replaces the empty tab, the rest open in new tabs */
async function openTabs(app: App, ...paths: string[]): Promise<void> {
  for (let i = 0; i < paths.length; i++) await app.openFile(paths[i], { newTab: i > 0 })
}

/** drop a tab onto a point of a target, as a fraction of its box */
async function dragTabTo(tab: Locator, target: Locator, fx: number, fy: number): Promise<void> {
  const box = (await target.boundingBox())!
  await tab.dragTo(target, { targetPosition: { x: box.width * fx, y: box.height * fy } })
}

test.describe('opening tabs @basic', () => {
  test('click replaces the active tab, Ctrl+click / middle-click / Ctrl+T / + / double-click open new tabs', async ({ app, page }) => {
    const ex = new Explorer(app)
    const tabs = new Tabs(app)
    await tabs.expectTitles([['New tab']])
    // double-click on the empty part of the tab bar
    const list = page.locator('.leaf.is-focused .tab-list')
    const box = (await list.boundingBox())!
    await list.dblclick({ position: { x: box.width - 5, y: box.height / 2 } })
    await tabs.expectTitles([['New tab', 'New tab']])
    await page.keyboard.press('Control+W')
    await tabs.expectTitles([['New tab']])

    await ex.item('Alpha.md').click()
    await tabs.expectTitles([['Alpha']])
    await ex.item('Beta.md').click()
    await tabs.expectTitles([['Beta']])
    await ex.item('Alpha.md').click({ modifiers: ['Control'] })
    await tabs.expectTitles([['Beta', 'Alpha']])
    await expect(tabs.activeTab()).toHaveText('Alpha')
    await ex.item('readme.txt').click({ button: 'middle' })
    await tabs.expectTitles([['Beta', 'Alpha', 'readme.txt']])

    // a file that is already open in the leaf is focused, not duplicated
    await tabs.tab('Beta').click()
    await ex.item('Alpha.md').click()
    await expect(tabs.activeTab()).toHaveText('Alpha')
    await tabs.expectTitles([['Beta', 'Alpha', 'readme.txt']])

    await page.keyboard.press('Control+T')
    await tabs.expectTitles([['Beta', 'Alpha', 'New tab', 'readme.txt']])
    await expect(page.locator('.leaf.is-focused .empty-view')).toBeVisible()
    await page.locator('.leaf.is-focused .tab-bar-actions button[title^="New tab"]').click()
    await expect.poll(async () => (await tabs.titles())[0].filter((t) => t === 'New tab').length).toBe(2)
  })

  test('an empty "New tab" offers actions that work', async ({ app, page }) => {
    await page.locator('.empty-view .empty-action', { hasText: 'Create new note' }).click()
    await expect.poll(() => app.activeFile()).toBe('Untitled.md')
    await expect(page.locator('.empty-view')).toHaveCount(0)
  })
})

test.describe('closing and pinning @basic', () => {
  test('close button, middle-click, Ctrl+W; the last tab leaves an empty tab', async ({ app, page }) => {
    const tabs = new Tabs(app)
    await openTabs(app, 'Alpha.md', 'Beta.md', 'Folder A/Gamma.md', 'readme.txt')
    await tabs.close('Beta')
    await tabs.expectTitles([['Alpha', 'Gamma', 'readme.txt']])
    await tabs.tab('Gamma').click({ button: 'middle' })
    await tabs.expectTitles([['Alpha', 'readme.txt']])
    await expect(tabs.activeTab()).toHaveText('readme.txt')
    await page.keyboard.press('Control+W')
    await tabs.expectTitles([['Alpha']])
    await page.keyboard.press('Control+W')
    await tabs.expectTitles([['New tab']])
    await expect(page.locator('.empty-view')).toBeVisible()
  })

  test('"Close others" keeps pinned tabs, "Close all" empties the group; pinned tabs are not replaced', async ({ app, page }) => {
    const tabs = new Tabs(app)
    const ex = new Explorer(app)
    await openTabs(app, 'Alpha.md', 'Beta.md', 'Folder A/Gamma.md', 'readme.txt')
    await tabs.menu('Alpha', /^Pin$/)
    await expect(tabs.tab('Alpha').locator('.tab-close')).toHaveAttribute('title', 'Unpin')
    // opening a file while the pinned tab is active opens a new tab
    await tabs.tab('Alpha').click()
    await ex.item('Folder B').click()
    await ex.item('Folder B/Delta.md').click()
    await tabs.expectTitles([['Alpha', 'Delta', 'Beta', 'Gamma', 'readme.txt']])

    await tabs.menu('Gamma', 'Close others')
    await tabs.expectTitles([['Alpha', 'Gamma']])
    // unpin from the tab's pin button, then the command toggles it again
    await tabs.tab('Alpha').locator('.tab-close').click()
    await expect(tabs.tab('Alpha').locator('.tab-close')).toHaveAttribute('title', 'Close')
    await tabs.tab('Alpha').click()
    await app.runPaletteCommand('Toggle pin')
    await expect(tabs.tab('Alpha').locator('.tab-close')).toHaveAttribute('title', 'Unpin')
    expect(await app.state('workspace', 's => s.root.tabs.find(t => t.path === "Alpha.md").pinned')).toBe(true)

    await tabs.menu('Gamma', 'Close all')
    await tabs.expectTitles([['New tab']])
    await expect(page.locator('.empty-view')).toBeVisible()
  })
})

test.describe('dragging tabs @basic', () => {
  test('drag a tab to reorder it within its group', async ({ app }) => {
    const tabs = new Tabs(app)
    await openTabs(app, 'Alpha.md', 'Beta.md', 'Folder A/Gamma.md')
    await tabs.tab('Gamma').dragTo(tabs.tab('Alpha'))
    await tabs.expectTitles([['Gamma', 'Alpha', 'Beta']])
    await expect(tabs.activeTab()).toHaveText('Gamma')
    await tabs.tab('Gamma').dragTo(app.page.locator('.leaf .tab-list'), { targetPosition: { x: 600, y: 10 } })
    await tabs.expectTitles([['Alpha', 'Beta', 'Gamma']])
  })

  test('drag a tab into another split (tab bar and view centre)', async ({ app, page }) => {
    const tabs = new Tabs(app)
    await openTabs(app, 'Alpha.md', 'Beta.md', 'Folder A/Gamma.md')
    await page.keyboard.press('Control+\\')
    await tabs.expectTitles([['Alpha', 'Beta', 'Gamma'], ['Gamma']])

    await dragTabTo(tabs.tab('Alpha', 0), tabs.leaf(1).locator('.tab-list'), 0.95, 0.5)
    await tabs.expectTitles([['Beta', 'Gamma'], ['Gamma', 'Alpha']])
    await tabs.expectFocused(1)
    await expect(tabs.activeTab(1)).toHaveText('Alpha')

    await dragTabTo(tabs.tab('Beta', 0), tabs.leaf(1).locator('.view-container'), 0.5, 0.5)
    await tabs.expectTitles([['Gamma'], ['Gamma', 'Alpha', 'Beta']])

    // moving the last tab out of a group removes the group
    await tabs.tab('Gamma', 0).dragTo(tabs.leaf(1).locator('.tab-list'))
    await expect(tabs.leaves()).toHaveCount(1)
    expect((await tabs.titles())[0].sort()).toEqual(['Alpha', 'Beta', 'Gamma', 'Gamma'])
    expect(await tabs.rootSplit()).toBeNull()
  })

  test('drop a tab on the right / bottom edge of a view to split', async ({ app }) => {
    const tabs = new Tabs(app)
    await openTabs(app, 'Alpha.md', 'Beta.md', 'Folder A/Gamma.md')
    const view = () => tabs.leaf(0).locator('.view-container')
    const notes = ['Alpha.md', 'Beta.md', 'Folder A/Gamma.md'].map((p) => app.read(p))

    await dragTabTo(tabs.tab('Gamma'), view(), 0.95, 0.5)
    await tabs.expectTitles([['Alpha', 'Beta'], ['Gamma']])
    expect(await tabs.rootSplit()).toBe('row')

    await dragTabTo(tabs.tab('Beta'), tabs.leaf(1).locator('.view-container'), 0.5, 0.95)
    await tabs.expectTitles([['Alpha'], ['Gamma'], ['Beta']])
    expect(await app.page.evaluate(() => !!document.querySelector('.ws-split.row .ws-split.column'))).toBe(true)
    // dropping a tab on an editor moves the tab; it never inserts a link into the note
    await app.page.waitForTimeout(300)
    expect(['Alpha.md', 'Beta.md', 'Folder A/Gamma.md'].map((p) => app.read(p))).toEqual(notes)
  })
})

test.describe('splits @basic', () => {
  test('split right / down by command and tab menu; focus next split cycles groups', async ({ app, page }) => {
    const tabs = new Tabs(app)
    await openTabs(app, 'Alpha.md')
    await page.keyboard.press('Control+\\')
    await tabs.expectTitles([['Alpha'], ['Alpha']])
    expect(await tabs.rootSplit()).toBe('row')
    await tabs.expectFocused(1)
    // both groups show the note
    await expect(tabs.leaf(0).locator('.cm-content')).toContainText('Alpha links to')
    await expect(tabs.leaf(1).locator('.cm-content')).toContainText('Alpha links to')

    await app.runPaletteCommand('Split down')
    await tabs.expectTitles([['Alpha'], ['Alpha'], ['Alpha']])
    expect(await page.evaluate(() => !!document.querySelector('.ws-split.row .ws-split.column'))).toBe(true)

    await tabs.menu('Alpha', 'Split right', 2)
    await expect(tabs.leaves()).toHaveCount(4)

    // focus next split walks the leaves in order and wraps around
    const focusedIndex = (): Promise<number> => page.evaluate(() => [...document.querySelectorAll('.app-main .leaf')].findIndex((l) => l.classList.contains('is-focused')))
    const start = await focusedIndex()
    await app.runPaletteCommand('Focus next split')
    await expect.poll(focusedIndex).toBe((start + 1) % 4)
    await app.runPaletteCommand('Focus next split')
    await expect.poll(focusedIndex).toBe((start + 2) % 4)
  })

  test('the divider between splits can be dragged to resize', async ({ app, page }) => {
    const tabs = new Tabs(app)
    await openTabs(app, 'Alpha.md')
    await page.keyboard.press('Control+\\')
    await expect(tabs.leaves()).toHaveCount(2)
    const w0 = (await tabs.leaf(0).boundingBox())!.width
    const handle = page.locator('.ws-divider')
    const box = (await handle.boundingBox())!
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.mouse.down()
    await page.mouse.move(box.x - 60, box.y + box.height / 2, { steps: 4 })
    await page.mouse.move(box.x - 120, box.y + box.height / 2, { steps: 4 })
    await page.mouse.up()
    await expect.poll(async () => (await tabs.leaf(0).boundingBox())!.width).toBeLessThan(w0 - 80)
  })
})

test.describe('history @basic', () => {
  test('back / forward with header buttons, title bar buttons and Alt+arrows', async ({ app, page }) => {
    const ex = new Explorer(app)
    const tabs = new Tabs(app)
    await ex.item('Alpha.md').click({ modifiers: ['Control'] })
    await expect(tabs.backButton()).toBeDisabled()
    await expect(tabs.forwardButton()).toBeDisabled()
    await ex.item('Beta.md').click()
    await ex.item('readme.txt').click()
    await expect(tabs.headerTitle()).toHaveText('readme.txt')

    await tabs.backButton().click()
    await expect(tabs.headerTitle()).toHaveText('Beta')
    await page.keyboard.press('Alt+ArrowLeft')
    await expect(tabs.headerTitle()).toHaveText('Alpha')
    await expect(tabs.backButton()).toBeDisabled()
    await expect(tabs.forwardButton()).toBeEnabled()

    await tabs.forwardButton().click()
    await expect(tabs.headerTitle()).toHaveText('Beta')
    await page.keyboard.press('Alt+ArrowRight')
    await expect(tabs.headerTitle()).toHaveText('readme.txt')
    await expect(tabs.forwardButton()).toBeDisabled()

    await page.locator('.titlebar button[title="Navigate back"]').click()
    await expect(tabs.headerTitle()).toHaveText('Beta')
    await page.locator('.titlebar button[title="Navigate forward"]').click()
    await expect(tabs.headerTitle()).toHaveText('readme.txt')
    // still the same tab
    await tabs.expectTitles([['New tab', 'readme.txt']])

    // navigating from the middle drops the forward history
    await tabs.backButton().click()
    await ex.item('Folder A').click()
    await ex.item('Folder A/Gamma.md').click()
    await expect(tabs.forwardButton()).toBeDisabled()
  })

  test('history is per tab', async ({ app }) => {
    const ex = new Explorer(app)
    const tabs = new Tabs(app)
    await ex.item('Alpha.md').click({ modifiers: ['Control'] })
    await ex.item('Beta.md').click({ modifiers: ['Control'] })
    await expect(tabs.backButton()).toBeDisabled()
    await tabs.tab('Alpha').click()
    await expect(tabs.backButton()).toBeDisabled()
    await ex.item('readme.txt').click()
    await expect(tabs.backButton()).toBeEnabled()
    await tabs.tab('Beta').click()
    await expect(tabs.backButton()).toBeDisabled()
    await tabs.tab('readme.txt').click()
    await tabs.backButton().click()
    await tabs.expectTitles([['New tab', 'Alpha', 'Beta']])
  })
})

test.describe('renaming open files @basic', () => {
  test('rename from the explorer, the view header and the tab menu updates tab titles and history', async ({ app, page }) => {
    const ex = new Explorer(app)
    const tabs = new Tabs(app)
    const dialogs = new Dialogs(page)
    await ex.item('Alpha.md').click()
    await ex.item('Beta.md').click()
    await ex.renameInline('Beta.md', 'Beta two')
    await expect(tabs.activeTab()).toHaveText('Beta two')
    await expect(tabs.headerTitle()).toHaveText('Beta two')

    await tabs.headerTitle().click()
    await dialogs.prompt('Rename', 'Beta three')
    await expect(tabs.activeTab()).toHaveText('Beta three')
    await expect.poll(() => app.exists('Beta three.md')).toBe(true)

    await tabs.menu('Beta three', /^Rename\.\.\.$/)
    await dialogs.prompt('Rename file', 'Beta four.md')
    await expect(tabs.activeTab()).toHaveText('Beta four')
    await expect.poll(() => app.exists('Beta four.md')).toBe(true)

    // the renamed history entry still works
    await tabs.backButton().click()
    await expect(tabs.headerTitle()).toHaveText('Alpha')
    await ex.renameInline('Alpha.md', 'Alpha moved')
    await tabs.forwardButton().click()
    await expect(tabs.headerTitle()).toHaveText('Beta four')
    await tabs.backButton().click()
    await expect(tabs.headerTitle()).toHaveText('Alpha moved')
    await expect(app.activeView().locator('.cm-content')).toContainText('Alpha links to')
  })

  test('moving the folder of an open file updates the tab and its breadcrumb', async ({ app }) => {
    const ex = new Explorer(app)
    const tabs = new Tabs(app)
    await app.openFile('Folder A/Gamma.md')
    await expect(app.activeView().locator('.cm-content')).toContainText('Gamma links')
    await expect(tabs.focusedLeaf().locator('.view-header .crumb')).toHaveText(['Folder A'])
    await ex.renameInline('Folder A', 'Folder Z')
    await expect.poll(() => app.activeFile()).toBe('Folder Z/Gamma.md')
    await expect(tabs.focusedLeaf().locator('.view-header .crumb')).toHaveText(['Folder Z'])
    await expect(tabs.activeTab()).toHaveText('Gamma')
  })
})

test.describe('layout persistence @basic', () => {
  test('tabs, splits, pinned and active tabs survive a restart', async ({ app, page, relaunch }) => {
    const tabs = new Tabs(app)
    await openTabs(app, 'Alpha.md', 'Beta.md', 'readme.txt')
    await tabs.menu('Beta', /^Pin$/)
    await page.keyboard.press('Control+\\')
    await app.openFile('Folder A/Gamma.md')
    await tabs.expectTitles([['Alpha', 'Beta', 'readme.txt'], ['Gamma']])
    await tabs.tab('Alpha', 0).click()
    // wait for the (debounced) layout save
    await app.expectFile('.cs2d3k/workspace.json', (c) => {
      const ws = JSON.parse(c)
      const leaves = ws.root.children
      return leaves?.length === 2 && leaves[1].tabs[0].path === 'Folder A/Gamma.md' && ws.activeLeaf === leaves[0].id && leaves[0].active === leaves[0].tabs[0].id
    })

    const next = await relaunch()
    const tabs2 = new Tabs(next.app)
    await tabs2.expectTitles([['Alpha', 'Beta', 'readme.txt'], ['Gamma']])
    expect(await tabs2.rootSplit()).toBe('row')
    await expect(tabs2.tab('Beta').locator('.tab-close')).toHaveAttribute('title', 'Unpin')
    await tabs2.expectFocused(0)
    await expect(tabs2.activeTab(0)).toHaveText('Alpha')
    await expect(tabs2.activeTab(1)).toHaveText('Gamma')
    await expect(next.app.activeView().locator('.cm-content')).toContainText('Alpha links to')
    // history survives too (the split started as a copy of readme.txt)
    await tabs2.tab('Gamma', 1).click()
    await tabs2.backButton().click()
    await expect(tabs2.headerTitle()).toHaveText('readme.txt')
    await expect(tabs2.backButton()).toBeDisabled()
  })
})
