// Bottom panel helpers: terminal tabs (xterm.js), the Output tab and panel chrome.
import { expect, type Locator, type Page } from '@playwright/test'
import type { App } from './app'

const WIN = process.platform === 'win32'

/** Shell commands for the platform's default shell (PowerShell on Windows, $SHELL elsewhere). */
export const sh = {
  /** prints `prefix + suffix` without that text appearing literally in the typed command */
  echoJoined: (a: string, b: string): string => (WIN ? `echo ('${a}' + '${b}')` : `echo ${a}''${b}`),
  /** prints "cwd=<name of the current folder>" */
  printCwdName: (): string => (WIN ? "echo ('cwd=' + (Split-Path -Leaf (Get-Location)))" : 'echo "cwd=$(basename "$PWD")"'),
  exit: 'exit'
}

export class BottomPanel {
  constructor(readonly app: App) {}

  get page(): Page {
    return this.app.page
  }

  panel(): Locator {
    return this.page.locator('.bottom-panel')
  }
  tabs(): Locator {
    return this.page.locator('.bottom-tab')
  }
  tabTitles(): Locator {
    return this.page.locator('.bottom-tab .bottom-tab-title')
  }
  activeTab(): Locator {
    return this.page.locator('.bottom-tab.is-active')
  }
  tab(title: string | RegExp): Locator {
    return this.tabs().filter({ has: this.page.locator('.bottom-tab-title', { hasText: title }) })
  }
  /** the visible pane (terminal or output) */
  activePane(): Locator {
    return this.page.locator('.bottom-panel-pane[style*="flex"]')
  }
  action(title: string): Locator {
    return this.page.locator(`.bottom-panel-actions button[title^="${title}"]`)
  }
  newTerminalButton(): Locator {
    return this.page.locator('.bottom-new button[title^="New terminal"]').first()
  }
  outputRuns(): Locator {
    return this.page.locator('.output-view .output-run')
  }

  // ---------------------------------------------------------------- terminal

  terminalHost(): Locator {
    return this.activePane().locator('.terminal-host')
  }
  rows(): Locator {
    return this.activePane().locator('.xterm-rows')
  }
  /** visible terminal text (rows joined, no separators) */
  async text(): Promise<string> {
    return ((await this.rows().textContent()) ?? '').replace(/ /g, ' ')
  }
  async expectText(re: RegExp, timeout = 30_000): Promise<void> {
    await expect.poll(() => this.text(), { message: `terminal text matching ${re}`, timeout }).toMatch(re)
  }
  /** wait until the shell printed something (its prompt) */
  async waitForShell(): Promise<void> {
    await expect(this.rows()).toBeVisible()
    await this.expectText(/\S/)
  }
  /** focus the active terminal and run a command line */
  async run(cmd: string): Promise<void> {
    await this.terminalHost().click()
    await expect(this.activePane().locator('.xterm-helper-textarea')).toBeFocused()
    await this.page.keyboard.type(cmd, { delay: 15 })
    await this.page.keyboard.press('Enter')
  }
  /** open a terminal with Ctrl+` (or a new one) and wait for the prompt */
  async openWithHotkey(): Promise<void> {
    await this.page.keyboard.press('Control+`')
    await expect(this.panel()).toBeVisible()
    await this.waitForShell()
  }
}
