import { test, expect } from './fixtures'

test.describe('smoke @basic', () => {
  test('app boots into the vault and opens a note', async ({ app, page }) => {
    await expect(page.locator('.titlebar-title')).toHaveText(/CS2D3K/)
    await expect(app.treeItem('Welcome.md')).toBeVisible()
    await app.openFile('Welcome.md')
    await expect(app.activeView().locator('.cm-content')).toContainText('Welcome to CS2D3K')
  })

  test.describe('empty vault', () => {
    test.use({ vault: { source: 'empty' } })
    test('starts without errors and shows the empty tab', async ({ app, page }) => {
      await expect(page.locator('.empty-view')).toBeVisible()
      expect(await app.layout()).toHaveLength(1)
    })
  })
})
