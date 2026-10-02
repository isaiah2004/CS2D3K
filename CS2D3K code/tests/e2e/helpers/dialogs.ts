// Modal dialogs (prompt / confirm), context menus and notices.
import { expect, type Locator, type Page } from '@playwright/test'

export class Dialogs {
  constructor(readonly page: Page) {}

  /** the prompt / confirm modal with the given title */
  modal(title?: string | RegExp): Locator {
    const m = this.page.locator('.modal-backdrop .modal:not(.prompt):not(.settings-modal)')
    return title ? m.filter({ has: this.page.locator('.modal-title', { hasText: title }) }) : m
  }

  async prompt(title: string | RegExp, value: string | null): Promise<void> {
    const m = this.modal(title)
    await expect(m).toBeVisible()
    if (value === null) {
      await m.locator('.btn', { hasText: 'Cancel' }).click()
    } else {
      await m.locator('input.input').fill(value)
      await m.locator('.modal-buttons .btn.mod-cta').click()
    }
  }

  async confirm(title: string | RegExp, ok: boolean): Promise<void> {
    const m = this.modal(title)
    await expect(m).toBeVisible()
    await m.locator(ok ? '.modal-buttons .btn:last-child' : '.modal-buttons .btn', ok ? {} : { hasText: 'Cancel' }).click()
    await expect(m).toHaveCount(0)
  }

  menu(): Locator {
    return this.page.locator('.menu').first()
  }

  menuItem(label: string | RegExp): Locator {
    return this.page.locator('.menu .menu-item', { has: this.page.locator('.menu-label', { hasText: label }) }).first()
  }

  /** right-click `target` and pick a menu item by its label */
  async contextMenu(target: Locator, label: string | RegExp): Promise<void> {
    await target.click({ button: 'right' })
    await this.menuItem(label).click()
    await expect(this.page.locator('.menu')).toHaveCount(0)
  }

  notice(text: string | RegExp): Locator {
    return this.page.locator('.notices .notice', { hasText: text })
  }
}
