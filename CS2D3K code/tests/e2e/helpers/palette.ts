// Command palette (Ctrl+P) and quick switcher (Ctrl+O) page object.
import { expect, type Locator, type Page } from '@playwright/test'

export class Palette {
  constructor(readonly page: Page) {}

  modal(): Locator {
    return this.page.locator('.modal.prompt')
  }
  input(): Locator {
    return this.page.locator('.prompt-input')
  }
  items(): Locator {
    return this.page.locator('.prompt-results .suggestion-item')
  }
  selected(): Locator {
    return this.page.locator('.prompt-results .suggestion-item.is-selected')
  }
  /** visible suggestion texts (main line only) */
  async texts(): Promise<string[]> {
    return this.page.locator('.prompt-results .suggestion-item .suggestion-main').allInnerTexts()
  }

  async openCommands(): Promise<void> {
    await this.page.keyboard.press('Control+P')
    await expect(this.input()).toBeFocused()
    await expect(this.input()).toHaveAttribute('placeholder', /command/i)
  }
  async openSwitcher(): Promise<void> {
    await this.page.keyboard.press('Control+O')
    await expect(this.input()).toBeFocused()
    await expect(this.input()).toHaveAttribute('placeholder', /note/i)
  }
  async type(q: string): Promise<void> {
    await this.input().fill(q)
  }
  async close(): Promise<void> {
    await this.page.keyboard.press('Escape')
    await expect(this.modal()).toHaveCount(0)
  }
}
