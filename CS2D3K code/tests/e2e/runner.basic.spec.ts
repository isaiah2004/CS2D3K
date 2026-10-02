// Running fenced code blocks from notes (live preview + reading view): streaming output, exit status,
// stop, errors, runner overrides, timeout, unknown languages and the run-block hotkey.
import { spawnSync } from 'child_process'
import { test, expect } from './fixtures'
import { MarkdownEditor } from './helpers/editor'
import { openSettingsTab } from './helpers/code'
import type { Locator, Page } from '@playwright/test'

const PYTHON = process.platform === 'win32' ? 'python' : 'python3'
const hasPython = spawnSync(PYTHON, ['--version'], { windowsHide: true }).status === 0

const fence = (lang: string, code: string): string => '```' + lang + '\n' + code + '\n```\n'

const FILES: Record<string, string> = {
  'Stream.md':
    '# Stream\n\n' +
    fence('js', "console.log('js first')\nsetTimeout(() => console.log('js second ' + 6 * 7), 1500)") +
    '\n' +
    fence('python', "import time\nprint('py first', flush=True)\ntime.sleep(1.5)\nprint('py second', 6 * 7)"),
  'Fail.md': '# Fail\n\n' + fence('js', "console.log('before')\nconsole.error('bad thing happened')\nprocess.exit(3)"),
  'Long.md': '# Long\n\n' + fence('js', "let i = 0\nsetInterval(() => console.log('tick ' + i++), 100)"),
  'Args.md': '# Args\n\n' + fence('js', "console.log('arg=' + process.argv[2])"),
  'Unknown.md': '# Unknown\n\n' + fence('haskell', 'main = print 1') + '\n' + fence('', 'no language'),
  'Sub/Cursor.md': '# Cursor\n\n' + fence('js', "import { basename } from 'node:path'\nconsole.log('cwd=' + basename(process.cwd()))") + '\nafter\n'
}

test.use({ vault: { source: 'empty', files: FILES } })

const status = (out: Locator): Locator => out.locator('.cm-code-output-status, .code-output-status')
const text = (out: Locator): Locator => out.locator('.code-output-text')

/** live preview: the n-th ▶ Run button and output widget */
function live(ed: MarkdownEditor, n = 0): { run: Locator; out: Locator } {
  return { run: ed.root().locator('.cm-code-run').nth(n), out: ed.root().locator('.cm-code-output').nth(n) }
}
/** reading view: the n-th runnable code block */
function reading(ed: MarkdownEditor, n = 0): { run: Locator; out: Locator } {
  const block = ed.reading().locator('.code-block').nth(n)
  return { run: block.locator('.code-block-run'), out: block.locator('.code-block-output') }
}

async function expectRedText(el: Locator): Promise<void> {
  const [color, red] = await el.evaluate((node) => {
    const probe = document.createElement('span')
    probe.style.color = 'var(--color-red)'
    document.body.appendChild(probe)
    const r = getComputedStyle(probe).color
    probe.remove()
    return [getComputedStyle(node).color, r]
  })
  expect(color).toBe(red)
}

const openRunnerSettings = (page: Page): Promise<Locator> => openSettingsTab(page, 'Code runner')

test.describe('code runner: live preview @basic', () => {
  test('▶ Run on a js block streams output and shows exit code and duration', async ({ app, page }) => {
    const ed = new MarkdownEditor(app)
    await ed.open('Stream.md')
    const { run, out } = live(ed, 0)
    await expect(run).toHaveText('▶ Run')
    await run.click()
    // the first line arrives while the program is still running
    await expect(text(out)).toHaveText('js first\n')
    await expect(status(out)).toHaveText('Running…')
    await expect(out.locator('.is-stop')).toBeVisible()
    await expect(text(out)).toHaveText('js first\njs second 42\n', { timeout: 15_000 })
    await expect(status(out)).toHaveText(/^Exited with code 0 · \d+ ms$/)
    await expect(status(out)).not.toHaveClass(/is-error/)
    await expect(out.locator('.is-stop')).toBeHidden()
    const ms = Number(/· (\d+) ms/.exec((await status(out).textContent())!)![1])
    expect(ms).toBeGreaterThanOrEqual(1400)

    // the run is logged in the Output tab
    await app.command('output:show')
    await expect(page.locator('.output-run .output-run-title', { hasText: 'js (Stream.md)' })).toBeVisible()

    // clear output
    await out.locator('button[title="Clear output"]').click()
    await expect(ed.root().locator('.cm-code-output')).toHaveCount(0)
  })

  test('▶ Run on a python block streams output', async ({ app }) => {
    test.skip(!hasPython, `${PYTHON} is not installed`)
    const ed = new MarkdownEditor(app)
    await ed.open('Stream.md')
    await live(ed, 1).run.click()
    const out = ed.root().locator('.cm-code-output')
    await expect(text(out)).toHaveText('py first\n', { timeout: 15_000 })
    await expect(status(out)).toHaveText('Running…')
    await expect(text(out)).toHaveText('py first\npy second 42\n', { timeout: 15_000 })
    await expect(status(out)).toHaveText(/^Exited with code 0 · \d+ ms$/)
  })

  test('an error exit shows stderr in red', async ({ app }) => {
    const ed = new MarkdownEditor(app)
    await ed.open('Fail.md')
    await live(ed).run.click()
    const { out } = live(ed)
    await expect(status(out)).toHaveText(/^Exited with code 3 · \d+ ms$/, { timeout: 15_000 })
    await expect(status(out)).toHaveClass(/is-error/)
    await expect(text(out)).toContainText('before')
    const err = text(out).locator('.stderr')
    await expect(err).toContainText('bad thing happened')
    await expectRedText(err)
  })

  test('a long-running block can be stopped', async ({ app }) => {
    const ed = new MarkdownEditor(app)
    await ed.open('Long.md')
    const { run, out } = live(ed)
    await run.click()
    await expect(text(out)).toContainText('tick 2')
    await out.locator('.is-stop').click()
    await expect(status(out)).toHaveText(/^Stopped · \d+ ms$/, { timeout: 15_000 })
    await expect(status(out)).not.toHaveClass(/is-error/)
    // no more output after stopping
    const after = await text(out).textContent()
    await expect.poll(() => text(out).textContent(), { intervals: [300, 300, 300] }).toBe(after)
  })

  test('Mod+Shift+Enter runs the block under the cursor in the note folder', async ({ app, page }) => {
    const ed = new MarkdownEditor(app)
    await app.openFile('Sub/Cursor.md')
    await ed.waitLoaded()
    // outside a code block: a hint
    await ed.clickLine('after')
    await page.keyboard.press('Control+Shift+Enter')
    await expect(page.locator('.notice', { hasText: 'Place the cursor inside a fenced code block' })).toBeVisible()

    await ed.line("console.log('cwd=").click()
    await page.keyboard.press('Control+Shift+Enter')
    const out = ed.root().locator('.cm-code-output')
    await expect(text(out)).toHaveText('cwd=Sub\n', { timeout: 15_000 })
    await expect(status(out)).toHaveText(/^Exited with code 0/)
  })

  test('unknown languages explain why they cannot run', async ({ app, page }) => {
    const ed = new MarkdownEditor(app)
    await ed.open('Unknown.md')
    // no ▶ Run button for languages without a runner
    await expect(ed.root().locator('.cm-code-header')).toHaveCount(2)
    await expect(ed.root().locator('.cm-code-run')).toHaveCount(0)

    await ed.line('main = print 1').click()
    await page.keyboard.press('Control+Shift+Enter')
    await expect(page.locator('.notice.error', { hasText: 'Don\'t know how to run "haskell" code' })).toBeVisible()
    await ed.line('no language').click()
    await page.keyboard.press('Control+Shift+Enter')
    await expect(page.locator('.notice.error', { hasText: 'Add a language to the code block to run it' })).toBeVisible()
    await expect(ed.root().locator('.cm-code-output')).toHaveCount(0)
  })
})

test.describe('code runner: reading view @basic', () => {
  test('▶ Run streams js and python output in reading view', async ({ app, page }) => {
    const ed = new MarkdownEditor(app)
    await ed.open('Stream.md')
    await page.keyboard.press('Control+E')
    await ed.expectMode('reading')

    const js = reading(ed, 0)
    await js.run.click()
    await expect(js.run).toHaveText('■ Stop')
    await expect(text(js.out)).toHaveText('js first\n')
    await expect(status(js.out)).toHaveText('Running…')
    await expect(text(js.out)).toHaveText('js first\njs second 42\n', { timeout: 15_000 })
    await expect(status(js.out)).toHaveText(/^Exited with code 0 · \d+ ms$/)
    await expect(js.run).toHaveText('▶ Run')

    if (hasPython) {
      const py = reading(ed, 1)
      await py.run.click()
      await expect(text(py.out)).toHaveText('py first\n', { timeout: 15_000 })
      await expect(status(py.out)).toHaveText('Running…')
      await expect(text(py.out)).toHaveText('py first\npy second 42\n', { timeout: 15_000 })
      await expect(status(py.out)).toHaveText(/^Exited with code 0 · \d+ ms$/)
    }
  })

  test('errors and stopping in reading view', async ({ app, page }) => {
    const ed = new MarkdownEditor(app)
    await ed.open('Fail.md')
    await page.keyboard.press('Control+E')
    const fail = reading(ed)
    await fail.run.click()
    await expect(status(fail.out)).toHaveText(/^Exited with code 3 · \d+ ms$/, { timeout: 15_000 })
    await expect(status(fail.out)).toHaveClass(/is-error/)
    await expectRedText(text(fail.out).locator('.stderr'))

    await ed.open('Long.md')
    await ed.expectMode('reading')
    const long = reading(ed)
    await long.run.click()
    await expect(text(long.out)).toContainText('tick 2')
    await long.run.click()
    await expect(status(long.out)).toHaveText(/^Stopped · \d+ ms$/, { timeout: 15_000 })
    await expect(status(long.out)).not.toHaveClass(/is-error/)
    await expect(long.run).toHaveText('▶ Run')
  })
})

test.describe('code runner settings @basic', () => {
  test('a per-language override command from Settings → Code runner is used', async ({ app, page }) => {
    const ed = new MarkdownEditor(app)
    await ed.open('Args.md')
    await live(ed).run.click()
    await expect(text(live(ed).out)).toHaveText('arg=undefined\n', { timeout: 15_000 })

    const modal = await openRunnerSettings(page)
    const input = modal.locator('.setting-item', { hasText: 'JavaScript' }).locator('input')
    await expect(input).toHaveAttribute('placeholder', 'node "{file}"')
    await input.fill('node "{file}" from-override')
    await input.press('Enter')
    await page.keyboard.press('Escape')
    await expect(modal).toHaveCount(0)
    await app.expectFile('.cs2d3k/app.json', (c) => JSON.parse(c).runners?.js === 'node "{file}" from-override')

    await live(ed).run.click()
    await expect(text(live(ed).out)).toHaveText('arg=from-override\n', { timeout: 15_000 })
  })

  test('the timeout setting kills long runs', async ({ app, page }) => {
    const modal = await openRunnerSettings(page)
    const item = modal.locator('.setting-item', { hasText: 'Timeout' })
    await item.locator('input[type=range]').focus()
    await page.keyboard.press('ArrowRight')
    await expect(item.locator('.slider-value')).toHaveText('5s')
    await page.keyboard.press('Escape')
    await app.expectFile('.cs2d3k/app.json', (c) => JSON.parse(c).runTimeoutSec === 5)

    const ed = new MarkdownEditor(app)
    await ed.open('Long.md')
    const { run, out } = live(ed)
    await run.click()
    await expect(text(out)).toContainText('tick 1')
    await expect(status(out)).not.toHaveText('Running…', { timeout: 15_000 })
    const ms = Number(/· (\d+) ms/.exec((await status(out).textContent())!)![1])
    expect(ms).toBeGreaterThanOrEqual(4500)
    expect(ms).toBeLessThan(10_000)
  })
})
