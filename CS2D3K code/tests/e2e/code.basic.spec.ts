// Code view (Monaco): languages, saving (auto / manual), external changes, cursor status, navigation,
// running files, view toggles and settings, formatting, theming, large/binary guards and renames.
import { spawnSync } from 'child_process'
import { test, expect } from './fixtures'
import { CodeEditor, openSettingsTab, closeSettings } from './helpers/code'
import { expectFileText } from './helpers/editor'

const PYTHON = process.platform === 'win32' ? 'python' : 'python3'
const hasPython = spawnSync(PYTHON, ['--version'], { windowsHide: true }).status === 0

const APP_TS = `import { helper } from './helper'

export interface Item {
  id: number
  name: string
}

export function find(items: Item[], id: number): Item | undefined {
  return items.find((i) => i.id === id)
}

export const uniqueMarker = 'needle-in-code'
`

const FILES: Record<string, string> = {
  'src/app.ts': APP_TS,
  'src/tool.py': 'def greet(name):\n    return f"hi {name}"\n\n\nif __name__ == "__main__":\n    print(greet("py file"))\n',
  'src/run.js': "console.log('run file ok', 6 * 7)\n",
  'src/fail.js': "console.log('partial')\nconsole.error('file failed')\nprocess.exit(2)\n",
  'data.json': '{"a":1,"b":[1,2],"c":{"d":"e"}}\n',
  'long.txt': Array.from({ length: 80 }, (_, i) => `word${i}`).join(' ') + '\nsecond line\n',
  'blob.dat': 'abc\u0000def\u0000',
  'Note.md': '# Note\n'
}

test.use({ vault: { source: 'empty', files: FILES } })

test.describe('code editor basics @basic', () => {
  test('opens .ts / .py / .json with the language in the status bar', async ({ app }) => {
    const code = new CodeEditor(app)
    await code.open('src/app.ts')
    await code.expectText('export interface Item')
    await expect(code.statusItems()).toContainText(['Ln 1, Col 1', 'Spaces: 2', 'UTF-8', 'LF', 'TypeScript'])
    // syntax highlighting is active (keywords get their own token class)
    await expect(code.viewLines().locator('span[class*="mtk"]').filter({ hasText: /^export$/ }).first()).toBeVisible()

    await code.open('src/tool.py')
    await expect(code.statusItems().last()).toHaveText('Python')
    await expect(code.statusItems()).toContainText(['Spaces: 4'])
    await code.open('data.json')
    await expect(code.statusItems().last()).toHaveText('JSON')

    // markdown notes don't show code status items
    await app.openFile('Note.md')
    await expect(code.position()).toHaveCount(0)
  })

  test('typing autosaves', async ({ app }) => {
    const code = new CodeEditor(app)
    await code.open('src/app.ts')
    await code.focusEnd()
    await code.type('// added by the test')
    await expectFileText(app, 'src/app.ts', APP_TS + '// added by the test')
    await expect(code.dirtyDot()).toHaveCount(0)
  })

  test('TypeScript IntelliSense suggests members', async ({ app, page }) => {
    const code = new CodeEditor(app)
    await code.open('src/app.ts')
    await code.focusEnd()
    await code.type('const first = find([], 1)?.')
    const suggest = code.root().locator('.suggest-widget.visible').or(page.locator('.suggest-widget.visible'))
    await expect(suggest.locator('.monaco-list-row', { hasText: /^name/ }).first()).toBeVisible({ timeout: 30_000 })
    await expect(suggest.locator('.monaco-list-row', { hasText: /^id/ }).first()).toBeVisible()
    await page.keyboard.press('Escape')
    await code.type('name')
    await expectFileText(app, 'src/app.ts', APP_TS + 'const first = find([], 1)?.name')
  })

  test('autosave off: dirty marker and Ctrl+S', async ({ app, page }) => {
    const modal = await openSettingsTab(page, 'Code editor')
    await modal.locator('button.toggle[aria-label="Auto save"]').click()
    await expect(modal.locator('button.toggle[aria-label="Auto save"]')).toHaveAttribute('aria-checked', 'false')
    await closeSettings(page)

    const code = new CodeEditor(app)
    await code.open('src/app.ts')
    await code.focusEnd()
    await code.type('// unsaved')
    await expect(code.dirtyDot()).toBeVisible()
    // the autosave delay is 600 ms: nothing is written well past it
    for (let i = 0; i < 4; i++) {
      await page.waitForTimeout(300)
      expect(app.read('src/app.ts')).toBe(APP_TS)
    }
    await page.keyboard.press('Control+S')
    await expectFileText(app, 'src/app.ts', APP_TS + '// unsaved')
    await expect(code.dirtyDot()).toHaveCount(0)

    // the dirty dot saves when clicked
    await code.type(' again')
    await code.dirtyDot().click()
    await expectFileText(app, 'src/app.ts', APP_TS + '// unsaved again')
    await expect(code.dirtyDot()).toHaveCount(0)

    // turning autosave back on saves pending changes right away
    await code.focusEnd()
    await code.type('!')
    await expect(code.dirtyDot()).toBeVisible()
    await app.setSetting('codeAutoSave', true)
    await expectFileText(app, 'src/app.ts', APP_TS + '// unsaved again!')
  })

  test('external changes reload clean files and ask before discarding unsaved edits', async ({ app, page }) => {
    const code = new CodeEditor(app)
    await code.open('src/app.ts')
    app.writeExternal('src/app.ts', APP_TS + '// external one\n')
    await code.expectText('// external one')
    await expect(page.locator('.modal-title', { hasText: 'File changed on disk' })).toHaveCount(0)

    await app.setSetting('codeAutoSave', false)
    await code.focusEnd()
    await code.type('// mine')
    await expect(code.dirtyDot()).toBeVisible()

    // keep my edits
    app.writeExternal('src/app.ts', APP_TS + '// external two\n')
    const dialog = page.locator('.modal', { has: page.locator('.modal-title', { hasText: 'File changed on disk' }) })
    await expect(dialog).toBeVisible()
    await dialog.locator('button', { hasText: 'Cancel' }).click()
    await expect(dialog).toHaveCount(0)
    await code.expectText('// mine')
    await expect(code.dirtyDot()).toBeVisible()

    // reload discards them
    app.writeExternal('src/app.ts', APP_TS + '// external three\n')
    await expect(dialog).toBeVisible()
    await dialog.locator('button', { hasText: 'Reload' }).click()
    await code.expectText('// external three')
    await code.expectText('// mine', true)
    await expect(code.dirtyDot()).toHaveCount(0)
    expect(app.read('src/app.ts')).toBe(APP_TS + '// external three\n')
  })

  test('Ln/Col status follows the cursor and opens go to line', async ({ app, page }) => {
    const code = new CodeEditor(app)
    await code.open('src/app.ts')
    await code.viewLines().click()
    await page.keyboard.press('Control+Home')
    await expect(code.position()).toHaveText('Ln 1, Col 1')
    await page.keyboard.press('ArrowDown')
    await page.keyboard.press('ArrowDown')
    await page.keyboard.press('End')
    await expect(code.position()).toHaveText('Ln 3, Col 24')
    await page.keyboard.press('Shift+ArrowLeft')
    await page.keyboard.press('Shift+ArrowLeft')
    await page.keyboard.press('Shift+ArrowLeft')
    await expect(code.position()).toHaveText('Ln 3, Col 21 (3 selected)')

    await code.position().click()
    const quick = page.locator('.quick-input-widget')
    await expect(quick).toBeVisible()
    await page.keyboard.type('9')
    await page.keyboard.press('Enter')
    await expect(code.position()).toHaveText(/^Ln 9, Col \d+$/)
  })

  test('a search result opens the code file at the matching line', async ({ app, page }) => {
    const code = new CodeEditor(app)
    await page.keyboard.press('Control+Shift+F')
    const input = page.locator('input[placeholder="Search files..."]')
    await input.fill('needle-in-code')
    const toggle = page.locator('button[title^="Searching notes only"]')
    if (await toggle.count()) await toggle.click()
    await page.locator('.search-snippet').first().click()
    await expect.poll(() => app.activeFile()).toBe('src/app.ts')
    await code.waitReady()
    await expect(code.position()).toHaveText(/^Ln 12, Col \d+/)
    // the match is selected: typing replaces it
    await page.keyboard.type('found')
    await expectFileText(app, 'src/app.ts', APP_TS.replace('needle-in-code', 'found'))
  })

  test('run file shows the output in the Output tab', async ({ app, page }) => {
    const code = new CodeEditor(app)
    await code.open('src/run.js')
    await code.headerButton('Run file').click()
    const active = page.locator('.bottom-tab.is-active .bottom-tab-title')
    await expect(active).toHaveText('Output')
    const run = page.locator('.output-run').last()
    await expect(run).toHaveClass(/is-ok/, { timeout: 15_000 })
    await expect(run.locator('.output-run-title')).toHaveText('run.js')
    await expect(run.locator('.output-run-body')).toHaveText('run file ok 42\n')
    await expect(run.locator('.output-run-meta')).toContainText('exit 0')

    await code.open('src/fail.js')
    await code.viewLines().click()
    await page.keyboard.press('F5')
    const failed = page.locator('.output-run').last()
    await expect(failed).toHaveClass(/is-error/, { timeout: 15_000 })
    await expect(failed.locator('.output-run-title')).toHaveText('fail.js')
    await expect(failed.locator('.output-stderr')).toContainText('file failed')
    await expect(failed.locator('.output-run-meta')).toContainText('exit 2')
    await expect(page.locator('.output-run')).toHaveCount(2)
  })

  test('run a python file with Ctrl+Shift+Enter', async ({ app, page }) => {
    test.skip(!hasPython, `${PYTHON} is not installed`)
    const code = new CodeEditor(app)
    await code.open('src/tool.py')
    await code.viewLines().click()
    await page.keyboard.press('Control+Shift+Enter')
    const run = page.locator('.output-run').last()
    await expect(run).toHaveClass(/is-ok/, { timeout: 20_000 })
    await expect(run.locator('.output-run-body')).toHaveText('hi py file\n')
  })
})

test.describe('code editor view options @basic', () => {
  test('word wrap and minimap toggles per tab, defaults from settings', async ({ app, page }) => {
    const code = new CodeEditor(app)
    await code.open('long.txt')
    const wrap = code.headerButton('Toggle word wrap')
    const minimapBtn = code.headerButton('Toggle minimap')
    const minimap = code.root().locator('.minimap')
    const lineCount = (): Promise<number> => code.viewLines().locator('.view-line').count()

    await expect(wrap).not.toHaveClass(/is-active/)
    await expect(minimapBtn).toHaveClass(/is-active/)
    await expect(minimap).toBeVisible()
    await expect.poll(lineCount).toBe(3)

    await wrap.click()
    await expect(wrap).toHaveClass(/is-active/)
    await expect.poll(lineCount).toBeGreaterThan(3)
    await code.viewLines().click()
    await page.keyboard.press('Alt+Z')
    await expect(wrap).not.toHaveClass(/is-active/)
    await expect.poll(lineCount).toBe(3)

    await minimapBtn.click()
    await expect(minimapBtn).not.toHaveClass(/is-active/)
    await expect(minimap).toBeHidden()

    // settings: defaults for other tabs
    const modal = await openSettingsTab(page, 'Code editor', { hotkey: true })
    await modal.locator('button.toggle[aria-label="Word wrap"]').click()
    await modal.locator('button.toggle[aria-label="Line numbers"]').click()
    await closeSettings(page)
    await app.expectFile('.cs2d3k/app.json', (c) => JSON.parse(c).codeWordWrap === true && JSON.parse(c).codeLineNumbers === false)
    await code.open('src/app.ts', { newTab: true })
    await expect(code.headerButton('Toggle word wrap')).toHaveClass(/is-active/)
    await expect(code.root().locator('.minimap')).toBeVisible()
    await expect(code.root().locator('.line-numbers')).toHaveCount(0)

    // the first tab keeps its own choices (wrap off was chosen explicitly, minimap off)
    await page.locator('.leaf.is-focused .tab', { hasText: 'long.txt' }).click()
    await expect(code.headerButton('Toggle word wrap')).not.toHaveClass(/is-active/)
    await expect(code.root().locator('.minimap')).toBeHidden()
  })

  test('format document with Shift+Alt+F', async ({ app, page }) => {
    const code = new CodeEditor(app)
    await code.open('data.json')
    await code.viewLines().click()
    await page.keyboard.press('Shift+Alt+F')
    await expectFileText(app, 'data.json', /^\{\n(\s+)"a": 1,\n\1"b": \[\n\1\1 ?1,\n/, 15_000)
    await code.expectText('"c": {')

    // languages without a formatter say so
    await code.open('long.txt')
    await code.viewLines().click()
    await page.keyboard.press('Shift+Alt+F')
    await expect(page.locator('.notice', { hasText: 'No formatter available for plaintext' })).toBeVisible()
  })

  test('the editor theme follows the app theme', async ({ app }) => {
    const code = new CodeEditor(app)
    await code.open('src/app.ts')
    const colors = (): Promise<{ editor: string; app: string }> =>
      code.root().evaluate((root) => {
        const bg = root.querySelector('.monaco-editor-background')!
        const probe = document.createElement('div')
        probe.style.background = 'var(--background-primary)'
        document.body.appendChild(probe)
        const appBg = getComputedStyle(probe).backgroundColor
        probe.remove()
        return { editor: getComputedStyle(bg).backgroundColor, app: appBg }
      })
    const luminance = (rgb: string): number => {
      const [r, g, b] = rgb.match(/\d+/g)!.map(Number)
      return 0.2126 * r + 0.7152 * g + 0.0722 * b
    }
    await app.setTheme('dark')
    await expect.poll(async () => { const c = await colors(); return c.editor === c.app }).toBe(true)
    expect(luminance((await colors()).editor)).toBeLessThan(80)

    await app.setTheme('light')
    await expect.poll(async () => { const c = await colors(); return c.editor === c.app }).toBe(true)
    expect(luminance((await colors()).editor)).toBeGreaterThan(180)
  })

  test('binary files are not opened in the editor', async ({ app }) => {
    const code = new CodeEditor(app)
    await app.openFile('blob.dat')
    await expect(code.message().locator('.code-view-message-title')).toHaveText('Binary file')
    await expect(code.message()).toContainText('blob.dat appears to be a binary file')
    await expect(code.root().locator('.code-view-editor')).toHaveCSS('visibility', 'hidden')
    expect(app.read('blob.dat')).toBe('abc\u0000def\u0000')
  })

  test('renaming an open file keeps saving to the new path', async ({ app, page }) => {
    const code = new CodeEditor(app)
    await code.open('src/app.ts')
    await code.viewLines().click()
    await page.keyboard.press('F2')
    const input = page.locator('.modal input.input')
    await expect(input).toBeFocused()
    await input.fill('main.ts')
    await input.press('Enter')
    await expect.poll(() => app.activeFile()).toBe('src/main.ts')
    expect(app.exists('src/app.ts')).toBe(false)
    await expect(page.locator('.leaf.is-focused .tab.is-active .tab-title')).toHaveText('main.ts')

    await code.focusEnd()
    await code.type('// after rename')
    await expectFileText(app, 'src/main.ts', APP_TS + '// after rename')
    expect(app.exists('src/app.ts')).toBe(false)
    await expect(code.statusItems().last()).toHaveText('TypeScript')
  })
})

test.describe('code editor large files @basic', () => {
  const big = ('0123456789abcdef'.repeat(4) + '\n').repeat(85_000) // ~5.5 MB
  test.use({ vault: { source: 'empty', files: { 'big.log': big } } })

  test('files over 5 MB ask before opening', async ({ app }) => {
    const code = new CodeEditor(app)
    await app.openFile('big.log')
    await expect(code.message().locator('.code-view-message-title')).toHaveText('This file is too large to edit')
    await expect(code.message()).toContainText('big.log is 5.')
    await code.message().locator('button', { hasText: 'Open anyway' }).click()
    await code.waitReady()
    await code.expectText('0123456789abcdef')
    await expect(code.message()).toHaveCount(0)
  })
})
