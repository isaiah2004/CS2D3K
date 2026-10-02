// Graph view + local graph pane: counts, filters, groups, persisted settings, node clicks, live updates.
// Fixture vault "graph":  A → B, C (#alpha) · B → A, Ghost (unresolved) · C → img.png (#beta) · D (orphan) ·
// sub/E → A (#alpha) · code.ts (not part of the graph)
import { test, expect } from './fixtures'
import { Graph, LOCAL_GRAPH } from './helpers/graph'
import { MarkdownEditor } from './helpers/editor'

test.use({ vault: { source: 'graph' } })

test.describe('graph view @basic', () => {
  test('Ctrl+G opens the graph with node and link counts of the vault', async ({ app, page }) => {
    const graph = new Graph(app)
    await graph.open()
    await expect.poll(async () => (await app.layout())[0].tabs.map((t) => t.type)).toContain('graph')
    // 5 notes + 1 unresolved link; A–B (both directions, one edge), A–C, B–Ghost, E–A
    await graph.expectCounts(6, 4)
    await graph.waitSettled()
    for (const id of ['A.md', 'B.md', 'C.md', 'D.md', 'sub/E.md', 'unresolved:ghost']) expect(await graph.pos(id), id).not.toBeNull()
    expect(await graph.pos('code.ts')).toBeNull()

    // Ctrl+G again focuses the existing graph instead of opening another
    await app.openFile('A.md')
    await page.keyboard.press('Control+G')
    await expect.poll(async () => (await app.layout())[0].tabs.filter((t) => t.type === 'graph').length).toBe(1)
    await expect(graph.status()).toBeVisible()
  })

  test('filters change the counts', async ({ app, page }) => {
    const graph = new Graph(app)
    await graph.open()
    await graph.expectCounts(6, 4)
    await graph.openSettings()

    await graph.toggle('Tags').click()
    await expect(graph.toggle('Tags').locator('.toggle')).toHaveAttribute('aria-checked', 'true')
    await graph.expectCounts(8, 7)
    await graph.toggle('Tags').click()
    await graph.expectCounts(6, 4)

    await graph.toggle('Attachments').click()
    await graph.expectCounts(7, 5)
    await graph.toggle('Attachments').click()

    await graph.toggle('Orphans').click()
    await graph.expectCounts(5, 4)
    await graph.toggle('Orphans').click()

    await graph.toggle('Existing files only').click()
    await graph.expectCounts(5, 3)
    await graph.toggle('Existing files only').click()
    await graph.expectCounts(6, 4)

    const search = graph.controls().locator('.graph-search input')
    await search.fill('file:B')
    await graph.expectCounts(2, 1)
    await search.fill('path:sub')
    await graph.expectCounts(1, 0)
    await search.fill('zzz-nothing')
    await expect(page.locator('.graph-empty')).toHaveText('No files match the current filters.')
    await search.press('Escape')
    await expect(search).toHaveValue('')
    await graph.expectCounts(6, 4)
  })

  test('groups color their nodes', async ({ app, page }) => {
    const graph = new Graph(app)
    await graph.open()
    await graph.openSettings()
    await graph.controls().locator('button', { hasText: 'New group' }).click()
    const row = graph.controls().locator('.graph-group-row')
    await row.locator('input.input').fill('tag:alpha')
    await row.locator('input[type=color]').fill('#ff0000')
    await expect(row.locator('.graph-color-swatch')).toHaveCSS('background-color', 'rgb(255, 0, 0)')

    await page.mouse.move(2, 2)
    await graph.waitSettled()
    const isRed = ([r, g, b]: number[]): boolean => r > 200 && g < 60 && b < 60
    await expect.poll(async () => isRed(await graph.nodeColor('sub/E.md'))).toBe(true)
    await expect.poll(async () => isRed(await graph.nodeColor('A.md'))).toBe(true)
    expect(isRed(await graph.nodeColor('B.md'))).toBe(false)

    await row.locator('button[aria-label="Delete group"]').click()
    await expect(row).toHaveCount(0)
    await expect.poll(async () => isRed(await graph.nodeColor('A.md'))).toBe(false)
  })

  test('settings persist to .cs2d3k/graph.json', async ({ app }) => {
    const graph = new Graph(app)
    await graph.open()
    await graph.openSettings()
    await graph.toggle('Tags').click()
    await graph.toggle('Arrows').click()
    await graph.controls().locator('button', { hasText: 'New group' }).click()
    await graph.controls().locator('.graph-group-row input.input').fill('path:sub')
    await app.expectFile('.cs2d3k/graph.json', (c) => {
      const j = JSON.parse(c)
      return j.showTags === true && j.showArrows === true && j.panelOpen === true && j.groups?.[0]?.query === 'path:sub'
    })

    // restore defaults keeps the panel open
    await graph.controls().locator('button[aria-label="Restore default settings"]').click()
    await graph.expectCounts(6, 4)
    await app.expectFile('.cs2d3k/graph.json', (c) => {
      const j = JSON.parse(c)
      return j.showTags === false && j.groups.length === 0 && j.panelOpen === true
    })
    await graph.controls().locator('button[aria-label="Close graph settings"]').click()
    await expect(graph.controls()).toHaveCount(0)
    await app.expectFile('.cs2d3k/graph.json', (c) => JSON.parse(c).panelOpen === false)
  })

  test.describe('with saved settings', () => {
    test.use({ vault: { source: 'graph', files: { '.cs2d3k/graph.json': JSON.stringify({ showTags: true, showOrphans: false, panelOpen: true }) } } })
    test('loads them on open', async ({ app }) => {
      const graph = new Graph(app)
      await graph.open()
      await expect(graph.controls()).toBeVisible()
      await expect(graph.toggle('Tags').locator('.toggle')).toHaveAttribute('aria-checked', 'true')
      await expect(graph.toggle('Orphans').locator('.toggle')).toHaveAttribute('aria-checked', 'false')
      // tags on, D hidden: A B C E Ghost #alpha #beta
      await graph.expectCounts(7, 7)
    })
  })

  test('clicking a node opens the file, Ctrl+click in a new tab', async ({ app }) => {
    const graph = new Graph(app)
    await app.openFile('A.md')
    await graph.open()
    await graph.clickNode('D.md')
    await expect.poll(() => app.activeFile()).toBe('D.md')
    await expect(new MarkdownEditor(app).title()).toHaveText('D')

    await graph.open()
    const before = (await app.layout())[0].tabs.length
    await graph.clickNode('sub/E.md', { modifiers: ['Control'] })
    await expect.poll(() => app.activeFile()).toBe('sub/E.md')
    expect((await app.layout())[0].tabs.length).toBe(before + 1)
  })

  test('clicking an unresolved node creates the note', async ({ app }) => {
    const graph = new Graph(app)
    await graph.open()
    expect(app.exists('Ghost.md')).toBe(false)
    await graph.clickNode('unresolved:ghost')
    await expect.poll(() => app.exists('Ghost.md')).toBe(true)
    await expect.poll(() => app.activeFile()).toBe('Ghost.md')
    // the graph now has a real note instead of the unresolved node
    await graph.open()
    await graph.expectCounts(6, 4)
    await graph.waitSettled()
    expect(await graph.pos('Ghost.md')).not.toBeNull()
    expect(await graph.pos('unresolved:ghost')).toBeNull()
  })

  test('tag nodes search for the tag; nodes can be dragged', async ({ app, page }) => {
    const graph = new Graph(app)
    await graph.open()
    await graph.openSettings()
    await graph.toggle('Tags').click()
    await graph.expectCounts(8, 7)
    await graph.clickNode('tag:alpha')
    await expect(page.locator('input[placeholder="Search files..."]')).toHaveValue('#alpha')

    // drag D somewhere else: it follows the pointer and the camera stops auto-fitting
    await graph.waitSettled()
    const p = (await graph.pos('D.md'))!
    await page.mouse.move(p.x, p.y)
    await page.mouse.down()
    await page.mouse.move(p.x + 80, p.y + 50, { steps: 8 })
    const during = (await graph.pos('D.md'))!
    expect(Math.hypot(during.x - p.x - 80, during.y - p.y - 50)).toBeLessThan(10)
    await page.mouse.up()
    await expect(page.locator('canvas.graph-canvas').first()).toHaveCSS('cursor', /pointer|default/)
    // a drag isn't a click: nothing was opened
    expect(await app.activeFile()).toBeNull()
  })

  test('node context menu opens to the right', async ({ app, page }) => {
    const graph = new Graph(app)
    await graph.open()
    await graph.clickNode('C.md', { button: 'right' })
    const menu = page.locator('.menu')
    await expect(menu.locator('.menu-item')).toContainText(['Open', 'Open in new tab', 'Open to the right', 'Reveal in file explorer', 'Copy path'])
    await menu.locator('.menu-item', { hasText: 'Open to the right' }).click()
    await expect.poll(async () => (await app.layout()).map((l) => l.tabs.map((t) => t.path ?? t.type))).toEqual([expect.arrayContaining(['graph']), ['C.md']])
    await expect.poll(() => app.activeFile()).toBe('C.md')
  })

  test('updates live when a link is added', async ({ app, page }) => {
    const graph = new Graph(app)
    const ed = new MarkdownEditor(app)
    await ed.open('D.md')
    await page.evaluate(() => {
      const ws = window.__cs2d3k!.stores.workspace.getState() as { openView(t: string, o: { target: string }): void }
      ws.openView('graph', { target: 'split-right' })
    })
    await expect(graph.canvas()).toBeVisible()
    await graph.expectCounts(6, 4)

    const left = new MarkdownEditor(app, page.locator('.leaf').nth(0).locator('.view:not(.hidden)'))
    await left.focusEnd()
    await left.type('now links [[C]] and [[New idea]]')
    await page.locator('.leaf').nth(1).locator('.tab', { hasText: 'Graph' }).click()
    // D–C plus a new unresolved node
    await graph.expectCounts(7, 6)
    await graph.waitSettled()
    expect(await graph.pos('unresolved:new idea')).not.toBeNull()
  })
})

test.describe('local graph @basic', () => {
  test('follows the active file and the depth slider', async ({ app, page }) => {
    const local = new Graph(app, LOCAL_GRAPH)
    await app.openFile('A.md')
    await page.locator('.sidebar-tab[title="Local graph"]').click()
    await expect(local.canvas()).toBeVisible()
    // A and its neighbours B, C, E
    await expect.poll(() => local.counts()).toEqual({ nodes: 4, links: 3 })

    const depth = page.locator('.local-graph-depth input[type=range]')
    await depth.focus()
    await page.keyboard.press('ArrowRight')
    await expect(page.locator('.local-graph-depth-value')).toHaveText('2')
    // + Ghost (via B) and img.png (via C; attachments are on in the local graph)
    await expect.poll(() => local.counts()).toEqual({ nodes: 6, links: 5 })
    await app.expectFile('.cs2d3k/graph.json', (c) => JSON.parse(c).local?.depth === 2)

    await page.locator('.local-graph button[aria-label="Show attachments"]').click()
    await expect.poll(() => local.counts()).toEqual({ nodes: 5, links: 4 })
    await page.keyboard.press('Home')

    await app.openFile('D.md')
    await expect.poll(() => local.counts()).toEqual({ nodes: 1, links: 0 })
    await app.openFile('B.md')
    await depth.focus()
    await page.keyboard.press('ArrowLeft')
    await expect(page.locator('.local-graph-depth-value')).toHaveText('1')
    await expect.poll(() => local.counts()).toEqual({ nodes: 3, links: 2 })

    // clicking a node in the local graph opens it
    await local.clickNode('unresolved:ghost')
    await expect.poll(() => app.activeFile()).toBe('Ghost.md')
  })

  test('shows a message when no file is open', async ({ page }) => {
    await page.locator('.sidebar-tab[title="Local graph"]').click()
    await expect(page.locator('.local-graph .graph-empty')).toHaveText('No file is open.')
  })
})
