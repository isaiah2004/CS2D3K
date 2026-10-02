// Sidebars (left/right), pane groups, pane icons and the ribbon.
import { expect, type Locator, type Page } from '@playwright/test'
import type { App } from './app'

export type SideName = 'left' | 'right'

export class Sidebars {
  readonly page: Page
  constructor(readonly app: App) {
    this.page = app.page
  }

  sidebar(side: SideName): Locator {
    return this.page.locator(`.sidebar.${side}`)
  }
  groups(side: SideName): Locator {
    return this.sidebar(side).locator('.sidebar-group')
  }
  /** pane icon button (title = pane title, e.g. "Files", "Backlinks") */
  icon(title: string, side?: SideName): Locator {
    return (side ? this.sidebar(side) : this.page.locator('.sidebar')).locator(`.sidebar-tab[aria-label="${title}"]`)
  }
  ribbon(title: string): Locator {
    return this.page.locator(`.ribbon button[title="${title}"]`)
  }
  resizeHandle(side: SideName): Locator {
    return this.sidebar(side).locator(':scope > .resize-handle')
  }

  async isOpen(side: SideName): Promise<boolean> {
    return !(await this.sidebar(side).evaluate((el) => el.classList.contains('collapsed')))
  }
  async expectOpen(side: SideName, open: boolean): Promise<void> {
    if (open) await expect(this.sidebar(side)).not.toHaveClass(/collapsed/)
    else await expect(this.sidebar(side)).toHaveClass(/collapsed/)
  }
  async width(side: SideName): Promise<number> {
    return (await this.sidebar(side).boundingBox())!.width
  }
  /** pane titles per group of a side, e.g. [['Files','Search','Bookmarks']] */
  async layout(side: SideName): Promise<string[][]> {
    return this.groups(side).evaluateAll((gs) => gs.map((g) => [...g.querySelectorAll('.sidebar-tab')].map((b) => b.getAttribute('aria-label') ?? '')))
  }
  async activePane(side: SideName, group = 0): Promise<string | null> {
    return this.groups(side).nth(group).locator('.sidebar-tab.is-active').getAttribute('aria-label')
  }

  /** mouse-drag a resize handle by dx/dy pixels */
  async dragBy(handle: Locator, dx: number, dy: number): Promise<void> {
    const box = (await handle.boundingBox())!
    const x = box.x + box.width / 2
    const y = box.y + box.height / 2
    await this.page.mouse.move(x, y)
    await this.page.mouse.down()
    await this.page.mouse.move(x + dx / 2, y + dy / 2, { steps: 4 })
    await this.page.mouse.move(x + dx, y + dy, { steps: 4 })
    await this.page.mouse.up()
  }
}
