// Settings modal page object + access to the persisted `.cs2d3k/app.json`.
import { expect, type Locator, type Page } from '@playwright/test'
import type { App } from './app'

export class SettingsModal {
  readonly page: Page
  constructor(readonly app: App) {
    this.page = app.page
  }

  modal(): Locator {
    return this.page.locator('.settings-modal')
  }
  navItem(label: string): Locator {
    return this.modal().locator('.settings-nav-item', { hasText: new RegExp(`^${label}$`) })
  }
  content(): Locator {
    return this.modal().locator('.settings-content-inner')
  }
  search(): Locator {
    return this.modal().locator('.settings-search input')
  }
  /** a setting row by its exact name */
  item(name: string | RegExp): Locator {
    return this.content().locator('.setting-item', {
      has: this.page.locator('.setting-item-name', { hasText: typeof name === 'string' ? new RegExp(`^\\s*${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`) : name })
    })
  }
  toggle(name: string): Locator {
    return this.item(name).locator('.toggle')
  }

  async open(tab?: string): Promise<void> {
    if (!(await this.modal().isVisible())) await this.page.keyboard.press('Control+,')
    await expect(this.modal()).toBeVisible()
    if (tab) await this.go(tab)
  }
  async go(tab: string): Promise<void> {
    await this.navItem(tab).click()
    await expect(this.navItem(tab)).toHaveClass(/is-active/)
  }
  async close(): Promise<void> {
    await this.modal().locator('.settings-close').click()
    await expect(this.modal()).toHaveCount(0)
  }

  /** `.cs2d3k/app.json` on disk (or {} if not written yet) */
  appJson(): Record<string, unknown> {
    try {
      return this.app.readJson('.cs2d3k/app.json')
    } catch {
      return {}
    }
  }
  /** poll until `.cs2d3k/app.json` has `key` = `value` */
  async expectSaved(key: string, value: unknown): Promise<void> {
    await expect.poll(() => this.appJson()[key], { message: `app.json ${key}` }).toEqual(value)
  }
}
