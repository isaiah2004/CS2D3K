// Code view helpers (Monaco editor, header actions, status bar items, settings).
import { expect, type Locator, type Page } from '@playwright/test'
import type { App } from './app'

export class CodeEditor {
  constructor(readonly app: App) {}

  get page(): Page {
    return this.app.page
  }

  root(): Locator {
    return this.app.activeView().locator('.code-view')
  }
  monaco(): Locator {
    return this.root().locator('.monaco-editor').first()
  }
  viewLines(): Locator {
    return this.root().locator('.view-lines')
  }
  /** header action button of the focused leaf by (prefix of) its title */
  headerButton(title: string): Locator {
    return this.page.locator(`.leaf.is-focused .view-header-actions button[title^="${title}"]`)
  }
  dirtyDot(): Locator {
    return this.page.locator('.leaf.is-focused .view-header-actions .code-dirty-dot')
  }
  statusItems(): Locator {
    return this.page.locator('#status-bar-view-items .status-bar-item')
  }
  /** "Ln x, Col y" status item */
  position(): Locator {
    return this.statusItems().filter({ hasText: /^Ln \d+, Col \d+/ })
  }
  message(): Locator {
    return this.root().locator('.code-view-message')
  }

  async open(path: string, opts: { newTab?: boolean } = {}): Promise<void> {
    await this.app.openFile(path, opts)
    await this.waitReady()
  }

  async waitReady(): Promise<void> {
    await expect(this.root().locator('.code-view-editor')).toHaveCSS('visibility', 'visible', { timeout: 30_000 })
    await expect(this.viewLines()).toBeVisible()
    await expect(this.position()).toBeVisible()
  }

  /** visible text of the editor (rendered lines only) */
  async text(): Promise<string> {
    return ((await this.viewLines().textContent()) ?? '').replace(/ /g, ' ')
  }
  async expectText(re: RegExp | string, not = false): Promise<void> {
    const check = (t: string): boolean => (typeof re === 'string' ? t.includes(re) : re.test(t))
    await expect.poll(async () => check(await this.text()), { message: `editor text ${not ? 'not ' : ''}matching ${re}` }).toBe(!not)
  }

  /** focus the editor and put the cursor at the end of the document */
  async focusEnd(): Promise<void> {
    await this.viewLines().click()
    await this.page.keyboard.press('Control+End')
  }

  async type(text: string): Promise<void> {
    await this.page.keyboard.type(text, { delay: 10 })
  }
}

/** open Settings (ribbon button, or Ctrl+,) on a tab (by its nav label) and return the modal */
export async function openSettingsTab(page: Page, label: string, opts: { hotkey?: boolean } = {}): Promise<Locator> {
  if (opts.hotkey) await page.keyboard.press('Control+,')
  else await page.locator('.ribbon button[aria-label="Settings"]').click()
  const modal = page.locator('.settings-modal')
  await expect(modal).toBeVisible()
  await modal.locator('.settings-nav-item').getByText(label, { exact: true }).click()
  return modal
}

export async function closeSettings(page: Page): Promise<void> {
  await page.keyboard.press('Escape')
  await expect(page.locator('.settings-modal')).toHaveCount(0)
}
