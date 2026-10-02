// Reading view rendering and interactions: callouts, tables, tasks, tags, code blocks, external links.
import type { ElectronApplication } from '@playwright/test'
import { test, expect } from './fixtures'
import { MarkdownEditor, expectFileText } from './helpers/editor'

const RICH = `---
title: Rich
tags: [one]
---
# Rich

> [!tip] Pro tip
> Tip body.

> [!faq]- Folded question
> Hidden answer.

> [!note]+ Open fold
> Visible body.

| Name | Value |
| ---- | ----: |
| a | 1 |
| b | 2 |

- [ ] first task
- [x] done task
- [ ] third task

Tags: #alpha #beta/gamma

\`\`\`js
console.log('copy me')
\`\`\`

[Example site](https://example.com) and https://example.org
`

test.use({ vault: { source: 'empty', files: { 'Rich.md': RICH, 'Other.md': '# Other\n\nalso #alpha\n' } } })

/** Replace shell.openExternal in the main process so tests never launch the system browser. */
async function stubOpenExternal(electronApp: ElectronApplication): Promise<() => Promise<string[]>> {
  await electronApp.evaluate(({ shell }) => {
    const g = globalThis as unknown as { __opened: string[] }
    g.__opened = []
    shell.openExternal = async (url: string) => {
      g.__opened.push(url)
    }
  })
  return () => electronApp.evaluate(() => (globalThis as unknown as { __opened: string[] }).__opened)
}

async function openReading(app: import('./helpers/app').App): Promise<MarkdownEditor> {
  const ed = new MarkdownEditor(app)
  await ed.open('Rich.md')
  await app.page.keyboard.press('Control+E')
  await ed.expectMode('reading')
  return ed
}

test.describe('reading view @basic', () => {
  test('callouts render with titles and foldable ones toggle', async ({ app }) => {
    const ed = await openReading(app)
    const tip = ed.reading().locator('.callout[data-callout="tip"]')
    await expect(tip.locator('.callout-title-inner')).toHaveText('Pro tip')
    await expect(tip.locator('.callout-content')).toHaveText('Tip body.')

    const faq = ed.reading().locator('.callout[data-callout="faq"]')
    await expect(faq).toHaveClass(/is-collapsed/)
    await expect(faq.locator('.callout-content')).toBeHidden()
    await faq.locator('.callout-title').click()
    await expect(faq).not.toHaveClass(/is-collapsed/)
    await expect(faq.locator('.callout-content')).toBeVisible()
    await expect(faq.locator('.callout-content')).toHaveText('Hidden answer.')

    const open = ed.reading().locator('.callout[data-callout="note"]')
    await expect(open.locator('.callout-content')).toBeVisible()
    await open.locator('.callout-title').click()
    await expect(open.locator('.callout-content')).toBeHidden()
    // a non-foldable callout doesn't collapse
    await tip.locator('.callout-title').click()
    await expect(tip.locator('.callout-content')).toBeVisible()
  })

  test('tables and properties render', async ({ app }) => {
    const ed = await openReading(app)
    const table = ed.reading().locator('table')
    await expect(table.locator('thead th')).toHaveText(['Name', 'Value'])
    await expect(table.locator('tbody tr')).toHaveCount(2)
    await expect(table.locator('tbody tr').nth(1).locator('td')).toHaveText(['b', '2'])
    await expect(table.locator('thead th').nth(1)).toHaveCSS('text-align', 'right')
    await expect(ed.reading().locator('.frontmatter-properties .fm-key')).toHaveText(['title', 'tags'])
  })

  test('toggling a task writes the right line to disk', async ({ app }) => {
    const ed = await openReading(app)
    const boxes = ed.reading().locator('input.task-list-item-checkbox')
    await expect(boxes).toHaveCount(3)
    await boxes.nth(2).click()
    await expectFileText(app, 'Rich.md', RICH.replace('- [ ] third task', '- [x] third task'))
    await expect(boxes.nth(2)).toBeChecked()
    await expect(ed.reading().locator('li.task-list-item', { hasText: 'third task' })).toHaveClass(/is-checked/)

    await boxes.nth(1).click()
    await expectFileText(app, 'Rich.md', RICH.replace('- [ ] third task', '- [x] third task').replace('- [x] done task', '- [ ] done task'))
    await expect(boxes.nth(1)).not.toBeChecked()
    await expect(boxes.nth(0)).not.toBeChecked()

    // the editor (hidden while reading) has the same content: back in live preview the checkbox is checked
    await app.page.keyboard.press('Control+E')
    await expect(ed.root().locator('.cm-lp-task input')).toHaveCount(3)
    await expect(ed.root().locator('.cm-lp-task input').nth(2)).toBeChecked()
  })

  test('clicking a tag searches for it', async ({ app, page }) => {
    const ed = await openReading(app)
    await ed.reading().locator('a.tag', { hasText: '#alpha' }).click()
    const input = page.locator('input[placeholder="Search files..."]')
    await expect(input).toBeVisible()
    await expect(input).toHaveValue('#alpha')
    await expect(page.locator('.search-snippet')).toHaveCount(2)
    // the app didn't navigate away from the note
    await expect.poll(() => app.activeFile()).toBe('Rich.md')
  })

  test('code block copy button copies the code', async ({ app, electronApp }) => {
    const ed = await openReading(app)
    await electronApp.evaluate(({ clipboard }) => clipboard.writeText('nothing yet'))
    const block = ed.reading().locator('.code-block[data-lang="js"]')
    await expect(block.locator('.code-block-run')).toHaveText('▶ Run')
    await block.locator('.code-block-copy').click()
    await expect(block.locator('.code-block-copy')).toHaveText('Copied!')
    await expect.poll(() => electronApp.evaluate(({ clipboard }) => clipboard.readText())).toBe("console.log('copy me')")
    await expect(block.locator('.code-block-copy')).toHaveText('Copy')
  })

  test('external links open in the system browser, not in the app', async ({ app, page, electronApp }) => {
    const opened = await stubOpenExternal(electronApp)
    const ed = await openReading(app)
    const url = page.url()
    await ed.reading().locator('a.external-link', { hasText: 'Example site' }).click()
    await expect.poll(opened).toEqual(['https://example.com/'])
    await ed.reading().locator('a.external-link', { hasText: 'https://example.org' }).click()
    await expect.poll(opened).toEqual(['https://example.com/', 'https://example.org/'])
    expect(page.url()).toBe(url)
    expect(electronApp.windows()).toHaveLength(1)
    await expect(ed.reading().locator('h1')).toHaveText('Rich')

    // live preview: clicking a rendered external link
    await page.keyboard.press('Control+E')
    await ed.expectMode('live')
    await ed.root().locator('.cm-lp-external', { hasText: 'Example site' }).click()
    await expect.poll(opened).toHaveLength(3)
    expect((await opened())[2]).toMatch(/^https:\/\/example\.com\/?$/)
    expect(page.url()).toBe(url)
  })
})
