// Markdown note editor: modes, autosave, formatting, lists, history, search, live preview, title, status bar,
// context menu, external sync, split views, properties and long notes.
import { test, expect } from './fixtures'
import { MarkdownEditor, expectFileText } from './helpers/editor'
import { openSettingsTab } from './helpers/code'

const FILES: Record<string, string> = {
  'Note.md': '# Note\n\nfirst line\n',
  'Other.md': '# Other\n\nother body\n',
  'Count.md': 'one two three\n',
  'Format.md': 'boldword\nitalword\nlinkword\ntaskword\nsecretword\n',
  'Markup.md': '# Heading here\n\nSome **bold** and *ital* text with [[Other|alias]] link.\n\nlast line\n',
  'Search.md': 'apple banana apple\ncherry apple\n',
  'Props.md': '---\ntags: [alpha, beta]\nstatus: draft\n---\n# Props\n\nbody text\n',
  'Widgets.md':
    '# Widgets\n\n- bullet item\n- [ ] open task\n- [x] done task\n\n> [!warning] Careful\n> Callout body\n\n| A | B |\n| - | - |\n| 1 | 2 |\n\n---\n\n```py\nprint(1)\n```\n\nend\n'
}

test.use({ vault: { source: 'empty', files: FILES } })

test.describe('editor modes @basic', () => {
  test('Mod+E, the header button and the source toggle switch modes', async ({ app, page }) => {
    const ed = new MarkdownEditor(app)
    await ed.open('Note.md')
    await ed.expectMode('live')
    await expect(ed.modeButton()).toHaveAttribute('aria-label', 'Switch to reading view')

    await page.keyboard.press('Control+E')
    await ed.expectMode('reading')
    await expect(ed.reading().locator('h1')).toHaveText('Note')
    await expect(ed.root().locator('.md-editor-host')).toHaveClass(/is-hidden/)
    await expect(ed.modeButton()).toHaveAttribute('aria-label', 'Switch to editing view')

    await ed.modeButton().click()
    await ed.expectMode('live')
    await expect(ed.reading()).toHaveCount(0)

    // live preview hides the heading marker away from the cursor; source mode shows it
    await ed.clickLine('first line')
    await expect(ed.lines().first()).toHaveText('Note')
    await app.runPaletteCommand('Toggle Live Preview/Source mode')
    await ed.expectMode('source')
    await expect(ed.lines().first()).toHaveText('# Note')

    // reading and back returns to the last editing mode (source)
    await page.keyboard.press('Control+E')
    await ed.expectMode('reading')
    await page.keyboard.press('Control+E')
    await ed.expectMode('source')
  })

  test('each tab remembers its mode while navigating', async ({ app, page }) => {
    const ed = new MarkdownEditor(app)
    await ed.open('Note.md')
    await page.keyboard.press('Control+E')
    await ed.expectMode('reading')

    // navigating to another note in the same tab keeps reading view
    await ed.open('Other.md')
    await ed.expectMode('reading')
    await expect(ed.reading().locator('h1')).toHaveText('Other')

    // a new tab uses the default mode
    await ed.open('Count.md', { newTab: true })
    await ed.expectMode('live')

    await page.locator('.leaf.is-focused .tab', { hasText: 'Other' }).click()
    await expect.poll(() => app.activeFile()).toBe('Other.md')
    await ed.expectMode('reading')
  })

  test('the default view setting applies to newly opened notes', async ({ app, page }) => {
    const ed = new MarkdownEditor(app)
    const modal = await openSettingsTab(page, 'Editor')
    await modal.locator('.setting-item', { hasText: 'Default view for new tabs' }).locator('select').selectOption('reading')
    await page.keyboard.press('Escape')
    await expect(modal).toHaveCount(0)
    await app.expectFile('.cs2d3k/app.json', (c) => JSON.parse(c).defaultViewMode === 'reading')

    await ed.open('Note.md')
    await ed.expectMode('reading')

    await app.setSetting('defaultViewMode', 'source')
    await ed.open('Other.md', { newTab: true })
    await ed.expectMode('source')
  })
})

test.describe('editor editing @basic', () => {
  test('typing autosaves to disk', async ({ app }) => {
    const ed = new MarkdownEditor(app)
    await ed.open('Note.md')
    await ed.focusEnd()
    await ed.type('typed by the test')
    await expectFileText(app, 'Note.md', '# Note\n\nfirst line\ntyped by the test')
  })

  test('formatting hotkeys: bold, italic, link, checklist, comment', async ({ app, page }) => {
    const ed = new MarkdownEditor(app)
    await ed.open('Format.md')

    await ed.clickLine('boldword')
    await page.keyboard.press('Control+B')
    await ed.clickLine('italword')
    await page.keyboard.press('Control+I')
    await ed.clickLine('linkword')
    await page.keyboard.press('Shift+Home')
    await page.keyboard.press('Control+K')
    await ed.clickLine('taskword')
    await page.keyboard.press('Control+L')
    await ed.clickLine('secretword')
    await page.keyboard.press('Control+/')

    await expectFileText(app, 'Format.md', '**boldword**\n*italword*\n[[linkword]]\n- [ ] taskword\n%% secretword %%\n')

    // toggling again removes / advances the markup
    await ed.setCursorAtLineEnd('taskword')
    await page.keyboard.press('Control+L')
    await ed.setCursorAtLineEnd('secretword')
    await page.keyboard.press('Control+/')
    await app.expectFile('Format.md', (c) => c.includes('- [x] taskword\nsecretword\n'))
  })

  test('lists continue on Enter and Tab indents list items', async ({ app, page }) => {
    const ed = new MarkdownEditor(app)
    await ed.open('Note.md')
    await ed.focusEnd()
    await ed.type('- one')
    await page.keyboard.press('Enter')
    await ed.type('two')
    await page.keyboard.press('Enter')
    await page.keyboard.press('Tab')
    await ed.type('nested')
    await page.keyboard.press('Enter')
    await page.keyboard.press('Shift+Tab')
    await ed.type('three')
    // Enter on an empty item removes its marker (ends the list)
    await page.keyboard.press('Enter')
    await page.keyboard.press('Enter')
    await ed.type('1. first')
    await page.keyboard.press('Enter')
    await ed.type('second')
    await expectFileText(app, 'Note.md', '# Note\n\nfirst line\n- one\n- two\n\t- nested\n- three\n1. first\n2. second')
  })

  test('undo and redo', async ({ app, page }) => {
    const ed = new MarkdownEditor(app)
    await ed.open('Note.md')
    await ed.focusEnd()
    await ed.type('alpha')
    await app.expectFile('Note.md', (c) => c.endsWith('first line\nalpha'))
    await page.keyboard.press('Control+Z')
    await expectFileText(app, 'Note.md', '# Note\n\nfirst line\n')
    await page.keyboard.press('Control+Y')
    await app.expectFile('Note.md', (c) => c.endsWith('first line\nalpha'))
    await page.keyboard.press('Control+Z')
    await page.keyboard.press('Control+Shift+Z')
    await app.expectFile('Note.md', (c) => c.endsWith('first line\nalpha'))
  })

  test('search and replace panel', async ({ app, page }) => {
    const ed = new MarkdownEditor(app)
    await ed.open('Search.md')
    await ed.content().click()
    await page.keyboard.press('Control+F')
    const panel = ed.root().locator('.cm-search')
    await expect(panel).toBeVisible()
    await expect(panel.locator('input[name=search]')).toBeFocused()
    await page.keyboard.type('apple')
    await expect(ed.root().locator('.cm-searchMatch')).toHaveCount(3)

    await page.keyboard.press('Escape')
    await expect(panel).toHaveCount(0)

    await page.keyboard.press('Control+H')
    await expect(panel.locator('input[name=replace]')).toBeFocused()
    await panel.locator('input[name=search]').fill('apple')
    await panel.locator('input[name=replace]').fill('pear')
    await panel.locator('button[name=replaceAll]').click()
    await expectFileText(app, 'Search.md', 'pear banana pear\ncherry pear\n')
  })

  test('external change reloads the note without polluting undo', async ({ app, page }) => {
    const ed = new MarkdownEditor(app)
    await ed.open('Note.md')
    await ed.focusEnd()
    await ed.type('mine')
    await app.expectFile('Note.md', (c) => c.endsWith('mine'))

    app.writeExternal('Note.md', '# Note\n\nchanged elsewhere\n')
    await expect(ed.line('changed elsewhere')).toBeVisible()
    await ed.expectDoc((d) => d === '# Note\n\nchanged elsewhere\n')

    // undo only reverts the user's own edit history, never back to the pre-reload text
    await page.keyboard.press('Control+End')
    await ed.type('after')
    await expectFileText(app, 'Note.md', '# Note\n\nchanged elsewhere\nafter')
    await page.keyboard.press('Control+Z')
    await expectFileText(app, 'Note.md', '# Note\n\nchanged elsewhere\n')
    await ed.expectDoc((d) => d === '# Note\n\nchanged elsewhere\n')
  })

  test('two tabs of the same note stay in sync', async ({ app, page }) => {
    const ed = new MarkdownEditor(app)
    await ed.open('Note.md')
    await app.command('workspace:split-right')
    await expect(page.locator('.leaf')).toHaveCount(2)
    const left = new MarkdownEditor(app, page.locator('.leaf').nth(0).locator('.view:not(.hidden)'))
    const right = new MarkdownEditor(app, page.locator('.leaf').nth(1).locator('.view:not(.hidden)'))
    await right.waitLoaded()

    await right.content().click()
    await page.keyboard.press('Control+End')
    await right.type('from right')
    await expect(left.line('from right')).toBeVisible()

    await left.content().click()
    await page.keyboard.press('Control+End')
    await page.keyboard.press('Enter')
    await left.type('from left')
    await expect(right.line('from left')).toBeVisible()
    await expectFileText(app, 'Note.md', '# Note\n\nfirst line\nfrom right\nfrom left')
    await right.expectDoc((d) => d === '# Note\n\nfirst line\nfrom right\nfrom left')
  })
})

test.describe('editor live preview @basic', () => {
  test('markup is hidden away from the cursor and shown on the cursor line', async ({ app, page }) => {
    const ed = new MarkdownEditor(app)
    await ed.open('Markup.md')
    const line = ed.line('Some')
    // the cursor starts on the heading: its marker is revealed, the rest is rendered
    await expect(ed.lines().first()).toHaveText('# Heading here')
    await expect(line).toHaveText('Some bold and ital text with alias link.')
    await expect(line.locator('.cm-lp-link')).toHaveText('alias')

    await ed.clickLine('last line')
    await expect(line).toHaveText('Some bold and ital text with alias link.')

    // only the element under the cursor reveals its markup
    await line.getByText('bold', { exact: true }).click()
    await expect(line).toHaveText('Some **bold** and ital text with alias link.')
    await expect(ed.lines().first()).toHaveText('Heading here')
    await page.keyboard.press('End')
    await expect(line).toHaveText('Some bold and ital text with alias link.')
    // (clicking a rendered link would follow it: put the caret inside it like keyboard navigation would)
    await ed.setCursorAfter('[[Oth')
    await expect(line).toHaveText('Some bold and ital text with [[Other|alias]] link.')

    await page.keyboard.press('Control+Home')
    await expect(ed.lines().first()).toHaveText('# Heading here')
    await expect(line).toHaveText('Some bold and ital text with alias link.')
  })

  test('frontmatter renders as properties and reveals YAML on click', async ({ app, page }) => {
    const ed = new MarkdownEditor(app)
    await ed.open('Props.md')
    const props = ed.root().locator('.cm-lp-properties')
    await expect(props).toBeVisible()
    await expect(props.locator('.fm-key')).toHaveText(['tags', 'status'])
    await expect(props.locator('.fm-pill')).toHaveText(['alpha', 'beta'])
    await expect(props.locator('.fm-value').nth(1)).toHaveText('draft')

    await props.click()
    await expect(props).toHaveCount(0)
    await expect(ed.line('status: draft')).toBeVisible()
    await page.keyboard.type(' v2')
    await app.expectFile('Props.md', (c) => c.startsWith('---\ntags: [alpha, beta] v2\n'))

    // reading view shows the same properties
    await ed.clickLine('body text')
    await page.keyboard.press('Control+E')
    await expect(ed.reading().locator('.frontmatter-properties .fm-key')).toHaveText(['tags', 'status'])

    // "Show properties" off hides them
    await app.setSetting('showFrontmatter', false)
    await expect(ed.reading().locator('.frontmatter-properties')).toHaveCount(0)
    await page.keyboard.press('Control+E')
    await ed.clickLine('body text')
    await expect(ed.root().locator('.cm-lp-properties')).toHaveCount(0)
    await expect(ed.line('status:')).toHaveCount(0)
  })
})

test.describe('editor live preview widgets @basic', () => {
  test('lists, tasks, callouts, tables, rules and code headers render; checkboxes toggle', async ({ app }) => {
    const ed = new MarkdownEditor(app)
    await ed.open('Widgets.md')
    await ed.clickLine('end')
    const root = ed.root()
    await expect(root.locator('.cm-lp-bullet')).toHaveCount(1)
    await expect(root.locator('.cm-lp-task input')).toHaveCount(2)
    await expect(root.locator('.cm-task-checked')).toHaveText('done task')
    await expect(root.locator('.cm-callout-line')).toHaveCount(2)
    await expect(root.locator('.cm-callout-line[data-callout="warning"]').first()).toContainText('Careful')
    await expect(root.locator('.cm-lp-table table td')).toHaveText(['1', '2'])
    await expect(root.locator('.cm-lp-hr')).toHaveCount(1)
    await expect(root.locator('.cm-code-header .cm-code-lang')).toHaveText('py')
    await expect(root.locator('.cm-code-run')).toHaveCount(1)

    await root.locator('.cm-lp-task input').first().click()
    await app.expectFile('Widgets.md', (c) => c.includes('- [x] open task\n- [x] done task'))
    await root.locator('.cm-lp-task input').nth(1).click()
    await app.expectFile('Widgets.md', (c) => c.includes('- [x] open task\n- [ ] done task'))
    await expect(root.locator('.cm-lp-task input').first()).toBeChecked()
    await expect(root.locator('.cm-lp-task input').nth(1)).not.toBeChecked()
  })
})

test.describe('editor chrome @basic', () => {
  test('inline title renames the note and Enter moves into the editor', async ({ app, page }) => {
    const ed = new MarkdownEditor(app)
    await ed.open('Note.md')
    await expect(ed.title()).toHaveText('Note')
    await ed.title().click()
    await page.keyboard.press('Control+A')
    await page.keyboard.type('Renamed note')
    await page.keyboard.press('Enter')
    await expect.poll(() => app.exists('Renamed note.md')).toBe(true)
    expect(app.exists('Note.md')).toBe(false)
    await expect.poll(() => app.activeFile()).toBe('Renamed note.md')
    await expect(page.locator('.leaf.is-focused .tab.is-active .tab-title')).toHaveText('Renamed note')

    // focus moved to the start of the note: typing saves to the new path
    await ed.type('top ')
    await expectFileText(app, 'Renamed note.md', /^top # Note/)
    expect(app.exists('Note.md')).toBe(false)

    // Escape cancels a rename
    await ed.title().click()
    await page.keyboard.press('Control+A')
    await page.keyboard.type('Nope')
    await page.keyboard.press('Escape')
    await expect(ed.title()).toHaveText('Renamed note')
    expect(app.exists('Nope.md')).toBe(false)
  })

  test('a new empty note focuses its title and shows the placeholder', async ({ app, page }) => {
    const ed = new MarkdownEditor(app)
    await page.keyboard.press('Control+N')
    await expect.poll(() => app.activeFile()).toBe('Untitled.md')
    await ed.waitLoaded()
    await expect(ed.title()).toBeFocused()
    await expect(ed.root().locator('.cm-placeholder')).toHaveText('Start writing…')
    await page.keyboard.type('Fresh idea')
    await page.keyboard.press('Enter')
    await expect.poll(() => app.exists('Fresh idea.md')).toBe(true)
    await ed.type('content')
    await expect(ed.root().locator('.cm-placeholder')).toHaveCount(0)
    await expectFileText(app, 'Fresh idea.md', 'content')
  })

  test('word count in the status bar follows edits and selections', async ({ app, page }) => {
    const ed = new MarkdownEditor(app)
    await ed.open('Count.md')
    await expect(ed.wordCount()).toHaveText(/^3 words\s*14 characters$/)
    await ed.focusEnd()
    await ed.type('four')
    await expect(ed.wordCount()).toHaveText(/^4 words\s*18 characters$/)
    await page.keyboard.press('Shift+Control+ArrowLeft')
    await expect(ed.wordCount()).toHaveText(/^1 word\s*4 characters$/)
    await expect(ed.wordCount()).toHaveAttribute('title', 'Selection')

    // other views don't show it
    await page.keyboard.press('Control+E')
    await expect(ed.wordCount()).toBeVisible()
    await app.command('graph:open')
    await expect(ed.wordCount()).toHaveCount(0)
  })

  test('context menu formats the selection', async ({ app, page }) => {
    const ed = new MarkdownEditor(app)
    await ed.open('Format.md')
    const word = ed.line('italword')
    await word.dblclick()
    await word.click({ button: 'right' })
    const menu = page.locator('.menu')
    await expect(menu).toBeVisible()
    for (const label of ['Cut', 'Copy', 'Paste', 'Bold', 'Italic', 'Insert link', 'Toggle checklist'])
      await expect(menu.locator('.menu-item', { hasText: label }).first()).toBeVisible()
    await expect(menu.locator('.menu-item', { hasText: 'Cut' })).not.toHaveClass(/disabled/)
    await menu.locator('.menu-item', { hasText: 'Italic' }).click()
    await expect(menu).toHaveCount(0)
    await app.expectFile('Format.md', (c) => c.includes('\n*italword*\n'))

    // without a selection cut/copy are disabled; submenu formatting works on the word under the cursor
    await ed.clickLine('boldword')
    await ed.line('boldword').click({ button: 'right' })
    await expect(menu.locator('.menu-item', { hasText: 'Cut' })).toHaveClass(/disabled/)
    await menu.locator('.menu-item', { hasText: 'More formatting' }).hover()
    await page.locator('.menu .menu-item', { hasText: 'Strikethrough' }).click()
    await app.expectFile('Format.md', (c) => c.startsWith('~~boldword~~\n'))
  })
})

test.describe('editor long notes @basic', () => {
  const LINES = 5000
  const big = Array.from({ length: LINES }, (_, i) => (i % 50 === 0 ? `## Section ${i}` : `Line ${i} with some **bold** text and a [[Note]] link`)).join('\n')
  test.use({ vault: { source: 'empty', files: { ...FILES, 'Big.md': big } } })

  test('a very long note opens, scrolls and saves quickly', async ({ app, page }) => {
    const ed = new MarkdownEditor(app)
    const t0 = Date.now()
    await ed.open('Big.md')
    await expect(ed.line('Line 1 with')).toBeVisible()
    expect(Date.now() - t0, 'open time (ms)').toBeLessThan(5000)

    await ed.content().click()
    await page.keyboard.press('Control+End')
    await expect(ed.line(`Line ${LINES - 1} with`)).toBeVisible()
    await ed.type(' END')
    await app.expectFile('Big.md', (c) => c.endsWith(`Line ${LINES - 1} with some **bold** text and a [[Note]] link END`) && c.split('\n').length === LINES)
    // the editor only renders the viewport
    expect(await ed.lines().count()).toBeLessThan(400)
  })
})
