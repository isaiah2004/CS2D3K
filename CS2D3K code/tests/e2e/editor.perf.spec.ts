// Performance budgets for the note editor and the graph (run with `npm run test:perf`, one worker).
// Measurements are attached to the report as annotations.
import { test, expect } from './fixtures'
import { MarkdownEditor } from './helpers/editor'
import { Graph } from './helpers/graph'

const LINES = 5000
const bigNote = Array.from({ length: LINES }, (_, i) =>
  i % 40 === 0 ? `## Section ${i}` : i % 7 === 0 ? `- [ ] task ${i} with [[Other]] and #tag${i % 13}` : `Line ${i} has **bold**, *italic*, \`code\` and a [[Other|link]].`
).join('\n')

function graphVault(n: number): Record<string, string> {
  let seed = 42
  const rnd = (): number => (seed = (seed * 16807) % 2147483647) / 2147483647
  const files: Record<string, string> = {}
  for (let i = 0; i < n; i++) {
    const links: string[] = []
    const count = 1 + Math.floor(rnd() * 3)
    for (let j = 0; j < count; j++) {
      // mostly local links (clusters) plus some long-range ones
      const t = rnd() < 0.8 ? Math.max(0, Math.min(n - 1, i + Math.floor((rnd() - 0.5) * 30))) : Math.floor(rnd() * n)
      if (t !== i) links.push(`[[Note ${t}]]`)
    }
    if (rnd() < 0.05) links.push(`[[Missing ${Math.floor(rnd() * 20)}]]`)
    const tag = rnd() < 0.3 ? ` #topic${Math.floor(rnd() * 10)}` : ''
    files[`folder ${i % 20}/Note ${i}.md`] = `# Note ${i}\n\n${links.join(' ')}${tag}\n`
  }
  return files
}

test.describe('editor performance @perf', () => {
  test.use({ vault: { source: 'empty', files: { 'Big.md': bigNote, 'Other.md': '# Other\n' } } })

  test(`opening a ${LINES}-line note takes < 2 s`, async ({ app }, testInfo) => {
    const ed = new MarkdownEditor(app)
    const t0 = Date.now()
    await app.treeItem('Big.md').click()
    await ed.waitLoaded()
    await expect(ed.line('Line 1 has')).toBeVisible()
    const ms = Date.now() - t0
    testInfo.annotations.push({ type: 'open-5000-lines-ms', description: String(ms) })
    expect(ms).toBeLessThan(2000)

    // jumping to the end renders quickly too
    await ed.content().click()
    const t1 = Date.now()
    await app.page.keyboard.press('Control+End')
    await expect(ed.line(`Line ${LINES - 1} has`)).toBeVisible()
    const jump = Date.now() - t1
    testInfo.annotations.push({ type: 'jump-to-end-ms', description: String(jump) })
    expect(jump).toBeLessThan(1000)
  })

  test('typing latency in a long note stays low', async ({ app, page }, testInfo) => {
    const ed = new MarkdownEditor(app)
    await ed.open('Big.md')
    await ed.setCursorAtLineEnd('Line 2500 has')
    // keydown → next painted frame, per keystroke
    await page.evaluate(() => {
      const w = window as unknown as { __lat: number[] }
      w.__lat = []
      document.addEventListener(
        'keydown',
        () => {
          const t = performance.now()
          requestAnimationFrame(() => setTimeout(() => w.__lat.push(performance.now() - t), 0))
        },
        true
      )
    })
    const text = ' the quick brown fox jumps over the lazy dog'.repeat(3)
    await page.keyboard.type(text, { delay: 20 })
    await expect.poll(() => page.evaluate(() => (window as unknown as { __lat: number[] }).__lat.length)).toBe(text.length)
    const lat = (await page.evaluate(() => (window as unknown as { __lat: number[] }).__lat)).sort((a, b) => a - b)
    const p50 = lat[Math.floor(lat.length * 0.5)]
    const p95 = lat[Math.floor(lat.length * 0.95)]
    testInfo.annotations.push({ type: 'typing-latency-ms', description: `p50 ${p50.toFixed(1)} · p95 ${p95.toFixed(1)} · max ${lat[lat.length - 1].toFixed(1)}` })
    expect(p50).toBeLessThan(34)
    expect(p95).toBeLessThan(60)
    await app.expectFile('Big.md', (c) => c.includes(`Line 2500 has **bold**, *italic*, \`code\` and a [[Other|link]].${text}\n`))
  })
})

test.describe('graph performance @perf', () => {
  const N = 1000
  test.use({ vault: { source: 'empty', files: graphVault(N) } })

  test(`a graph of ${N} notes renders and settles within budget`, async ({ app, page }, testInfo) => {
    const graph = new Graph(app)
    const t0 = Date.now()
    await graph.open()
    await expect(graph.status()).toHaveText(/^10\d\d nodes · \d+ links$/, { timeout: 10_000 })
    const shown = Date.now() - t0
    // frame rate while the simulation runs
    const fps = await page.evaluate(
      (ms) =>
        new Promise<{ fps: number; worst: number }>((resolve) => {
          let frames = 0
          let worst = 0
          let last = performance.now()
          const start = last
          const tick = (t: number): void => {
            frames++
            worst = Math.max(worst, t - last)
            last = t
            if (t - start < ms) requestAnimationFrame(tick)
            else resolve({ fps: Math.round((frames * 1000) / (t - start)), worst: Math.round(worst) })
          }
          requestAnimationFrame(tick)
        }),
      1500
    )
    await graph.waitSettled(30_000)
    const settled = Date.now() - t0
    const { nodes, links } = await graph.counts()
    testInfo.annotations.push({ type: 'graph', description: `${nodes} nodes / ${links} links · shown ${shown} ms · settled ${settled} ms · ${fps.fps} fps (worst frame ${fps.worst} ms)` })
    expect(nodes).toBeGreaterThanOrEqual(N)
    expect(shown).toBeLessThan(3000)
    expect(settled).toBeLessThan(20_000)
    expect(fps.fps).toBeGreaterThan(20)
    expect(fps.worst).toBeLessThan(250)

    // clicking a node still works on a big graph
    await graph.clickNode('folder 0/Note 0.md')
    await expect.poll(() => app.activeFile()).toBe('folder 0/Note 0.md')
  })
})
