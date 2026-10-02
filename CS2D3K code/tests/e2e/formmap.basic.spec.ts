// Form-map shell + Map lens end-to-end. Drives the map like a user (mouse + keyboard) and asserts on the UI and on the
// .formmap JSON on disk.
import { test, expect } from './fixtures'
import type { App } from './helpers/app'
import { center, type CData } from './helpers/canvas'
import { DEFINITION, FormMapPage, formByTitle, forms, groupByLabel, groupOf, groups, meta, type FormCard } from './helpers/formmap'

async function openMap(app: App, file = DEFINITION): Promise<FormMapPage> {
  const m = new FormMapPage(app, file)
  await m.open()
  return m
}

const PRODUCT_GROUPS = ['Core idea', 'Philosophy', 'Engineering approach', 'Final goal', 'Initial features (MVP)', 'Later features', 'Open questions', 'Idea inbox']
const cardIn = (d: CData, id: string): FormCard => d.nodes.find((n) => n.id === id) as FormCard

const NESTED = JSON.stringify({
  formmap: { version: 2, fields: { sprint: { type: 'number' }, status: { type: 'select', options: [{ value: 'todo' }, { value: 'doing' }] } } },
  nodes: [
    { id: 'sprint', type: 'group', label: 'Sprint', assign: { sprint: 12 }, x: 0, y: 0, width: 1300, height: 800 },
    { id: 'doing', type: 'group', label: 'Doing', assign: { status: 'doing' }, x: 700, y: 100, width: 500, height: 600 },
    { id: 'task', type: 'form', title: 'Task', tags: [], fields: {}, x: 100, y: 120, width: 260, height: 120 }
  ],
  edges: []
})

test.describe('form-map shell @basic', () => {
  test('creating a form-map shows the template picker; each template writes its groups, registries and boards', async ({ app, page }) => {
    // ribbon → product definition
    await page.locator('.ribbon [title="Create new form-map"]').click()
    await expect.poll(() => app.activeFile()).toBe('Untitled form-map.formmap')
    const picker = app.activeView().locator('.fm-template-picker')
    await expect(picker.locator('.fm-template-card .fm-template-name')).toHaveText(['Blank', 'Brainstorm', 'Kanban', 'Product definition'])
    expect(app.read('Untitled form-map.formmap')).toBe('')
    await picker.locator('.fm-template-card', { hasText: 'Product definition' }).click()
    await expect(app.activeView().locator('.fm-node-group')).toHaveCount(8)
    await app.expectFile('Untitled form-map.formmap', (s) => s.includes('"group"'))
    let d = app.readJson<CData>('Untitled form-map.formmap')
    expect(meta(d)).toMatchObject({ version: 2, template: 'product-definition' })
    expect(Object.keys(meta(d).fields!)).toEqual(expect.arrayContaining(['phase', 'priority', 'effort', 'status', 'fun', 'acceptance']))
    expect(meta(d).presets!.map((p) => p.name)).toEqual(['Idea', 'Principle', 'Goal', 'Approach', 'Feature', 'Question', 'Note'])
    expect(meta(d).boards!.map((b) => b.name)).toEqual(['Roadmap', 'Features by status'])
    expect(groups(d).map((z) => z.label)).toEqual(PRODUCT_GROUPS)
    expect(groups(d).every((z) => z.locked)).toBe(true)
    expect(groupByLabel(d, 'Initial features (MVP)')).toMatchObject({ preset: 'feature', assign: { phase: 'mvp' }, order: 5 })
    expect(groupByLabel(d, 'Later features')).toMatchObject({ preset: 'feature', assign: { phase: 'later' }, order: 6 })
    expect(groupByLabel(d, 'Idea inbox').order).toBeUndefined()
    expect(d.nodes.some((n) => 'kind' in n)).toBe(false)
    // the presets are the toolbar
    await expect(app.activeView().locator('.fm-tool[aria-label^="Add "]')).toHaveCount(8 + 2)

    // explorer background menu → kanban
    const explorer = page.locator('.pane-body', { has: app.treeItem('Welcome.md') })
    const eb = (await explorer.boundingBox())!
    await page.mouse.click(eb.x + 30, eb.y + eb.height - 15, { button: 'right' })
    await page.locator('.menu-item', { hasText: 'New form-map' }).click()
    await expect.poll(() => app.activeFile()).toBe('Untitled form-map 1.formmap')
    await app.activeView().locator('.fm-template-card', { hasText: 'Kanban' }).click()
    await expect(app.activeView().locator('.fm-node-group')).toHaveCount(4)
    await app.expectFile('Untitled form-map 1.formmap', (s) => s.includes('"boards"'))
    d = app.readJson<CData>('Untitled form-map 1.formmap')
    expect(groups(d).map((g) => g.label)).toEqual(['Board', 'To do', 'Doing', 'Done'])
    const board = meta(d).boards![0]
    expect(board.source).toEqual({ mode: 'groups', groupIds: groups(d).slice(1).map((g) => g.id) })
    expect(forms(d).filter((f) => groupOf(d, f)?.label === 'To do')).toHaveLength(2)

    // command palette → blank: the empty map
    await app.runPaletteCommand('Create new form-map')
    await expect.poll(() => app.activeFile()).toBe('Untitled form-map 2.formmap')
    await app.activeView().locator('.fm-template-card', { hasText: 'Blank' }).click()
    await expect(app.activeView().locator('.fm-map .canvas-empty-hint')).toBeVisible()
    await app.expectFile('Untitled form-map 2.formmap', (s) => s.includes('"blank"'))
    d = app.readJson<CData>('Untitled form-map 2.formmap')
    expect(d).toMatchObject({ formmap: { version: 2, template: 'blank' }, nodes: [], edges: [] })
  })

  test('"Convert current canvas to form-map" copies the canvas; its groups become form-map groups', async ({ app, page }) => {
    // only offered for canvases
    await app.openFile('Welcome.md')
    await page.keyboard.press('Control+P')
    await page.locator('.prompt-input').fill('Convert current canvas')
    await expect(page.locator('.suggestion-item', { hasText: 'Convert current canvas' })).toHaveCount(0)
    await page.keyboard.press('Escape')

    await app.openFile('Architecture.canvas')
    await app.runPaletteCommand('Convert current canvas')
    await expect.poll(() => app.activeFile()).toBe('Architecture.formmap')
    await expect(app.activeView().locator('.fm-map .canvas-node')).toHaveCount(6)
    // the canvas group is a form-map group (header, lock), unlocked like on the canvas
    await expect(app.activeView().locator('.fm-node-group.is-unlocked .fm-group-label')).toHaveText('Code')
    const canvas = app.readJson<CData>('Architecture.canvas')
    const fm = app.readJson<CData>('Architecture.formmap')
    expect(fm.nodes).toEqual(canvas.nodes)
    expect(fm.edges).toEqual(canvas.edges)
    expect(canvas.formmap).toBeUndefined()
  })

  test('lens switching with the header buttons and Alt+1..4; the lens persists per tab', async ({ app, page }) => {
    const m = await openMap(app)
    await m.lens('Board')
    await m.lens('Table')
    await m.lens('Doc')
    await m.lens('Map')
    for (const [key, name, sel] of [
      ['2', 'Board', '.fm-board'],
      ['3', 'Table', '.fm-table-lens'],
      ['4', 'Doc', '.fm-doc'],
      ['1', 'Map', '.fm-map']
    ] as const) {
      await page.keyboard.press(`Alt+${key}`)
      await expect(m.lensButton(name)).toHaveAttribute('aria-selected', 'true')
      await expect(m.fmRoot().locator(sel)).toBeVisible()
    }

    await m.lens('Board')
    await expect.poll(() => page.evaluate(() => window.__cs2d3k!.getActiveTab()?.state?.lens)).toBe('board')
    // a second tab on the same map has its own lens
    await app.openFile(DEFINITION, { newTab: true })
    await expect(m.fmRoot().locator('.fm-map')).toBeVisible()
    await m.lens('Table')
    await page.locator('.tab').filter({ hasText: 'CS2D3K Definition' }).first().click()
    await expect(m.fmRoot().locator('.fm-board')).toBeVisible()
    await expect(m.lensButton('Board')).toHaveAttribute('aria-selected', 'true')
    await page.locator('.tab').filter({ hasText: 'CS2D3K Definition' }).last().click()
    await expect(m.fmRoot().locator('.fm-table-lens')).toBeVisible()
  })
})

test.describe('form-map map lens @basic', () => {
  test('the toolbar creates a plain card and a card from each preset (tags + default fields)', async ({ app, page }) => {
    const m = await openMap(app)
    const before = forms(m.data()).length
    const make = async (label: string, title: string): Promise<FormCard> => {
      await m.root().locator(`.fm-tool[aria-label="${label}"]`).click()
      const input = m.root().locator('.fm-title-input')
      await expect(input).toBeFocused()
      await page.keyboard.type(title)
      await page.keyboard.press('Enter')
      await expect(input).toHaveCount(0)
      return (await m.waitForNode((n) => n.type === 'form' && n.title === title, `${title} saved`)) as FormCard
    }
    const plain = await make('Add card', 'Just a card')
    expect(plain).toMatchObject({ tags: [], fields: {} })
    expect('kind' in plain).toBe(false)
    for (const [preset, fields] of [
      ['idea', { status: 'raw' }],
      ['principle', {}],
      ['goal', {}],
      ['approach', { status: 'proposed' }],
      ['feature', {}],
      ['question', { status: 'open' }],
      ['note', {}]
    ] as const) {
      const c = await make(`Add ${preset}`, `New ${preset}`)
      expect(c.tags).toEqual([preset])
      expect(c.fields).toMatchObject(fields)
      await expect(m.card(c.id).locator('.fm-ctag')).toHaveText(`#${preset}`)
    }
    expect(forms(m.data())).toHaveLength(before + 8)
  })

  test('double-click inside a group creates its preset card with the group fields; outside, a plain card', async ({ app, page }) => {
    const m = await openMap(app)
    const d = m.data()
    const later = groupByLabel(d, 'Later features')
    await m.zoomToGroup(later.id)
    const p = await m.groupSpot(later.id)
    await page.mouse.dblclick(p.x, p.y)
    await expect(m.root().locator('.fm-title-input')).toBeFocused()
    await page.keyboard.type('Offline sync')
    await page.keyboard.press('Enter')
    const f = await m.waitForNode((n) => n.title === 'Offline sync')
    expect(f).toMatchObject({ tags: ['feature'], fields: { phase: 'later' } })
    expect(groupOf(m.data(), f)?.id).toBe(later.id)

    const inbox = groupByLabel(d, 'Idea inbox')
    await m.focus()
    await m.moveCamera(() => page.keyboard.press('Shift+1'))
    await m.zoomToGroup(inbox.id)
    const q = await m.groupSpot(inbox.id)
    await page.mouse.dblclick(q.x, q.y)
    await page.keyboard.type('Sticker reactions')
    await page.keyboard.press('Enter')
    const idea = await m.waitForNode((n) => n.title === 'Sticker reactions')
    expect(idea).toMatchObject({ tags: ['idea'], fields: { status: 'raw' } })
    expect(groupOf(m.data(), idea)?.id).toBe(inbox.id)

    // empty space outside every group → a plain card
    await m.focus()
    await m.moveCamera(() => page.keyboard.press('Shift+1'))
    const e = await m.emptyPoint({ region: { fx0: 0.1, fx1: 0.9, fy0: 0.03, fy1: 0.97 }, clearance: 25 })
    await page.mouse.dblclick(e.x, e.y)
    await page.keyboard.type('Floating thought')
    await page.keyboard.press('Enter')
    const free = await m.waitForNode((n) => n.title === 'Floating thought')
    expect(free).toMatchObject({ tags: [], fields: {} })
    expect(groupOf(m.data(), free)).toBeUndefined()
  })

  test('inline title and body edits are saved', async ({ app, page }) => {
    const m = await openMap(app)
    const card = formByTitle(m.data(), 'Plan screen')
    await m.zoomToGroup(groupByLabel(m.data(), 'Later features').id)
    await m.dblTap(m.card(card.id).locator('.fm-card-title'))
    const title = m.card(card.id).locator('.fm-title-input')
    await expect(title).toBeFocused()
    await page.keyboard.press('Control+a')
    await page.keyboard.type('Plan screen v2')
    await m.tap(m.card(card.id).locator('.fm-body-editor .cm-content'))
    await page.keyboard.press('Control+a')
    await page.keyboard.type('Shows **tasks** per day')
    await page.keyboard.press('Escape')
    await expect(title).toHaveCount(0)
    await m.expectData((d) => cardIn(d, card.id).title === 'Plan screen v2' && cardIn(d, card.id).text === 'Shows **tasks** per day', 'title + body saved')
    await expect(m.card(card.id).locator('.fm-card-title')).toHaveText('Plan screen v2')
    await expect(m.card(card.id).locator('.fm-card-body strong')).toHaveText('tasks')
  })

  test('field chips: select menu, stars, and the + Field chip; tags from the card', async ({ app, page }) => {
    const m = await openMap(app)
    const d = m.data()
    const card = formByTitle(d, 'Idea panel')
    await m.zoomToGroup(groupByLabel(d, 'Initial features (MVP)').id)
    await m.clickCard(card.id)
    const chips = m.card(card.id).locator('.fm-chips')
    await m.tap(chips.locator('.fm-chip', { hasText: 'Must' }))
    await page.locator('.menu-item', { hasText: 'Should' }).click()
    await m.expectData((x) => cardIn(x, card.id).fields.priority === 'should', 'priority via chip menu')
    await expect(chips.locator('.fm-chip', { hasText: 'Should' })).toBeVisible()
    await m.tap(chips.locator('.fm-chip', { hasText: 'Should' }))
    await page.locator('.menu-item', { hasText: 'Clear priority' }).click()
    await m.expectData((x) => cardIn(x, card.id).fields.priority === undefined, 'priority cleared')
    await expect(chips.locator('.fm-chip', { hasText: 'Should' })).toHaveCount(0)
    // stars: 2 → 2/5; clicking the current value clears it
    await m.tap(m.card(card.id).locator('.fm-star').nth(1))
    await m.expectData((x) => cardIn(x, card.id).fields.fun === 2, 'fun = 2')
    await expect(m.card(card.id).locator('.fm-star.is-on')).toHaveCount(2)
    await m.tap(m.card(card.id).locator('.fm-star').nth(1))
    await m.expectData((x) => cardIn(x, card.id).fields.fun === undefined, 'fun cleared')
    // + Field: any field of the map, here a select from a submenu
    await m.tap(chips.locator('.fm-chip.is-empty', { hasText: 'Field' }))
    await m.menuItem('Horizon').hover()
    await m.submenuItem('Milestone').click()
    await m.expectData((x) => cardIn(x, card.id).fields.horizon === 'milestone', 'horizon added')
    await expect(chips.locator('.fm-chip', { hasText: 'Milestone' })).toBeVisible()
    // a new tag from the card
    await m.tap(m.card(card.id).locator('.fm-ctag-add'))
    await page.locator('.menu-item', { hasText: 'New tag…' }).click()
    await page.locator('.modal .input').fill('#urgent')
    await page.locator('.modal .btn.mod-cta').click()
    await m.expectData((x) => (cardIn(x, card.id).tags ?? []).join() === 'feature,urgent' && !!meta(x).tags?.urgent?.color, 'tag added + registered')
    await expect(m.card(card.id).locator('.fm-ctag')).toHaveText(['#feature', '#urgent'])
  })

  test('dragging a card into another group applies its fields in one undo step', async ({ app, page }) => {
    const m = await openMap(app)
    const d = m.data()
    const card = formByTitle(d, 'Idea panel')
    const later = groupByLabel(d, 'Later features')
    const box = await m.nodeBox(card.id)
    const grabPt = { x: box.x + 14, y: box.y + 10 }
    const cardCenter = center(box)
    // aim so that the card's center lands in the empty lower part of "Later features"
    const target = await m.toScreen({ x: later.x + later.width / 2, y: later.y + later.height - 150 })
    const to = { x: target.x + (grabPt.x - cardCenter.x), y: target.y + (grabPt.y - cardCenter.y) }
    await m.drag(grabPt, to, { steps: 14, hold: true })
    await expect(m.root().locator('.fm-drop-target .fm-drop-label')).toHaveText('Phase → Later')
    await page.mouse.up()
    await expect(m.card(card.id)).toHaveClass(/fm-wiggle/)
    await expect(m.root().locator('.fm-chip-float', { hasText: 'Phase → Later' })).toBeVisible()
    await m.expectData((x) => cardIn(x, card.id).fields.phase === 'later' && groupOf(x, cardIn(x, card.id))?.id === later.id, 'phase later + inside the group')
    // one undo step puts back both the position and the phase
    await page.keyboard.press('Control+z')
    await m.expectData((x) => {
      const f = cardIn(x, card.id)
      return f.fields.phase === 'mvp' && f.x === card.x && f.y === card.y
    }, 'undo restores position + phase')
  })

  test('locked groups do not move; an unlocked group carries its cards', async ({ app, page }) => {
    const m = await openMap(app)
    const d = m.data()
    const oq = groupByLabel(d, 'Open questions')
    const inside = forms(d).filter((f) => groupOf(d, f)?.id === oq.id)
    expect(inside).toHaveLength(4)
    await m.zoomToGroup(oq.id)
    const label = async () => center(await m.nodeBox(oq.id, '.fm-group-label'))
    let lp = await label()
    await m.drag(lp, { x: lp.x + 60, y: lp.y + 40 })
    await page.evaluate(() => window.__cs2d3k!.fileops.flushAll())
    expect(groupByLabel(m.data(), 'Open questions').x).toBe(oq.x)

    await page.keyboard.press('Escape')
    await m.tap(m.node(oq.id).locator('.fm-group-lock'))
    await m.expectData((x) => groupByLabel(x, 'Open questions').locked === false, 'unlocked')
    await expect(m.node(oq.id)).toHaveClass(/is-unlocked/)
    lp = await label()
    await m.drag(lp, { x: lp.x + 60, y: lp.y + 40 })
    await m.expectData((x) => groupByLabel(x, 'Open questions').x !== oq.x, 'group moved')
    const after = m.data()
    const z2 = groupByLabel(after, 'Open questions')
    const dx = z2.x - oq.x
    const dy = z2.y - oq.y
    expect(dx).not.toBe(0)
    for (const f of inside) {
      const g = after.nodes.find((n) => n.id === f.id)!
      expect([g.x - f.x, g.y - f.y], f.title).toEqual([dx, dy])
    }
  })

  test('connecting cards infers the relation from tag rules; change it, or type a custom one, from the edge menu', async ({ app, page }) => {
    const m = await openMap(app)
    const d = m.data()
    const feature = formByTitle(d, 'UI mockup generation')
    const goal = formByTitle(d, 'Secure, Scalable, Satisfying — in that order')
    await m.connect(feature.id, goal.id, 'top')
    await expect(m.root().locator('.fm-chip-float', { hasText: 'serves' })).toBeVisible()
    let edgeId = ''
    await m.expectData((x) => {
      const e = x.edges.find((e) => e.fromNode === feature.id && e.toNode === goal.id)
      edgeId = e?.id ?? ''
      return e?.relation === 'serves'
    }, 'inferred serves')
    await expect(m.edge(edgeId)).toHaveClass(/fm-rel-serves/)

    let p = await m.edgePoint(edgeId)
    await page.mouse.click(p.x, p.y, { button: 'right' })
    await m.menuItem('Relation').hover()
    await m.submenuItem('Depends on').click()
    await m.expectData((x) => x.edges.find((e) => e.id === edgeId)?.relation === 'depends', 'relation changed')
    await expect(m.edge(edgeId)).toHaveClass(/fm-rel-depends/)
    await expect(m.edge(edgeId)).toHaveClass(/is-dashed/)

    p = await m.edgePoint(edgeId)
    await page.mouse.click(p.x, p.y, { button: 'right' })
    await m.menuItem('Relation').hover()
    await m.submenuItem('Custom…').click()
    await page.locator('.modal .input').fill('inspires')
    await page.locator('.modal .btn.mod-cta').click()
    await m.expectData((x) => x.edges.find((e) => e.id === edgeId)?.relation === 'inspires', 'custom relation')
    await expect(m.edge(edgeId)).toHaveClass(/fm-rel-custom/)
    await expect(m.edgeLabel(edgeId)).toHaveText('inspires')
  })

  test('W traces why a card exists and dims the rest; Esc clears', async ({ app, page }) => {
    const m = await openMap(app)
    const d = m.data()
    const goal = formByTitle(d, 'Bring the fun back')
    await m.clickCard(goal.id)
    await page.keyboard.press('w')
    await expect(m.root().locator('.fm-banner')).toContainText('Why-trace · 7 cards')
    const traced = ['Bring the fun back', 'Idea panel', 'Form-map definition board', 'UI mockup generation', 'Task queue panel', 'Review panel', 'Dev agent panel'].map((t) => formByTitle(d, t).id)
    for (const id of traced) await expect(m.card(id)).toHaveClass(/fm-lit/)
    await expect(m.root().locator('.fm-node-form.fm-dim')).toHaveCount(forms(d).length - 7)
    await expect(m.insp().locator('.fm-insp-hl')).toContainText('Highlighting 7 cards')
    await page.keyboard.press('Escape')
    await expect(m.root().locator('.fm-banner')).toHaveCount(0)
    await expect(m.root().locator('.fm-dim')).toHaveCount(0)
    // W with nothing selected explains itself
    await page.keyboard.press('Escape')
    await page.keyboard.press('w')
    await expect(page.locator('.notice', { hasText: 'Select a card, then press W' })).toBeVisible()
  })

  test('mind-map keys: Tab adds a child (the preset child), Enter a sibling', async ({ app, page }) => {
    const m = await openMap(app)
    await m.root().locator('.fm-tool[aria-label="Add goal"]').click()
    await page.keyboard.type('Bring fun back to dev')
    await page.keyboard.press('Enter')
    await page.keyboard.press('Tab')
    await expect(m.root().locator('.fm-title-input')).toBeFocused()
    await page.keyboard.type('Confetti on decisions')
    await page.keyboard.press('Enter')
    await page.keyboard.press('Enter')
    await expect(m.root().locator('.fm-title-input')).toBeFocused()
    await page.keyboard.type('Freehand doodles')
    await page.keyboard.press('Enter')
    await m.expectData((x) => forms(x).some((f) => f.title === 'Freehand doodles'), 'sibling saved')
    const d = m.data()
    const goal = formByTitle(d, 'Bring fun back to dev')
    const child = formByTitle(d, 'Confetti on decisions')
    const sib = formByTitle(d, 'Freehand doodles')
    expect([goal.tags, child.tags, sib.tags]).toEqual([['goal'], ['feature'], ['feature']])
    expect(d.edges.find((e) => e.fromNode === child.id && e.toNode === goal.id)).toMatchObject({ relation: 'serves', fromSide: 'left', toSide: 'right' })
    expect(d.edges.find((e) => e.fromNode === sib.id && e.toNode === goal.id)).toMatchObject({ relation: 'serves' })
    expect(child.x).toBeGreaterThan(goal.x + goal.width)
    expect(sib.x).toBe(child.x)
    expect(sib.y).toBeGreaterThan(child.y)
  })

  test('focusing a tag dims cards without it', async ({ app, page }) => {
    const m = await openMap(app)
    const d = m.data()
    await m.openInspectorTab('Map')
    const tags = m.insp().locator('.fm-reg-tag')
    await tags.filter({ has: page.locator('input[aria-label="Rename #goal"]') }).locator('button[title^="Focus on #goal"]').click()
    await expect(m.root().locator('.fm-banner')).toContainText('Focus · #goal')
    await expect(m.root().locator('.fm-node-form.fm-dim')).toHaveCount(forms(d).length - 3)
    for (const f of forms(d).filter((f) => f.tags?.includes('goal'))) await expect(m.card(f.id)).not.toHaveClass(/fm-dim/)
    // Esc on the map clears it
    await m.focus()
    await page.keyboard.press('Escape')
    await expect(m.root().locator('.fm-dim')).toHaveCount(0)
    // two tags; the banner close button clears
    await tags.filter({ has: page.locator('input[aria-label="Rename #goal"]') }).locator('button[title^="Focus on"]').click()
    await tags.filter({ has: page.locator('input[aria-label="Rename #question"]') }).locator('button[title^="Focus on"]').click()
    await expect(m.root().locator('.fm-node-form:not(.fm-dim)')).toHaveCount(7)
    await m.root().locator('.fm-banner-close').click()
    await expect(m.root().locator('.fm-dim')).toHaveCount(0)
  })

  test('the minimap navigates the camera', async ({ app }) => {
    const m = await openMap(app)
    const d = m.data()
    const zs = groups(d)
    const i = zs.findIndex((z) => z.label === 'Open questions')
    const z = zs[i]
    await m.ctrlWheel(center(await m.rootBox()), -100, 3)
    // the minimap redraws throttled (its bounds include the view): click once the group stops moving
    const mini = m.root().locator('.fm-minimap-group').nth(i)
    let last = ''
    await expect
      .poll(async () => {
        const b = await mini.boundingBox()
        const k = b ? `${Math.round(b.x)},${Math.round(b.y)},${Math.round(b.width)}` : ''
        const same = k === last
        last = k
        return same && k !== ''
      }, { intervals: [250] })
      .toBe(true)
    const rect = center((await mini.boundingBox())!)
    await m.moveCamera(() => app.page.mouse.click(rect.x, rect.y))
    const c = await m.toWorld(center(await m.rootBox()))
    expect(Math.abs(c.x - (z.x + z.width / 2))).toBeLessThan(z.width * 0.1)
    expect(Math.abs(c.y - (z.y + z.height / 2))).toBeLessThan(z.height * 0.1)
    await expect(m.root().locator('.fm-minimap-view')).toBeVisible()
  })

  test('align, distribute and tidy', async ({ app, page }) => {
    const m = await openMap(app)
    const d = m.data()
    const id = (t: string): string => formByTitle(d, t).id
    const x = (data: CData, t: string): number => data.nodes.find((n) => n.id === id(t))!.x

    // distribute three cards horizontally: even gaps, outer cards stay
    await m.clickCard(id('Idea panel'))
    await m.clickCard(id('Task queue panel'), { modifiers: ['Shift'] })
    await m.clickCard(id('Automated server bug detection'), { modifiers: ['Shift'] })
    await expect.poll(async () => (await m.selectedIds()).length).toBe(3)
    await m.clickCard(id('Task queue panel'), { button: 'right' })
    await m.menuItem('Distribute').hover()
    await m.submenuItem('Horizontally').click()
    await m.expectData((n) => x(n, 'Task queue panel') === 450, 'distributed')
    expect([x(m.data(), 'Idea panel'), x(m.data(), 'Automated server bug detection')]).toEqual([30, 870])

    // align left
    await m.clickCard(id('Idea panel'))
    await m.clickCard(id('Review panel'), { modifiers: ['Shift'] })
    await m.clickCard(id('Review panel'), { button: 'right' })
    await m.menuItem('Align').hover()
    await m.submenuItem('Left').click()
    await m.expectData((n) => x(n, 'Review panel') === 30, 'aligned left')

    // tidy the inbox group from its context menu
    const inbox = groupByLabel(d, 'Idea inbox')
    await m.focus()
    await page.keyboard.press('Escape')
    const lb = await m.nodeBox(inbox.id, '.fm-group-label')
    await page.mouse.click(lb.x + 5, lb.y + lb.height / 2, { button: 'right' })
    await m.menuItem('Tidy cards').click()
    const ideas = ['XP for merged tasks', 'Voice capture', "Weekly 'what shipped' recap"]
    await m.expectData((n) => ideas.map((t) => n.nodes.find((c) => c.id === id(t))!.y).join() === '460,650,840', 'tidied')
    expect(ideas.map((t) => x(m.data(), t))).toEqual([-470, -470, -470])
  })

  test('the pen draws a drawing node', async ({ app, page }) => {
    const m = await openMap(app)
    await m.focus()
    await page.keyboard.press('p')
    await expect(m.root()).toHaveClass(/fm-pen-mode/)
    await expect(m.root().locator('.fm-pen-hint')).toBeVisible()
    const r = await m.rootBox()
    const sx = r.x + r.width * 0.45
    const sy = r.y + r.height * 0.4
    await page.mouse.move(sx, sy)
    await page.mouse.down()
    for (let i = 0; i <= 30; i++) {
      const a = (i / 30) * Math.PI * 2
      await page.mouse.move(sx + Math.cos(a) * 70 + i * 2, sy + Math.sin(a) * 40)
    }
    await page.mouse.up()
    const n = await m.waitForNode((n) => n.type === 'drawing', 'drawing saved')
    expect((n.points as number[]).length).toBeGreaterThanOrEqual(8)
    expect(n.strokeWidth).toBeGreaterThan(0)
    await expect(m.node(n.id).locator('.fm-drawing-stroke')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(m.root().locator('.fm-pen-hint')).toHaveCount(0)
    await expect(m.root()).not.toHaveClass(/fm-pen-mode/)
    await m.root().locator('.fm-tool[aria-label="Pen"]').click()
    await expect(m.root()).toHaveClass(/fm-pen-mode/)
    await m.root().locator('.fm-tool[aria-label="Pen"]').click()
    await expect(m.root()).not.toHaveClass(/fm-pen-mode/)
  })

  test('pitch mode: ordered groups as slides, arrows/Esc, sidebars collapsed and restored', async ({ app, page }) => {
    const m = await openMap(app)
    const sidebars = (): Promise<boolean[]> => app.state('workspace', '(s) => [s.left.open, s.right.open]')
    const before = await sidebars()
    await expect(m.fmRoot().locator('.fm-inspector')).toBeVisible()
    await page.locator('button[title^="Pitch mode"]').click()
    const bar = m.root().locator('.fm-pitch-bar')
    await expect(bar).toBeVisible()
    await expect(bar.locator('.fm-pitch-count')).toHaveText('1 / 7')
    await expect(m.root().locator('.fm-pitch-label')).toHaveText('Core idea')
    await expect.poll(sidebars).toEqual([false, false])
    await expect(m.fmRoot().locator('.fm-inspector')).toHaveCount(0)
    await expect(m.root().locator('.fm-toolbar')).toHaveCount(0)
    const labels = ['Core idea', 'Philosophy', 'Engineering approach', 'Final goal', 'Initial features (MVP)', 'Later features', 'Open questions']
    for (let i = 1; i < labels.length; i++) {
      await page.keyboard.press('ArrowRight')
      await expect(bar.locator('.fm-pitch-count')).toHaveText(`${i + 1} / 7`)
      await expect(m.root().locator('.fm-pitch-label')).toHaveText(labels[i])
    }
    const q = groupByLabel(m.data(), 'Open questions')
    await expect(m.node(q.id)).not.toHaveClass(/fm-dim/)
    await expect(m.card(formByTitle(m.data(), 'Idea panel').id)).toHaveClass(/fm-dim/)
    await page.keyboard.press('ArrowLeft')
    await expect(bar.locator('.fm-pitch-count')).toHaveText('6 / 7')
    await page.keyboard.press('Home')
    await expect(bar.locator('.fm-pitch-count')).toHaveText('1 / 7')
    await page.keyboard.press('Escape')
    await expect(bar).toHaveCount(0)
    await expect.poll(sidebars).toEqual(before)
    await expect(m.fmRoot().locator('.fm-inspector')).toBeVisible()
    await expect(m.root().locator('.fm-toolbar')).toBeVisible()
  })

  test('the votes badge adds and removes dot votes', async ({ app, page }) => {
    const m = await openMap(app)
    const d = m.data()
    const card = formByTitle(d, 'Plan screen')
    await m.zoomToGroup(groupByLabel(d, 'Later features').id)
    const votes = m.card(card.id).locator('.fm-votes')
    await expect(votes).toHaveCount(0)
    await m.clickCard(card.id)
    await expect(votes).toHaveClass(/is-zero/)
    await m.tap(votes)
    await expect(m.root().locator('.fm-chip-float', { hasText: '+1 vote' })).toBeVisible()
    await m.tap(votes)
    await m.expectData((x) => cardIn(x, card.id).votes === 2, 'two votes')
    await expect(votes).toHaveText('2')
    await m.clickCard(card.id, { button: 'right' })
    await m.menuItem('Remove a vote').click()
    await m.expectData((x) => cardIn(x, card.id).votes === 1, 'one vote left')
    await m.focus()
    await page.keyboard.press('Escape')
    await expect(votes).toHaveText('1')
    await expect(votes).not.toHaveClass(/is-zero/)
  })

  test('finishing a card celebrates with confetti and moves the HUD board progress', async ({ app, page }) => {
    const m = await openMap(app)
    const d = m.data()
    const card = formByTitle(d, 'Form-map definition board')
    await expect(m.root().locator('.fm-hud-title')).toContainText('Features by status')
    await expect(m.root().locator('.fm-hud-title-num')).toHaveText('0/10 done')
    await m.zoomToGroup(groupByLabel(d, 'Initial features (MVP)').id)
    await m.clickCard(card.id)
    await m.tap(m.card(card.id).locator('.fm-chip', { hasText: 'Building' }))
    await page.locator('.menu-item', { hasText: 'Done' }).click()
    await expect(page.locator('canvas.fm-confetti')).toHaveCount(1)
    await m.expectData((x) => cardIn(x, card.id).fields.status === 'done', 'done saved')
    await expect(m.card(card.id).locator('.fm-card')).toHaveClass(/is-win/)
    await expect(m.card(card.id).locator('.fm-win-badge')).toBeVisible()
    await expect(m.root().locator('.fm-hud-title-num')).toHaveText('1/10 done')
    // the confetti canvas removes itself (~1.2s animation)
    await expect(page.locator('canvas.fm-confetti')).toHaveCount(0, { timeout: 5_000 })
  })
})

test.describe('form-map nested groups @basic', () => {
  test.use({ vault: { source: 'sample', files: { 'Nested.formmap': NESTED } } })

  test('nested groups: a card dropped into an inner group gets the outer and the inner fields', async ({ app, page }) => {
    const m = await openMap(app, 'Nested.formmap')
    const box = await m.nodeBox('task')
    const grab = { x: box.x + 14, y: box.y + 10 }
    const target = await m.toScreen({ x: 950, y: 400 })
    const c = center(box)
    await m.drag(grab, { x: target.x + (grab.x - c.x), y: target.y + (grab.y - c.y) }, { steps: 12, hold: true })
    await expect(m.root().locator('.fm-drop-label')).toHaveText('sprint → 12, status → doing')
    await page.mouse.up()
    await m.expectData((d) => JSON.stringify(cardIn(d, 'task').fields) === '{"sprint":12,"status":"doing"}' && groupOf(d, cardIn(d, 'task'))?.id === 'doing', 'outer + inner fields')
    // the parent group counts its nested cards
    await expect(m.node('sprint').locator('.fm-group-count')).toHaveText('1')
    await expect(m.node('doing').locator('.fm-group-count')).toHaveText('1')
  })
})
