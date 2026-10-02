import { test, expect } from './fixtures'

// Regression: views were remounted on every tab switch, losing editor/canvas state (undo history,
// run output, selection). A view's DOM must be the very same element after switching away and back.
test.describe('tab state @basic', () => {
  test('views stay mounted when switching tabs', async ({ app, page }) => {
    await app.openFile('Architecture.canvas')
    await expect(app.activeView().locator('.canvas-world [data-node-id]').first()).toBeVisible()
    await app.activeView().evaluate((el) => ((el as HTMLElement & { __mark?: number }).__mark = 42))
    await app.openFile('Welcome.md', { newTab: true })
    await expect(app.activeView().locator('.cm-content')).toBeVisible()
    await page.locator('.tab', { hasText: 'Architecture' }).click()
    await expect.poll(() => app.activeFile()).toBe('Architecture.canvas')
    expect(await app.activeView().evaluate((el) => (el as HTMLElement & { __mark?: number }).__mark)).toBe(42)
  })

  test('canvas undo history survives a tab switch', async ({ app, page }) => {
    await app.openFile('Architecture.canvas')
    const view = app.activeView()
    const before = (app.readJson<{ nodes: unknown[] }>('Architecture.canvas')).nodes.length
    // create a card by double-clicking empty space far from content
    const box = (await view.locator('.canvas-world').locator('..').boundingBox())!
    await page.mouse.dblclick(box.x + 30, box.y + box.height - 30)
    await page.keyboard.press('Escape')
    await app.expectFile('Architecture.canvas', (c) => JSON.parse(c).nodes.length === before + 1)
    await app.openFile('Welcome.md', { newTab: true })
    await page.locator('.tab', { hasText: 'Architecture' }).click()
    await expect.poll(() => app.activeFile()).toBe('Architecture.canvas')
    await app.activeView().locator('.canvas-world').locator('..').click({ position: { x: 10, y: 10 } })
    await page.keyboard.press('Control+Z')
    await app.expectFile('Architecture.canvas', (c) => JSON.parse(c).nodes.length === before)
  })
})
