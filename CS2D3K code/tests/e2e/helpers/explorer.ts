// File explorer page object (left sidebar "Files" pane).
import { expect, type Locator, type Page } from '@playwright/test'
import type { App } from './app'
import { Dialogs } from './dialogs'

export class Explorer {
  readonly page: Page
  readonly dialogs: Dialogs

  constructor(readonly app: App) {
    this.page = app.page
    this.dialogs = new Dialogs(app.page)
  }

  /** the Files pane (header + body) */
  header(): Locator {
    return this.page.locator('.pane-header', { has: this.page.locator('button[title="New folder"]') })
  }
  button(title: string | RegExp): Locator {
    return this.header().getByTitle(title)
  }
  item(path: string): Locator {
    return this.app.treeItem(path)
  }
  name(path: string): Locator {
    return this.item(path).locator('.item-name')
  }
  renameInput(): Locator {
    return this.page.locator('input.rename-input')
  }

  /** visible tree paths, top to bottom */
  async visiblePaths(): Promise<string[]> {
    return this.page.locator('.tree-item[data-path]').evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.path!))
  }

  async isExpanded(path: string): Promise<boolean> {
    await this.item(path).waitFor()
    return (await this.item(path).locator('.chevron.collapsed').count()) === 0
  }
  async expand(path: string): Promise<void> {
    if (!(await this.isExpanded(path))) await this.item(path).click()
    await expect(this.item(path).locator('.chevron')).not.toHaveClass(/collapsed/)
  }
  async collapse(path: string): Promise<void> {
    if (await this.isExpanded(path)) await this.item(path).click()
    await expect(this.item(path).locator('.chevron')).toHaveClass(/collapsed/)
  }
  /** expand every parent folder of `path` so it is visible */
  async reveal(path: string): Promise<void> {
    const parts = path.split('/')
    for (let i = 1; i < parts.length; i++) await this.expand(parts.slice(0, i).join('/'))
    await expect(this.item(path)).toBeVisible()
  }

  async contextMenu(path: string, label: string | RegExp): Promise<void> {
    await this.reveal(path)
    await this.dialogs.contextMenu(this.item(path), label)
  }

  /** start inline rename from the context menu, type the new name and commit with Enter */
  async renameInline(path: string, newName: string): Promise<void> {
    await this.contextMenu(path, /^Rename\.\.\.$/)
    await expect(this.renameInput()).toBeFocused()
    await this.renameInput().fill(newName)
    await this.renameInput().press('Enter')
    await expect(this.renameInput()).toHaveCount(0)
  }

  /** delete via the context menu, answering the confirm dialog */
  async delete(path: string, confirm = true): Promise<void> {
    await this.contextMenu(path, /^Delete$/)
    await this.dialogs.confirm(/Delete (file|folder)/, confirm)
  }

  /** HTML5 drag of a tree item onto another tree item (or the pane background when `to` is null) */
  async drag(from: string, to: string | null): Promise<void> {
    const target = to === null ? this.rootDropZone() : this.item(to)
    await this.item(from).dragTo(target, to === null ? { targetPosition: await this.emptySpot() } : undefined)
  }

  /** the scrollable files pane body (drop target for "move to vault root") */
  rootDropZone(): Locator {
    return this.page.locator('.sidebar-pane .pane-body[tabindex="0"]')
  }
  private async emptySpot(): Promise<{ x: number; y: number }> {
    const box = (await this.rootDropZone().boundingBox())!
    return { x: box.width / 2, y: box.height - 10 }
  }

  async sortBy(label: string | RegExp): Promise<void> {
    await this.button('Change sort order').click()
    await this.dialogs.menuItem(label).click()
  }
}
