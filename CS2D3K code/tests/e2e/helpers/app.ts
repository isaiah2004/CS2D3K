// High-level helpers for e2e specs (cf. Logseq's e2e helper namespaces: block, page, graph, assert...).
// Feature-specific helpers live next to this file (editor.ts, canvas.ts, formmap.ts…) and take an App.
import { expect, type Locator, type Page } from '@playwright/test'
import { existsSync, readFileSync, writeFileSync, mkdirSync, rmSync } from 'fs'
import { dirname, join } from 'path'

export interface LayoutLeaf {
  leaf: string
  active: string | null
  tabs: { id: string; type: string; path?: string }[]
}

export class App {
  constructor(
    readonly page: Page,
    readonly vaultDir: string
  ) {}

  // ---------------------------------------------------------------- files on disk

  abs(rel: string): string {
    return join(this.vaultDir, rel)
  }
  exists(rel: string): boolean {
    return existsSync(this.abs(rel))
  }
  read(rel: string): string {
    return readFileSync(this.abs(rel), 'utf8')
  }
  readJson<T = Record<string, unknown>>(rel: string): T {
    return JSON.parse(this.read(rel)) as T
  }
  /** write a file from "outside" the app (exercises the file watcher) */
  writeExternal(rel: string, content: string): void {
    mkdirSync(dirname(this.abs(rel)), { recursive: true })
    writeFileSync(this.abs(rel), content)
  }
  removeExternal(rel: string): void {
    rmSync(this.abs(rel), { recursive: true, force: true })
  }
  /** poll until the file on disk satisfies `fn` (saves are debounced) */
  async expectFile(rel: string, fn: (content: string) => boolean | void, message?: string): Promise<void> {
    await expect
      .poll(() => {
        if (!this.exists(rel)) return false
        try {
          return fn(this.read(rel)) !== false
        } catch {
          return false
        }
      }, { message: message ?? `file ${rel}`, timeout: 10_000 })
      .toBe(true)
  }

  // ---------------------------------------------------------------- app state (window.__cs2d3k)

  layout(): Promise<LayoutLeaf[]> {
    return this.page.evaluate(() => window.__cs2d3k!.layout())
  }
  activeFile(): Promise<string | null> {
    return this.page.evaluate(() => window.__cs2d3k!.getActiveFile())
  }
  /** run a registered command by id (bypasses hotkeys) */
  command(id: string): Promise<boolean> {
    return this.page.evaluate((cid) => window.__cs2d3k!.executeCommand(cid), id)
  }
  /** read state from a store, e.g. app.state('settings', s => s.settings.baseTheme) */
  state<T>(store: string, pick: string): Promise<T> {
    return this.page.evaluate(
      ([s, p]) => {
        const st = window.__cs2d3k!.stores[s].getState()
        // eslint-disable-next-line no-new-func
        return new Function('s', `return (${p})(s)`)(st)
      },
      [store, pick] as const
    ) as Promise<T>
  }
  setSetting(key: string, value: unknown): Promise<void> {
    return this.page.evaluate(
      ([k, v]) => {
        const s = window.__cs2d3k!.stores.settings.getState() as { set(k: string, v: unknown): void }
        s.set(k, v)
      },
      [key, value] as const
    )
  }

  // ---------------------------------------------------------------- explorer

  treeItem(path: string): Locator {
    return this.page.locator(`.tree-item[data-path="${path}"]`)
  }
  /** expands parent folders and clicks the file in the explorer */
  async openFile(path: string, opts: { newTab?: boolean } = {}): Promise<void> {
    const parts = path.split('/')
    for (let i = 1; i < parts.length; i++) {
      const dir = parts.slice(0, i).join('/')
      const item = this.treeItem(dir)
      await item.waitFor()
      if ((await item.locator('.chevron.collapsed').count()) > 0) await item.click()
    }
    await this.treeItem(path).click({ modifiers: opts.newTab ? ['Control'] : [] })
    await expect.poll(() => this.activeFile()).toBe(path)
  }

  // ---------------------------------------------------------------- palette / switcher

  async runPaletteCommand(query: string): Promise<void> {
    await this.page.keyboard.press('Control+P')
    await this.page.locator('.prompt-input').fill(query)
    await this.page.locator('.suggestion-item').first().waitFor()
    await this.page.keyboard.press('Enter')
  }

  /** the visible view container of the active tab */
  activeView(): Locator {
    return this.page.locator('.leaf.is-focused .view:not(.hidden)')
  }

  async contextMenu(target: Locator, item: string | RegExp): Promise<void> {
    await target.click({ button: 'right' })
    await this.page.locator('.menu-item', { hasText: item }).first().click()
  }

  async setTheme(mode: 'dark' | 'light'): Promise<void> {
    await this.setSetting('baseTheme', mode)
    await expect(this.page.locator('body')).toHaveClass(new RegExp(`theme-${mode}`))
  }
}
