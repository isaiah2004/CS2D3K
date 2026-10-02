// Form-map shell + Map lens end-to-end (ported from e2e/formmap-shell.mjs and e2e/formmap-map.mjs).
// Drives the map like a user (mouse + keyboard) and asserts on the UI and on the .formmap JSON on disk.
import { test, expect } from './fixtures'
import type { App } from './helpers/app'
import { center, type CData } from './helpers/canvas'
import { DEFINITION, FormMapPage, formByTitle, forms, zoneByLabel, zoneOf, zones, type FormCard } from './helpers/formmap'

async function openMap(app: App, file = DEFINITION): Promise<FormMapPage> {
  const m = new FormMapPage(app, file)
  await m.open()
  return m
}

const PRODUCT_ZONES = ['Core idea', 'Philosophy', 'Engineering approach', 'Final goal', 'Initial features (MVP)', 'Later features', 'Open questions', 'Idea inbox']

test.describe('form-map shell @basic', () => {
  test('creating a form-map shows the template picker; each template writes its zones', async ({ app, page }) => {
    // ribbon → product definition
    await page.locator('.ribbon [title="Create new form-map"]').click()
    await expect.poll(() => app.activeFile()).toBe('Untitled form-map.formmap')
    const picker = app.activeView().locator('.fm-template-picker')
    await expect(picker.locator('.fm-template-card')).toHaveText([/Product definition/, /Brainstorm/, /Blank/])
    expect(app.read('Untitled form-map.formmap')).toBe('')
    await picker.locator('.fm-template-card', { hasText: 'Product definition' }).click()
    await expect(app.activeView().locator('.fm-node-zone')).toHaveCount(8)
    await app.expectFile('Untitled form-map.formmap', (s) => s.includes('"zone"'))
    let d = app.readJson<CData>('Untitled form-map.formmap')
    expect(d.formmap).toMatchObject({ version: 1, template: 'product-definition', mvpBudget: 40 })
    expect(zones(d).map((z) => z.label)).toEqual(PRODUCT_ZONES)
    expect(zones(d).every((z) => z.locked)).toBe(true)
    expect(zoneByLabel(d, 'Initial features (MVP)')).toMatchObject({ defaultKind: 'feature', assign: { phase: 'mvp' }, order: 5 })
    expect(zoneByLabel(d, 'Later features')).toMatchObject({ defaultKind: 'feature', assign: { phase: 'later' }, order: 6 })
    expect(zoneByLabel(d, 'Final goal').assign).toEqual({ horizon: 'final' })
    expect(zoneByLabel(d, 'Idea inbox').order).toBeUndefined()

    // explorer background menu → brainstorm
    const explorer = page.locator('.pane-body', { has: app.treeItem('Welcome.md') })
    const eb = (await explorer.boundingBox())!
    await page.mouse.click(eb.x + 30, eb.y + eb.height - 15, { button: 'right' })
    await page.locator('.menu-item', { hasText: 'New form-map' }).click()
    await expect.poll(() => app.activeFile()).toBe('Untitled form-map 1.formmap')
    await app.activeView().locator('.fm-template-card', { hasText: 'Brainstorm' }).click()
    await expect(app.activeView().locator('.fm-node-zone')).toHaveCount(1)
    await app.expectFile('Untitled form-map 1.formmap', (s) => s.includes('"zone"'))
    d = app.readJson<CData>('Untitled form-map 1.formmap')
    expect(d.formmap).toMatchObject({ template: 'brainstorm' })
    expect(zones(d)).toHaveLength(1)
    expect(zones(d)[0]).toMatchObject({ label: 'Idea inbox', defaultKind: 'idea', locked: true })

    // command palette → blank: no zones, the empty map
    await app.runPaletteCommand('Create new form-map')
    await expect.poll(() => app.activeFile()).toBe('Untitled form-map 2.formmap')
    await app.activeView().locator('.fm-template-card', { hasText: 'Blank' }).click()
    await expect(app.activeView().locator('.fm-map .canvas-empty-hint')).toBeVisible()
    await app.expectFile('Untitled form-map 2.formmap', (s) => s.includes('"blank"'))
    d = app.readJson<CData>('Untitled form-map 2.formmap')
    expect(d).toMatchObject({ formmap: { template: 'blank' }, nodes: [], edges: [] })
  })

  test('"Convert current canvas to form-map" copies the canvas into a new form-map', async ({ app, page }) => {
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
    const canvas = app.readJson<CData>('Architecture.canvas')
    const fm = app.readJson<CData>('Architecture.formmap')
    expect(fm.formmap).toEqual({ version: 1, template: 'converted' })
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
  test('the toolbar creates a card of each kind', async ({ app, page }) => {
    const m = await openMap(app)
    const before = forms(m.data()).length
    for (const kind of ['idea', 'principle', 'goal', 'approach', 'feature', 'question', 'note']) {
      await m.root().locator(`.fm-tool[aria-label="Add ${kind}"]`).click()
      const title = m.root().locator('.fm-title-input')
      await expect(title).toBeFocused()
      await page.keyboard.type(`New ${kind}`)
      await page.keyboard.press('Enter')
      await expect(title).toHaveCount(0)
      const card = await m.waitForNode((n) => n.type === 'form' && n.title === `New ${kind}`, `${kind} saved`)
      expect(card.kind).toBe(kind)
      await expect(m.card(card.id).locator('.fm-kind-chip')).toContainText(kind, { ignoreCase: true })
    }
    expect(forms(m.data())).toHaveLength(before + 7)
  })

  test('double-click creates the zone default kind (and applies zone.assign), an idea outside zones', async ({ app, page }) => {
    const m = await openMap(app)
    let d = m.data()
    const later = zoneByLabel(d, 'Later features')
    await m.zoomToZone(later.id)
    const p = await m.zoneSpot(later.id)
    await page.mouse.dblclick(p.x, p.y)
    await expect(m.root().locator('.fm-title-input')).toBeFocused()
    await page.keyboard.type('Offline sync')
    await page.keyboard.press('Enter')
    const f = await m.waitForNode((n) => n.title === 'Offline sync')
    expect(f).toMatchObject({ kind: 'feature', fields: { phase: 'later' } })
    expect(zoneOf(m.data(), f)?.id).toBe(later.id)

    const inbox = zoneByLabel(d, 'Idea inbox')
    await m.focus()
    await m.moveCamera(() => page.keyboard.press('Shift+1'))
    await m.zoomToZone(inbox.id)
    const q = await m.zoneSpot(inbox.id)
    await page.mouse.dblclick(q.x, q.y)
    await page.keyboard.type('Sticker reactions')
    await page.keyboard.press('Enter')
    const idea = await m.waitForNode((n) => n.title === 'Sticker reactions')
    expect(idea.kind).toBe('idea')
    expect(zoneOf(m.data(), idea)?.id).toBe(inbox.id)

    // empty space outside every zone → idea
    await m.focus()
    await m.moveCamera(() => page.keyboard.press('Shift+1'))
    const e = await m.emptyPoint({ region: { fx0: 0.1, fx1: 0.9, fy0: 0.03, fy1: 0.97 }, clearance: 25 })
    await page.mouse.dblclick(e.x, e.y)
    await page.keyboard.type('Floating thought')
    await page.keyboard.press('Enter')
    const free = await m.waitForNode((n) => n.title === 'Floating thought')
    d = m.data()
    expect(free.kind).toBe('idea')
    expect(zoneOf(d, free)).toBeUndefined()
  })

  test('inline title and body edits are saved', async ({ app, page }) => {
    const m = await openMap(app)
    const card = formByTitle(m.data(), 'Plan screen')
    await m.zoomToZone(zoneByLabel(m.data(), 'Later features').id)
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
    await m.expectData((d) => {
      const f = d.nodes.find((n) => n.id === card.id) as FormCard
      return f.title === 'Plan screen v2' && f.text === 'Shows **tasks** per day'
    }, 'title + body saved')
    await expect(m.card(card.id).locator('.fm-card-title')).toHaveText('Plan screen v2')
    await expect(m.card(card.id).locator('.fm-card-body strong')).toHaveText('tasks')
  })

  test('field chips: select menu and star rating are saved', async ({ app, page }) => {
    const m = await openMap(app)
    const d = m.data()
    const card = formByTitle(d, 'Idea panel')
    await m.zoomToZone(zoneByLabel(d, 'Initial features (MVP)').id)
    await m.clickCard(card.id)
    const chips = m.card(card.id).locator('.fm-chips')
    await m.tap(chips.locator('.fm-chip', { hasText: 'Must' }))
    await expect(page.locator('.menu-item', { hasText: 'Must' })).toHaveClass(/menu-item/)
    await page.locator('.menu-item', { hasText: 'Should' }).click()
    await m.expectData((x) => (x.nodes.find((n) => n.id === card.id) as FormCard).fields.priority === 'should', 'priority via chip menu')
    await expect(chips.locator('.fm-chip', { hasText: 'Should' })).toBeVisible()
    // clear a field from the menu
    await m.tap(chips.locator('.fm-chip', { hasText: 'Should' }))
    await page.locator('.menu-item', { hasText: 'Clear priority' }).click()
    await m.expectData((x) => (x.nodes.find((n) => n.id === card.id) as FormCard).fields.priority === undefined, 'priority cleared')
    await expect(chips.locator('.fm-chip.is-empty', { hasText: '+ Priority' })).toBeVisible()
    // stars: 2 → 2/5; clicking the current value clears it
    await m.tap(m.card(card.id).locator('.fm-star').nth(1))
    await m.expectData((x) => (x.nodes.find((n) => n.id === card.id) as FormCard).fields.fun === 2, 'fun = 2')
    await expect(m.card(card.id).locator('.fm-star.is-on')).toHaveCount(2)
    await m.tap(m.card(card.id).locator('.fm-star').nth(1))
    await m.expectData((x) => (x.nodes.find((n) => n.id === card.id) as FormCard).fields.fun === 0, 'fun cleared')
  })

  test('dragging a card into another zone applies zone.assign in one undo step', async ({ app, page }) => {
    const m = await openMap(app)
    const d = m.data()
    const card = formByTitle(d, 'Idea panel')
    const later = zoneByLabel(d, 'Later features')
    const grab = await m.nodeBox(card.id, '.fm-kind-chip')
    const grabPt = { x: grab.x + 6, y: grab.y + grab.height / 2 }
    const cardCenter = center(await m.nodeBox(card.id))
    // aim so that the card's center lands in the empty lower part of "Later features"
    const target = await m.toScreen({ x: later.x + later.width / 2, y: later.y + later.height - 150 })
    const to = { x: target.x + (grabPt.x - cardCenter.x), y: target.y + (grabPt.y - cardCenter.y) }
    await m.drag(grabPt, to, { steps: 14, hold: true })
    await expect(m.root().locator('.fm-drop-target .fm-drop-label')).toHaveText('Phase → Later')
    await page.mouse.up()
    await expect(m.card(card.id)).toHaveClass(/fm-wiggle/)
    await expect(m.root().locator('.fm-chip-float', { hasText: 'Phase → Later' })).toBeVisible()
    await m.expectData((x) => {
      const f = x.nodes.find((n) => n.id === card.id) as FormCard
      return f.fields.phase === 'later' && zoneOf(x, f)?.id === later.id
    }, 'phase later + inside the zone')
    // one undo step puts back both the position and the phase
    await page.keyboard.press('Control+z')
    await m.expectData((x) => {
      const f = x.nodes.find((n) => n.id === card.id) as FormCard
      return f.fields.phase === 'mvp' && f.x === card.x && f.y === card.y
    }, 'undo restores position + phase')
  })

  test('locked zones do not move; an unlocked zone carries its cards', async ({ app, page }) => {
    const m = await openMap(app)
    const d = m.data()
    const oq = zoneByLabel(d, 'Open questions')
    const inside = forms(d).filter((f) => zoneOf(d, f)?.id === oq.id)
    expect(inside).toHaveLength(4)
    await m.zoomToZone(oq.id)
    const label = async () => center(await m.nodeBox(oq.id, '.fm-zone-label'))
    let lp = await label()
    await m.drag(lp, { x: lp.x + 60, y: lp.y + 40 })
    await page.evaluate(() => window.__cs2d3k!.fileops.flushAll())
    expect(zoneByLabel(m.data(), 'Open questions').x).toBe(oq.x)

    await page.keyboard.press('Escape')
    await m.tap(m.node(oq.id).locator('.fm-zone-lock'))
    await m.expectData((x) => zoneByLabel(x, 'Open questions').locked === false, 'unlocked')
    await expect(m.node(oq.id)).toHaveClass(/is-unlocked/)
    lp = await label()
    await m.drag(lp, { x: lp.x + 60, y: lp.y + 40 })
    await m.expectData((x) => zoneByLabel(x, 'Open questions').x !== oq.x, 'zone moved')
    const after = m.data()
    const z2 = zoneByLabel(after, 'Open questions')
    const dx = z2.x - oq.x
    const dy = z2.y - oq.y
    expect(dx).not.toBe(0)
    for (const f of inside) {
      const g = after.nodes.find((n) => n.id === f.id)!
      expect([g.x - f.x, g.y - f.y], f.title).toEqual([dx, dy])
    }
  })

  test('connecting cards infers the relation; change it from the edge menu', async ({ app, page }) => {
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

    const p = await m.edgePoint(edgeId)
    await page.mouse.click(p.x, p.y, { button: 'right' })
    await m.menuItem('Relation').hover()
    await m.submenuItem('Depends on').click()
    await m.expectData((x) => x.edges.find((e) => e.id === edgeId)?.relation === 'depends', 'relation changed')
    await expect(m.edge(edgeId)).toHaveClass(/fm-rel-depends/)
    await expect(m.edge(edgeId)).toHaveClass(/is-dashed/)
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

  test('mind-map keys: Tab adds a child, Enter a sibling', async ({ app, page }) => {
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
    expect([goal.kind, child.kind, sib.kind]).toEqual(['goal', 'feature', 'feature'])
    expect(d.edges.find((e) => e.fromNode === child.id && e.toNode === goal.id)).toMatchObject({ relation: 'serves', fromSide: 'left', toSide: 'right' })
    expect(d.edges.find((e) => e.fromNode === sib.id && e.toNode === goal.id)).toMatchObject({ relation: 'serves' })
    expect(child.x).toBeGreaterThan(goal.x + goal.width)
    expect(sib.x).toBe(child.x)
    expect(sib.y).toBeGreaterThan(child.y)
  })

  test('the focus filter dims cards that do not match', async ({ app, page }) => {
    const m = await openMap(app)
    const d = m.data()
    await m.openInspectorTab('Map')
    const focus = m.insp().locator('.fm-maptab .fm-i-section').filter({ hasText: 'Focus' })
    await focus.locator('.fm-kchip', { hasText: 'Goal' }).click()
    await expect(m.root().locator('.fm-banner')).toContainText('Focus · Goals')
    await expect(m.root().locator('.fm-node-form.fm-dim')).toHaveCount(forms(d).length - 3)
    for (const f of forms(d).filter((f) => f.kind === 'goal')) await expect(m.card(f.id)).not.toHaveClass(/fm-dim/)
    // Esc on the map clears it
    await m.focus()
    await page.keyboard.press('Escape')
    await expect(m.root().locator('.fm-dim')).toHaveCount(0)
    // phase filter: only MVP features stay bright; the banner close button clears it
    await focus.locator('.fm-opt-chip', { hasText: 'Initial (MVP)' }).click()
    await expect(m.root().locator('.fm-node-form:not(.fm-dim)')).toHaveCount(6)
    await m.root().locator('.fm-banner-close').click()
    await expect(m.root().locator('.fm-dim')).toHaveCount(0)
  })

  test('the minimap navigates the camera', async ({ app }) => {
    const m = await openMap(app)
    const d = m.data()
    const zs = zones(d)
    const i = zs.findIndex((z) => z.label === 'Open questions')
    const z = zs[i]
    await m.ctrlWheel(center(await m.rootBox()), -100, 3)
    const rect = center((await m.root().locator('.fm-minimap-zone').nth(i).boundingBox())!)
    await m.moveCamera(() => app.page.mouse.click(rect.x, rect.y))
    const r = await m.rootBox()
    const c = await m.toWorld(center(r))
    expect(Math.abs(c.x - (z.x + z.width / 2))).toBeLessThan(z.width * 0.1)
    expect(Math.abs(c.y - (z.y + z.height / 2))).toBeLessThan(z.height * 0.1)
    // the viewport rectangle follows
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

    // tidy the inbox zone from its context menu
    const inbox = zoneByLabel(d, 'Idea inbox')
    await m.focus()
    await page.keyboard.press('Escape')
    const lb = await m.nodeBox(inbox.id, '.fm-zone-label')
    await page.mouse.click(lb.x + 5, lb.y + lb.height / 2, { button: 'right' })
    await m.menuItem('Tidy cards').click()
    const ideas = ['XP for merged tasks', 'Voice capture', "Weekly 'what shipped' recap"]
    await m.expectData((n) => ideas.map((t) => n.nodes.find((c) => c.id === id(t))!.y).join() === '490,680,870', 'tidied')
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
    // the toolbar button toggles it too
    await m.root().locator('.fm-tool[aria-label="Pen"]').click()
    await expect(m.root()).toHaveClass(/fm-pen-mode/)
    await m.root().locator('.fm-tool[aria-label="Pen"]').click()
    await expect(m.root()).not.toHaveClass(/fm-pen-mode/)
  })

  test('pitch mode: zones as slides in order, arrows/Esc, sidebars collapsed and restored', async ({ app, page }) => {
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
    // cards outside the current slide are dimmed
    const q = zoneByLabel(m.data(), 'Open questions')
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
    await m.zoomToZone(zoneByLabel(d, 'Later features').id)
    const votes = m.card(card.id).locator('.fm-votes')
    await expect(votes).toHaveCount(0)
    await m.clickCard(card.id)
    await expect(votes).toHaveClass(/is-zero/)
    await m.tap(votes)
    await expect(m.root().locator('.fm-chip-float', { hasText: '+1 vote' })).toBeVisible()
    await m.tap(votes)
    await m.expectData((x) => (x.nodes.find((n) => n.id === card.id) as FormCard).votes === 2, 'two votes')
    await expect(votes).toHaveText('2')
    await m.clickCard(card.id, { button: 'right' })
    await m.menuItem('Remove a vote').click()
    await m.expectData((x) => (x.nodes.find((n) => n.id === card.id) as FormCard).votes === 1, 'one vote left')
    // the badge stays visible on unselected cards with votes
    await m.focus()
    await page.keyboard.press('Escape')
    await expect(votes).toHaveText('1')
    await expect(votes).not.toHaveClass(/is-zero/)
  })

  test('marking a feature done celebrates with confetti', async ({ app, page }) => {
    const m = await openMap(app)
    const d = m.data()
    const card = formByTitle(d, 'Form-map definition board')
    await m.zoomToZone(zoneByLabel(d, 'Initial features (MVP)').id)
    await m.clickCard(card.id)
    await m.tap(m.card(card.id).locator('.fm-chip', { hasText: 'Building' }))
    await page.locator('.menu-item', { hasText: 'Done' }).click()
    await expect(page.locator('canvas.fm-confetti')).toHaveCount(1)
    await m.expectData((x) => (x.nodes.find((n) => n.id === card.id) as FormCard).fields.status === 'done', 'done saved')
    await expect(m.card(card.id).locator('.fm-card')).toHaveClass(/is-win/)
    await expect(m.card(card.id).locator('.fm-win-badge')).toBeVisible()
    await expect(m.root().locator('.fm-hud-title')).toHaveText('MVP 1/6 done')
    // the confetti canvas removes itself (~1.2s animation)
    await expect(page.locator('canvas.fm-confetti')).toHaveCount(0, { timeout: 5_000 })
  })
})
