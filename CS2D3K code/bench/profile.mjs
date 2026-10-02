// CPU-profiles a benchmark interaction and prints the hottest functions (self time).
//   node bench/profile.mjs graph-zoom|graph-hover|graph-open-bible|canvas-pan|canvas-zoom|formmap-pan|formmap-zoom [--n 1000] [--trace]
import { _electron as electron } from 'playwright'
import { rmSync } from 'fs'
import { join } from 'path'
import { synthetic, bible, canvasVault, formmapVault } from './vaults.mjs'

const ROOT = join(import.meta.dirname, '..')
const which = process.argv[2] ?? 'graph-zoom'
const N = process.argv.includes('--n') ? Number(process.argv[process.argv.indexOf('--n') + 1]) : 1000
const dir = which === 'graph-open-bible' ? bible({ level: 'verse', crossRefs: 78000 }) : which.startsWith('canvas') ? canvasVault(N) : which.startsWith('formmap') ? formmapVault(N) : synthetic(1000)
rmSync(join(dir, '.cs2d3k'), { recursive: true, force: true })
const env = { ...process.env, CS2D3K_TEST: '1', CS2D3K_BENCH: '1', CS2D3K_VAULT: dir, CS2D3K_USER_DATA: process.env.BENCH_USERDATA || join(ROOT, 'bench', '.cache', 'userdata-prof') }
delete env.ELECTRON_RUN_AS_NODE
const app = await electron.launch({ args: [join(ROOT, process.env.CS2D3K_OUT || 'out', 'main', 'index.js')], cwd: ROOT, env })
const page = await app.firstWindow()
page.on('console', (m) => m.text().startsWith('frames ') && console.log('[page]', m.text()))
await page.waitForFunction(() => !!window.__cs2d3k, null, { timeout: 120000 })
await page.evaluate(() => window.__cs2d3k.ready())
await page.evaluate(() => window.__cs2d3k.stores.workspace.getState().toggleSidebar('right', false))
const cdp = await page.context().newCDPSession(page)
await cdp.send('Profiler.enable')
await cdp.send('Profiler.setSamplingInterval', { interval: 200 })

const TRACE = process.argv.includes('--trace')
const traceEvents = []
cdp.on('Tracing.dataCollected', (e) => traceEvents.push(...e.value))
const PLAIN = process.argv.includes('--plain')
const run = async (fn) => {
  if (PLAIN) {
    await fn()
    process.exit(0)
  }
  if (TRACE) {
    await cdp.send('Tracing.start', { categories: 'devtools.timeline,disabled-by-default-devtools.timeline,gpu,cc,viz', transferMode: 'ReportEvents' })
    await fn()
    const done = new Promise((r) => cdp.once('Tracing.tracingComplete', r))
    await cdp.send('Tracing.end')
    await done
    return null
  }
  await cdp.send('Profiler.start')
  await fn()
  const { profile } = await cdp.send('Profiler.stop')
  return profile
}

let profile
if (which.startsWith('graph') && which !== 'graph-open-bible') {
  await page.evaluate(() => window.__cs2d3k.executeCommand('graph:open'))
  await page.waitForFunction(() => [...document.querySelectorAll('.view-graph canvas')].some((c) => c.__graph?.isSettled()), null, { timeout: 120000, polling: 250 })
  profile = await run(() =>
    page.evaluate(async (kind) => {
      const c = [...document.querySelectorAll('.view-graph canvas')].find((x) => x.__graph)
      const r = c.getBoundingClientRect()
      const end = performance.now() + 3000
      let i = 0
      while (performance.now() < end) {
        await new Promise((res) => requestAnimationFrame(res))
        i++
        if (kind === 'graph-zoom') c.dispatchEvent(new WheelEvent('wheel', { deltaY: i % 80 < 40 ? -30 : 30, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, bubbles: true, cancelable: true }))
        else c.dispatchEvent(new PointerEvent('pointermove', { clientX: r.left + ((i * 7) % r.width), clientY: r.top + r.height / 2, bubbles: true, pointerType: 'mouse' }))
      }
    }, which)
  )
} else if (which === 'graph-open-bible') {
  profile = await run(async () => {
    await page.evaluate(() => window.__cs2d3k.executeCommand('graph:open'))
    await page.waitForFunction(() => [...document.querySelectorAll('.view-graph canvas')].some((c) => c.__graph?.nodeCount > 0), null, { timeout: 120000 })
  })
} else {
  const ext = which.startsWith('canvas') ? 'canvas' : 'formmap'
  await page.evaluate(() => window.__cs2d3k.stores.workspace.getState().toggleSidebar('left', false))
  await page.evaluate((p) => window.__cs2d3k.stores.workspace.getState().openFile(p), `Bench ${N}.${ext}`)
  await page.waitForSelector('.canvas-view[data-ready], .canvas-world [data-node-id]', { state: 'attached' })
  await page.waitForTimeout(1500)
  if (process.argv.includes('--zoom')) {
    // start from a given zoom (e.g. full mode with DOM cards) instead of the fitted view
    const z = Number(process.argv[process.argv.indexOf('--zoom') + 1])
    await page.evaluate((z) => {
      const e = document.querySelector('.view:not(.hidden) .canvas-view').__canvasEngine
      const { w, h } = e.viewSize()
      const c = e.viewCenter()
      e.setViewport({ x: w / 2 - c.x * z, y: h / 2 - c.y * z, zoom: z }, false)
    }, z)
    await page.waitForTimeout(2000)
  }
  if (process.argv.includes('--css')) {
    await page.addStyleTag({ content: process.argv[process.argv.indexOf('--css') + 1] })
    await page.waitForTimeout(500)
  }
  if (process.argv.includes('--prezoom'))
    // a 2 s zoom sweep right before the profiled interaction (no settle in between)
    await page.evaluate(async () => {
      const root = document.querySelector('.view:not(.hidden) .canvas-world').parentElement
      const r = root.getBoundingClientRect()
      const end = performance.now() + 2000
      let i = 0
      while (performance.now() < end) {
        await new Promise((res) => requestAnimationFrame(res))
        i++
        root.dispatchEvent(new WheelEvent('wheel', { deltaY: i % 80 < 40 ? -20 : 20, ctrlKey: true, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, bubbles: true, cancelable: true }))
      }
    })
  if (which.endsWith('drag')) {
    // drag the card nearest the view center back and forth (real mouse events), report ms per move
    const at = await page.evaluate((types) => {
      const rootEl = document.querySelector('.view:not(.hidden) .canvas-view')
      const eng = rootEl.__canvasEngine
      const root = rootEl.getBoundingClientRect()
      let best = null
      if (!eng) {
        // builds without the engine handle: nearest DOM card
        for (const el of rootEl.querySelectorAll('.canvas-world [data-node-id]:not(.canvas-node-group):not(.fm-node-zone)')) {
          const b = el.getBoundingClientRect()
          const gx = b.left + b.width / 2
          const gy = b.top + Math.min(12, b.height / 2)
          const d = Math.hypot(gx - (root.left + root.width / 2), gy - (root.top + root.height / 2))
          if (!best || d < best.d) best = { d, x: gx, y: gy }
        }
        return best
      }
      const v = eng.getViewport()
      for (const n of eng.data().nodes) {
        if (!types.includes(n.type)) continue
        const gx = root.left + v.x + (n.x + n.width / 2) * v.zoom
        const gy = root.top + v.y + n.y * v.zoom + Math.min(12, (n.height * v.zoom) / 2)
        const d = Math.hypot(gx - (root.left + root.width / 2), gy - (root.top + root.height / 2))
        if (!best || d < best.d) best = { d, x: gx, y: gy }
      }
      return best
    }, which.startsWith('canvas') ? ['text', 'code'] : ['form'])
    profile = await run(async () => {
      if (process.argv.includes('--hover')) {
        // floor: plain mouse moves, no button (nothing changes on screen)
        const t1 = Date.now()
        for (let i = 1; i <= 120; i++) await page.mouse.move(at.x + (i % 60) * 3, at.y + 200)
        console.log(`[hover] ${((Date.now() - t1) / 120).toFixed(1)} ms per move`)
      }
      await page.mouse.move(at.x, at.y)
      await page.mouse.down()
      const t0 = Date.now()
      let moves = 0
      for (let k = 0; k < 4; k++)
        for (let i = 1; i <= 60; i++) {
          const f = k % 2 ? 1 - i / 60 : i / 60
          await page.mouse.move(at.x + 300 * f, at.y + 60 * f)
          moves++
        }
      console.log(`[drag] ${((Date.now() - t0) / moves).toFixed(1)} ms per move`)
      await page.mouse.up()
    })
  } else profile = await run(() =>
    page.evaluate(async (kind) => {
      const root = document.querySelector('.view:not(.hidden) .canvas-world').parentElement
      const r = root.getBoundingClientRect()
      const end = performance.now() + 3000
      let i = 0
      const gaps = []
      let last = performance.now()
      while (performance.now() < end) {
        await new Promise((res) => requestAnimationFrame(res))
        const now = performance.now()
        gaps.push(now - last)
        last = now
        i++
        if (kind.endsWith('zoom')) root.dispatchEvent(new WheelEvent('wheel', { deltaY: i % 80 < 40 ? -20 : 20, ctrlKey: true, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, bubbles: true, cancelable: true }))
        else root.dispatchEvent(new WheelEvent('wheel', { deltaX: i % 120 < 60 ? 6 : -6, clientX: r.left + 40, clientY: r.top + 40, bubbles: true, cancelable: true }))
      }
      gaps.sort((a, b) => a - b)
      console.log(`frames ${gaps.length}, p50 ${gaps[gaps.length >> 1].toFixed(1)} ms, p95 ${gaps[Math.floor(gaps.length * 0.95)].toFixed(1)} ms`)
    }, which)
  )
}
await app.close()

if (TRACE) {
  // total duration per trace event name (complete events), top 25
  const agg = new Map()
  for (const e of traceEvents) if (e.ph === 'X' && e.dur) agg.set(`${e.name} [${e.cat.split(',')[0]}]`, (agg.get(`${e.name} [${e.cat.split(',')[0]}]`) ?? 0) + e.dur / 1000)
  console.log(`${which} trace (ms per event type over the run):`)
  for (const [k, v] of [...agg].sort((a, b) => b[1] - a[1]).slice(0, 25)) console.log(`${v.toFixed(1).padStart(9)} ms  ${k}`)
  process.exit(0)
}
// aggregate self time per function
const byId = new Map(profile.nodes.map((n) => [n.id, n]))
const self = new Map()
const dt = profile.timeDeltas
profile.samples.forEach((id, i) => {
  const n = byId.get(id)
  const f = n.callFrame
  const key = `${f.functionName || '(anonymous)'}  ${f.url.split('/').pop()}:${f.lineNumber + 1}`
  self.set(key, (self.get(key) ?? 0) + (dt[i] ?? 0) / 1000)
})
const total = [...self.values()].reduce((a, b) => a + b, 0)
console.log(`${which}: ${total.toFixed(0)} ms sampled`)
for (const [k, v] of [...self].sort((a, b) => b[1] - a[1]).slice(0, 25)) console.log(`${v.toFixed(1).padStart(8)} ms  ${((v / total) * 100).toFixed(1).padStart(5)}%  ${k}`)
