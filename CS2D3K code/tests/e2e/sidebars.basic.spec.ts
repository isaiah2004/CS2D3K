// Sidebars: toggle (buttons + hotkeys), resize, switch panes, move panes between sidebars, split pane groups and
// resize them, hide / re-enable panes, ribbon actions.
import { test, expect } from './fixtures'
import { Sidebars } from './helpers/sidebars'
import { Dialogs } from './helpers/dialogs'
import { SettingsModal } from './helpers/settings'
import { Tabs } from './helpers/tabs'

test.use({ vault: { source: 'shell' } })

function workspaceJson(app: { readJson<T>(rel: string): T }): { left: { open: boolean; width: number; groups: { panes: string[]; size: number }[] }; right: { open: boolean; width: number; groups: { panes: string[]; size: number }[] } } | null {
  try {
    return app.readJson('.cs2d3k/workspace.json')
  } catch {
    return null
  }
}

test.describe('sidebar toggles @basic', () => {
  test('title bar buttons and Ctrl+Shift+L / Ctrl+Shift+R toggle the sidebars (persisted)', async ({ app, page }) => {
    const sb = new Sidebars(app)
    await sb.expectOpen('left', true)
    await sb.expectOpen('right', true)

    await page.locator('.titlebar button[title^="Toggle left sidebar"]').click()
    await sb.expectOpen('left', false)
    await page.locator('.titlebar button[title^="Toggle right sidebar"]').click()
    await sb.expectOpen('right', false)
    await expect.poll(() => workspaceJson(app)?.left.open).toBe(false)
    await expect.poll(() => workspaceJson(app)?.right.open).toBe(false)

    await page.keyboard.press('Control+Shift+L')
    await sb.expectOpen('left', true)
    await page.keyboard.press('Control+Shift+R')
    await sb.expectOpen('right', true)
    await page.keyboard.press('Control+Shift+R')
    await sb.expectOpen('right', false)
    // the main area takes the room
    const main = (await page.locator('.app-center').boundingBox())!.width
    await page.keyboard.press('Control+Shift+R')
    await expect.poll(async () => (await page.locator('.app-center').boundingBox())!.width).toBeLessThan(main - 200)
  })

  test('hotkeys work while an editor has focus', async ({ app, page }) => {
    const sb = new Sidebars(app)
    await app.openFile('Alpha.md')
    const before = app.read('Alpha.md')
    await app.activeView().locator('.cm-content').click()
    await expect(app.activeView().locator('.cm-content')).toBeFocused()
    await page.keyboard.press('Control+Shift+L')
    await sb.expectOpen('left', false)
    await page.keyboard.press('Control+Shift+R')
    await sb.expectOpen('right', false)
    await page.keyboard.press('Control+Shift+L')
    await sb.expectOpen('left', true)
    // the keys did not reach the editor
    await page.waitForTimeout(300)
    expect(app.read('Alpha.md')).toBe(before)
  })
})

test.describe('sidebar resize @basic', () => {
  test('drag the edges to resize; limits apply; double-click resets', async ({ app }) => {
    const sb = new Sidebars(app)
    const l0 = await sb.width('left')
    const r0 = await sb.width('right')
    await sb.dragBy(sb.resizeHandle('left'), 100, 0)
    await expect.poll(() => sb.width('left')).toBeCloseTo(l0 + 100, -1)
    await sb.dragBy(sb.resizeHandle('right'), -80, 0)
    await expect.poll(() => sb.width('right')).toBeCloseTo(r0 + 80, -1)
    await expect.poll(() => workspaceJson(app)?.left.width).toBe(380)
    await expect.poll(() => workspaceJson(app)?.right.width).toBe(380)

    // clamped to 180..700
    await sb.dragBy(sb.resizeHandle('left'), -400, 0)
    await expect.poll(() => workspaceJson(app)?.left.width).toBe(180)
    await sb.dragBy(sb.resizeHandle('right'), -600, 0)
    await expect.poll(() => workspaceJson(app)?.right.width).toBe(700)

    await sb.resizeHandle('left').dblclick()
    await sb.resizeHandle('right').dblclick()
    await expect.poll(() => workspaceJson(app)?.left.width).toBe(280)
    await expect.poll(() => workspaceJson(app)?.right.width).toBe(300)
  })
})

test.describe('sidebar panes @basic', () => {
  test('pane icons switch the visible pane', async ({ app, page }) => {
    const sb = new Sidebars(app)
    expect(await sb.layout('left')).toEqual([['Files', 'Search', 'Bookmarks']])
    expect(await sb.layout('right')).toEqual([['Backlinks', 'Outgoing links', 'Tags'], ['Outline', 'Local graph']])

    await sb.icon('Search').click()
    await expect(sb.sidebar('left').getByPlaceholder('Search files...')).toBeVisible()
    await expect(sb.icon('Search')).toHaveClass(/is-active/)
    await sb.icon('Bookmarks').click()
    await expect(sb.sidebar('left')).toContainText('No bookmarks yet')
    await sb.icon('Files').click()
    await expect(app.treeItem('Alpha.md')).toBeVisible()

    await app.openFile('Alpha.md')
    await sb.icon('Outgoing links').click()
    await expect(sb.sidebar('right')).toContainText('Outgoing links from Alpha')
    await sb.icon('Tags').click()
    await expect(sb.sidebar('right').locator('.item-name', { hasText: 'project' })).toBeVisible()
    await expect(sb.groups('right').nth(1)).toContainText('Section one')
    await sb.icon('Local graph').click()
    await expect(sb.icon('Local graph')).toHaveClass(/is-active/)
    await expect(sb.groups('right').nth(1).locator('.local-graph')).toBeVisible()
  })

  test('drag a pane icon to the other sidebar, and back with the context menu', async ({ app, page }) => {
    const sb = new Sidebars(app)
    await sb.icon('Search', 'left').dragTo(sb.icon('Outgoing links', 'right'))
    await expect.poll(() => sb.layout('left')).toEqual([['Files', 'Bookmarks']])
    await expect.poll(() => sb.layout('right')).toEqual([['Backlinks', 'Search', 'Outgoing links', 'Tags'], ['Outline', 'Local graph']])
    await expect(sb.icon('Search', 'right')).toHaveClass(/is-active/)
    await expect(sb.sidebar('right').getByPlaceholder('Search files...')).toBeVisible()

    // drop onto the empty part of a tab strip appends
    const strip = sb.groups('left').first().locator('.sidebar-tabs')
    const box = (await strip.boundingBox())!
    await sb.icon('Tags', 'right').dragTo(strip, { targetPosition: { x: box.width - 10, y: box.height / 2 } })
    await expect.poll(() => sb.layout('left')).toEqual([['Files', 'Bookmarks', 'Tags']])

    await new Dialogs(page).contextMenu(sb.icon('Search', 'right'), 'Move to left sidebar')
    await expect.poll(() => sb.layout('left')).toEqual([['Files', 'Bookmarks', 'Tags', 'Search']])
    await expect.poll(() => workspaceJson(app)?.left.groups[0].panes).toEqual(['files', 'bookmarks', 'tags', 'search'])
  })

  test('"Split down" creates a pane group; groups can be resized', async ({ app, page }) => {
    const sb = new Sidebars(app)
    const dialogs = new Dialogs(page)
    await dialogs.contextMenu(sb.icon('Search', 'left'), 'Split down')
    await expect.poll(() => sb.layout('left')).toEqual([['Files', 'Bookmarks'], ['Search']])
    await expect(sb.groups('left').nth(1).getByPlaceholder('Search files...')).toBeVisible()
    await expect(sb.groups('left').nth(0).locator('.tree-item[data-path="Alpha.md"]')).toBeVisible()

    // a single-pane group can't be split further
    await sb.icon('Search', 'left').click({ button: 'right' })
    await expect(dialogs.menuItem('Split down')).toHaveClass(/disabled/)
    await page.keyboard.press('Escape')

    const h0 = (await sb.groups('left').nth(0).boundingBox())!.height
    await sb.dragBy(sb.sidebar('left').locator('.group-resize'), 0, 120)
    await expect.poll(async () => (await sb.groups('left').nth(0).boundingBox())!.height).toBeGreaterThan(h0 + 80)
    await expect.poll(() => {
      const g = workspaceJson(app)?.left.groups
      return !!g && g.length === 2 && g[0].size > g[1].size
    }).toBe(true)
  })

  test('hide a pane from its context menu and re-enable it in Settings → Core panes', async ({ app, page }) => {
    const sb = new Sidebars(app)
    const dialogs = new Dialogs(page)
    const settings = new SettingsModal(app)
    await dialogs.contextMenu(sb.icon('Bookmarks', 'left'), 'Hide pane')
    await expect(sb.icon('Bookmarks')).toHaveCount(0)
    await settings.expectSaved('corePanes', expect.objectContaining({ bookmarks: false }))

    // hiding every pane of a group hides the group
    await dialogs.contextMenu(sb.icon('Outline', 'right'), 'Hide pane')
    await dialogs.contextMenu(sb.icon('Local graph', 'right'), 'Hide pane')
    await expect(sb.groups('right')).toHaveCount(1)

    await settings.open('Core panes')
    await expect(settings.toggle('Bookmarks')).toHaveAttribute('aria-checked', 'false')
    await settings.toggle('Bookmarks').click()
    await settings.toggle('Outline').click()
    await expect(settings.toggle('Bookmarks')).toHaveAttribute('aria-checked', 'true')
    await settings.close()
    await expect(sb.icon('Bookmarks', 'left')).toBeVisible()
    await expect(sb.groups('right')).toHaveCount(2)
    await expect(sb.icon('Outline', 'right')).toBeVisible()
    await expect(sb.icon('Local graph')).toHaveCount(0)

    // turning a pane off in settings hides it too
    await settings.open('Core panes')
    await settings.toggle('Files').click()
    await settings.close()
    await expect(sb.icon('Files')).toHaveCount(0)
    await expect(sb.icon('Search', 'left')).toHaveClass(/is-active/)
  })
})

test.describe('ribbon @basic', () => {
  test('ribbon buttons run their commands', async ({ app, page }) => {
    const sb = new Sidebars(app)
    const tabs = new Tabs(app)

    await sb.ribbon('Open quick switcher').click()
    await expect(page.locator('.prompt-input')).toHaveAttribute('placeholder', /Find or create a note/)
    await page.keyboard.press('Escape')
    await sb.ribbon('Open command palette').click()
    await expect(page.locator('.prompt-input')).toHaveAttribute('placeholder', /Type a command/)
    await page.keyboard.press('Escape')

    await sb.ribbon('Create new note').click()
    await expect.poll(() => app.activeFile()).toBe('Untitled.md')
    await sb.ribbon('Create new canvas').click()
    await expect.poll(() => app.activeFile()).toBe('Untitled.canvas')
    await sb.ribbon('Create new form-map').click()
    await expect.poll(() => app.activeFile()).toBe('Untitled form-map.formmap')

    await sb.ribbon('Open graph view').click()
    await expect(tabs.activeTab()).toHaveText('Graph view')
    await expect(page.locator('.leaf.is-focused .graph-view')).toBeVisible()
    // singleton: a second click focuses the existing graph tab
    await tabs.tab('Untitled form-map').click()
    await sb.ribbon('Open graph view').click()
    await expect(page.locator('.tab', { hasText: 'Graph view' })).toHaveCount(1)
    await expect(tabs.activeTab()).toHaveText('Graph view')

    await sb.ribbon('Toggle terminal').click()
    await expect(page.locator('.bottom-panel')).toBeVisible()
    await expect(page.locator('.bottom-tab.is-active')).toContainText('Terminal 1')
    await sb.ribbon('Toggle terminal').click()
    await expect(page.locator('.bottom-panel')).toBeHidden()

    await page.locator('.ribbon button[title="Help"]').click()
    await expect(page.locator('.notice', { hasText: 'Ctrl+P commands' })).toBeVisible()
    await sb.ribbon('Settings (Ctrl+,)').click()
    await expect(page.locator('.settings-modal')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.locator('.settings-modal')).toHaveCount(0)

    await app.runPaletteCommand('Toggle ribbon')
    await expect(page.locator('.ribbon')).toBeHidden()
    await app.runPaletteCommand('Toggle ribbon')
    await expect(page.locator('.ribbon')).toBeVisible()
  })
})
