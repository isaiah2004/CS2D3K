// Performance budgets for the canvas engine and the form-map lenses (tag @perf, run with `npm run test:perf`).
import { test, expect } from './fixtures'
import type { Page } from '@playwright/test'
import { CanvasPage, center } from './helpers/canvas'
import { FormMapPage, type Lens } from './helpers/formmap'

const KINDS = ['idea', 'principle', 'goal', 'approach', 'feature', 'question', 'note']

/** deterministic pseudo-random numbers */
function rng(seed: number): () => number {
  let s = seed
  return () => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648)
}

function bigCanvas(nodes: number, edges: number): string {
  const r = rng(7)
  const cols = Math.ceil(Math.sqrt(nodes))
  const ns = Array.from({ length: nodes }, (_, i) => {
    const x = (i % cols) * 320
    const y = Math.floor(i / cols) * 200
    if (i % 10 === 9) return { id: `n${i}`, type: 'code', language: 'python', code: `print(${i})\nfor k in range(3):\n    print(k)`, x, y, width: 280, height: 160 }
    return { id: `n${i}`, type: 'text', text: `## Card ${i}\nSome **markdown** text with a [[Welcome]] link and a list:\n- one\n- two`, x, y, width: 260, height: 140, ...(i % 7 === 0 ? { color: String((i % 6) + 1) } : {}) }
  })
  const es = Array.from({ length: edges }, (_, i) => {
    const a = Math.floor(r() * nodes)
    let b = a + 1 + Math.floor(r() * 3) * cols
    if (b >= nodes) b = Math.max(0, a - cols)
    return { id: `e${i}`, fromNode: `n${a}`, toNode: `n${b}`, ...(i % 5 === 0 ? { label: `edge ${i}` } : {}) }
  })
  return JSON.stringify({ nodes: ns, edges: es }, null, '\t')
}

function bigFormMap(cards: number): string {
  const zones = KINDS.map((k, i) => ({ id: `z${i}`, type: 'zone', label: `Zone ${k}`, emoji: '✨', x: i * 2100, y: 0, width: 2000, height: 2600, defaultKind: k, order: i + 1, locked: true }))
  const forms = Array.from({ length: cards }, (_, i) => {
    const kind = KINDS[i % KINDS.length]
    const zi = i % KINDS.length
    const j = Math.floor(i / KINDS.length)
    const fields: Record<string, unknown> =
      kind === 'feature' ? { phase: ['mvp', 'later', 'next'][j % 3], priority: 'should', effort: 'm', status: 'planned', fun: (j % 5) + 1 } : kind === 'question' ? { status: 'open' } : kind === 'idea' ? { status: 'raw' } : {}
    return { id: `f${i}`, type: 'form', kind, title: `${kind} card ${i}`, text: `Details for card ${i} with **markdown**`, fields, votes: i % 4, x: zi * 2100 + 40 + (j % 6) * 320, y: 80 + Math.floor(j / 6) * 220, width: 280, height: 180 }
  })
  const edges = Array.from({ length: Math.floor(cards / 2) }, (_, i) => ({ id: `r${i}`, fromNode: `f${i * 2}`, toNode: `f${(i * 2 + 9) % cards}`, relation: 'relates' }))
  return JSON.stringify({ formmap: { version: 1, title: 'Big map', mvpBudget: 40 }, nodes: [...zones, ...forms], edges }, null, '\t')
}

/** records requestAnimationFrame gaps while `fn` runs; returns the frame gaps in ms */
async function frameGaps(page: Page, fn: () => Promise<void>): Promise<number[]> {
  await page.evaluate(() => {
    const w = window as unknown as { __gaps: number[]; __rec: boolean }
    w.__gaps = []
    w.__rec = true
    let last = performance.now()
    const tick = (t: number): void => {
      w.__gaps.push(t - last)
      last = t
      if (w.__rec) requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  })
  await fn()
  return page.evaluate(() => {
    const w = window as unknown as { __gaps: number[]; __rec: boolean }
    w.__rec = false
    return w.__gaps.slice(1)
  })
}

const pct = (xs: number[], p: number): number => [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(xs.length * p))]

test.describe('canvas performance @perf', () => {
  test.use({ vault: { source: 'sample', files: { 'Big.canvas': bigCanvas(500, 600) } } })

  test('a canvas with 500 nodes / 600 edges opens in < 3 s and pans/zooms without long frames', async ({ app, page }, testInfo) => {
    const c = new CanvasPage(app, 'Big.canvas')
    const t0 = Date.now()
    await app.treeItem('Big.canvas').click()
    // the engine culls to the view and, zoomed out on a board this size, draws the cards and edges on its canvas layer
    // (not as 500 DOM cards): "open" = the engine rendered the whole file
    await expect(c.root()).toHaveAttribute('data-ready', '', { timeout: 15_000 })
    await expect(c.root()).toHaveAttribute('data-node-count', '500')
    await expect(c.root()).toHaveAttribute('data-edge-count', '600')
    await expect(c.root()).toHaveAttribute('data-render', 'canvas')
    const openMs = Date.now() - t0
    await c.settle()

    const r = await c.rootBox()
    const p = center(r)
    await page.mouse.move(p.x, p.y)
    const gaps = await frameGaps(page, async () => {
      for (let i = 0; i < 15; i++) await page.mouse.wheel(i % 2 ? 60 : -60, 90)
      await c.ctrlWheel(p, -100, 4)
      await c.ctrlWheel(p, 100, 6)
      for (let i = 0; i < 10; i++) await page.mouse.wheel(-80, -40)
      // space + drag pans
      await c.focus()
      await page.keyboard.down('Space')
      await c.drag(p, { x: p.x + 200, y: p.y + 120 }, { steps: 20 })
      await page.keyboard.up('Space')
    })
    const max = Math.max(...gaps)
    const p95 = pct(gaps, 0.95)
    const long = gaps.filter((g) => g > 100).length
    testInfo.annotations.push({ type: 'perf', description: `open ${openMs} ms · ${gaps.length} frames · p95 ${p95.toFixed(1)} ms · max ${max.toFixed(1)} ms · >100ms: ${long}` })
    console.log(`[perf] canvas 500/600: open ${openMs} ms, frames ${gaps.length}, p95 ${p95.toFixed(1)} ms, max ${max.toFixed(1)} ms, >100ms ${long}`)

    expect(openMs, 'open time').toBeLessThan(3000)
    expect(p95, 'p95 frame time while panning/zooming').toBeLessThan(50)
    // the first camera move promotes the world to its own layer (one slower frame); after that frames stay short
    expect(long, 'frames longer than 100 ms').toBeLessThanOrEqual(2)
    expect(max, 'longest frame').toBeLessThan(250)

    // cards anywhere on the board render their full content once the camera gets there (culling mounts them)
    await c.moveCamera(() => page.evaluate(() => (document.querySelector('.view:not(.hidden) .canvas-view') as HTMLElement & { __canvasEngine: { fitNodes(ids: string[], z: number, a: boolean): void } }).__canvasEngine.fitNodes(['n498'], 1, false)))
    await expect(c.node('n498').locator('.canvas-markdown')).toBeVisible()
    await expect(c.node('n498').locator('h2')).toHaveText('Card 498')
    await expect(c.root()).toHaveAttribute('data-render', 'full')
  })
})

test.describe('form-map performance @perf', () => {
  test.use({ vault: { source: 'sample', files: { 'Big.formmap': bigFormMap(300) } } })

  test('a form-map with 300 cards switches lenses in < 1 s', async ({ app }, testInfo) => {
    const m = new FormMapPage(app, 'Big.formmap')
    await m.open()
    // zoomed out on 300 cards the map draws them on its canvas layer: the engine reports every node of the file
    const mapReady = async (): Promise<void> => {
      await expect(m.root()).toBeVisible()
      await expect(m.root()).toHaveAttribute('data-ready', '')
      await expect(m.root()).toHaveAttribute('data-node-count', '307')
    }
    await mapReady()
    const ready: Record<Lens, () => Promise<void>> = {
      Map: mapReady,
      Board: () => expect(m.fmRoot().locator('.fm-board .fm-col').first()).toBeVisible(),
      Table: () => expect(m.fmRoot().locator('.fm-table tbody tr')).toHaveCount(300),
      Doc: () => expect(m.fmRoot().locator('.fm-doc-md h2').last()).toHaveText('Idea inbox')
    }
    const times: string[] = []
    // twice: the first switch also loads the lens chunk
    for (const round of [1, 2])
      for (const lens of ['Board', 'Table', 'Doc', 'Map'] as Lens[]) {
        const t0 = Date.now()
        await m.lensButton(lens).click()
        await ready[lens]()
        const ms = Date.now() - t0
        times.push(`${lens}#${round} ${ms}ms`)
        expect(ms, `${lens} lens (round ${round})`).toBeLessThan(1000)
      }
    // the board shows every card once grouped by kind
    await m.lensButton('Board').click()
    await m.fmRoot().locator('.fm-seg button', { hasText: 'Kind' }).click()
    await expect(m.fmRoot().locator('.fm-bcard')).toHaveCount(300)
    testInfo.annotations.push({ type: 'perf', description: times.join(' · ') })
    console.log(`[perf] form-map 300 lens switches: ${times.join(', ')}`)
  })
})
