// Form-map lenses end-to-end: inspector (Card / Coach / Map tabs), Board, Table, Doc, HUD and selection sync
// (ported from e2e/formmap-lenses.mjs). Asserts on the UI and on the .formmap JSON on disk.
import { test, expect } from './fixtures'
import type { Locator } from '@playwright/test'
import type { App } from './helpers/app'
import { center, type CData } from './helpers/canvas'
import { FormMapPage, formByTitle, forms, zoneByLabel, zoneOf, zones, type FormCard } from './helpers/formmap'

/** the right sidebar is collapsed so the lenses get more room */
async function openDefinition(app: App): Promise<FormMapPage> {
  await app.page.locator('[title^="Toggle right sidebar"]').click()
  await expect.poll(() => app.state<boolean>('workspace', '(s) => s.right.open')).toBe(false)
  const m = new FormMapPage(app)
  await m.open()
  return m
}

const cardIn = (d: CData, id: string): FormCard => d.nodes.find((n) => n.id === id) as FormCard

/** drag a board card by the mouse onto a column body */
async function dragToColumn(m: FormMapPage, card: Locator, column: Locator): Promise<void> {
  await card.scrollIntoViewIfNeeded()
  const a = (await card.boundingBox())!
  await column.scrollIntoViewIfNeeded()
  const b = (await column.locator('.fm-col-body').boundingBox())!
  await m.drag({ x: a.x + a.width / 2, y: a.y + 14 }, { x: b.x + b.width / 2, y: b.y + Math.min(60, b.height / 2) }, { steps: 14, hold: true })
  await expect(column).toHaveClass(/is-drop-target/)
  await m.page.mouse.up()
}

test.describe('form-map lenses @basic', () => {
  test('inspector Card tab edits kind, title, body, every field type, votes, relations and Why?', async ({ app, page }) => {
    const m = await openDefinition(app)
    const d0 = m.data()
    const card = formByTitle(d0, 'Idea panel')
    const at = (fn: (f: FormCard) => unknown, msg: string): Promise<void> => m.expectData((d) => fn(cardIn(d, card.id)), msg)
    const insp = m.insp()
    const row = (label: string): Locator => insp.locator('.fm-i-row', { has: page.locator('.fm-i-label', { hasText: new RegExp(`^${label}$`) }) })

    await m.lens('Board')
    await m.boardCard('Idea panel').click()
    await expect(insp.locator('.fm-i-title')).toHaveValue('Idea panel')
    await expect(insp.locator('.fm-i-zoneline')).toContainText('Initial features (MVP)')

    // kind switch (fields of other kinds are kept)
    await insp.locator('.fm-i-kinds .fm-kchip', { hasText: '💡' }).click()
    await at((f) => f.kind === 'idea' && f.fields.phase === 'mvp', 'kind → idea')
    await expect(row('Status').locator('.fm-opt-chip')).toHaveText(['Raw', 'Refined', 'Merged', 'Dropped'])
    await insp.locator('.fm-i-kinds .fm-kchip', { hasText: '✨' }).click()
    await at((f) => f.kind === 'feature', 'kind → feature')

    // title + body (markdown preview)
    await insp.locator('.fm-i-title').fill('Idea panel 2')
    await at((f) => f.title === 'Idea panel 2', 'title')
    const notes = insp.locator('.fm-i-section', { has: page.locator('.fm-i-section-head', { hasText: 'Notes' }) })
    await notes.locator('textarea').fill('Dump ideas **fast**')
    await at((f) => f.text === 'Dump ideas **fast**', 'body')
    await notes.locator('button[title="Preview markdown"]').click()
    await expect(notes.locator('.fm-i-preview strong')).toHaveText('fast')

    // select (click again to clear) + rating
    await row('Priority').locator('.fm-opt-chip', { hasText: 'Could' }).click()
    await at((f) => f.fields.priority === 'could', 'priority could')
    await row('Priority').locator('.fm-opt-chip', { hasText: 'Could' }).click()
    await at((f) => f.fields.priority === undefined, 'priority cleared')
    await row('Fun factor').locator('.fm-rating-star').nth(2).click()
    await at((f) => f.fields.fun === 3, 'fun 3')
    await expect(row('Fun factor').locator('.fm-rating-star.is-on')).toHaveCount(3)

    // checklist: add, toggle, reorder
    const add = insp.locator('.fm-cl-add')
    await add.fill('Can dump an idea in under 3 seconds')
    await add.press('Enter')
    await add.fill('Ideas survive a restart')
    await add.press('Enter')
    await at((f) => (f.fields.acceptance as unknown[])?.length === 2, 'two criteria')
    const items = insp.locator('.fm-cl-item')
    await items.nth(0).locator('input[type="checkbox"]').check()
    await at((f) => (f.fields.acceptance as { done: boolean }[])[0].done, 'first done')
    await expect(insp.locator('.fm-cl-progress')).toContainText('1/2')
    await items.nth(0).locator('button[title^="Move down"]').click()
    await at(
      (f) => JSON.stringify(f.fields.acceptance) === JSON.stringify([{ text: 'Ideas survive a restart', done: false }, { text: 'Can dump an idea in under 3 seconds', done: true }]),
      'reordered'
    )
    await items.nth(1).locator('.fm-cl-text').press('Alt+ArrowUp')
    await at((f) => (f.fields.acceptance as { text: string }[])[0].text === 'Can dump an idea in under 3 seconds', 'Alt+↑ reorders back')

    // link field (opening it is checked at the end: it leaves the tab)
    await row('Linked note').locator('input').fill('[[Welcome]]')
    await at((f) => f.fields.note === '[[Welcome]]', 'link saved')

    // votes
    await insp.locator('.fm-i-vote').click()
    await insp.locator('.fm-i-vote').click()
    await insp.locator('button[title="Remove a vote"]').click()
    await at((f) => f.votes === 8, 'votes 7 + 2 - 1')
    await expect(insp.locator('.fm-i-dots')).toHaveAttribute('aria-label', '8 votes')

    // relations: add via the picker (relation inferred), remove
    await insp.locator('.fm-i-addbtn', { hasText: 'Add relation' }).click()
    await page.keyboard.type('every ounce')
    await expect(insp.locator('.fm-relpick-item.is-active')).toContainText('Every ounce of AI ability')
    await expect(insp.locator('.fm-relpick-item.is-active .fm-relpick-verb')).toHaveText('serves')
    await page.keyboard.press('Enter')
    const goal = formByTitle(d0, 'Every ounce of AI ability')
    await m.expectData((d) => d.edges.some((e) => e.fromNode === card.id && e.toNode === goal.id && e.relation === 'serves'), 'relation added')
    const served = insp.locator('.fm-rel-item', { hasText: 'Every ounce of AI ability' })
    await expect(served).toBeVisible()
    await served.hover()
    await served.locator('.fm-rel-remove').click()
    await m.expectData((d) => !d.edges.some((e) => e.fromNode === card.id && e.toNode === goal.id), 'relation removed')

    // Why? highlights the chain (also dims the board), click again clears
    await insp.locator('.fm-i-why').click()
    await expect(insp.locator('.fm-insp-hl')).toContainText('Highlighting')
    await expect(insp.locator('.fm-i-why')).toHaveText(/Clear why/)
    await expect(m.boardCard('Plan screen')).toHaveClass(/is-dim/)
    await insp.locator('.fm-i-why').click()
    await expect(insp.locator('.fm-insp-hl')).toHaveCount(0)

    // clicking a relation reveals the other card in the map
    await insp.locator('.fm-rel-item', { hasText: 'Bring the fun back' }).click()
    await expect(m.lensButton('Map')).toHaveAttribute('aria-selected', 'true')
    await expect(m.card(formByTitle(d0, 'Bring the fun back').id)).toHaveClass(/fm-pulse/)

    // the link field opens its note (Ctrl = new tab)
    await row('Linked note').locator('button[title^="Open note"]').click({ modifiers: ['Control'] })
    await expect.poll(() => app.activeFile()).toBe('Welcome.md')
    expect((await app.layout())[0].tabs.map((t) => t.path)).toEqual(['CS2D3K Definition.formmap', 'Welcome.md'])
  })

  test('zone settings in the inspector', async ({ app, page }) => {
    const m = await openDefinition(app)
    const zone = zoneByLabel(m.data(), 'Open questions')
    const at = (fn: (z: Record<string, unknown>) => unknown, msg: string): Promise<void> => m.expectData((d) => fn(d.nodes.find((n) => n.id === zone.id)!), msg)
    const insp = m.insp()
    const row = (label: string): Locator => insp.locator('.fm-i-row', { has: page.locator('.fm-i-label', { hasText: new RegExp(`^${label}$`) }) })
    // select the zone from the Map tab navigator (double-click), then edit it in the Card tab
    await m.openInspectorTab('Map')
    await insp.locator('.fm-znav-item', { hasText: 'Open questions' }).dblclick()
    await m.openInspectorTab('Card')
    await expect(insp.locator('.fm-i-zone-count')).toHaveText('4 cards inside')

    await insp.locator('.fm-i-title').fill('Open questions & risks')
    await at((z) => z.label === 'Open questions & risks', 'label')
    await expect(m.node(zone.id).locator('.fm-zone-label')).toHaveText('Open questions & risks')
    await row('Emoji').locator('.fm-i-emoji-btn', { hasText: '🧪' }).click()
    await at((z) => z.emoji === '🧪', 'emoji')
    await row('Prompt').locator('textarea').fill('What could still go wrong?')
    await at((z) => z.prompt === 'What could still go wrong?', 'prompt')
    await row('Assigns').locator('.fm-opt-chip', { hasText: 'Parked' }).click()
    await at((z) => JSON.stringify(z.assign) === '{"status":"parked"}', 'assign')
    await row('New cards').locator('.fm-kchip').first().click()
    await at((z) => z.defaultKind === 'idea', 'default kind')
    await row('Pitch order').locator('input').fill('9')
    await at((z) => z.order === 9, 'order')
    await row('Locked').locator('[role="switch"]').click()
    await at((z) => z.locked === false, 'unlocked')
    await expect(m.node(zone.id)).toHaveClass(/is-unlocked/)
  })

  test('multi-select bulk edit', async ({ app, page }) => {
    const m = await openDefinition(app)
    const d = m.data()
    const a = formByTitle(d, 'Idea panel')
    const b = formByTitle(d, 'Task queue panel')
    await m.lens('Board')
    await m.boardCard('Idea panel').click()
    await m.boardCard('Task queue panel').click({ modifiers: ['Control'] })
    const insp = m.insp()
    await expect(insp.locator('.fm-i-multi-head')).toHaveText('2 cards selected')
    await expect(insp.locator('.fm-insp-tab', { hasText: 'Card' }).locator('.fm-insp-badge')).toHaveText('2')
    const row = (label: string): Locator => insp.locator('.fm-i-row', { has: page.locator('.fm-i-label', { hasText: new RegExp(`^${label}$`) }) })
    await expect(row('Effort').locator('.fm-i-mixed')).toHaveText('mixed')
    await expect(row('Priority').locator('.fm-opt-chip.is-active')).toHaveText('Must')
    await row('Priority').locator('.fm-opt-chip', { hasText: 'Could' }).click()
    await m.expectData((x) => cardIn(x, a.id).fields.priority === 'could' && cardIn(x, b.id).fields.priority === 'could', 'both could')
    await row('Effort').locator('.fm-opt-chip', { hasText: 'XS' }).click()
    await m.expectData((x) => cardIn(x, a.id).fields.effort === 'xs' && cardIn(x, b.id).fields.effort === 'xs', 'both xs')
    await expect(row('Effort').locator('.fm-i-mixed')).toHaveCount(0)
    // Ctrl+click again removes a card from the selection
    await m.boardCard('Task queue panel').click({ modifiers: ['Control'] })
    await expect(insp.locator('.fm-i-title')).toHaveValue('Idea panel')
  })

  test('Coach tab: checks for the sample, reveal on click, budget editing', async ({ app, page }) => {
    const m = await openDefinition(app)
    const d = m.data()
    const insp = m.insp()
    await expect(m.inspTab('Coach').locator('.fm-insp-badge.is-warn')).toHaveText('1')
    await m.openInspectorTab('Coach')
    await expect(insp.locator('.fm-check-title')).toHaveText([
      '4 open questions',
      '2 principles nobody relies on',
      '2 approaches still proposed',
      '6 MVP features without acceptance criteria',
      '3 raw ideas waiting in the inbox',
      'Every feature serves a goal',
      'Every goal has features serving it',
      'MVP fits the budget (21 / 24 pts)'
    ])
    await expect(insp.locator('.fm-check', { hasText: 'principles nobody relies on' }).locator('.fm-check-detail')).toContainText("“1. Don't read all the agent's code”, “6. Prompts are code”")
    await expect(insp.locator('.fm-coach-mood-title')).toHaveText('A few things to decide')
    await expect(insp.locator('.fm-coach-points').first()).toContainText('21')

    // clicking a check highlights and reveals its cards on the map
    const questions = forms(d).filter((f) => f.kind === 'question')
    await insp.locator('.fm-check', { hasText: '4 open questions' }).click()
    await expect(insp.locator('.fm-insp-hl')).toContainText('Highlighting 4 cards')
    await expect(insp.locator('.fm-check', { hasText: '4 open questions' })).toHaveClass(/is-active/)
    for (const q of questions) await expect(m.card(q.id)).toHaveClass(/fm-lit/)
    await expect(m.root().locator('.fm-node-form.fm-dim')).toHaveCount(forms(d).length - 4)
    await expect(m.card(questions[0].id)).toHaveClass(/fm-pulse/)

    // the MVP budget is editable: 21 points over a 20-point budget is a warning
    await insp.locator('.fm-coach-budget').fill('20')
    await m.expectData((x) => (x.formmap as { mvpBudget?: number }).mvpBudget === 20, 'budget saved')
    await expect(insp.locator('.fm-check.is-warn .fm-check-title')).toHaveText(['MVP is over budget: 21 / 20 pts', '4 open questions'])
    await expect(insp.locator('.fm-budget')).toHaveClass(/is-over/)
    await expect(m.inspTab('Coach').locator('.fm-insp-badge.is-warn')).toHaveText('2')
    // clicking the active check again clears the highlight; kind tiles focus the map on one kind
    await insp.locator('.fm-check', { hasText: '4 open questions' }).click()
    await expect(insp.locator('.fm-insp-hl')).toHaveCount(0)
    await insp.locator('.fm-kind-tile', { hasText: 'Goals' }).click()
    await expect(m.root().locator('.fm-banner')).toContainText('Focus · Goals')
    await expect(insp.locator('.fm-kind-tile', { hasText: 'Goals' })).toContainText('3')
  })

  test('Map tab: navigator, focus chips and Spark', async ({ app, page }) => {
    const m = await openDefinition(app)
    const d = m.data()
    const insp = m.insp()
    await m.openInspectorTab('Map')
    // title meta
    await insp.locator('.fm-i-row', { hasText: 'Title' }).locator('input').fill('CS2D3K — the definition')
    await m.expectData((x) => (x.formmap as { title?: string }).title === 'CS2D3K — the definition', 'title meta')

    // navigator: zones in pitch order, card counts; click reveals
    const nav = insp.locator('.fm-znav-item')
    await expect(nav.locator('.fm-znav-label')).toHaveText(['Core idea', 'Philosophy', 'Engineering approach', 'Final goal', 'Initial features (MVP)', 'Later features', 'Open questions', 'Idea inbox'])
    await expect(nav.filter({ hasText: 'Philosophy' }).locator('.fm-znav-count')).toHaveText('11')
    const later = zoneByLabel(d, 'Later features')
    await m.moveCamera(() => nav.filter({ hasText: 'Later features' }).click())
    const c = await m.toWorld(center(await m.rootBox()))
    expect(Math.abs(c.x - (later.x + later.width / 2))).toBeLessThan(40)
    expect(Math.abs(c.y - (later.y + later.height / 2))).toBeLessThan(40)

    // focus chips
    const focus = insp.locator('.fm-i-section', { has: page.locator('.fm-i-section-head', { hasText: 'Focus' }) })
    await focus.locator('.fm-kchip', { hasText: 'Question' }).click()
    await expect(m.root().locator('.fm-node-form:not(.fm-dim)')).toHaveCount(4)
    await focus.locator('.fm-kchip', { hasText: 'Goal' }).click()
    await expect(m.root().locator('.fm-node-form:not(.fm-dim)')).toHaveCount(7)
    await focus.locator('.fm-i-textbtn', { hasText: 'Clear' }).click()
    await expect(m.root().locator('.fm-dim')).toHaveCount(0)

    // Spark: a provocative prompt lands as a raw idea in the inbox, selected and revealed
    await insp.locator('.fm-spark-btn').click()
    // revealed (the pulse lasts ~1.5s) and selected in the map
    await expect(m.root().locator('.canvas-node.fm-pulse.is-selected')).toHaveCount(1)
    let spark: FormCard | undefined
    await m.expectData((x) => (spark = forms(x).find((f) => f.fields.source === 'Spark ✨')), 'spark card')
    const x = m.data()
    expect(spark!).toMatchObject({ kind: 'idea', fields: { status: 'raw' } })
    expect(zoneOf(x, spark!)?.label).toBe('Idea inbox')
    await expect(insp.locator('.fm-spark-text')).toHaveText(`“${spark!.title}”`)
    await expect(m.card(spark!.id)).toHaveClass(/is-selected/)
  })

  test('Board: group-by, sorting, drags between columns and quick-add', async ({ app, page }) => {
    const m = await openDefinition(app)
    const d = m.data()
    await page.keyboard.press('Alt+2')
    await expect(m.fmRoot().locator('.fm-board')).toBeVisible()
    const titles = (col: string): Promise<string[]> => m.column(col).locator('.fm-bcard-title').allInnerTexts()
    const seg = (label: string): Locator => m.fmRoot().locator('.fm-seg button', { hasText: label })

    // phase columns
    await expect(m.fmRoot().locator('.fm-col .fm-col-label')).toHaveText(['Initial (MVP)', 'Next', 'Later', 'Someday'])
    await expect(m.column('mvp').locator('.fm-col-count')).toHaveText('6')
    await expect(m.column('mvp').locator('.fm-col-pts')).toHaveText('21/24 pts')
    await expect(m.column('later').locator('.fm-col-count')).toHaveText('4')

    // sorting
    await seg('Votes').click()
    expect(await titles('mvp')).toEqual(['Form-map definition board', 'Idea panel', 'Task queue panel', 'Review panel', 'Dev agent panel', 'Project workspace'])
    await seg('Fun').click()
    expect(await titles('mvp')).toEqual(['Idea panel', 'Form-map definition board', 'Task queue panel', 'Dev agent panel', 'Review panel', 'Project workspace'])
    await seg('Map order').click()
    expect(await titles('mvp')).toEqual(['Idea panel', 'Task queue panel', 'Dev agent panel', 'Review panel', 'Project workspace', 'Form-map definition board'])

    // other groupings
    await seg('Status').click()
    await expect(m.fmRoot().locator('.fm-col .fm-col-label')).toHaveText(['Idea', 'Planned', 'Building', 'Done', 'Cut'])
    await expect(m.column('planned').locator('.fm-col-count')).toHaveText('5')
    await seg('Kind').click()
    await expect(m.fmRoot().locator('.fm-col')).toHaveCount(7)
    await expect(m.column('principle').locator('.fm-col-count')).toHaveText('11')
    await seg('Zone').click()
    await expect(m.fmRoot().locator('.fm-col')).toHaveCount(9)
    await expect.poll(() => page.evaluate(() => (window.__cs2d3k!.getActiveTab()?.state?.board as { group?: string })?.group)).toBe('zone')

    // drag between phase columns sets the field (and moves the card into the matching zone)
    await seg('Phase').click()
    const plan = formByTitle(d, 'Plan screen')
    await dragToColumn(m, m.boardCard('Plan screen'), m.column('mvp'))
    await m.expectData((x) => {
      const f = cardIn(x, plan.id)
      return f.fields.phase === 'mvp' && zoneOf(x, f)?.label === 'Initial features (MVP)'
    }, 'phase mvp + moved into the MVP zone')
    await expect(m.column('mvp').locator('.fm-col-count')).toHaveText('7')

    // zone grouping moves the card geometrically
    await seg('Zone').click()
    const oq = zoneByLabel(d, 'Open questions')
    const voice = formByTitle(d, 'Voice capture')
    await dragToColumn(m, m.boardCard('Voice capture'), m.column(oq.id))
    await m.expectData((x) => zoneOf(x, cardIn(x, voice.id))?.id === oq.id, 'moved into Open questions')
    expect(cardIn(m.data(), voice.id).kind).toBe('idea')

    // quick-add in a zone column
    const inbox = zoneByLabel(d, 'Idea inbox')
    await m.column(inbox.id).scrollIntoViewIfNeeded()
    await m.column(inbox.id).locator('.fm-col-addrow').click()
    await page.keyboard.type('Achievements for shipped MVPs')
    await page.keyboard.press('Enter')
    await page.keyboard.press('Escape')
    await expect(m.column(inbox.id).locator('.fm-quickadd')).toHaveCount(0)
    let added: FormCard | undefined
    await m.expectData((x) => (added = forms(x).find((f) => f.title === 'Achievements for shipped MVPs')), 'quick-added')
    expect(added!.kind).toBe('idea')
    expect(zoneOf(m.data(), added!)?.id).toBe(inbox.id)
    await expect(m.boardCard('Achievements for shipped MVPs')).toHaveClass(/is-selected/)
  })

  test('Table: kind tabs, sorting, inline edits and add row', async ({ app, page }) => {
    const m = await openDefinition(app)
    const d = m.data()
    await page.keyboard.press('Alt+3')
    const table = m.fmRoot().locator('.fm-table-lens')
    await expect(table).toBeVisible()
    await expect(table.locator('.fm-tab', { hasText: 'All' }).locator('.fm-tab-count')).toHaveText(String(forms(d).length))
    await expect(table.locator('tbody tr')).toHaveCount(forms(d).length)
    await table.locator('.fm-tab', { hasText: 'Features' }).click()
    await expect(table.locator('tbody tr')).toHaveCount(10)
    await expect(table.locator('thead th')).toHaveText(['Kind', 'Title', 'Phase', 'Priority', 'Effort', 'Status', 'Fun factor', 'Acceptance criteria', 'Linked note', 'Zone', 'Votes', 'Links'])

    // sorting: votes (biggest first), then ascending, then off
    const votesTh = table.locator('th', { hasText: 'Votes' })
    await votesTh.click()
    await expect(votesTh).toHaveAttribute('aria-sort', 'descending')
    await expect(table.locator('tbody tr').first().locator('.fm-cell-title')).toHaveText('Form-map definition board')
    await votesTh.click()
    await expect(votesTh).toHaveAttribute('aria-sort', 'ascending')
    await expect(table.locator('tbody tr').last().locator('.fm-cell-title')).toHaveText('Form-map definition board')
    await votesTh.click()
    await expect(votesTh).toHaveAttribute('aria-sort', 'none')

    // inline title edit
    const ath = formByTitle(d, 'Agentic test harness')
    await m.row('Agentic test harness').locator('.fm-cell-title').dblclick()
    await page.keyboard.press('Control+a')
    await page.keyboard.type('Agentic test harness v2')
    await page.keyboard.press('Enter')
    await m.expectData((x) => cardIn(x, ath.id).title === 'Agentic test harness v2', 'title edited')
    // select cell via its option menu
    await m.row('Agentic test harness v2').locator('td.is-select').nth(1).locator('.fm-opt-chip').click()
    await page.locator('.menu-item', { hasText: 'Must' }).click()
    await m.expectData((x) => cardIn(x, ath.id).fields.priority === 'must', 'priority edited')
    // rating cell
    await m.row('Agentic test harness v2').locator('td.is-rating .fm-rating-star').nth(4).click()
    await m.expectData((x) => cardIn(x, ath.id).fields.fun === 5, 'fun edited')

    // add a row: a new feature lands in the MVP zone and its title is edited inline
    await table.locator('.fm-table-add').click()
    await expect(table.locator('.fm-cell-input')).toBeFocused()
    await page.keyboard.type('Table-made feature')
    await page.keyboard.press('Enter')
    let made: FormCard | undefined
    await m.expectData((x) => (made = forms(x).find((f) => f.title === 'Table-made feature')), 'row added')
    expect(made!).toMatchObject({ kind: 'feature', fields: { phase: 'mvp' } })
    await expect(table.locator('tbody tr')).toHaveCount(11)
  })

  test('Doc: generated sections in order, copy markdown, export to a note', async ({ app, page, electronApp }) => {
    const m = await openDefinition(app)
    await page.keyboard.press('Alt+4')
    const doc = m.fmRoot().locator('.fm-doc')
    await expect(doc.locator('.fm-doc-md h1')).toHaveText('CS2D3K Definition')
    await expect(doc.locator('.fm-doc-md h2')).toHaveText(['Core idea', 'Philosophy', 'Engineering approach', 'Final goal', 'Initial features (MVP)', 'Later features', 'Open questions', 'Decisions', 'Idea inbox'])
    await expect(doc.locator('.fm-doc-md h3', { hasText: 'ADR-01' })).toBeVisible()

    await doc.locator('button', { hasText: 'Copy markdown' }).click()
    await expect(doc.locator('button', { hasText: 'Copied' })).toBeVisible()
    // (the system clipboard uses CRLF on Windows)
    const md = (await electronApp.evaluate(({ clipboard }) => clipboard.readText())).replace(/\r\n/g, '\n')
    expect(md.startsWith('# CS2D3K Definition\n')).toBe(true)
    expect(md).toContain('## Philosophy')

    await doc.locator('.fm-doc-export').click()
    const input = page.locator('.modal .input')
    await expect(input).toHaveValue('CS2D3K Definition - Definition.md')
    await page.locator('.modal .btn.mod-cta').click()
    await app.expectFile('CS2D3K Definition - Definition.md', (s) => s === md, 'exported note')
    await m.expectData((x) => (x.formmap as { exportPath?: string }).exportPath === 'CS2D3K Definition - Definition.md', 'exportPath recorded')
    await expect(doc.locator('.fm-doc-bar-time')).toHaveText('Exported just now')
    await expect(doc.locator('.fm-doc-bar-path')).toContainText('CS2D3K Definition - Definition.md')
    // the next export writes straight to the recorded path (no prompt)
    app.removeExternal('CS2D3K Definition - Definition.md')
    await expect.poll(() => app.exists('CS2D3K Definition - Definition.md')).toBe(false)
    await doc.locator('.fm-doc-export').click()
    await expect(page.locator('.modal')).toHaveCount(0)
    await app.expectFile('CS2D3K Definition - Definition.md', (s) => s.includes('## Idea inbox'), 're-exported')
  })

  test('the HUD numbers match the data', async ({ app, page }) => {
    const m = await openDefinition(app)
    const d = m.data()
    const all = forms(d)
    const mvp = all.filter((f) => f.kind === 'feature' && f.fields.phase === 'mvp')
    const open = all.filter((f) => f.kind === 'question' && (!f.fields.status || f.fields.status === 'open'))
    const decided = all.filter((f) => (f.kind === 'question' && f.fields.status === 'decided') || (f.kind === 'approach' && f.fields.status === 'accepted'))
    const votes = all.reduce((s, f) => s + (f.votes ?? 0), 0)
    const hud = m.root().locator('.fm-hud')
    const stat = (cap: string): Locator => hud.locator('.fm-hud-stat', { hasText: cap }).locator('b')
    await expect(hud.locator('.fm-hud-title')).toHaveText(`MVP 0/${mvp.length} done`)
    await expect(hud.locator('.fm-hud-ring-label')).toHaveText('0%')
    await expect(stat('open')).toHaveText(String(open.length))
    await expect(stat('decided')).toHaveText(String(decided.length))
    await expect(stat('votes')).toHaveText(String(votes))
    expect([mvp.length, open.length, decided.length, votes]).toEqual([6, 4, 4, 33])

    // decide a question and finish a feature from the inspector: the HUD follows
    const insp = m.insp()
    const row = (label: string): Locator => insp.locator('.fm-i-row', { has: page.locator('.fm-i-label', { hasText: new RegExp(`^${label}$`) }) })
    await m.clickCard(open[0].id)
    await row('Status').locator('.fm-opt-chip', { hasText: 'Decided' }).click()
    await expect(stat('open')).toHaveText('3')
    await expect(stat('decided')).toHaveText('5')
    await m.clickCard(mvp[0].id)
    await row('Status').locator('.fm-opt-chip', { hasText: 'Done' }).click()
    await expect(hud.locator('.fm-hud-title')).toHaveText('MVP 1/6 done')
    await expect(hud.locator('.fm-hud-ring-label')).toHaveText('17%')
    // clicking a stat highlights those cards
    await hud.locator('.fm-hud-stat', { hasText: 'open' }).click()
    await expect(m.root().locator('.fm-node-form.fm-lit')).toHaveCount(3)
  })

  test('the selection is shared across lenses', async ({ app, page }) => {
    const m = await openDefinition(app)
    const d = m.data()
    const review = formByTitle(d, 'Review panel')
    const plan = formByTitle(d, 'Plan screen')
    await m.clickCard(review.id)
    await expect(m.insp().locator('.fm-i-title')).toHaveValue('Review panel')
    await page.keyboard.press('Alt+2')
    await expect(m.fmRoot().locator('.fm-bcard.is-selected .fm-bcard-title')).toHaveText(['Review panel'])
    await page.keyboard.press('Alt+3')
    await expect(m.fmRoot().locator('tbody tr.is-selected .fm-cell-title')).toHaveText(['Review panel'])
    await m.row('Plan screen').locator('td').last().click()
    await expect(m.fmRoot().locator('tbody tr.is-selected .fm-cell-title')).toHaveText(['Plan screen'])
    await page.keyboard.press('Alt+1')
    await expect(m.card(plan.id)).toHaveClass(/is-selected/)
    await expect(m.card(review.id)).not.toHaveClass(/is-selected/)
    await page.keyboard.press('Alt+4')
    await expect(m.insp().locator('.fm-i-title')).toHaveValue('Plan screen')
    // selecting on the map updates the board too
    await page.keyboard.press('Alt+1')
    await m.clickCard(review.id, { modifiers: ['Shift'] })
    await page.keyboard.press('Alt+2')
    await expect(m.fmRoot().locator('.fm-bcard.is-selected')).toHaveCount(2)
    expect(zones(d)).toHaveLength(8)
  })
})
