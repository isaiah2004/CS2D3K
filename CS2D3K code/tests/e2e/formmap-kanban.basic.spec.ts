// Kanban in form-maps end-to-end: boards made from groups on the canvas, field boards, the embedded kanban node
// (drag within / between columns, out onto the canvas, canvas cards in), conversions between groups and kanban nodes,
// and loading a version 1 file. Asserts on the UI and on the .formmap JSON on disk.
import { readFileSync } from 'fs'
import { join } from 'path'
import { test, expect, ROOT } from './fixtures'
import type { App } from './helpers/app'
import { center, type CData, type Pt } from './helpers/canvas'
import { boardByName, FormMapPage, formByTitle, forms, groupByLabel, groupOf, groups, kanbans, meta, type FormCard, type Kanban } from './helpers/formmap'

const SPRINT = 'Sprint board.formmap'

async function openMap(app: App, file = SPRINT): Promise<FormMapPage> {
  await app.page.locator('[title^="Toggle right sidebar"]').click()
  const m = new FormMapPage(app, file)
  await m.open()
  return m
}

const cardIn = (d: CData, id: string): FormCard => d.nodes.find((n) => n.id === id) as FormCard
const kanbanIn = (d: CData, id: string): Kanban => d.nodes.find((n) => n.id === id) as Kanban
const colCards = (k: Kanban, title: string): string[] => k.columns.find((c) => c.title === title)!.cards.map((c) => c.title)

/** press on `from`, move in steps to `to`, release — the kanban node and the board drag with pointer events */
async function dragTo(m: FormMapPage, from: Pt, to: Pt, steps = 14): Promise<void> {
  await m.drag(from, to, { steps })
}
const top = async (loc: import('@playwright/test').Locator, dy = 8): Promise<Pt> => {
  const b = (await loc.boundingBox())!
  return { x: b.x + b.width / 2, y: b.y + dy }
}

test.describe('form-map kanban @basic', () => {
  test('a board made from groups on the canvas: moving a card between columns moves it between the groups on disk', async ({ app, page }) => {
    const m = await openMap(app)
    const d = m.data()
    const [todo, doing, done] = ['To do', 'Doing', 'Done'].map((l) => groupByLabel(d, l))
    await m.fit([todo.id, doing.id, done.id], 0.8)
    // select three groups by their headers, then "Create board from 3 groups" from the context menu
    for (const [i, g] of [todo, doing, done].entries()) {
      const b = await m.nodeBox(g.id, '.fm-group-label')
      if (i) await page.keyboard.down('Shift')
      await page.mouse.click(b.x + 4, b.y + b.height / 2)
      if (i) await page.keyboard.up('Shift')
    }
    await expect.poll(async () => (await m.selectedIds()).length).toBe(3)
    const b = await m.nodeBox(doing.id, '.fm-group-label')
    await page.mouse.click(b.x + 4, b.y + b.height / 2, { button: 'right' })
    await m.menuItem('Create board from 3 groups').click()
    // the Board lens opens on the new board
    await expect(m.lensButton('Board')).toHaveAttribute('aria-selected', 'true')
    await expect(m.fmRoot().locator('.fm-col .fm-col-label')).toHaveText(['To do', 'Doing', 'Done'])
    await expect(m.fmRoot().locator('.fm-board-tab.is-active')).toHaveText('Sprint 12')
    await m.expectData((x) => meta(x).boards!.length === 3, 'board saved')
    const board = meta(m.data()).boards![2]
    expect(board.source).toEqual({ mode: 'groups', groupIds: [todo.id, doing.id, done.id] })

    // drag "Welcome tour" from To do to Done: it moves into the Done group (and gets done: true from it)
    const tour = formByTitle(d, 'Welcome tour')
    const card = m.boardCard('Welcome tour')
    const a = (await card.boundingBox())!
    const col = (await m.column(done.id).locator('.fm-col-body').boundingBox())!
    await m.drag({ x: a.x + a.width / 2, y: a.y + 14 }, { x: col.x + col.width / 2, y: col.y + col.height - 40 }, { steps: 14, hold: true })
    await expect(m.column(done.id)).toHaveClass(/is-drop-target/)
    await page.mouse.up()
    await expect(page.locator('canvas.fm-confetti')).toHaveCount(1)
    await m.expectData((x) => groupOf(x, cardIn(x, tour.id))?.id === done.id && cardIn(x, tour.id).fields.done === true, 'moved into the Done group, done: true')
    await expect(m.column(done.id).locator('.fm-bcard-title')).toHaveText(['Faster first launch', 'Welcome tour'])
    // the other board over the same groups stays in sync
    await m.boardTab('Sprint 12').first().click()
    await expect(m.column(done.id).locator('.fm-col-count')).toHaveText('2')
    // moving it back on the canvas moves it back on the board
    await m.lens('Map')
    await m.fit([todo.id, done.id], 0.6)
    const box = await m.nodeBox(tour.id)
    const target = await m.toScreen({ x: todo.x + todo.width / 2, y: todo.y + todo.height - 120 })
    const c = center(box)
    await m.drag({ x: box.x + 10, y: box.y + 8 }, { x: target.x + (box.x + 10 - c.x), y: target.y + (box.y + 8 - c.y) }, { steps: 12 })
    await m.expectData((x) => groupOf(x, cardIn(x, tour.id))?.id === todo.id, 'back in To do')
    await m.lens('Board')
    await expect(m.column(todo.id).locator('.fm-bcard-title', { hasText: 'Welcome tour' })).toBeVisible()
  })

  test('a field board: columns are the values, moving a card sets the field; the order is kept', async ({ app, page }) => {
    const m = await openMap(app)
    const d = m.data()
    await m.lens('Board')
    await m.boardTab('Sprint by priority').click()
    await expect(m.fmRoot().locator('.fm-col .fm-col-label')).toHaveText(['High', 'Medium', 'Low'])
    await expect(m.fmRoot().locator('.fm-col .fm-col-count')).toHaveText(['4', '2', '1'])
    const theme = formByTitle(d, 'Theme picker preview')
    const card = m.boardCard('Theme picker preview')
    const first = m.column('High').locator('.fm-bcard').first()
    const from = await top(card, 14)
    const to = await top(first, 6)
    await m.drag(from, to, { steps: 14, hold: true })
    await expect(m.column('High')).toHaveClass(/is-drop-target/)
    await page.mouse.up()
    await m.expectData((x) => cardIn(x, theme.id).fields.Priority === 'High', 'field set by the column')
    await m.expectData((x) => boardByName(x, 'Sprint by priority').order?.High?.[0] === theme.id, 'placed first')
    await expect(m.column('High').locator('.fm-bcard-title').first()).toHaveText('Theme picker preview')
    // the card stayed where it was on the canvas (field boards don't move cards)
    expect(groupOf(m.data(), cardIn(m.data(), theme.id))?.label).toBe('Review')
    // keyboard: Shift+→ moves the focused card to the next column
    await m.boardCard('Theme picker preview').focus()
    await page.keyboard.press('Shift+ArrowRight')
    await m.expectData((x) => cardIn(x, theme.id).fields.Priority === 'Medium', 'moved with the keyboard')
  })

  test('the kanban node: create it, add cards, drag within and between columns, edit columns', async ({ app, page }) => {
    const m = await openMap(app, 'CS2D3K Definition.formmap')
    await m.root().locator('.fm-tool[aria-label="Add kanban"]').click()
    let k = (await m.waitForNode((n) => n.type === 'kanban', 'kanban saved')) as Kanban
    expect(k.columns.map((c) => c.title)).toEqual(['To do', 'Doing', 'Done'])
    await m.fit([k.id], 1)
    const node = m.node(k.id)
    await expect(node.locator('.fm-kb-title')).toHaveText('Kanban')
    const todo = k.columns[0]
    const doing = k.columns[1]
    const done = k.columns[2]

    // add three cards to "To do"
    await m.tap(m.kanbanColumn(k.id, todo.id).locator('.fm-kb-add'))
    for (const t of ['Alpha', 'Beta', 'Gamma']) {
      await page.keyboard.type(t)
      await page.keyboard.press('Enter')
    }
    await page.keyboard.press('Escape')
    await m.expectData((x) => colCards(kanbanIn(x, k.id), 'To do').join() === 'Alpha,Beta,Gamma', 'cards added')
    k = kanbanIn(m.data(), k.id)
    const [alpha, beta, gamma] = k.columns[0].cards
    await expect(m.kanbanColumn(k.id, todo.id).locator('.fm-kb-col-count')).toHaveText('3')

    // within a column: Gamma above Alpha
    await dragTo(m, await top(m.kanbanCard(k.id, gamma.id), 10), await top(m.kanbanCard(k.id, alpha.id), 4))
    await m.expectData((x) => colCards(kanbanIn(x, k.id), 'To do').join() === 'Gamma,Alpha,Beta', 'reordered')
    // between columns: Beta → Doing, Alpha → Done (the last column celebrates)
    await dragTo(m, await top(m.kanbanCard(k.id, beta.id), 10), await top(m.kanbanColumn(k.id, doing.id).locator('[data-kanban-list]'), 20))
    await m.expectData((x) => colCards(kanbanIn(x, k.id), 'Doing').join() === 'Beta', 'moved to Doing')
    await dragTo(m, await top(m.kanbanCard(k.id, alpha.id), 10), await top(m.kanbanColumn(k.id, done.id).locator('[data-kanban-list]'), 20))
    await expect(page.locator('canvas.fm-confetti')).toHaveCount(1)
    await m.expectData((x) => colCards(kanbanIn(x, k.id), 'Done').join() === 'Alpha', 'moved to Done')

    // done checkbox, inline edit
    await m.tap(m.kanbanCard(k.id, beta.id).locator('.fm-kb-check'))
    await m.expectData((x) => kanbanIn(x, k.id).columns[1].cards[0].done === true, 'marked done')
    await m.dblTap(m.kanbanCard(k.id, gamma.id).locator('.fm-kb-card-title'))
    const title = node.locator('.fm-kb-edit-title')
    await expect(title).toBeFocused()
    await title.fill('Gamma ray')
    await node.locator('.fm-kb-edit-text').fill('with notes')
    await node.locator('.fm-kb-edit-text').press('Control+Enter')
    await m.expectData((x) => JSON.stringify(kanbanIn(x, k.id).columns[0].cards[0]).includes('"title":"Gamma ray","text":"with notes"'), 'edited inline')

    // columns: rename (double-click), add, collapse, delete
    await m.dblTap(m.kanbanColumn(k.id, doing.id).locator('.fm-kb-col-title'))
    await page.keyboard.press('Control+a')
    await page.keyboard.type('In progress')
    await page.keyboard.press('Enter')
    await m.expectData((x) => kanbanIn(x, k.id).columns[1].title === 'In progress', 'renamed')
    await m.tap(node.locator('.fm-kb-head button[aria-label="Add column"]'))
    await page.keyboard.type('Review')
    await page.keyboard.press('Enter')
    await m.expectData((x) => kanbanIn(x, k.id).columns.map((c) => c.title).join() === 'To do,In progress,Done,Review', 'column added')
    k = kanbanIn(m.data(), k.id)
    const review = k.columns[3]
    // reorder: drag the Review header before Done
    await m.fit([k.id], 1)
    const doneHead = (await m.kanbanColumn(k.id, done.id).locator('.fm-kb-col-head').boundingBox())!
    await dragTo(m, await top(m.kanbanColumn(k.id, review.id).locator('.fm-kb-col-head'), 10), { x: doneHead.x + 20, y: doneHead.y + 10 })
    await m.expectData((x) => kanbanIn(x, k.id).columns.map((c) => c.title).join() === 'To do,In progress,Review,Done', 'column moved')
    await m.tap(m.kanbanColumn(k.id, review.id).locator('button[aria-label="Review menu"]'))
    await page.locator('.menu-item', { hasText: 'Collapse' }).click()
    await expect(m.kanbanColumn(k.id, review.id)).toHaveClass(/is-collapsed/)
    await m.tap(m.kanbanColumn(k.id, review.id).locator('.fm-kb-collapsed'))
    await expect(m.kanbanColumn(k.id, review.id)).not.toHaveClass(/is-collapsed/)
    await m.tap(m.kanbanColumn(k.id, review.id).locator('button[aria-label="Review menu"]'))
    await page.locator('.menu-item', { hasText: 'Delete column' }).click()
    await m.expectData((x) => kanbanIn(x, k.id).columns.length === 3, 'column deleted')
    // undo brings it back (every edit is one undo step)
    await m.focus()
    await page.keyboard.press('Control+z')
    await m.expectData((x) => kanbanIn(x, k.id).columns.length === 4, 'undo')
  })

  test('drag a kanban card out onto the canvas, and a canvas card into a kanban column', async ({ app, page }) => {
    const m = await openMap(app)
    const d = m.data()
    const k = kanbans(d)[0]
    await m.fit([k.id], 0.9)
    const graph = k.columns[0].cards.find((c) => c.title === 'Graph labels overlap')!

    // out: onto empty canvas below the board
    const kb = await m.nodeBox(k.id)
    const out = { x: kb.x + kb.width / 2, y: Math.min(kb.y + kb.height + 120, (await m.rootBox()).y + (await m.rootBox()).height - 100) }
    await m.drag(await top(m.kanbanCard(k.id, graph.id), 10), out, { steps: 14, hold: true })
    await expect(page.locator('.fm-kb-ghost.is-out')).toBeVisible()
    await page.mouse.up()
    await m.expectData((x) => !!cardIn(x, graph.id) && cardIn(x, graph.id).type === 'form', 'a canvas card now')
    const popped = cardIn(m.data(), graph.id)
    expect(popped).toMatchObject({ title: 'Graph labels overlap', text: 'Dense areas at 0.3× zoom.', tags: ['bug'] })
    expect(colCards(kanbanIn(m.data(), k.id), 'New')).toEqual(['Tab title flickers on rename'])
    const w = await m.toWorld(out)
    expect(Math.abs(popped.x + popped.width / 2 - w.x)).toBeLessThan(40)

    // in: drag "Sync across devices" (Backlog) into "Confirmed", above its card
    const plugin = formByTitle(d, 'Sync across devices')
    await m.fit([k.id, plugin.id], 0.9)
    const pb = await m.nodeBox(plugin.id)
    const confirmed = k.columns[1]
    const dest = await top(m.kanbanCard(k.id, confirmed.cards[0].id), 4)
    await m.drag({ x: pb.x + 10, y: pb.y + 8 }, dest, { steps: 16, hold: true })
    await expect(m.kanbanColumn(k.id, confirmed.id)).toHaveClass(/is-over/)
    await page.mouse.up()
    await m.expectData((x) => !x.nodes.some((n) => n.id === plugin.id) && colCards(kanbanIn(x, k.id), 'Confirmed').join() === 'Sync across devices,Paste loses formatting', 'moved into the column')
    expect(kanbanIn(m.data(), k.id).columns[1].cards[0]).toMatchObject({ id: plugin.id, tags: ['idea'], fields: { Priority: 'Medium' }, votes: 4 })
    await expect(m.root().locator('.fm-chip-float', { hasText: 'Moved into “Confirmed”' })).toBeVisible()
  })

  test('convert groups ↔ kanban node', async ({ app, page }) => {
    const m = await openMap(app)
    const d = m.data()
    const sprint = groupByLabel(d, 'Sprint 12')
    const todo = groupByLabel(d, 'To do')
    // the parent group converts its child groups (columns) and their cards
    await m.fit([sprint.id], 0.6)
    const b = await m.nodeBox(sprint.id, '.fm-group-label')
    await page.mouse.click(b.x + 4, b.y + b.height / 2, { button: 'right' })
    await m.menuItem('Convert to kanban node').click()
    await m.expectData((x) => kanbans(x).length === 2, 'kanban created')
    let x = m.data()
    const k = kanbans(x).find((n) => n.title === 'Sprint 12')!
    expect(k.columns.map((c) => [c.title, c.cards.length])).toEqual([
      ['To do', 3],
      ['Doing', 2],
      ['Review', 1],
      ['Done', 1]
    ])
    expect(k.columns[0].cards[0]).toMatchObject({ title: 'Welcome tour', tags: ['task', 'ux'], fields: { Owner: 'Ana', Priority: 'High', Estimate: 3 }, votes: 2 })
    expect(k.columns[3].cards[0].done).toBe(true)
    expect(groups(x).map((g) => g.label)).toEqual(['Backlog'])
    expect(x.edges).toHaveLength(0)
    // the saved board over those groups is gone; the field board stays
    expect(meta(x).boards!.map((bd) => bd.name)).toEqual(['Sprint by priority'])
    await expect(m.node(k.id).locator('.fm-kb-title')).toHaveText('Sprint 12')

    // back: "Convert to groups" from the kanban's context menu
    await m.fit([k.id], 0.8)
    const head = await m.nodeBox(k.id, '.fm-kb-head')
    await page.mouse.click(head.x + head.width - 120, head.y + head.height / 2, { button: 'right' })
    await m.menuItem('Convert to groups').click()
    await m.expectData((y) => kanbans(y).length === 1, 'groups created')
    x = m.data()
    expect(groups(x).map((g) => g.label)).toEqual(['Sprint 12', 'To do', 'Doing', 'Review', 'Done', 'Backlog'])
    const tour = formByTitle(x, 'Welcome tour')
    expect(groupOf(x, tour)?.label).toBe('To do')
    expect(tour).toMatchObject({ tags: ['task', 'ux'], fields: { Owner: 'Ana', Priority: 'High', Estimate: 3 }, votes: 2 })
    expect(formByTitle(x, 'Faster first launch').fields.done).toBe(true)
    // with a saved board over the new column groups
    const bd = boardByName(x, 'Sprint 12')
    expect(bd.source).toEqual({ mode: 'groups', groupIds: groups(x).slice(1, 5).map((g) => g.id) })
    await m.lens('Board')
    await m.boardTab('Sprint 12').click()
    await expect(m.fmRoot().locator('.fm-col .fm-col-count')).toHaveText(['3', '2', '1', '1'])
    expect(todo.id).not.toBe(groupByLabel(x, 'To do').id)
  })
})

test.describe('form-map migration @basic', () => {
  const legacy = readFileSync(join(ROOT, 'tests', 'fixtures', 'definition-v1.formmap'), 'utf8')
  test.use({ vault: { source: 'sample', files: { 'Old definition.formmap': legacy } } })

  test('a version 1 file (kinds + zones) loads as tags + groups, and saves as version 2 without losing data', async ({ app, page }) => {
    const old = JSON.parse(legacy) as CData
    const m = await openMap(app, 'Old definition.formmap')
    // the file is untouched until edited
    expect(app.read('Old definition.formmap')).toBe(legacy)
    // kinds show as tags, zones as groups, the kinds as presets
    const idea = formByTitle(old, 'Idea panel')
    await m.fit([idea.id], 1)
    await expect(m.card(idea.id).locator('.fm-ctag')).toHaveText(['#feature'])
    await expect(m.root().locator('.fm-node-group')).toHaveCount(8)
    await expect(m.root().locator('.fm-tool[aria-label="Add feature"]')).toBeVisible()
    // the coach runs the same checks as before
    await m.openInspectorTab('Coach')
    await expect(m.insp().locator('.fm-check-title').first()).toHaveText('4 open questions')

    // an edit saves the migrated file
    await m.clickCard(idea.id)
    await m.insp().locator('.fm-insp-tab', { hasText: 'Card' }).click()
    await m.insp().locator('.fm-i-vote').click()
    await m.expectData((x) => meta(x)?.version === 2, 'saved as version 2')
    const d = m.data()
    expect(meta(d)).toMatchObject({ title: 'CS2D3K Definition', template: 'product-definition' })
    expect(meta(d).mvpBudget).toBeUndefined()
    expect((meta(d).checks as { id: string; max?: number }[]).find((c) => c.id === 'mvp-budget')?.max).toBe(24)
    // every node kept; kinds → first tag; fields untouched; zones → locked groups
    expect(d.nodes.map((n) => n.id)).toEqual(old.nodes.map((n) => n.id))
    for (const o of old.nodes) {
      const n = d.nodes.find((x) => x.id === o.id)!
      if (o.type === 'form') {
        expect(n.type).toBe('form')
        expect('kind' in n).toBe(false)
        expect((n as FormCard).tags?.[0]).toBe(o.kind)
        expect((n as FormCard).fields).toEqual(o.fields)
        expect([n.title, n.text, n.x, n.y]).toEqual([o.title, o.text, o.x, o.y])
      } else {
        expect(n).toMatchObject({ type: 'group', label: o.label, preset: o.defaultKind, locked: true })
      }
    }
    expect(d.edges).toEqual(old.edges)
    expect(cardIn(d, idea.id).votes).toBe((idea.votes as number) + 1)
    expect(meta(d).fields?.phase?.type).toBe('select')
    expect(forms(d)).toHaveLength(38)
  })
})
