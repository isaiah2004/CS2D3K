// Links in notes: autocomplete, navigation, unresolved links, subpaths, embeds, page previews,
// markdown links, drag & drop from the explorer and rename link updating.
import { test, expect } from './fixtures'
import { MarkdownEditor, expectFileText, dragFile, acceptCompletion } from './helpers/editor'

test.use({ vault: { source: 'links' } })

const suggestions = (page: import('@playwright/test').Page) => page.locator('.cm-tooltip-autocomplete li')

test.describe('link autocomplete @basic', () => {
  test('[[ suggests files and inserts the link', async ({ app, page }) => {
    const ed = new MarkdownEditor(app)
    await ed.open('Home.md')
    await ed.focusEnd()
    await ed.type('See [[Tar')
    await expect(suggestions(page).first()).toContainText('Target')
    await acceptCompletion(page)
    await ed.type(' and [[dee')
    await expect(suggestions(page).first()).toContainText('Deep')
    await expect(suggestions(page).first()).toContainText('Folder')
    await acceptCompletion(page)
    await expectFileText(app, 'Home.md', /\nSee \[\[Target\]\] and \[\[Deep\]\]$/)
    await expect(page.locator('.cm-tooltip-autocomplete')).toHaveCount(0)
  })

  test('[[note# suggests headings of that note', async ({ app, page }) => {
    const ed = new MarkdownEditor(app)
    await ed.open('Home.md')
    await ed.focusEnd()
    await ed.type('[[Target#')
    await expect(suggestions(page)).toHaveText([/Target\s*H1/, /Second section\s*H2/, /Third\s*H2/])
    await ed.type('thi')
    await expect(suggestions(page)).toHaveCount(1)
    await acceptCompletion(page)
    await expectFileText(app, 'Home.md', /\n\[\[Target#Third\]\]$/)
  })

  test('#tag suggests existing tags', async ({ app, page }) => {
    const ed = new MarkdownEditor(app)
    await ed.open('Home.md')
    await ed.focusEnd()
    await ed.type('more #proj')
    await expect(suggestions(page)).toHaveText([/#project\/beta\s*2/, /#project\/alpha\s*2/])
    await suggestions(page).filter({ hasText: 'alpha' }).click()
    await ed.type('end')
    await expectFileText(app, 'Home.md', /\nmore #project\/alpha end$/)
  })
})

test.describe('link navigation @basic', () => {
  test('clicking a wikilink navigates, Mod+click opens a new tab', async ({ app, page }) => {
    const ed = new MarkdownEditor(app)
    const targetLink = ed.root().locator('.cm-lp-link', { hasText: /^Target$/ })
    await ed.open('Home.md')
    await targetLink.click()
    await expect.poll(() => app.activeFile()).toBe('Target.md')
    // navigated in the same tab, which can go back
    expect((await app.layout())[0].tabs.map((t) => t.path)).toEqual(['Target.md'])
    await page.locator('.leaf.is-focused button[title="Navigate back"]').click()
    await expect.poll(() => app.activeFile()).toBe('Home.md')

    await targetLink.click({ modifiers: ['Control'] })
    await expect.poll(async () => (await app.layout())[0].tabs.map((t) => t.path)).toEqual(['Home.md', 'Target.md'])
    await expect.poll(() => app.activeFile()).toBe('Target.md')
    // a plain click on a link to a note that is already open activates its tab
    await page.locator('.leaf.is-focused .tab', { hasText: 'Home' }).click()
    await targetLink.click()
    await expect.poll(() => app.activeFile()).toBe('Target.md')
    expect((await app.layout())[0].tabs).toHaveLength(2)
  })

  test('a link context menu opens it in a new tab', async ({ app, page }) => {
    const ed = new MarkdownEditor(app)
    await ed.open('Home.md')
    await ed.clickLine('last line')
    const link = ed.root().locator('.cm-lp-link', { hasText: 'deep note' })
    await link.click({ button: 'right' })
    const menu = page.locator('.menu')
    await expect(menu.locator('.menu-item').first()).toHaveText(/Open link/)
    // right-clicking keeps the link rendered
    await expect(link).toBeVisible()
    await menu.locator('.menu-item', { hasText: 'Open link in new tab' }).click()
    await expect.poll(async () => (await app.layout())[0].tabs.map((t) => t.path)).toEqual(['Home.md', 'Folder/Deep.md'])
  })

  test('an unresolved link creates the note', async ({ app }) => {
    const ed = new MarkdownEditor(app)
    await ed.open('Home.md')
    const link = ed.root().locator('.cm-lp-link', { hasText: 'Missing note' })
    await expect(link).toHaveClass(/is-unresolved/)
    expect(app.exists('Missing note.md')).toBe(false)
    await link.click()
    await expect.poll(() => app.activeFile()).toBe('Missing note.md')
    expect(app.read('Missing note.md')).toBe('')
    await ed.waitLoaded()
    await ed.type('created')
    await expectFileText(app, 'Missing note.md', 'created')

    // back in Home the link is resolved now
    await app.openFile('Home.md')
    await expect(ed.root().locator('.cm-lp-link', { hasText: 'Missing note' })).not.toHaveClass(/is-unresolved/)
  })

  test('heading and block subpaths scroll to the target', async ({ app, page }) => {
    const ed = new MarkdownEditor(app)
    await ed.open('Home.md')
    await ed.root().locator('.cm-lp-link', { hasText: 'second' }).click()
    await expect.poll(() => app.activeFile()).toBe('Target.md')
    await expect(ed.line('Second section')).toBeInViewport()
    await expect.poll(() => ed.cursorLine()).toBe('## Second section')
    await expect(ed.line('Intro text')).not.toBeInViewport()

    await page.locator('.leaf.is-focused button[title="Navigate back"]').click()
    await expect.poll(() => app.activeFile()).toBe('Home.md')
    await ed.root().locator('.cm-lp-link', { hasText: 'block' }).click()
    await expect.poll(() => app.activeFile()).toBe('Target.md')
    await expect.poll(() => ed.cursorLine()).toBe('Block paragraph text ^blk1')
    await expect(ed.line('Block paragraph text')).toBeInViewport()

    // reading view scrolls to the heading as well
    await page.locator('.leaf.is-focused button[title="Navigate back"]').click()
    await expect.poll(() => app.activeFile()).toBe('Home.md')
    await page.keyboard.press('Control+E')
    await ed.reading().locator('a.internal-link', { hasText: /^second$/ }).click()
    await expect.poll(() => app.activeFile()).toBe('Target.md')
    await ed.expectMode('reading')
    await expect(ed.reading().locator('h2', { hasText: 'Second section' })).toBeInViewport()
    await expect(ed.reading().locator('h1', { hasText: 'Target' })).not.toBeInViewport()
  })

  test('markdown links render and navigate', async ({ app }) => {
    const ed = new MarkdownEditor(app)
    await ed.open('Home.md')
    const link = ed.root().locator('.cm-lp-link', { hasText: 'md link' })
    await expect(link).toHaveClass(/cm-lp-internal/)
    await link.click()
    await expect.poll(() => app.activeFile()).toBe('Target.md')

    await app.openFile('Home.md')
    await app.page.keyboard.press('Control+E')
    await ed.reading().locator('a.internal-link', { hasText: 'md link' }).click()
    await expect.poll(() => app.activeFile()).toBe('Target.md')
  })
})

test.describe('embeds and previews @basic', () => {
  test('heading and image embeds render in live preview and reading view', async ({ app, page }) => {
    const ed = new MarkdownEditor(app)
    await ed.open('Home.md')
    await ed.clickLine('last line')
    const embed = ed.root().locator('.cm-lp-embed-block .markdown-embed')
    await expect(embed.locator('.markdown-embed-title')).toHaveText('Target › Second section')
    await expect(embed.locator('.markdown-embed-content')).toContainText('Embedded section body.')
    await expect(embed.locator('.markdown-embed-content')).not.toContainText('Not part of the embed')
    const img = ed.root().locator('.cm-lp-embed-block img')
    await expect(img).toBeVisible()
    await expect.poll(() => img.evaluate((i: HTMLImageElement) => i.naturalWidth)).toBe(16)

    // the embed title links to the section
    await embed.locator('.markdown-embed-title a').click()
    await expect.poll(() => app.activeFile()).toBe('Target.md')
    await expect(ed.line('Second section')).toBeInViewport()

    await page.locator('.leaf.is-focused button[title="Navigate back"]').click()
    await expect.poll(() => app.activeFile()).toBe('Home.md')
    await page.keyboard.press('Control+E')
    await expect(ed.reading().locator('.internal-embed.markdown-embed .markdown-embed-content')).toContainText('Embedded section body.')
    const rimg = ed.reading().locator('.internal-embed.image-embed img')
    await expect.poll(() => rimg.evaluate((i: HTMLImageElement) => i.naturalWidth)).toBe(16)
  })

  test('Ctrl+hover shows a page preview', async ({ app, page }) => {
    const ed = new MarkdownEditor(app)
    await ed.open('Home.md')
    await ed.clickLine('last line')
    const link = ed.root().locator('.cm-lp-link', { hasText: 'second' })

    // plain hover: no preview
    await link.hover()
    await page.waitForTimeout(300)
    await expect(page.locator('.hover-popover')).toHaveCount(0)

    await page.mouse.move(5, 5)
    await page.keyboard.down('Control')
    await link.hover()
    const pop = page.locator('.hover-popover')
    await expect(pop.locator('.markdown-rendered h2')).toHaveText('Second section')
    await expect(pop).toContainText('Embedded section body.')
    await expect(pop).not.toContainText('Not part of the embed')
    await page.keyboard.up('Control')
    await page.mouse.move(5, 5)
    await expect(pop).toHaveCount(0)

    // unresolved target
    await page.keyboard.down('Control')
    await ed.root().locator('.cm-lp-link', { hasText: 'Missing note' }).hover()
    await expect(pop).toContainText('doesn’t exist yet')
    await page.keyboard.up('Control')
    await page.keyboard.press('Escape')
    await expect(pop).toHaveCount(0)
  })
})

test.describe('link maintenance @basic', () => {
  test('dropping files from the explorer inserts links', async ({ app }) => {
    const ed = new MarkdownEditor(app)
    await ed.open('Home.md')
    await app.treeItem('Folder').click()
    // dropped past the end of a line: the link goes at the end of that line
    await dragFile(app.page, app.treeItem('Folder/Deep.md'), ed.line('last line'), 'end')
    await expectFileText(app, 'Home.md', /\nlast line\[\[Deep\]\]\n$/)
    // images become embeds
    await dragFile(app.page, app.treeItem('pic.png'), ed.line('Tag here'), 'end')
    await expectFileText(app, 'Home.md', /\nTag here: #project\/alpha!\[\[pic\.png\]\]\n/)
  })

  test('renaming a note keeps links to it working', async ({ app, page }) => {
    const ed = new MarkdownEditor(app)
    await ed.open('Home.md')
    await app.contextMenu(app.treeItem('Target.md'), 'Rename...')
    const input = page.locator('.rename-input')
    await expect(input).toBeFocused()
    await input.fill('Goal')
    await input.press('Enter')
    await expect.poll(() => app.exists('Goal.md')).toBe(true)
    expect(app.exists('Target.md')).toBe(false)
    await expectFileText(
      app,
      'Home.md',
      /Links: \[\[Goal\]\] and \[\[Goal#Second section\|second\]\] and \[\[Missing note\]\] and \[md link\]\(Goal\.md\) and .* \[\[Goal#\^blk1\|block\]\]\.\n\n!\[\[Goal#Second section\]\]/
    )
    await expect(page.locator('.notice', { hasText: 'Updated links in 1 file' })).toBeVisible()
    // the open editor picked up the rewritten links and they still resolve
    await ed.clickLine('last line')
    await expect(ed.root().locator('.cm-lp-link', { hasText: /^Goal$/ })).not.toHaveClass(/is-unresolved/)
    await ed.root().locator('.cm-lp-link', { hasText: 'second' }).click()
    await expect.poll(() => app.activeFile()).toBe('Goal.md')
    await expect(ed.line('Second section')).toBeInViewport()
  })
})
