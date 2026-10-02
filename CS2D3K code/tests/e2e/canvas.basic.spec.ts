// Canvas (.canvas) end-to-end: the canvas engine driven like a user (mouse + keyboard), asserting on the UI and on
// the JSON Canvas file on disk. Ported from the ad-hoc e2e/canvas.mjs script.
//
// Note on the sample vault: Architecture.canvas has a link node (en.wikipedia.org). Wikipedia allows framing and the
// app CSP allows https frames, so it logs no console errors; the specs keep the strict console-error check.
import { test, expect } from './fixtures'
import type { App } from './helpers/app'
import { CanvasPage, center, dropFiles, type CData, type CNode, type Viewport } from './helpers/canvas'

const FILE = 'Architecture.canvas'
const onGrid = (v: number): boolean => Math.abs(v % 20) === 0
const snap = (v: number): number => Math.round(v / 20) * 20

async function openCanvas(app: App, file = FILE): Promise<CanvasPage> {
  const c = new CanvasPage(app, file)
  await c.open()
  return c
}

test.describe('canvas @basic', () => {
  test('opening a canvas fits its content into view', async ({ app, page }) => {
    const c = await openCanvas(app)
    await expect(c.root().locator('.canvas-node')).toHaveCount(6)
    await expect(c.root().locator('g.canvas-edge')).toHaveCount(3)
    const r = await c.rootBox()
    for (const id of ['a1', 'a2', 'a3', 'a4', 'a5', 'g1']) {
      const b = await c.nodeBox(id)
      expect(b.x).toBeGreaterThanOrEqual(r.x - 1)
      expect(b.y).toBeGreaterThanOrEqual(r.y - 1)
      expect(b.x + b.width).toBeLessThanOrEqual(r.x + r.width + 1)
      expect(b.y + b.height).toBeLessThanOrEqual(r.y + r.height + 1)
    }
    // rendered content: markdown text card, file previews, code cell, edge label
    await expect(c.node('a1').locator('h1')).toHaveText('CS2D3K')
    await expect(c.node('a2').locator('.canvas-node-label')).toHaveText('Welcome')
    await expect(c.node('a4').locator('.canvas-code-lang')).toHaveValue('python')
    await expect(c.edgeLabel('e2')).toHaveText('implements')
    await expect(page.locator('.status-bar-item', { hasText: '6 cards · 3 edges' })).toBeVisible()
  })

  test('double-click on the background creates a text card in edit mode; typing is saved', async ({ app, page }) => {
    const c = await openCanvas(app)
    const p = await c.emptyPoint()
    const w = await c.toWorld(p)
    await page.mouse.dblclick(p.x, p.y)
    const editing = c.root().locator('.canvas-node.is-editing')
    await expect(editing).toHaveCount(1)
    await expect(editing.locator('.cm-editor.cm-focused')).toBeVisible()
    await page.keyboard.type('Hello **canvas**')
    await page.keyboard.press('Escape')
    await expect(editing).toHaveCount(0)
    const n = await c.waitForNode((n) => n.type === 'text' && n.text === 'Hello **canvas**', 'new card saved')
    expect(Math.abs(n.x + n.width / 2 - w.x)).toBeLessThanOrEqual(20)
    expect(Math.abs(n.y + n.height / 2 - w.y)).toBeLessThanOrEqual(20)
    await expect(c.node(n.id).locator('strong')).toHaveText('canvas')
    await expect(c.node(n.id)).toHaveClass(/is-selected/)
  })

  test('dragging a card snaps it to the 20px grid', async ({ app }) => {
    const c = await openCanvas(app)
    const before = c.nodeOnDisk('a1')!
    const { zoom } = await c.viewport()
    await c.dragNode('a1', 47, 29)
    const after = await c.waitForNode((n) => n.id === 'a1' && (n.x !== before.x || n.y !== before.y), 'a1 moved')
    expect(onGrid(after.x) && onGrid(after.y), `snapped ${after.x},${after.y}`).toBe(true)
    expect(Math.abs(after.x - (before.x + 47 / zoom))).toBeLessThanOrEqual(10.5)
    expect(Math.abs(after.y - (before.y + 29 / zoom))).toBeLessThanOrEqual(10.5)
    // the DOM follows the data
    const b = await c.nodeBox('a1')
    const s = await c.toScreen({ x: after.x, y: after.y })
    expect(Math.abs(b.x - s.x)).toBeLessThan(2)
    expect(Math.abs(b.y - s.y)).toBeLessThan(2)
  })

  test('resizing a card from its corner snaps the new edges', async ({ app }) => {
    const c = await openCanvas(app)
    await c.select('a1')
    await expect(c.node('a1')).toHaveClass(/is-selected/)
    const se = await c.nodeBox('a1', '.canvas-resize-se')
    await c.drag(center(se), { x: center(se).x + 80, y: center(se).y + 50 }, { steps: 8 })
    const n = await c.waitForNode((n) => n.id === 'a1' && n.width > 300 && n.height > 110, 'a1 resized')
    expect(n.x).toBe(-220)
    expect(n.y).toBe(-320)
    expect(onGrid(n.x + n.width) && onGrid(n.y + n.height)).toBe(true)
  })

  test('box select, Shift-click adds and removes', async ({ app, page }) => {
    const c = await openCanvas(app)
    const a1 = c.nodeOnDisk('a1')!
    // marquee from empty space above-left of a1 into a1: intersecting cards get selected, the group (not contained) not
    const from = await c.toScreen({ x: a1.x - 120, y: a1.y - 30 })
    const to = await c.toScreen({ x: a1.x + 40, y: a1.y + 40 })
    await c.drag(from, to, { hold: true })
    await expect(c.root().locator('.canvas-marquee')).toBeVisible()
    await page.mouse.up()
    await expect(c.root().locator('.canvas-marquee')).toHaveCount(0)
    await expect.poll(() => c.selectedIds()).toEqual(['a1'])
    await c.select('a4', { modifiers: ['Shift'] })
    await expect.poll(async () => (await c.selectedIds()).sort()).toEqual(['a1', 'a4'])
    await c.select('a1', { modifiers: ['Shift'] })
    await expect.poll(() => c.selectedIds()).toEqual(['a4'])
    // a marquee around everything selects all cards and the fully contained group
    const r = await c.rootBox()
    await c.drag({ x: r.x + 4, y: r.y + 4 }, { x: r.x + r.width - 4, y: r.y + r.height - 4 })
    await expect.poll(async () => (await c.selectedIds()).length).toBe(6)
    // clicking empty space clears the selection
    await c.clickBackground()
    await expect.poll(() => c.selectedIds()).toEqual([])
  })

  test('delete, duplicate and copy/paste of cards', async ({ app, page, electronApp }) => {
    const c = await openCanvas(app)
    const a1 = c.nodeOnDisk('a1')!

    // duplicate (Ctrl+D) places a copy to the right
    await c.select('a1')
    await page.keyboard.press('Control+d')
    const dup = await c.waitForNode((n) => n.type === 'text' && n.id !== 'a1' && n.text === a1.text, 'duplicate')
    expect(dup.x).toBe(a1.x + snap(a1.width + 40))
    expect(dup.y).toBe(a1.y)
    await expect.poll(() => c.selectedIds()).toEqual([dup.id])

    // copy (Ctrl+C) puts JSON Canvas on the clipboard; paste (Ctrl+V) drops it at the pointer
    await c.select('a1')
    await page.keyboard.press('Control+c')
    await expect.poll(() => electronApp.evaluate(({ clipboard }) => clipboard.readText())).toContain('"nodes"')
    const p = await c.emptyPoint({ clearance: 60 })
    const w = await c.toWorld(p)
    await page.mouse.move(p.x, p.y)
    await page.keyboard.press('Control+v')
    const pasted = await c.waitForNode((n) => n.text === a1.text && n.id !== 'a1' && n.id !== dup.id, 'pasted copy')
    expect(Math.abs(pasted.x + pasted.width / 2 - w.x)).toBeLessThanOrEqual(20)
    expect(Math.abs(pasted.y + pasted.height / 2 - w.y)).toBeLessThanOrEqual(20)

    // plain text paste → text card, URL paste → web page card
    await electronApp.evaluate(({ clipboard }) => clipboard.writeText('Just some *pasted* words'))
    await page.keyboard.press('Control+v')
    await c.waitForNode((n) => n.type === 'text' && n.text === 'Just some *pasted* words', 'text paste')
    await electronApp.evaluate(({ clipboard }) => clipboard.writeText('http://example.com/docs'))
    await page.keyboard.press('Control+v')
    const link = await c.waitForNode((n) => n.type === 'link' && n.url === 'http://example.com/docs', 'url paste')
    await expect(c.node(link.id).locator('.canvas-link-url')).toHaveText('example.com')

    // delete removes the card and its edges
    await c.select('a1')
    await page.keyboard.press('Delete')
    await c.expectData((d) => !d.nodes.some((n) => n.id === 'a1') && !d.edges.some((e) => e.fromNode === 'a1'), 'a1 + edges deleted')
    await expect(c.node('a1')).toHaveCount(0)
    await expect(c.edge('e1')).toHaveCount(0)
  })

  test('undo / redo restore moves and deletions (keyboard + controls)', async ({ app, page }) => {
    const c = await openCanvas(app)
    const orig = c.nodeOnDisk('a1')!
    await c.dragNode('a1', 60, 40)
    const moved = await c.waitForNode((n) => n.id === 'a1' && n.x !== orig.x, 'moved')
    await page.keyboard.press('Control+z')
    await c.expectData((d) => d.nodes.some((n) => n.id === 'a1' && n.x === orig.x && n.y === orig.y), 'undo move')
    await page.keyboard.press('Control+Shift+z')
    await c.expectData((d) => d.nodes.some((n) => n.id === 'a1' && n.x === moved.x && n.y === moved.y), 'redo move')

    await c.select('a2')
    await page.keyboard.press('Delete')
    await c.expectData((d) => !d.nodes.some((n) => n.id === 'a2') && !d.edges.some((e) => e.id === 'e1'), 'deleted')
    await c.root().locator('button[title="Undo (Ctrl+Z)"]').click()
    await c.expectData((d) => d.nodes.some((n) => n.id === 'a2') && d.edges.some((e) => e.id === 'e1'), 'undo delete restores node + edge')
    await expect(c.node('a2')).toBeVisible()
    await c.root().locator('button[title="Redo (Ctrl+Shift+Z)"]').click()
    await c.expectData((d) => !d.nodes.some((n) => n.id === 'a2'), 'redo delete')
    await c.focus()
    await page.keyboard.press('Control+z')
    await page.keyboard.press('Control+y')
    await c.expectData((d) => !d.nodes.some((n) => n.id === 'a2'), 'Ctrl+Y redoes')
  })

  test('connect two cards via a handle; edit the edge label; edge color and arrows via the context menu', async ({ app, page }) => {
    const c = await openCanvas(app)
    const edges0 = c.data().edges.length
    await c.connect('a1', 'a4', 'right')
    let edge: CData['edges'][number] | undefined
    await c.expectData((d) => (edge = d.edges.find((e) => e.fromNode === 'a1' && e.toNode === 'a4')), 'edge a1 → a4 created')
    expect(c.data().edges).toHaveLength(edges0 + 1)
    expect(edge!.fromSide).toBe('right')
    const id = edge!.id
    await expect(c.edge(id)).toHaveCount(1)

    // add a label from the edge context menu
    const mid = await c.edgePoint(id)
    await page.mouse.click(mid.x, mid.y, { button: 'right' })
    await c.menuItem('Add label').click()
    await page.keyboard.type('runs')
    await page.keyboard.press('Enter')
    await c.expectData((d) => d.edges.find((e) => e.id === id)?.label === 'runs', 'label saved')
    await expect(c.edgeLabel(id)).toHaveText('runs')

    // double-click an existing label to edit it
    await c.dblTap(c.edgeLabel('e2'))
    await expect(c.edgeLabel('e2').locator('input')).toBeFocused()
    await page.keyboard.press('Control+a')
    await page.keyboard.type('calls')
    await page.keyboard.press('Enter')
    await c.expectData((d) => d.edges.find((e) => e.id === 'e2')?.label === 'calls', 'e2 label edited')

    // color
    await c.tap(c.edgeLabel('e2'), { button: 'right' })
    await c.menuItem('Set color').hover()
    await page.locator('.menu .menu .menu-item', { hasText: 'Red' }).click()
    await c.expectData((d) => d.edges.find((e) => e.id === 'e2')?.color === '1', 'edge color')
    await expect(c.edge('e2')).toHaveClass(/has-color/)

    // arrows
    await c.tap(c.edgeLabel('e2'), { button: 'right' })
    await c.menuItem('Arrows').hover()
    await page.locator('.menu .menu .menu-item', { hasText: 'Two-way' }).click()
    await c.expectData((d) => {
      const e = d.edges.find((e) => e.id === 'e2')
      return e?.fromEnd === 'arrow' && e?.toEnd === 'arrow'
    }, 'two-way arrows')
    await expect(c.edge('e2').locator('.canvas-edge-arrow')).toHaveCount(2)
    await c.tap(c.edgeLabel('e2'), { button: 'right' })
    await c.menuItem('Arrows').hover()
    await page.locator('.menu .menu .menu-item', { hasText: 'No arrows' }).click()
    await c.expectData((d) => d.edges.find((e) => e.id === 'e2')?.toEnd === 'none', 'no arrows')
    await expect(c.edge('e2').locator('.canvas-edge-arrow')).toHaveCount(0)
  })

  test('dropping a new edge on empty space opens the create menu', async ({ app, page }) => {
    const c = await openCanvas(app)
    const a1 = c.nodeOnDisk('a1')!
    const dropAt = await c.toScreen({ x: a1.x + a1.width / 2, y: a1.y - 200 })
    const edges0 = c.data().edges.length
    const dragFromTop = async (): Promise<void> => {
      const b = await c.nodeBox('a1')
      await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2)
      const h = await c.nodeBox('a1', '.canvas-handle-top')
      await c.drag(center(h), dropAt, { steps: 10 })
    }

    // Escape dismisses the menu and the pending edge
    await dragFromTop()
    await expect(page.locator('.menu')).toBeVisible()
    for (const label of ['Add card', 'Add note from vault', 'Add code cell', 'Add web page']) await expect(c.menuItem(label)).toBeVisible()
    await expect(c.root().locator('.canvas-edges-temp')).toHaveCount(1)
    await page.keyboard.press('Escape')
    await expect(page.locator('.menu')).toHaveCount(0)
    await expect(c.root().locator('.canvas-edges-temp')).toHaveCount(0)

    // picking an item creates a connected node there
    await dragFromTop()
    await c.menuItem('Add code cell').click()
    const code = c.root().locator('.canvas-node-code.is-selected .cm-editor.cm-focused')
    await expect(code).toBeVisible()
    await page.keyboard.type('print(40 + 2)')
    const n = await c.waitForNode((n) => n.type === 'code' && n.code === 'print(40 + 2)', 'connected code cell')
    await c.expectData((d) => d.edges.length === edges0 + 1 && d.edges.some((e) => e.fromNode === 'a1' && e.fromSide === 'top' && e.toNode === n.id), 'edge to new cell')
  })

  test('group: create from the selection, dragging a group moves its children', async ({ app, page }) => {
    const c = await openCanvas(app)
    const a1 = c.nodeOnDisk('a1')!
    await c.select('a1')
    await c.root().locator('.canvas-card-menu-button[aria-label="Add group"]').click()
    const input = c.root().locator('.canvas-group-label.is-editing input')
    await expect(input).toBeFocused()
    await page.keyboard.type('Intro')
    await page.keyboard.press('Enter')
    const g = await c.waitForNode((n) => n.type === 'group' && n.label === 'Intro', 'group created')
    // the selection's bounds + 40px padding, snapped to the grid
    expect([g.x, g.y, g.x + g.width, g.y + g.height]).toEqual([snap(a1.x - 40), snap(a1.y - 40), snap(a1.x + a1.width + 40), snap(a1.y + a1.height + 40)])
    await expect(c.node(g.id).locator('.canvas-group-label')).toHaveText('Intro')

    // dragging the new group by its label carries a1
    const lb = await c.nodeBox(g.id, '.canvas-group-label')
    await c.drag(center(lb), { x: center(lb).x - 60, y: center(lb).y - 40 })
    const g2 = await c.waitForNode((n) => n.id === g.id && n.x !== g.x, 'group moved')
    await c.expectData((d) => {
      const n = d.nodes.find((x) => x.id === 'a1')!
      return n.x - a1.x === g2.x - g.x && n.y - a1.y === g2.y - g.y
    }, 'a1 moved with its group')

    // the sample group "Code" carries the three cards inside it, not the ones outside
    const before = c.data()
    const at = (d: CData, id: string): CNode => d.nodes.find((n) => n.id === id)!
    const gl = await c.nodeBox('g1', '.canvas-group-label')
    await c.drag(center(gl), { x: center(gl).x + 50, y: center(gl).y + 30 })
    await c.expectData((d) => at(d, 'g1').x !== at(before, 'g1').x, 'g1 moved')
    const after = c.data()
    const dx = at(after, 'g1').x - at(before, 'g1').x
    const dy = at(after, 'g1').y - at(before, 'g1').y
    for (const id of ['a3', 'a4', 'a5']) expect([at(after, id).x - at(before, id).x, at(after, id).y - at(before, id).y], id).toEqual([dx, dy])
    for (const id of ['a1', 'a2']) expect([at(after, id).x, at(after, id).y], id).toEqual([at(before, id).x, at(before, id).y])
  })

  test('dropping a file from the explorer creates a file node', async ({ app }) => {
    const c = await openCanvas(app)
    const p = await c.emptyPoint({ clearance: 60 })
    const w = await c.toWorld(p)
    const r = await c.rootBox()
    await app.treeItem('CS2D3K Definition.formmap').dragTo(c.root(), { targetPosition: { x: p.x - r.x, y: p.y - r.y } })
    let n = await c.waitForNode((n) => n.type === 'file' && n.file === 'CS2D3K Definition.formmap', 'file node from drop')
    expect(Math.abs(n.x + n.width / 2 - w.x)).toBeLessThanOrEqual(30)
    await expect(c.node(n.id).locator('.canvas-node-label')).toHaveText('CS2D3K Definition.formmap')
    // several files (multi-selection payload) are laid out side by side
    await dropFiles(c.root(), ['Notes/Linking notes.md', 'Projects/api/utils.py'], p)
    n = await c.waitForNode((n) => n.file === 'Notes/Linking notes.md', 'first dropped')
    const m = await c.waitForNode((n) => n.file === 'Projects/api/utils.py', 'second dropped')
    expect(m.x).toBeGreaterThanOrEqual(n.x + n.width)
    await expect(c.node(n.id).locator('.canvas-markdown')).toBeVisible()
    await expect(c.node(m.id).locator('.canvas-code-preview')).toBeVisible()
  })

  test('"Add note from vault" picker adds the chosen file', async ({ app, page }) => {
    const c = await openCanvas(app)
    const count = c.data().nodes.length
    await c.root().locator('.canvas-card-menu-button[aria-label="Add note from vault"]').click()
    await expect(page.locator('.prompt-input')).toBeFocused()
    // the canvas itself is not offered
    await page.keyboard.type('Architecture')
    await expect(page.locator('.suggestion-item', { hasText: 'Architecture.canvas' })).toHaveCount(0)
    await page.locator('.prompt-input').fill('utils')
    await expect(page.locator('.suggestion-item').first()).toContainText('Projects/api/utils.py')
    await page.keyboard.press('Enter')
    await expect(page.locator('.prompt-input')).toHaveCount(0)
    const n = await c.waitForNode((n) => n.type === 'file' && n.file === 'Projects/api/utils.py', 'note added')
    expect(c.data().nodes).toHaveLength(count + 1)
    await expect(c.node(n.id)).toHaveClass(/is-selected/)
    // placed in a free spot: no overlap with other cards
    const others = c.data().nodes.filter((o) => o.id !== n.id && o.type !== 'group')
    for (const o of others) expect(n.x < o.x + o.width && n.x + n.width > o.x && n.y < o.y + o.height && n.y + n.height > o.y, `overlaps ${o.id}`).toBe(false)
  })

  test('web page card: URL prompt validates and adds a framed page', async ({ app, page }) => {
    const c = await openCanvas(app)
    await c.root().locator('.canvas-card-menu-button[aria-label="Add web page"]').click()
    const input = page.locator('.modal .input')
    await expect(input).toBeFocused()
    await page.keyboard.type('not a url')
    await page.keyboard.press('Enter')
    await expect(page.locator('.modal-error')).toHaveText('Enter a valid URL')
    await input.fill('example.com')
    await page.keyboard.press('Enter')
    await expect(page.locator('.modal')).toHaveCount(0)
    const n = await c.waitForNode((n) => n.type === 'link' && n.url === 'https://example.com', 'link node (https added)')
    await expect(c.node(n.id).locator('.canvas-link-url')).toHaveText('example.com')
    await expect(c.node(n.id).locator('iframe')).toHaveAttribute('src', 'https://example.com')
  })

  test('code cell: run python, Ctrl+Enter, stop, language switch; code edits are saved', async ({ app, page }) => {
    test.slow()
    const c = await openCanvas(app)
    const cell = c.node('a4')
    // run the sample python cell
    await c.tap(cell.locator('.canvas-code-run'))
    await expect(cell.locator('.canvas-code-output pre')).toContainText('canvas code node 2', { timeout: 20_000 })
    await expect(cell.locator('.canvas-code-status')).toContainText('Exit code 0')

    // edit the code; Ctrl+Enter runs it
    await c.tap(cell.locator('.cm-content'))
    await page.keyboard.press('Control+End')
    await page.keyboard.type('\nprint("done")')
    await page.keyboard.press('Control+Enter')
    await expect(cell.locator('.canvas-code-output pre')).toContainText('done', { timeout: 20_000 })
    await c.expectData((d) => (d.nodes.find((n) => n.id === 'a4')?.code as string)?.endsWith('print("done")'), 'python edit saved')

    // switch to JavaScript and run
    await cell.locator('.canvas-code-lang').selectOption('js')
    await c.expectData((d) => d.nodes.find((n) => n.id === 'a4')?.language === 'js', 'language saved')
    await c.tap(cell.locator('.cm-content'))
    await page.keyboard.press('Control+a')
    await page.keyboard.type('console.log("from js", 6 * 7')
    await page.keyboard.press('Control+Enter')
    await expect(cell.locator('.canvas-code-output pre')).toContainText('from js 42', { timeout: 20_000 })
    await c.expectData((d) => d.nodes.find((n) => n.id === 'a4')?.code === 'console.log("from js", 6 * 7)', 'js code saved')

    // a long-running cell can be stopped
    await page.keyboard.press('Control+a')
    await page.keyboard.type("setInterval(() => console.log('tick'), 100")
    await c.tap(cell.locator('.canvas-code-run'))
    await expect(cell.locator('.canvas-code-output pre')).toContainText('tick', { timeout: 20_000 })
    await expect(cell.locator('.canvas-code-status')).toContainText('Running')
    await c.tap(cell.locator('.canvas-code-run.is-running'))
    await expect(cell.locator('.canvas-code-run:not(.is-running)')).toBeVisible({ timeout: 15_000 })
    await expect(cell.locator('.canvas-code-status')).not.toContainText('Running')
  })

  test('zoom controls, Shift+1, Ctrl+wheel, wheel and space-drag panning', async ({ app, page }) => {
    const c = await openCanvas(app)
    const fit = await c.viewport()
    const label = c.root().locator('.canvas-zoom-label')
    await expect(label).toHaveText(`${Math.round(fit.zoom * 100)}%`)

    await c.moveCamera(() => c.root().locator('button[title="Zoom in"]').click())
    expect((await c.viewport()).zoom).toBeCloseTo(fit.zoom * 1.25, 3)
    await c.moveCamera(() => label.click())
    await expect(label).toHaveText('100%')
    await c.moveCamera(() => c.root().locator('button[title="Zoom out"]').click())
    await expect(label).toHaveText('80%')
    await c.focus()
    await c.moveCamera(() => page.keyboard.press('Shift+1'))
    expect((await c.viewport()).zoom).toBeCloseTo(fit.zoom, 3)

    // Ctrl+wheel zooms around the pointer: the world point under it stays put
    const p = await c.emptyPoint()
    const wBefore = await c.toWorld(p)
    await c.ctrlWheel(p, -100, 3)
    await expect.poll(async () => (await c.viewport()).zoom).toBeGreaterThan(fit.zoom * 1.5)
    const wAfter = await c.toWorld(p)
    expect(Math.abs(wAfter.x - wBefore.x)).toBeLessThan(1)
    expect(Math.abs(wAfter.y - wBefore.y)).toBeLessThan(1)
    await c.moveCamera(() => c.root().locator('button[title="Zoom to fit (Shift+1)"]').click())
    expect((await c.viewport()).zoom).toBeCloseTo(fit.zoom, 3)

    // plain wheel pans
    const v0 = await c.viewport()
    await page.mouse.move(p.x, p.y)
    await page.mouse.wheel(0, 120)
    await expect.poll(async () => (await c.viewport()).y).toBeCloseTo(v0.y - 120, 0)

    // space + drag pans; nothing moves on disk
    const disk = JSON.stringify(c.data().nodes)
    const v1 = await c.viewport()
    const q = await c.emptyPoint()
    await c.focus()
    await page.keyboard.down('Space')
    await expect(c.root()).toHaveClass(/is-space-down/)
    await c.drag(q, { x: q.x + 100, y: q.y + 60 }, { steps: 6 })
    await page.keyboard.up('Space')
    const v2 = await c.viewport()
    expect(v2.x - v1.x).toBeCloseTo(100, 0)
    expect(v2.y - v1.y).toBeCloseTo(60, 0)
    await page.evaluate(() => window.__cs2d3k!.fileops.flushAll())
    expect(JSON.stringify(c.data().nodes)).toBe(disk)
  })

  test('the viewport persists per tab', async ({ app, page }) => {
    const c = await openCanvas(app)
    const fit = await c.viewport()
    const p = await c.emptyPoint()
    await c.ctrlWheel(p, -100, 2)
    await expect.poll(async () => (await c.viewport()).zoom).toBeGreaterThan(fit.zoom * 1.3)
    const zoomed = await c.viewport()
    // saved into the tab state (debounced); the DOM transform is rounded, so compare loosely
    const same = (a: Viewport | undefined, b: Viewport): boolean => !!a && Math.abs(a.x - b.x) < 0.01 && Math.abs(a.y - b.y) < 0.01 && Math.abs(a.zoom - b.zoom) < 1e-5
    await expect.poll(async () => same(await page.evaluate(() => window.__cs2d3k!.getActiveTab()?.state?.viewport as Viewport | undefined), zoomed)).toBe(true)

    // a second tab on the same canvas starts fitted, with its own viewport
    await app.openFile(FILE, { newTab: true })
    await expect(c.root()).toBeVisible()
    await c.settle()
    expect((await c.viewport()).zoom).toBeCloseTo(fit.zoom, 3)
    expect((await app.layout())[0].tabs.filter((t) => t.path === FILE)).toHaveLength(2)

    // back to the first tab: its camera is unchanged
    await page.locator('.tab').filter({ hasText: 'Architecture' }).first().click()
    await expect.poll(async () => same(await c.viewport(), zoomed)).toBe(true)
  })

  test('an external edit reloads the canvas', async ({ app }) => {
    const c = await openCanvas(app)
    const d = c.data()
    d.nodes.push({ id: 'ext1', type: 'text', text: '# From outside', x: 800, y: -300, width: 260, height: 80 })
    d.edges = d.edges.filter((e) => e.id !== 'e3')
    app.writeExternal(FILE, JSON.stringify(d, null, '\t'))
    await expect(c.node('ext1').locator('h1')).toHaveText('From outside')
    await expect(c.edge('e3')).toHaveCount(0)
    // edits after the reload build on the new content
    await c.focus()
    await c.moveCamera(() => app.page.keyboard.press('Shift+1'))
    await c.select('ext1')
    await app.page.keyboard.press('Delete')
    await c.expectData((d) => !d.nodes.some((n) => n.id === 'ext1') && !d.edges.some((e) => e.id === 'e3') && d.nodes.length === 6, 'saved on top of the external edit')
  })

  test.describe('invalid file', () => {
    test.use({ vault: { source: 'sample', files: { 'Broken.canvas': 'this is not json {' } } })
    test('shows a safe empty state and is never overwritten (until the user adds something)', async ({ app, page }) => {
      const c = await openCanvas(app, 'Broken.canvas')
      await expect(c.root().locator('.canvas-empty-title')).toHaveText('Could not read this canvas')
      // camera changes are not edits
      const p = await c.emptyPoint()
      await c.ctrlWheel(p, -100, 2)
      await page.mouse.wheel(0, 80)
      await page.evaluate(() => window.__cs2d3k!.fileops.flushAll())
      // switching away also flushes pending saves
      await app.openFile('Welcome.md')
      await page.evaluate(() => window.__cs2d3k!.fileops.flushAll())
      expect(app.read('Broken.canvas')).toBe('this is not json {')
      // adding a card is an explicit edit: now it is written as valid JSON Canvas
      await app.openFile('Broken.canvas')
      await expect(c.root().locator('.canvas-empty-title')).toBeVisible()
      const q = await c.emptyPoint()
      await page.mouse.dblclick(q.x, q.y)
      await page.keyboard.type('fresh')
      await page.keyboard.press('Escape')
      await c.expectData((d) => d.nodes.length === 1 && d.nodes[0].text === 'fresh', 'rewritten after an edit')
    })
  })

  test.describe('unknown fields', () => {
    const custom = {
      nodes: [
        { id: 'n1', type: 'text', text: 'one', x: 0, y: 0, width: 260, height: 60, myField: { deep: [1, 2] }, styleAttributes: { shape: 'pill' } },
        { id: 'n2', type: 'text', text: 'two', x: 400, y: 0, width: 260, height: 60 },
        { id: 'n3', type: 'future-type', x: 0, y: 200, width: 200, height: 100, payload: 'keep me' }
      ],
      edges: [{ id: 'x1', fromNode: 'n1', fromSide: 'right', toNode: 'n2', toSide: 'left', weight: 3 }],
      metadata: { version: '1.0-1.0', frontmatter: { tags: ['a'] } }
    }
    test.use({ vault: { source: 'sample', files: { 'Custom.canvas': JSON.stringify(custom, null, '\t') } } })
    test('are preserved when the canvas is saved', async ({ app }) => {
      const c = await openCanvas(app, 'Custom.canvas')
      await expect(c.node('n3')).toContainText('Unsupported node type')
      await c.dragNode('n2', 40, 40)
      await c.expectData((d) => d.nodes.find((n) => n.id === 'n2')!.x !== 400, 'saved')
      const d = c.data()
      expect(d.metadata).toEqual(custom.metadata)
      const n1 = d.nodes.find((n) => n.id === 'n1')!
      expect(n1.myField).toEqual({ deep: [1, 2] })
      expect(n1.styleAttributes).toEqual({ shape: 'pill' })
      expect(d.nodes.find((n) => n.id === 'n3')).toMatchObject({ type: 'future-type', payload: 'keep me' })
      expect(d.edges[0]).toMatchObject({ id: 'x1', weight: 3 })
    })
  })

  test('renders in dark and light themes', async ({ app }) => {
    const c = await openCanvas(app)
    const lum = async (): Promise<{ bg: number; card: number }> =>
      c.root().evaluate((root) => {
        const l = (el: Element): number => {
          const m = getComputedStyle(el).backgroundColor.match(/[\d.]+/g)!.map(Number)
          return 0.2126 * m[0] + 0.7152 * m[1] + 0.0722 * m[2]
        }
        return { bg: l(root), card: l(root.querySelector('[data-node-id="a2"] .canvas-node-container')!) }
      })
    await app.setTheme('dark')
    const dark = await lum()
    await app.setTheme('light')
    await expect.poll(async () => (await lum()).bg).toBeGreaterThan(dark.bg + 60)
    const light = await lum()
    expect(light.card).toBeGreaterThan(dark.card + 60)
    await expect(c.node('a1').locator('h1')).toBeVisible()
  })
})
