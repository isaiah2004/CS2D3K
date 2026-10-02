// Bottom panel: terminals (xterm + pty), tab management, cwd from the explorer, panel sizing, Output tab.
import { test, expect } from './fixtures'
import { BottomPanel, sh } from './helpers/terminal'
import { MarkdownEditor } from './helpers/editor'
import { CodeEditor } from './helpers/code'

test.use({
  vault: {
    source: 'empty',
    files: {
      'Note.md': '# Note\n\n```js\nconsole.log("from block")\n```\n',
      'proj/sub/tool.js': "console.log('from file')\n"
    }
  }
})

test.describe('terminal @basic', () => {
  test('Ctrl+` opens a terminal that runs commands', async ({ app, page }) => {
    const bp = new BottomPanel(app)
    await expect(bp.panel()).toHaveCount(0)
    await bp.openWithHotkey()
    await expect(bp.tabTitles()).toHaveText(['Terminal 1'])
    await expect(bp.activePane().locator('.xterm-helper-textarea')).toBeFocused()
    await bp.run(sh.echoJoined('mark', 'er42'))
    await bp.expectText(/marker42/)

    // the status bar toggle shows the panel state
    await expect(page.locator('.status-bar .status-bar-item[title^="Toggle terminal panel"]')).toHaveClass(/is-active/)
  })

  test('the terminal survives hiding the panel', async ({ app, page }) => {
    const bp = new BottomPanel(app)
    await bp.openWithHotkey()
    await bp.run(sh.echoJoined('first', 'run'))
    await bp.expectText(/firstrun/)

    await page.keyboard.press('Control+`')
    await expect(bp.panel()).toBeHidden()
    await page.locator('.status-bar .status-bar-item[title^="Toggle terminal panel"]').click()
    await expect(bp.panel()).toBeVisible()
    await expect(bp.tabTitles()).toHaveText(['Terminal 1'])
    await bp.expectText(/firstrun/)
    await bp.run(sh.echoJoined('second', 'run'))
    await bp.expectText(/firstrun[\s\S]*secondrun/)

    // the hide button too
    await bp.action('Hide panel').click()
    await expect(bp.panel()).toBeHidden()
    await page.keyboard.press('Control+`')
    await bp.expectText(/secondrun/)
  })

  test('several terminals: new, switch, rename, clear, kill', async ({ app, page }) => {
    const bp = new BottomPanel(app)
    await bp.openWithHotkey()
    await bp.run(sh.echoJoined('in', 'one'))
    await bp.expectText(/inone/)

    await bp.newTerminalButton().click()
    await expect(bp.tabTitles()).toHaveText(['Terminal 1', 'Terminal 2'])
    await expect(bp.activeTab()).toContainText('Terminal 2')
    await bp.waitForShell()
    expect(await bp.text()).not.toMatch(/inone/)
    await bp.run(sh.echoJoined('in', 'two'))
    await bp.expectText(/intwo/)

    await bp.tab('Terminal 1').click()
    await bp.expectText(/inone/)
    expect(await bp.text()).not.toMatch(/intwo/)

    // rename (double click)
    await bp.tab('Terminal 1').dblclick()
    const input = page.locator('.modal input.input')
    await expect(input).toHaveValue('Terminal 1')
    await input.fill('Build')
    await input.press('Enter')
    await expect(bp.tabTitles()).toHaveText(['Build', 'Terminal 2'])

    // clear
    await bp.action('Clear terminal').click()
    await expect.poll(() => bp.text()).not.toMatch(/inone/)

    // rename + kill from the tab context menu
    await app.contextMenu(bp.tab('Terminal 2'), 'Rename…')
    await page.locator('.modal input.input').fill('Server')
    await page.locator('.modal input.input').press('Enter')
    await expect(bp.tabTitles()).toHaveText(['Build', 'Server'])
    await app.contextMenu(bp.tab('Server'), 'Kill terminal')
    await expect(bp.tabTitles()).toHaveText(['Build'])
    await bp.tab('Build').locator('button[title="Kill terminal"]').click()
    await expect(bp.tabs()).toHaveCount(0)
    await expect(bp.panel()).toHaveCount(0)
  })

  test('exiting the shell closes the tab on the next key press', async ({ app, page }) => {
    const bp = new BottomPanel(app)
    await bp.openWithHotkey()
    await bp.run(sh.exit)
    await bp.expectText(/\[Process exited with code 0\] — press any key to close/)
    await expect(bp.tabs()).toHaveCount(1)
    await page.keyboard.press('a')
    await expect(bp.tabs()).toHaveCount(0)
  })

  test('"Open terminal here" starts in that folder', async ({ app }) => {
    const bp = new BottomPanel(app)
    await app.treeItem('proj').click()
    await app.contextMenu(app.treeItem('proj/sub'), 'Open terminal here')
    await expect(bp.panel()).toBeVisible()
    await bp.waitForShell()
    await bp.run(sh.printCwdName())
    await bp.expectText(/cwd=sub/)

    // a file's entry opens its folder; a plain new terminal starts in the vault root
    await app.treeItem('proj/sub').click()
    await app.contextMenu(app.treeItem('proj/sub/tool.js'), 'Open terminal here')
    await expect(bp.tabs()).toHaveCount(2)
    await bp.waitForShell()
    await bp.run(sh.printCwdName())
    await bp.expectText(/cwd=sub/)
    await bp.newTerminalButton().click()
    await expect(bp.tabs()).toHaveCount(3)
    await bp.waitForShell()
    await bp.run(sh.printCwdName())
    await bp.expectText(/cwd=vault/)
  })

  test('the panel resizes and maximizes, and the terminal refits', async ({ app, page }) => {
    const bp = new BottomPanel(app)
    await bp.openWithHotkey()
    const height = async (): Promise<number> => (await bp.panel().boundingBox())!.height
    const rowCount = (): Promise<number> => bp.rows().locator(':scope > div').count()
    const h0 = await height()
    const r0 = await rowCount()

    const handle = page.locator('.bottom-panel-resize')
    const box = (await handle.boundingBox())!
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.mouse.down()
    await page.mouse.move(box.x + box.width / 2, box.y - 120, { steps: 6 })
    await page.mouse.up()
    await expect.poll(height).toBeGreaterThan(h0 + 100)
    await expect.poll(rowCount).toBeGreaterThan(r0)
    const h1 = await height()

    await bp.action('Maximize panel').click()
    await expect.poll(height).toBeGreaterThan(900 * 0.6)
    await expect(bp.action('Restore panel size')).toBeVisible()
    await bp.action('Restore panel size').click()
    await expect.poll(height).toBe(h1)
    await expect(bp.action('Maximize panel')).toBeVisible()
  })
})

test.describe('output tab @basic', () => {
  test('collects code block and file runs', async ({ app, page }) => {
    const bp = new BottomPanel(app)
    const ed = new MarkdownEditor(app)
    await ed.open('Note.md')
    await ed.root().locator('.cm-code-run').click()
    await expect(ed.root().locator('.cm-code-output-status')).toHaveText(/^Exited with code 0/, { timeout: 15_000 })

    const code = new CodeEditor(app)
    await app.treeItem('proj').click()
    await app.treeItem('proj/sub').click()
    await code.open('proj/sub/tool.js')
    await code.headerButton('Run file').click()
    await expect(bp.activeTab()).toContainText('Output')
    await expect(bp.outputRuns()).toHaveCount(2)
    await expect(bp.outputRuns().nth(0).locator('.output-run-title')).toHaveText('js (Note.md)')
    await expect(bp.outputRuns().nth(0).locator('.output-run-body')).toContainText('from block')
    await expect(bp.outputRuns().nth(1)).toHaveClass(/is-ok/, { timeout: 15_000 })
    await expect(bp.outputRuns().nth(1).locator('.output-run-title')).toHaveText('tool.js')
    await expect(bp.outputRuns().nth(1).locator('.output-run-body')).toHaveText('from file\n')

    await bp.action('Clear output').click()
    await expect(bp.outputRuns()).toHaveCount(0)
    await expect(page.locator('.output-view .output-empty')).toBeVisible()
  })
})
