// Markdown note view helpers (CodeMirror 6 editor, live preview, reading view, inline title, status bar).
import { expect, type Locator, type Page } from '@playwright/test'
import type { App } from './app'

export type NoteMode = 'live' | 'source' | 'reading'

/** poll a vault file until it equals / matches `expected` (shows a diff on failure, unlike app.expectFile) */
export async function expectFileText(app: App, rel: string, expected: string | RegExp, timeout = 10_000): Promise<void> {
  const read = (): string | null => (app.exists(rel) ? app.read(rel).replace(/\r\n/g, '\n') : null)
  if (typeof expected === 'string') await expect.poll(read, { message: `content of ${rel}`, timeout }).toBe(expected)
  else await expect.poll(read, { message: `content of ${rel}`, timeout }).toMatch(expected)
}

export class MarkdownEditor {
  constructor(
    readonly app: App,
    /** scope (defaults to the focused leaf's visible view) */
    readonly scope?: Locator
  ) {}

  get page(): Page {
    return this.app.page
  }

  /** the `.markdown-view` root of the scoped / active tab */
  root(): Locator {
    return (this.scope ?? this.app.activeView()).locator('.markdown-view')
  }
  content(): Locator {
    return this.root().locator('.cm-content')
  }
  lines(): Locator {
    return this.root().locator('.cm-line')
  }
  line(text: string | RegExp): Locator {
    return this.lines().filter({ hasText: text }).first()
  }
  title(): Locator {
    return this.root().locator('.md-inline-title')
  }
  reading(): Locator {
    return this.root().locator('.md-reading .markdown-rendered')
  }
  /** header button toggling reading / editing */
  modeButton(): Locator {
    return this.page.locator('.leaf.is-focused .view-header-actions button[aria-label^="Switch to"]')
  }
  wordCount(): Locator {
    return this.page.locator('#status-bar-view-items .md-word-count')
  }

  /** open a note from the explorer and wait until the editor has loaded */
  async open(path: string, opts: { newTab?: boolean } = {}): Promise<void> {
    await this.app.openFile(path, opts)
    await this.waitLoaded()
  }

  async waitLoaded(): Promise<void> {
    await expect(this.root()).toBeVisible()
    await expect(this.root()).not.toHaveClass(/is-loading/)
  }

  async mode(): Promise<NoteMode> {
    const cls = (await this.root().getAttribute('class')) ?? ''
    return (/is-(live|source|reading)/.exec(cls)?.[1] ?? 'live') as NoteMode
  }
  async expectMode(mode: NoteMode): Promise<void> {
    await expect(this.root()).toHaveClass(new RegExp(`is-${mode}`))
  }

  /** focus the editor with the cursor at the end of the document */
  async focusEnd(): Promise<void> {
    await this.content().click()
    await this.page.keyboard.press('Control+End')
  }

  /** click at the end of the first line containing `text` */
  async clickLine(text: string | RegExp): Promise<void> {
    const line = this.line(text)
    const box = (await line.boundingBox())!
    await this.page.mouse.click(box.x + box.width - 2, box.y + box.height / 2)
  }

  /** type into the focused editor (small delay so autocompletion/IME-like handlers keep up) */
  async type(text: string): Promise<void> {
    await this.page.keyboard.type(text, { delay: 5 })
  }

  // ---------------------------------------------------------------- state without UI (CodeMirror view)

  /** full document text of the editor (the source, also while hidden in reading view) */
  doc(): Promise<string> {
    return this.root()
      .locator('.cm-content')
      .evaluate((el) => (el as HTMLElement & { cmTile?: { root?: { view?: { state: { doc: { toString(): string } } } } } }).cmTile!.root!.view!.state.doc.toString())
  }

  /** text of the line holding the main cursor */
  cursorLine(): Promise<string> {
    return this.root()
      .locator('.cm-content')
      .evaluate((el) => {
        type V = { state: { selection: { main: { head: number } }; doc: { lineAt(p: number): { text: string } } } }
        const v = (el as HTMLElement & { cmTile?: { root?: { view?: V } } }).cmTile!.root!.view!
        return v.state.doc.lineAt(v.state.selection.main.head).text
      })
  }

  /** place the cursor at the end of the first line containing `text` (setup helper) */
  setCursorAtLineEnd(text: string): Promise<void> {
    return this.root()
      .locator('.cm-content')
      .evaluate((el, t) => {
        type V = {
          state: { doc: { lines: number; line(n: number): { text: string; to: number } } }
          dispatch(tr: unknown): void
          focus(): void
        }
        const v = (el as HTMLElement & { cmTile?: { root?: { view?: V } } }).cmTile!.root!.view!
        for (let i = 1; i <= v.state.doc.lines; i++) {
          const l = v.state.doc.line(i)
          if (l.text.includes(t)) {
            v.dispatch({ selection: { anchor: l.to }, scrollIntoView: true })
            v.focus()
            return
          }
        }
        throw new Error(`no line containing ${t}`)
      }, text)
  }

  /** place the cursor right after the first occurrence of `text` in the document (setup helper) */
  setCursorAfter(text: string): Promise<void> {
    return this.root()
      .locator('.cm-content')
      .evaluate((el, t) => {
        type V = { state: { doc: { toString(): string } }; dispatch(tr: unknown): void; focus(): void }
        const v = (el as HTMLElement & { cmTile?: { root?: { view?: V } } }).cmTile!.root!.view!
        const at = v.state.doc.toString().indexOf(t)
        if (at < 0) throw new Error(`text not found: ${t}`)
        v.dispatch({ selection: { anchor: at + t.length }, scrollIntoView: true })
        v.focus()
      }, text)
  }

  async expectDoc(fn: (doc: string) => boolean, message?: string): Promise<void> {
    await expect.poll(async () => fn(await this.doc()), { message: message ?? 'editor document' }).toBe(true)
  }
}

/**
 * Drag a file from the explorer onto `target` (at `pos` relative to its box) with real DOM drag events: the
 * explorer's own dragstart fills the DataTransfer. (Playwright's mouse-driven HTML5 drag isn't delivered in Electron.)
 */
export async function dragFile(page: Page, source: Locator, target: Locator, pos: { x: number; y: number } | 'end' = 'end'): Promise<void> {
  const box = (await target.boundingBox())!
  const p = pos === 'end' ? { x: box.width - 2, y: box.height / 2 } : pos
  const at = { clientX: box.x + p.x, clientY: box.y + p.y }
  const dataTransfer = await page.evaluateHandle(() => new DataTransfer())
  await source.dispatchEvent('dragstart', { dataTransfer })
  await target.dispatchEvent('dragenter', { dataTransfer, ...at })
  await target.dispatchEvent('dragover', { dataTransfer, ...at })
  await target.dispatchEvent('drop', { dataTransfer, ...at })
  await source.dispatchEvent('dragend', { dataTransfer })
  await dataTransfer.dispose()
}

/**
 * Accept the selected autocompletion with Enter. CodeMirror ignores keyboard acceptance for 75 ms after the list
 * opens or updates (`interactionDelay`), so wait for the list to be stable a moment first.
 */
export async function acceptCompletion(page: Page): Promise<void> {
  await expect(page.locator('.cm-tooltip-autocomplete li[aria-selected]')).toBeVisible()
  await page.waitForTimeout(150)
  await page.keyboard.press('Enter')
  await expect(page.locator('.cm-tooltip-autocomplete')).toHaveCount(0)
}
