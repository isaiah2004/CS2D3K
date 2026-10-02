// Form-map lenses end-to-end: inspector (Card / Coach / Map tabs), Board (saved boards), Table, Doc, HUD and selection
// sync. Asserts on the UI and on the .formmap JSON on disk.
import { test, expect } from './fixtures'
import type { Locator } from '@playwright/test'
import type { App } from './helpers/app'
import { center, type CData } from './helpers/canvas'
import { boardByName, FormMapPage, formByTitle, forms, groupByLabel, groupOf, groups, meta, type FormCard } from './helpers/formmap'

/** the right sidebar is collapsed so the lenses get more room */
async function openDefinition(app: App): Promise<FormMapPage> {
  await app.page.locator('[title^="Toggle right sidebar"]').click()
  await expect.poll(() => app.state<boolean>('workspace', '(s) => s.right.open')).toBe(false)
  const m = new FormMapPage(app)
  await m.open()
  return m
}

const cardIn = (d: CData, id: string): FormCard => d.nodes.find((n) => n.id === id) as FormCard

/** drag a board card by the mouse onto a column, above the card at `index` (default: the column body top) */
async function dragToColumn(m: FormMapPage, card: Locator, column: Locator, before?: Locator): Promise<void> {
  await card.scrollIntoViewIfNeeded()
  const a = (await card.boundingBox())!
  await column.scrollIntoViewIfNeeded()
  let to: { x: number; y: number }
  if (before) {
    const b = (await before.boundingBox())!
    to = { x: b.x + b.width / 2, y: b.y + 6 }
  } else {
    const b = (await column.locator('.fm-col-body').boundingBox())!
    to = { x: b.x + b.width / 2, y: b.y + Math.min(60, b.height / 2) }
  }
  await m.drag({ x: a.x + a.width / 2, y: a.y + 14 }, to, { steps: 14, hold: true })
  await expect(column).toHaveClass(/is-drop-target/)
  await m.page.mouse.up()
}

const rowOf = (insp: Locator, label: string): Locator => insp.locator('.fm-i-row', { has: insp.page().locator('.fm-i-label', { hasText: new RegExp(`^${label}$`) }) })

test.describe('form-map inspector @basic', () => {
  test('Card tab: title, body, tags, fields (from the registry or new), checklist, link, votes, relations and Why?', async ({ app, page }) => {
    const m = await openDefinition(app)
    const d0 = m.data()
    const card = formByTitle(d0, 'Idea panel')
    const at = (fn: (f: FormCard) => unknown, msg: string): Promise<void> => m.expectData((d) => fn(cardIn(d, card.id)), msg)
    const insp = m.insp()
    const row = (label: string): Locator => rowOf(insp, label)

    await m.lens('Board')
    await m.boardCard('Idea panel').click()
    await expect(insp.locator('.fm-i-title')).toHaveValue('Idea panel')
    await expect(insp.locator('.fm-i-zoneline')).toContainText('Initial features (MVP)')

    // tags: add an existing one from the menu, remove it with ×
    await expect(insp.locator('.fm-i-tags .fm-tag')).toHaveText(['#feature×'])
    await insp.locator('.fm-i-addtag').click()
    await page.locator('.menu-item', { hasText: '#goal' }).click()
    await at((f) => f.tags?.join() === 'feature,goal', 'tag added')
    await insp.locator('.fm-i-tags .fm-tag', { hasText: 'goal' }).locator('.fm-tag-x').click()
    await at((f) => f.tags?.join() === 'feature', 'tag removed')

    // title + body (markdown preview)
    await insp.locator('.fm-i-title').fill('Idea panel 2')
    await at((f) => f.title === 'Idea panel 2', 'title')
    const notes = insp.locator('.fm-i-section', { has: page.locator('.fm-i-section-head', { hasText: 'Notes' }) })
    await notes.locator('textarea').fill('Dump ideas **fast**')
    await at((f) => f.text === 'Dump ideas **fast**', 'body')
    await notes.locator('button[title="Preview markdown"]').click()
    await expect(notes.locator('.fm-i-preview strong')).toHaveText('fast')

    // the fields the card has, in registry order; select (click again to clear) + rating
    await expect(insp.locator('.fm-i-fields .fm-i-label')).toHaveText(['Phase', 'Priority', 'Effort', 'Status', 'Fun factor'])
    // the status options offered are the feature ones (option scopes)
    await expect(row('Status').locator('.fm-opt-chip')).toHaveText(['Idea', 'Planned', 'Building', 'Done', 'Cut'])
    await row('Priority').locator('.fm-opt-chip', { hasText: 'Could' }).click()
    await at((f) => f.fields.priority === 'could', 'priority could')
    await row('Priority').locator('.fm-opt-chip', { hasText: 'Could' }).click()
    await at((f) => f.fields.priority === undefined, 'priority cleared')
    await row('Fun factor').locator('.fm-rating-star').nth(2).click()
    await at((f) => f.fields.fun === 3, 'fun 3')

    // add a field of the map: a checklist
    await insp.locator('.fm-i-addbtn', { hasText: 'Add field' }).click()
    await insp.locator('.fm-i-fieldchip', { hasText: 'Acceptance criteria' }).click()
    const add = insp.locator('.fm-cl-add')
    await add.fill('Can dump an idea in under 3 seconds')
    await add.press('Enter')
    await add.fill('Ideas survive a restart')
    await add.press('Enter')
    await at((f) => (f.fields.acceptance as unknown[])?.length === 2, 'two items')
    const items = insp.locator('.fm-cl-item')
    await items.nth(0).locator('input[type="checkbox"]').check()
    await at((f) => (f.fields.acceptance as { done: boolean }[])[0].done, 'first done')
    await expect(insp.locator('.fm-cl-progress')).toContainText('1/2')
    await items.nth(0).locator('button[title^="Move down"]').click()
    await at((f) => (f.fields.acceptance as { text: string }[])[0].text === 'Ideas survive a restart', 'reordered')

    // a brand-new field: registered and set
    await insp.locator('.fm-i-addbtn', { hasText: 'Add field' }).click()
    await insp.locator('input[aria-label="New field name"]').fill('Owner')
    await insp.locator('select[aria-label="New field type"]').selectOption('text')
    await insp.locator('.fm-i-newfield .btn', { hasText: 'Add' }).click()
    await row('Owner').locator('input').fill('Ana')
    await m.expectData((d) => cardIn(d, card.id).fields.Owner === 'Ana' && meta(d).fields?.Owner?.type === 'text', 'new field registered + set')

    // link field (opening it is checked at the end: it leaves the tab)
    await insp.locator('.fm-i-addbtn', { hasText: 'Add field' }).click()
    await insp.locator('.fm-i-fieldchip', { hasText: 'Linked note' }).click()
    await row('Linked note').locator('input').fill('[[Welcome]]')
    await at((f) => f.fields.note === '[[Welcome]]', 'link saved')

    // remove a field from the card
    await row('Owner').hover()
    await row('Owner').locator('.fm-i-row-x').click()
    await at((f) => !('Owner' in f.fields), 'field removed')
    await expect(row('Owner')).toHaveCount(0)

    // votes
    await insp.locator('.fm-i-vote').click()
    await insp.locator('.fm-i-vote').click()
    await insp.locator('button[title="Remove a vote"]').click()
    await at((f) => f.votes === 8, 'votes 7 + 2 - 1')
    await expect(insp.locator('.fm-i-dots')).toHaveAttribute('aria-label', '8 votes')

    // relations: add via the picker (relation from the tag rules), remove
    await insp.locator('.fm-i-addbtn', { hasText: 'Add relation' }).click()
    await page.keyboard.type('every ounce')
    await expect(insp.locator('.fm-relpick-item.is-active')).toContainText('Every ounce of AI ability')
    await expect(insp.locator('.fm-relpick-item.is-active .fm-relpick-verb')).toHaveText('serves')
    await page.keyboard.press('Enter')
    const goal = formByTitle(d0, 'Every ounce of AI ability')
    await m.expectData((d) => d.edges.some((e) => e.fromNode === card.id && e.toNode === goal.id && e.relation === 'serves'), 'relation added')
    const served = insp.locator('.fm-rel-item', { hasText: 'Every ounce of AI ability' })
    await served.hover()
    await served.locator('.fm-rel-remove').click()
    await m.expectData((d) => !d.edges.some((e) => e.fromNode === card.id && e.toNode === goal.id), 'relation removed')

    // Why? highlights the chain (also dims the board), click again clears
    await insp.locator('.fm-i-why').click()
    await expect(insp.locator('.fm-insp-hl')).toContainText('Highlighting')
    await expect(m.boardCard('Plan screen')).toHaveClass(/is-dim/)
    await insp.locator('.fm-i-why').click()
    await expect(insp.locator('.fm-insp-hl')).toHaveCount(0)

    // clicking a relation reveals the other card in the map
    await insp.locator('.fm-rel-item', { hasText: 'Bring the fun back' }).click()
    await expect(m.lensButton('Map')).toHaveAttribute('aria-selected', 'true')
    await expect(m.card(formByTitle(d0, 'Bring the fun back').id)).toHaveClass(/fm-pulse/)

    // the link field opens its note (Ctrl = new tab)
    await m.clickCard(card.id)
    await row('Linked note').locator('button[title^="Open note"]').click({ modifiers: ['Control'] })
    await expect.poll(() => app.activeFile()).toBe('Welcome.md')
  })

  test('group settings: label, emoji, color, prompt, preset, assigned fields, pitch order, lock', async ({ app, page }) => {
    const m = await openDefinition(app)
    const g = groupByLabel(m.data(), 'Open questions')
    const at = (fn: (z: Record<string, unknown>) => unknown, msg: string): Promise<void> => m.expectData((d) => fn(d.nodes.find((n) => n.id === g.id)!), msg)
    const insp = m.insp()
    const row = (label: string): Locator => rowOf(insp, label)
    await m.openInspectorTab('Map')
    await insp.locator('.fm-znav-item', { hasText: 'Open questions' }).dblclick()
    await m.openInspectorTab('Card')
    await expect(insp.locator('.fm-i-zone-count')).toHaveText('4 cards inside')

    await insp.locator('.fm-i-title').fill('Open questions & risks')
    await at((z) => z.label === 'Open questions & risks', 'label')
    await expect(m.node(g.id).locator('.fm-group-label')).toHaveText('Open questions & risks')
    await row('Emoji').locator('.fm-i-emoji-btn', { hasText: '🧪' }).click()
    await at((z) => z.emoji === '🧪', 'emoji')
    await row('Color').locator('.fm-i-swatch[title="Purple"]').click()
    await at((z) => z.color === '6', 'color')
    await row('Prompt').locator('textarea').fill('What could still go wrong?')
    await at((z) => z.prompt === 'What could still go wrong?', 'prompt')
    await row('New cards').locator('.fm-kchip', { hasText: 'Idea' }).click()
    await at((z) => z.preset === 'idea', 'preset')
    // assign any field of the map
    await insp.locator('.fm-i-addbtn', { hasText: 'Assign a field' }).click()
    await insp.locator('select[aria-label="Field to assign"]').selectOption('status')
    await insp.locator('.fm-i-assign-block').locator('.fm-opt-chip', { hasText: 'Parked' }).click()
    await at((z) => JSON.stringify(z.assign) === '{"status":"parked"}', 'assign')
    await expect(m.node(g.id).locator('.fm-group-assign')).toHaveText('Status → Parked')
    await row('Pitch order').locator('input').fill('9')
    await at((z) => z.order === 9, 'order')
    await row('Locked').locator('[role="switch"]').click()
    await at((z) => z.locked === false, 'unlocked')
    await expect(m.node(g.id)).toHaveClass(/is-unlocked/)
  })

  test('multi-select bulk edit: tags and select fields', async ({ app, page }) => {
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
    const row = (label: string): Locator => rowOf(insp, label)
    await expect(row('Effort').locator('.fm-i-mixed')).toHaveText('mixed')
    await expect(row('Priority').locator('.fm-opt-chip.is-active')).toHaveText('Must')
    await row('Priority').locator('.fm-opt-chip', { hasText: 'Could' }).click()
    await m.expectData((x) => cardIn(x, a.id).fields.priority === 'could' && cardIn(x, b.id).fields.priority === 'could', 'both could')
    await row('Effort').locator('.fm-opt-chip', { hasText: 'XS' }).click()
    await m.expectData((x) => cardIn(x, a.id).fields.effort === 'xs' && cardIn(x, b.id).fields.effort === 'xs', 'both xs')
    await expect(row('Effort').locator('.fm-i-mixed')).toHaveCount(0)
    await row('Tags').locator('.fm-i-addtag').click()
    await page.locator('.menu-item', { hasText: '#goal' }).click()
    await m.expectData((x) => [a, b].every((c) => cardIn(x, c.id).tags?.includes('goal')), 'both tagged')
    await row('Tags').locator('.fm-tag', { hasText: 'goal' }).locator('.fm-tag-x').click()
    await m.expectData((x) => [a, b].every((c) => !cardIn(x, c.id).tags?.includes('goal')), 'both untagged')
    // Ctrl+click again removes a card from the selection
    await m.boardCard('Task queue panel').click({ modifiers: ['Control'] })
    await expect(insp.locator('.fm-i-title')).toHaveValue('Idea panel')
  })

  test('Coach tab: the example rules, budget editing, tag tiles and the group fix', async ({ app, page }) => {
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
      'Every goal has features serving it'
    ])
    await expect(insp.locator('.fm-coach-mood-title')).toHaveText('A few things to decide')
    await expect(insp.locator('.fm-coach-points').first()).toContainText('21')

    // clicking a check highlights and reveals its cards on the map
    const questions = forms(d).filter((f) => f.tags?.includes('question'))
    await insp.locator('.fm-check', { hasText: '4 open questions' }).click()
    await expect(insp.locator('.fm-insp-hl')).toContainText('Highlighting 4 cards')
    for (const q of questions) await expect(m.card(q.id)).toHaveClass(/fm-lit/)
    await expect(m.card(questions[0].id)).toHaveClass(/fm-pulse/)
    await insp.locator('.fm-check', { hasText: '4 open questions' }).click()
    await expect(insp.locator('.fm-insp-hl')).toHaveCount(0)

    // the budget is the limit of the map's sum rule: 21 points over 20 is a warning
    await insp.locator('.fm-coach-budget').fill('20')
    await m.expectData((x) => (meta(x).checks as { id: string; max?: number }[]).find((c) => c.id === 'mvp-budget')?.max === 20, 'budget saved')
    await expect(insp.locator('.fm-check.is-warn .fm-check-title')).toHaveText(['MVP is over budget: 21 / 20 pts', '4 open questions'])
    await expect(insp.locator('.fm-budget')).toHaveClass(/is-over/)
    await expect(m.inspTab('Coach').locator('.fm-insp-badge.is-warn')).toHaveText('2')

    // tag tiles focus the map on a tag
    await expect(insp.locator('.fm-kind-tile', { hasText: '#goal' })).toContainText('3')
    await insp.locator('.fm-kind-tile', { hasText: '#goal' }).click()
    await expect(m.root().locator('.fm-banner')).toContainText('Focus · #goal')
    await insp.locator('.fm-kind-tile', { hasText: '#goal' }).click()

    // a card whose field disagrees with its group: the coach offers to fix it
    const card = formByTitle(d, 'Idea panel')
    await m.fit([groupByLabel(d, 'Initial features (MVP)').id])
    await m.clickCard(card.id)
    await m.tap(m.card(card.id).locator('.fm-chip', { hasText: 'Initial (MVP)' }))
    await page.locator('.menu-item', { hasText: 'Later' }).click()
    await m.expectData((x) => cardIn(x, card.id).fields.phase === 'later', 'phase set on the card face (no move)')
    const fix = insp.locator('.fm-check', { hasText: "doesn't match its group" })
    await expect(fix).toBeVisible()
    await fix.locator('.fm-check-fix').click()
    await m.expectData((x) => cardIn(x, card.id).fields.phase === 'mvp', 'fixed')
    await expect(fix).toHaveCount(0)
  })

  test('Map tab: registries — rename a field everywhere, add an option, recolor and rename a tag, a preset from a card; navigator and Spark', async ({ app, page }) => {
    const m = await openDefinition(app)
    const d = m.data()
    const insp = m.insp()
    await m.openInspectorTab('Map')
    await rowOf(insp, 'Title').locator('input').fill('CS2D3K — the definition')
    await m.expectData((x) => meta(x).title === 'CS2D3K — the definition', 'title meta')

    // navigator: groups in pitch order with card counts; click reveals
    const nav = insp.locator('.fm-znav-item')
    await expect(nav.locator('.fm-znav-label')).toHaveText(['Core idea', 'Philosophy', 'Engineering approach', 'Final goal', 'Initial features (MVP)', 'Later features', 'Open questions', 'Idea inbox'])
    await expect(nav.filter({ hasText: 'Philosophy' }).locator('.fm-znav-count')).toHaveText('11')
    const later = groupByLabel(d, 'Later features')
    await m.moveCamera(() => nav.filter({ hasText: 'Later features' }).click())
    const c = await m.toWorld(center(await m.rootBox()))
    expect(Math.abs(c.x - (later.x + later.width / 2))).toBeLessThan(40)
    expect(Math.abs(c.y - (later.y + later.height / 2))).toBeLessThan(40)

    // fields: rename "Priority" → "Importance" on every card, group, board…
    const fields = insp.locator('.fm-reg-item')
    await fields.filter({ hasText: 'Priority' }).locator('.fm-reg-row').click()
    const detail = insp.locator('.fm-reg-detail')
    await detail.locator('input[aria-label="Field name"]').fill('Importance')
    await detail.locator('input[aria-label="Field name"]').press('Enter')
    await m.expectData((x) => !!meta(x).fields?.Importance && !meta(x).fields?.priority && cardIn(x, formByTitle(d, 'Idea panel').id).fields.Importance === 'must', 'renamed everywhere')
    expect(Object.keys(meta(m.data()).fields!).indexOf('Importance')).toBe(1)
    // …and add an option
    await detail.locator('input[aria-label="New option"]').fill('Nice to have')
    await detail.locator('input[aria-label="New option"]').press('Enter')
    await m.expectData((x) => meta(x).fields?.Importance?.options?.some((o) => o.value === 'Nice to have'), 'option added')

    // tags: recolor and rename
    const noteTag = insp.locator('.fm-reg-tag', { has: page.locator('input[aria-label="Rename #note"]') })
    await noteTag.locator('.fm-reg-dot').click()
    await page.locator('.menu-item', { hasText: 'Pink' }).click()
    await m.expectData((x) => meta(x).tags?.note?.color === 'pink', 'tag recolored')
    await noteTag.locator('input').fill('context')
    await noteTag.locator('input').press('Enter')
    await m.expectData((x) => !!meta(x).tags?.context && !meta(x).tags?.note && forms(x).some((f) => f.tags?.includes('context')) && meta(x).presets!.some((p) => p.tags?.includes('context')), 'tag renamed')

    // presets: one from the selected card shows in the toolbar
    await m.clickCard(formByTitle(d, 'Plan screen').id)
    await insp.locator('.btn', { hasText: 'From selected card' }).click()
    await m.expectData((x) => meta(x).presets!.length === 8 && meta(x).presets![7].tags?.join() === 'feature', 'preset added')
    const presetName = insp.locator('input[aria-label="Preset name"]')
    await presetName.fill('Epic')
    await m.expectData((x) => meta(x).presets![7].name === 'Epic', 'preset renamed')
    await expect(m.root().locator('.fm-tool[aria-label="Add epic"]')).toBeVisible()

    // Spark: a provocative prompt lands as a #spark card in the inbox, selected and revealed
    await insp.locator('.fm-spark-btn').click()
    await expect(m.root().locator('.canvas-node.fm-pulse.is-selected')).toHaveCount(1)
    let spark: FormCard | undefined
    await m.expectData((x) => (spark = forms(x).find((f) => f.tags?.includes('spark'))), 'spark card')
    expect(groupOf(m.data(), spark!)?.label).toBe('Idea inbox')
    await expect(insp.locator('.fm-spark-text')).toHaveText(`“${spark!.title}”`)
  })
})

test.describe('form-map lenses @basic', () => {
  test('Board: saved boards — groups board moves cards between groups, field board sets the field, order, quick-add, WIP', async ({ app, page }) => {
    const m = await openDefinition(app)
    const d = m.data()
    await page.keyboard.press('Alt+2')
    await expect(m.fmRoot().locator('.fm-board')).toBeVisible()
    await expect(m.fmRoot().locator('.fm-board-tab:not(.is-new)')).toHaveText(['Roadmap', 'Features by status'])
    const titles = (col: string): Promise<string[]> => m.column(col).locator('.fm-bcard-title').allInnerTexts()
    const mvp = groupByLabel(d, 'Initial features (MVP)')
    const later = groupByLabel(d, 'Later features')

    // Roadmap: columns are groups
    await expect(m.fmRoot().locator('.fm-col .fm-col-label')).toHaveText(['Idea inbox', 'Later features', 'Initial features (MVP)'])
    await expect(m.column(mvp.id).locator('.fm-col-count')).toHaveText('6')
    const plan = formByTitle(d, 'Plan screen')
    await dragToColumn(m, m.boardCard('Plan screen'), m.column(mvp.id))
    await m.expectData((x) => groupOf(x, cardIn(x, plan.id))?.id === mvp.id && cardIn(x, plan.id).fields.phase === 'mvp', 'moved into the MVP group (phase applied)')
    await expect(m.column(mvp.id).locator('.fm-col-count')).toHaveText('7')
    await expect(m.column(later.id).locator('.fm-col-count')).toHaveText('3')
    // reorder within the column: the order is saved on the board
    await dragToColumn(m, m.boardCard('Plan screen'), m.column(mvp.id), m.column(mvp.id).locator('.fm-bcard').first())
    await m.expectData((x) => boardByName(x, 'Roadmap').order?.[mvp.id]?.[0] === plan.id, 'order saved')
    expect((await titles(mvp.id))[0]).toBe('Plan screen')

    // Features by status: a field board (filtered to #feature); without the inspector all four columns fit
    await page.locator('button[title="Toggle inspector"]').click()
    await m.boardTab('Features by status').click()
    await expect(m.fmRoot().locator('.fm-col .fm-col-label')).toHaveText(['Idea', 'Planned', 'Building', 'Done'])
    await expect(m.fmRoot().locator('.fm-board-bar .fm-tag')).toHaveText(['#feature×'])
    const ath = formByTitle(d, 'Agentic test harness')
    await dragToColumn(m, m.boardCard('Agentic test harness'), m.column('done'))
    await m.expectData((x) => cardIn(x, ath.id).fields.status === 'done', 'status set by the column')
    await expect(page.locator('canvas.fm-confetti')).toHaveCount(1)
    await expect(m.column('done').locator('.fm-col-count')).toHaveText('1')

    // quick-add in a column: the card gets the column value and the board's tag
    await m.column('planned').locator('.fm-col-addrow', { hasText: 'Add card' }).click()
    await page.keyboard.type('Achievements for shipped MVPs')
    await page.keyboard.press('Enter')
    await page.keyboard.press('Escape')
    let added: FormCard | undefined
    await m.expectData((x) => (added = forms(x).find((f) => f.title === 'Achievements for shipped MVPs')), 'quick-added')
    expect(added!).toMatchObject({ tags: ['feature'], fields: { status: 'planned' } })
    await expect(m.boardCard('Achievements for shipped MVPs')).toHaveClass(/is-selected/)

    // WIP limit from the column menu
    await m.column('planned').locator('.fm-col-head').click({ button: 'right' })
    await page.locator('.menu-item', { hasText: 'Set WIP limit' }).click()
    await page.locator('.modal .input').fill('3')
    await page.locator('.modal .btn.mod-cta').click()
    await expect(m.column('planned').locator('.fm-col-count')).toHaveText('6/3')
    await expect(m.column('planned').locator('.fm-col-count')).toHaveClass(/is-over/)
    await m.expectData((x) => boardByName(x, 'Features by status').wip?.planned === 3, 'wip saved')
  })

  test('Board: create, rename and delete a board; the lens remembers the active board', async ({ app, page }) => {
    const m = await openDefinition(app)
    await m.lens('Board')
    await m.boardTab('New board').click()
    const setup = m.fmRoot().locator('.fm-board-setup-card')
    await setup.locator('button[role="tab"]', { hasText: 'Split by a field' }).click()
    await setup.locator('select[aria-label="Field"]').selectOption('phase')
    await setup.locator('input[aria-label="Board name"]').fill('Phases')
    await setup.locator('.btn.mod-cta', { hasText: 'Create board' }).click()
    await expect(m.boardTab('Phases')).toHaveClass(/is-active/)
    await expect(m.fmRoot().locator('.fm-col .fm-col-label')).toHaveText(['No phase', 'Initial (MVP)', 'Next', 'Later', 'Someday'])
    await m.expectData((x) => boardByName(x, 'Phases').source.mode === 'field', 'board saved')
    await expect.poll(() => page.evaluate(() => window.__cs2d3k!.getActiveTab()?.state?.boardId)).toBe(boardByName(m.data(), 'Phases').id)

    // groups board from the setup panel
    await m.boardTab('New board').click()
    await setup.locator('.fm-board-setup-group', { hasText: 'Philosophy' }).click()
    await setup.locator('.fm-board-setup-group', { hasText: 'Engineering approach' }).click()
    await setup.locator('.btn.mod-cta', { hasText: 'Create board' }).click()
    await expect(m.fmRoot().locator('.fm-col .fm-col-label')).toHaveText(['Philosophy', 'Engineering approach'])
    await expect(m.fmRoot().locator('.fm-col .fm-col-count')).toHaveText(['11', '6'])

    // rename + delete from the tab's menu
    await m.boardTab('Phases').click({ button: 'right' })
    await page.locator('.menu-item', { hasText: 'Rename' }).click()
    await page.locator('.modal .input').fill('Phase plan')
    await page.locator('.modal .btn.mod-cta').click()
    await expect(m.boardTab('Phase plan')).toBeVisible()
    await m.boardTab('Phase plan').click({ button: 'right' })
    await page.locator('.menu-item', { hasText: 'Delete board' }).click()
    await page.locator('.modal .btn.mod-warning').click()
    await expect(m.boardTab('Phase plan')).toHaveCount(0)
    await m.expectData((x) => !meta(x).boards!.some((b) => b.name.startsWith('Phase')), 'board deleted')
  })

  test('Table: the registry as columns, group and tag filters, sorting, inline edits and add row', async ({ app, page }) => {
    const m = await openDefinition(app)
    const d = m.data()
    await page.keyboard.press('Alt+3')
    const table = m.fmRoot().locator('.fm-table-lens')
    await expect(table).toBeVisible()
    await expect(table.locator('tbody tr')).toHaveCount(forms(d).length)
    const regCols = Object.values(meta(d).fields!).map((f) => f.label)
    await expect(table.locator('thead th')).toHaveText(['Title', 'Tags', ...regCols.map((l) => new RegExp(`${l}$`)), 'Group', 'Votes', 'Links'] as (string | RegExp)[])

    // filters
    await table.locator('select[aria-label="Group filter"]').selectOption({ label: '🔭 Later features' })
    await expect(table.locator('tbody tr')).toHaveCount(4)
    await table.locator('select[aria-label="Group filter"]').selectOption('')
    await table.locator('.fm-board-filter', { hasText: 'Tags' }).click()
    await page.locator('.menu-item', { hasText: '#question' }).click()
    await expect(table.locator('tbody tr')).toHaveCount(4)
    await table.locator('.fm-i-textbtn', { hasText: 'Clear' }).click()
    await expect(table.locator('tbody tr')).toHaveCount(forms(d).length)

    // sorting: votes (biggest first), then ascending, then off
    const votesTh = table.locator('th', { hasText: 'Votes' })
    await votesTh.click()
    await expect(votesTh).toHaveAttribute('aria-sort', 'descending')
    await expect(table.locator('tbody tr').first().locator('.fm-cell-title')).toHaveText('Form-map definition board')
    await votesTh.click()
    await expect(votesTh).toHaveAttribute('aria-sort', 'ascending')
    await votesTh.click()
    await expect(votesTh).toHaveAttribute('aria-sort', 'none')

    // inline edits
    const ath = formByTitle(d, 'Agentic test harness')
    await m.row('Agentic test harness').locator('.fm-cell-title').dblclick()
    await page.keyboard.press('Control+a')
    await page.keyboard.type('Agentic test harness v2')
    await page.keyboard.press('Enter')
    await m.expectData((x) => cardIn(x, ath.id).title === 'Agentic test harness v2', 'title edited')
    await m.row('Agentic test harness v2').locator('td.is-select').nth(1).locator('.fm-opt-chip').click()
    await page.locator('.menu-item', { hasText: 'Must' }).click()
    await m.expectData((x) => cardIn(x, ath.id).fields.priority === 'must', 'priority edited')
    await m.row('Agentic test harness v2').locator('td.is-rating').first().locator('.fm-rating-star').nth(4).click()
    await m.expectData((x) => cardIn(x, ath.id).fields.fun === 5, 'fun edited')
    await m.row('Agentic test harness v2').locator('.fm-cell-tags').click()
    await page.locator('.menu-item', { hasText: '#goal' }).click()
    await m.expectData((x) => cardIn(x, ath.id).tags?.join() === 'feature,goal', 'tag from the table')

    // add a row: a new card, title edited inline
    await table.locator('.fm-table-add').click()
    await expect(table.locator('.fm-cell-input')).toBeFocused()
    await page.keyboard.type('Table-made card')
    await page.keyboard.press('Enter')
    await m.expectData((x) => forms(x).some((f) => f.title === 'Table-made card'), 'row added')
    await expect(table.locator('tbody tr')).toHaveCount(forms(d).length + 1)
  })

  test('Doc: groups in pitch order with their cards and fields, copy markdown, export to a note', async ({ app, page, electronApp }) => {
    const m = await openDefinition(app)
    await page.keyboard.press('Alt+4')
    const doc = m.fmRoot().locator('.fm-doc')
    await expect(doc.locator('.fm-doc-md h1')).toHaveText('CS2D3K Definition')
    await expect(doc.locator('.fm-doc-md h2')).toHaveText(['🌱 Core idea', '🧭 Philosophy', '🛠️ Engineering approach', '🎯 Final goal', '🚀 Initial features (MVP)', '🔭 Later features', '❓ Open questions', '📥 Idea inbox'])
    await expect(doc.locator('.fm-doc-md h3', { hasText: 'Idea panel' })).toBeVisible()

    await doc.locator('button', { hasText: 'Copy markdown' }).click()
    await expect(doc.locator('button', { hasText: 'Copied' })).toBeVisible()
    const md = (await electronApp.evaluate(({ clipboard }) => clipboard.readText())).replace(/\r\n/g, '\n')
    expect(md.startsWith('# CS2D3K Definition\n')).toBe(true)
    expect(md).toContain('- **Priority:** Must')
    expect(md).toContain('_Serves:_ Bring the fun back')

    await doc.locator('.fm-doc-export').click()
    const input = page.locator('.modal .input')
    await expect(input).toHaveValue('CS2D3K Definition - Doc.md')
    await page.locator('.modal .btn.mod-cta').click()
    await app.expectFile('CS2D3K Definition - Doc.md', (s) => s === md, 'exported note')
    await m.expectData((x) => meta(x).exportPath === 'CS2D3K Definition - Doc.md', 'exportPath recorded')
    await expect(doc.locator('.fm-doc-bar-time')).toHaveText('Exported just now')
    app.removeExternal('CS2D3K Definition - Doc.md')
    await expect.poll(() => app.exists('CS2D3K Definition - Doc.md')).toBe(false)
    await doc.locator('.fm-doc-export').click()
    await expect(page.locator('.modal')).toHaveCount(0)
    await app.expectFile('CS2D3K Definition - Doc.md', (s) => s.includes('📥 Idea inbox'), 're-exported')
  })

  test('the HUD numbers match the data; the ring follows the chosen board', async ({ app, page }) => {
    const m = await openDefinition(app)
    const d = m.data()
    const hud = m.root().locator('.fm-hud')
    const stat = (cap: string): Locator => hud.locator('.fm-hud-stat', { hasText: cap }).locator('b')
    await expect(hud.locator('.fm-hud-title-name')).toHaveText('Features by status')
    await expect(hud.locator('.fm-hud-title-num')).toHaveText('0/10 done')
    await expect(hud.locator('.fm-hud-ring-label')).toHaveText('0%')
    await expect(stat('cards')).toHaveText(String(forms(d).length))
    await expect(stat('groups')).toHaveText(String(groups(d).length))
    await expect(stat('boards')).toHaveText('2')
    await expect(stat('votes')).toHaveText('33')

    // finish a feature from the inspector: the HUD follows
    const insp = m.insp()
    await m.clickCard(formByTitle(d, 'Idea panel').id)
    await rowOf(insp, 'Status').locator('.fm-opt-chip', { hasText: 'Done' }).click()
    await expect(hud.locator('.fm-hud-title-num')).toHaveText('1/10 done')
    await expect(hud.locator('.fm-hud-ring-label')).toHaveText('10%')
    // switch the board the ring follows
    await hud.locator('.fm-hud-title').click()
    await page.locator('.menu-item', { hasText: 'Roadmap' }).click()
    await expect(hud.locator('.fm-hud-title-name')).toHaveText('Roadmap')
    await expect(hud.locator('.fm-hud-title-num')).toHaveText('6/13 done')
    await m.expectData((x) => meta(x).hudBoard === boardByName(x, 'Roadmap').id, 'hud board saved')
    // clicking a stat highlights those cards
    await hud.locator('.fm-hud-stat', { hasText: 'votes' }).click()
    await expect(m.root().locator('.fm-node-form.fm-lit')).toHaveCount(6)
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
    await page.keyboard.press('Alt+1')
    await m.clickCard(review.id, { modifiers: ['Shift'] })
    await page.keyboard.press('Alt+2')
    await expect(m.fmRoot().locator('.fm-bcard.is-selected')).toHaveCount(2)
  })
})
