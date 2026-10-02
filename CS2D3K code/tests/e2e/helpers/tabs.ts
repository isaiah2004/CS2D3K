// Tabs, splits and navigation page object (main workspace area).
import { expect, type Locator, type Page } from '@playwright/test'
import type { App } from './app'

export class Tabs {
  readonly page: Page
  constructor(readonly app: App) {
    this.page = app.page
  }

  leaves(): Locator {
    return this.page.locator('.app-main .leaf')
  }
  leaf(i: number): Locator {
    return this.leaves().nth(i)
  }
  focusedLeaf(): Locator {
    return this.page.locator('.app-main .leaf.is-focused')
  }
  /** tab with the given title, optionally inside leaf `i` */
  tab(title: string, leaf?: number): Locator {
    const scope = leaf === undefined ? this.page.locator('.app-main') : this.leaf(leaf)
    return scope.locator('.tab', { has: this.page.locator('.tab-title', { hasText: new RegExp(`^${escape(title)}$`) }) })
  }
  /** index of the focused leaf (left→right, top→bottom) */
  async focusedIndex(): Promise<number> {
    return this.leaves().evaluateAll((ls) => ls.findIndex((l) => l.classList.contains('is-focused')))
  }
  async expectFocused(i: number): Promise<void> {
    await expect.poll(() => this.focusedIndex()).toBe(i)
  }
  activeTab(leaf?: number): Locator {
    return (leaf === undefined ? this.focusedLeaf() : this.leaf(leaf)).locator('.tab.is-active')
  }

  /** tab titles per leaf (left→right, top→bottom) */
  async titles(): Promise<string[][]> {
    return this.leaves().evaluateAll((leaves) => leaves.map((l) => [...l.querySelectorAll('.tab .tab-title')].map((t) => t.textContent ?? '')))
  }
  async expectTitles(expected: string[][]): Promise<void> {
    await expect.poll(() => this.titles()).toEqual(expected)
  }

  async close(title: string): Promise<void> {
    const t = this.tab(title)
    await t.hover()
    await t.locator('.tab-close').click()
  }

  async menu(title: string, item: string | RegExp, leaf?: number): Promise<void> {
    await this.tab(title, leaf).click({ button: 'right' })
    await this.page.locator('.menu .menu-item', { has: this.page.locator('.menu-label', { hasText: item }) }).first().click()
  }

  /** the split direction of the root split ('row' = side by side, 'column' = stacked), or null for a single leaf */
  async rootSplit(): Promise<'row' | 'column' | null> {
    return this.page.evaluate(() => {
      const el = document.querySelector('.app-main > .ws-split')
      return el ? (el.classList.contains('row') ? 'row' : 'column') : null
    })
  }

  headerTitle(): Locator {
    return this.focusedLeaf().locator('.view-header .crumb-current')
  }
  backButton(): Locator {
    return this.focusedLeaf().locator('.view-header button[title="Navigate back"]')
  }
  forwardButton(): Locator {
    return this.focusedLeaf().locator('.view-header button[title="Navigate forward"]')
  }
}

function escape(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
