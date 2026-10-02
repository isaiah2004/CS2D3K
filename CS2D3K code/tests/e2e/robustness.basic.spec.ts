// Robustness / security audit regressions (see QUALITY.md): data loss races, hostile notes, malformed files.
import { writeFileSync, readdirSync, existsSync } from 'fs'
import { join } from 'path'
import { test, expect } from './fixtures'
import type { App } from './helpers/app'

const open = (app: App, path: string, mode?: 'live' | 'source' | 'reading'): Promise<void> =>
  app.page.evaluate(
    ([p, m]) => {
      const ws = window.__cs2d3k!.stores.workspace.getState() as { openFile(p: string, o?: unknown): void }
      ws.openFile(p, m ? { state: { mode: m } } : undefined)
    },
    [path, mode] as const
  )

const pause = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

test.describe('robustness: hostile notes @basic', () => {
  test.use({
    vault: {
      source: 'empty',
      files: {
        'evil.js': 'window.top.__pwned = (window.top.__pwned || 0) + 1',
        'Hostile.md': [
          '# Hostile',
          '',
          '<iframe srcdoc="<script src=\'vault://local/evil.js\'></script>"></iframe>',
          '',
          '<meta http-equiv="refresh" content="0;url=vault://local/evil.js">',
          '',
          '<a id="filelink" href="file:///C:/Windows/win.ini">local file</a>',
          '',
          '<div class="code-block" data-lang="js"><code hidden>window.top.__pwned = 99</code><button class="code-block-run">Read the docs</button><div class="code-block-output" hidden></div></div>',
          '',
          'end'
        ].join('\n')
      }
    }
  })

  test('raw HTML in a note cannot run scripts, fake a Run button or navigate the window', async ({ app, page }) => {
    const url = page.url()
    await open(app, 'Hostile.md', 'reading')
    const view = app.activeView().locator('.md-reading .markdown-rendered')
    await expect(view).toContainText('end')
    expect(await view.locator('iframe, meta').count()).toBe(0)

    await view.locator('button.code-block-run').click()
    await view.locator('#filelink').click()
    await pause(800)
    expect(page.url()).toBe(url)
    expect(await page.evaluate(() => (window as unknown as { __pwned?: number }).__pwned ?? 0)).toBe(0)
    await expect(view.locator('.code-block-output')).toBeHidden()
    // the app is still alive
    expect(await page.evaluate(() => !!window.__cs2d3k)).toBe(true)
  })
})

test.describe('robustness: window hardening @basic', () => {
  test.use({ vault: { source: 'empty', files: { 'evil.js': 'window.top.__pwned = 1', 'page.html': '<script>window.__pwned = 1</script>' } } })

  test('the app window refuses to navigate to other pages', async ({ app, page }) => {
    const url = page.url()
    for (const target of [`file:///${app.abs('page.html').replace(/\\/g, '/')}`, 'vault://local/page.html', 'http://localhost.example.com/']) {
      await page.evaluate((t) => {
        window.location.href = t
      }, target)
      await pause(500)
      expect(page.url(), target).toBe(url)
    }
    expect(await page.evaluate(() => !!window.__cs2d3k)).toBe(true)
  })
})

test.describe('robustness: CSP blocks vault scripts even without the sanitizer @basic', () => {
  test.use({
    vault: { source: 'empty', files: { 'evil.js': 'window.top.__pwned = 1' } },
    allowConsoleErrors: [/Content Security Policy|Refused to load the script/i]
  })

  test('a srcdoc frame cannot load a script from vault://', async ({ page }) => {
    await page.evaluate(() => {
      const f = document.createElement('iframe')
      f.srcdoc = `<script src="vault://local/evil.js"></script>`
      document.body.appendChild(f)
    })
    await pause(800)
    expect(await page.evaluate(() => (window as unknown as { __pwned?: number }).__pwned ?? 0)).toBe(0)
  })
})

test.describe('robustness: pending saves vs delete / rename @basic', () => {
  test.use({ vault: { source: 'empty', files: { 'Note.md': 'start\n', 'Other.md': 'other\n' } } })

  test('deleting a note right after typing does not resurrect it', async ({ app, page }) => {
    await app.setSetting('confirmDelete', false)
    await open(app, 'Note.md', 'source')
    const editor = app.activeView().locator('.cm-content')
    await expect(editor).toContainText('start')
    await editor.click()
    await page.keyboard.press('Control+End')
    await page.keyboard.type('typed')
    // well inside the 400ms save debounce
    await app.command('file:delete')
    await expect.poll(() => app.exists('Note.md')).toBe(false)
    await pause(1200)
    expect(app.exists('Note.md')).toBe(false)
  })

  test('renaming a note right after typing keeps the text and leaves no file behind', async ({ app, page }) => {
    await open(app, 'Note.md', 'source')
    const editor = app.activeView().locator('.cm-content')
    await expect(editor).toContainText('start')
    await editor.click()
    await page.keyboard.press('Control+End')
    await page.keyboard.type('typed')
    await page.evaluate(() => window.__cs2d3k!.fileops.renamePath('Note.md', 'Renamed.md'))
    await app.expectFile('Renamed.md', (c) => c.includes('typed'))
    await pause(1200)
    expect(app.exists('Note.md')).toBe(false)
    expect(app.read('Renamed.md')).toMatch(/^start\s*typed/)
  })

  test('case-only rename works and keeps the tab', async ({ app, page }) => {
    await open(app, 'Other.md', 'source')
    expect(await page.evaluate(() => window.__cs2d3k!.fileops.renamePath('Other.md', 'OTHER.md'))).toBe(true)
    await expect.poll(() => readdirSync(app.vaultDir).includes('OTHER.md')).toBe(true)
    expect(readdirSync(app.vaultDir)).not.toContain('Other.md')
    await expect.poll(() => app.activeFile()).toBe('OTHER.md')
    expect(app.read('OTHER.md')).toBe('other\n')
  })
})

test.describe('robustness: malformed files @basic', () => {
  const nul = String.fromCharCode(0)
  test.use({
    vault: {
      source: 'empty',
      files: {
        'Bad frontmatter.md': '---\ntitle: [unclosed\n  - : :\n---\nbody text\n',
        'Unclosed frontmatter.md': '---\ntitle: x\nno end\n',
        'Binary.md': `abc${nul}${nul}\u00ff\u00fe garbage`,
        'Empty.md': '',
        'CRLF.md': '# Title\r\n\r\nline one\r\nline two\r\n',
        'Long line.md': 'x'.repeat(200_000),
        'Empty.canvas': '',
        'Broken.canvas': '{ "nodes": [ {"id": "a", "type": "text", "text": "A", "x": 0, "y": 0 ',
        'Weird.canvas': JSON.stringify({
          nodes: [
            { id: 'a', type: 'text', text: 'A', x: 0, y: 0, width: 100, height: 60 },
            { id: 'a', type: 'text', text: 'dup', x: 200, y: 0, width: 100, height: 60 },
            { type: 'file', file: 'missing.md', x: 0, y: 200 },
            { id: 'n', type: 'unknown-type', x: 'NaN', y: null },
            null,
            'str'
          ],
          edges: [
            { id: 'e1', fromNode: 'a', toNode: 'ghost' },
            { id: 'e2', fromNode: 'ghost', toNode: 'ghost2' },
            { id: 'e3', fromNode: 'a', toNode: 'a', fromSide: 'nowhere' },
            { fromNode: 1, toNode: {} }
          ]
        }),
        'Array.canvas': '[1, 2, 3]',
        'Empty.formmap': '',
        'Broken.formmap': '{"nodes": [}',
        'Weird.formmap': JSON.stringify({
          formmap: { title: 5, mvpBudget: 'lots' },
          nodes: [
            { id: 'f1', type: 'form', kind: 'nonsense', x: 0, y: 0, width: 200, height: 100, fields: 'oops', votes: 'many' },
            { id: 'f2', type: 'form', x: 300, y: 0, width: 200, height: 100, fields: { phase: 42, priority: null } },
            { id: 'z1', type: 'zone', x: -50, y: -50, width: 800, height: 400, assign: 'x', order: 'first' },
            { id: 'd1', type: 'drawing', x: 0, y: 0, width: 10, height: 10, points: 'not-an-array' }
          ],
          edges: [{ id: 'e', fromNode: 'f1', toNode: 'f2', relation: 'nope' }, { id: 'e2', fromNode: 'f1', toNode: 'gone' }]
        })
      }
    }
  })

  const files = ['Bad frontmatter.md', 'Unclosed frontmatter.md', 'Binary.md', 'Empty.md', 'CRLF.md', 'Long line.md', 'Empty.canvas', 'Broken.canvas', 'Weird.canvas', 'Array.canvas', 'Empty.formmap', 'Broken.formmap', 'Weird.formmap']

  test('every malformed file opens without crashing a view, and nothing is rewritten', async ({ app, page }) => {
    const before = Object.fromEntries(files.map((f) => [f, app.read(f)]))
    for (const f of files) {
      await open(app, f)
      await expect(app.activeView()).toBeVisible()
      await pause(400)
      await expect(app.activeView().locator('.error-boundary'), f).toHaveCount(0)
    }
    // reading view too
    for (const f of files.filter((x) => x.endsWith('.md'))) {
      await open(app, f, 'reading')
      await pause(250)
      await expect(app.activeView().locator('.error-boundary'), f).toHaveCount(0)
    }
    // switch formmap lenses on the weird one
    await open(app, 'Weird.formmap')
    for (const key of ['2', '3', '4', '1']) {
      await page.keyboard.press(`Alt+${key}`)
      await pause(250)
      await expect(app.activeView().locator('.error-boundary'), `lens ${key}`).toHaveCount(0)
    }
    await pause(800)
    for (const f of files) expect(app.read(f), `${f} must not be rewritten just by opening it`).toBe(before[f])
    expect(await page.evaluate(() => !!window.__cs2d3k)).toBe(true)
  })
})

test.describe('robustness: corrupt config @basic', () => {
  test.use({ vault: { source: 'empty', files: { 'a.md': 'a', '.cs2d3k/app.json': '{ "baseTheme": "light", oops }', '.cs2d3k/workspace.json': '{' } } })

  test('unparsable config files are backed up before defaults are saved over them', async ({ app }) => {
    await app.setSetting('editorFontSize', 17)
    await expect.poll(() => app.exists('.cs2d3k/app.json.bak')).toBe(true)
    expect(app.read('.cs2d3k/app.json.bak')).toBe('{ "baseTheme": "light", oops }')
    await app.expectFile('.cs2d3k/app.json', (c) => JSON.parse(c).editorFontSize === 17)
    expect(app.read('.cs2d3k/app.json.bak')).toBe('{ "baseTheme": "light", oops }')
    expect(app.exists('.cs2d3k/workspace.json.bak')).toBe(true)
  })
})

test.describe('robustness: special file names @basic', () => {
  // '#' can only be linked with a markdown link: in a wikilink it starts a heading (like Obsidian)
  test.use({ vault: { source: 'empty', files: { 'Embeds.md': '![[x %20 & y.png]]\n\n![[ünï cødé.png]]\n\n![](a%20%231%20%2520%20%26%20b.png)\n' } } })

  test('images with #, %, & and unicode in their names load through vault://', async ({ app, page }) => {
    // 1x1 png
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')
    for (const name of ['x %20 & y.png', 'ünï cødé.png', 'a #1 %20 & b.png']) writeFileSync(join(app.vaultDir, name), png)
    await expect.poll(() => page.evaluate(() => Object.keys((window.__cs2d3k!.stores.vault.getState() as { files: object }).files).length)).toBeGreaterThanOrEqual(4)
    await open(app, 'Embeds.md', 'reading')
    const imgs = app.activeView().locator('.md-reading img')
    await expect(imgs).toHaveCount(3)
    await expect.poll(() => imgs.evaluateAll((els) => els.map((e) => (e as HTMLImageElement).naturalWidth))).toEqual([1, 1, 1])
    expect(existsSync(app.abs('a #1 %20 & b.png'))).toBe(true)
  })
})

test.describe('robustness: vault:// frames after removing bypassCSP @basic', () => {
  const pdf = [
    '%PDF-1.1',
    '1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj',
    '2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj',
    '3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] >> endobj',
    'trailer << /Root 1 0 R >>',
    '%%EOF'
  ].join('\n')
  test.use({ vault: { source: 'empty', files: { 'doc.pdf': pdf, 'Pdf.md': '![[doc.pdf]]\n' } } })

  test('PDF embeds and the PDF view still load from vault:// (CSP frame-src)', async ({ app }) => {
    await open(app, 'Pdf.md', 'reading')
    await expect(app.activeView().locator('.md-reading iframe')).toHaveAttribute('src', /^vault:\/\/local\/doc\.pdf/)
    await open(app, 'doc.pdf')
    await expect(app.activeView().locator('iframe')).toHaveAttribute('src', /^vault:\/\/local\/doc\.pdf/)
    await pause(1000)
    // a CSP block would be a console error, which fails the test (fixtures)
  })
})

test.describe('robustness: processes do not outlive a window reload @basic', () => {
  test.use({ vault: { source: 'empty', files: { 'a.md': 'a' } } })

  // works as an ES module (runner: .mjs) and in `node -e`; single quotes + forward slashes survive any shell
  const ticker = (file: string): string => `setInterval(() => process.getBuiltinModule('fs').writeFileSync('${file.replace(/\\/g, '/')}', String(Date.now())), 100)`
  const stillTicking = async (app: App, rel: string): Promise<boolean> => {
    const a = app.exists(rel) ? app.read(rel) : ''
    await pause(1200)
    return (app.exists(rel) ? app.read(rel) : '') !== a
  }

  test('reloading the window stops running snippets and terminal processes', async ({ app, page }) => {
    // a snippet started through the runner (like the ▶ Run button)
    const runFile = app.abs('run-tick.txt')
    await page.evaluate((code) => {
      void window.api.runner.run({ lang: 'js', code, runId: 'audit-run' })
    }, ticker(runFile))
    // a process started in a terminal tab
    await app.command('terminal:focus')
    const term = page.locator('.terminal-host .xterm')
    await expect(term).toBeVisible()
    await term.click()
    const termFile = app.abs('term-tick.txt')
    await page.keyboard.type(`node -e "${ticker(termFile)}"`)
    await page.keyboard.press('Enter')
    await expect.poll(() => app.exists('run-tick.txt') && app.exists('term-tick.txt'), { timeout: 20_000 }).toBe(true)
    expect(await stillTicking(app, 'run-tick.txt')).toBe(true)

    await app.command('app:reload')
    await page.waitForFunction(() => !!window.__cs2d3k, null, { timeout: 30_000 })
    await page.evaluate(() => window.__cs2d3k!.ready())
    await pause(800)
    expect(await stillTicking(app, 'run-tick.txt'), 'runner child still alive').toBe(false)
    expect(await stillTicking(app, 'term-tick.txt'), 'terminal child still alive').toBe(false)
  })
})
