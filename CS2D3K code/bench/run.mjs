// CS2D3K performance benchmarks: graph, canvas, form-map.
//
//   npm run build && node bench/run.mjs [--only graph|canvas|formmap] [--quick] [--fresh] [--out name]
//   (--case <text>: only the graph scenarios whose name contains <text>, e.g. --case Bible)
//
// Runs the production build with vsync and the frame-rate cap disabled (CS2D3K_BENCH=1) so FPS numbers
// show real headroom. Results: bench/results/<name>.json and a markdown summary printed to stdout.
import { _electron as electron } from 'playwright'
import { mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from 'fs'
import { join } from 'path'
import { synthetic, bible, canvasVault, formmapVault } from './vaults.mjs'

const ROOT = join(import.meta.dirname, '..')
const args = process.argv.slice(2)
const flag = (f) => args.includes(f)
const opt = (f, d) => (args.includes(f) ? args[args.indexOf(f) + 1] : d)
const ONLY = opt('--only', null)
const QUICK = flag('--quick')
/** only graph scenarios whose name contains this text, e.g. --case 10k */
const CASE = opt('--case', null)
const FRESH = flag('--fresh')
const OUT = opt('--out', new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-'))
const SAMPLE_MS = QUICK ? 1500 : 3000

// ---------------------------------------------------------------- app launch

async function launch(vaultDir, { width = 1600, height = 1000 } = {}) {
  rmSync(join(vaultDir, '.cs2d3k'), { recursive: true, force: true })
  // BENCH_USERDATA lets concurrent benchmark runs (graph vs canvas) use separate profiles
  const userData = process.env.BENCH_USERDATA || join(ROOT, 'bench', '.cache', 'userdata')
  rmSync(userData, { recursive: true, force: true })
  const env = { ...process.env, CS2D3K_TEST: '1', CS2D3K_BENCH: '1', CS2D3K_VAULT: vaultDir, CS2D3K_USER_DATA: userData }
  delete env.ELECTRON_RUN_AS_NODE
  const t0 = Date.now()
  const app = await electron.launch({ args: [join(ROOT, process.env.CS2D3K_OUT || 'out', 'main', 'index.js')], cwd: ROOT, env })
  const page = await app.firstWindow()
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
  await app.evaluate(({ BrowserWindow }, s) => {
    const w = BrowserWindow.getAllWindows()[0]
    w.unmaximize()
    w.setSize(s.width, s.height)
  }, { width, height })
  await page.waitForFunction(() => !!window.__cs2d3k, null, { timeout: 120_000 })
  await page.evaluate(() => window.__cs2d3k.ready())
  const readyMs = Date.now() - t0
  await page.evaluate(installHelpers)
  // the right sidebar's local graph would compete for frames — benchmark the main view alone
  await page.evaluate(() => window.__cs2d3k.stores.workspace.getState().toggleSidebar('right', false))
  return { app, page, readyMs, errors }
}

/** In-page helpers: frame sampling with an rAF-driven interaction callback. */
function installHelpers() {
  const stats = (arr) => {
    if (!arr.length) return { n: 0, avg: 0, p50: 0, p95: 0, p99: 0, max: 0 }
    const s = [...arr].sort((a, b) => a - b)
    const q = (p) => s[Math.min(s.length - 1, Math.floor(p * s.length))]
    return { n: s.length, avg: s.reduce((a, b) => a + b, 0) / s.length, p50: q(0.5), p95: q(0.95), p99: q(0.99), max: s[s.length - 1] }
  }
  window.__bench = {
    stats,
    heapMB: () => (performance.memory ? performance.memory.usedJSHeapSize / 1048576 : null),
    /** run `onFrame(i, t)` every animation frame for `ms`; returns browser frame intervals */
    sample(ms, onFrame) {
      return new Promise((resolve) => {
        const intervals = []
        let last = 0
        let i = 0
        const start = performance.now()
        const step = (t) => {
          if (last) intervals.push(t - last)
          last = t
          if (t - start >= ms) {
            const s = stats(intervals)
            resolve({ fps: intervals.length / ((t - start) / 1000), frame: s, long: intervals.filter((x) => x > 16.7).length })
            return
          }
          onFrame?.(i++, t)
          requestAnimationFrame(step)
        }
        requestAnimationFrame(step)
      })
    },
    nextPaint: () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)))
  }
}

const round = (v, d = 1) => (typeof v === 'number' ? Math.round(v * 10 ** d) / 10 ** d : v)

// ---------------------------------------------------------------- graph

async function benchGraph(name, vaultDir) {
  const { app, page, readyMs, errors } = await launch(vaultDir)
  try {
    const notes = await page.evaluate(() => Object.values(window.__cs2d3k.stores.vault.getState().files).filter((f) => f.ext === 'md').length)
    // time to first rendered graph, measured in-page (playwright's rAF polling starves when frames are slow)
    const openMs = await page.evaluate(async () => {
      const s = performance.now()
      window.__cs2d3k.executeCommand('graph:open')
      const find = () => [...document.querySelectorAll('.view-graph canvas')].find((x) => x.__graph)
      while (!(find()?.__graph.nodeCount > 0) && performance.now() - s < 120000) await new Promise((r) => setTimeout(r, 2))
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
      return performance.now() - s
    })
    // instrument the engine: it reports its own main-thread cost per frame through the bench hooks
    await page.evaluate(() => {
      const eng = (window.__eng = [...document.querySelectorAll('.view-graph canvas')].find((x) => x.__graph).__graph)
      if (!eng.bench) {
        // pre-WebGL engine (baseline builds): equivalent hooks around its internals
        const frame = eng.frame
        let ticks = 0
        let since = performance.now()
        eng.bench = {
          frameTimes: null,
          // the 1px readback waits for the GPU to rasterize the frame, like bench.draw() of the WebGL engine
          draw: () => (eng.draw(), eng.ctx.getImageData(0, 0, 1, 1)),
          pan: (dx, dy) => ((eng.cam.x += dx), (eng.cam.y += dy), (eng.autoFit = false), eng.requestFrame()),
          restart: () => eng.animate(),
          stats: () => {
            const now = performance.now()
            const tps = (ticks * 1000) / Math.max(1, now - since)
            ticks = 0
            since = now
            return { renderer: 'canvas2d', simInThread: true, tickMs: eng.tickCost, ticksPerSec: eng.isSettled() ? 0 : tps }
          }
        }
        const sim = eng.sim
        const tick = sim.tick.bind(sim)
        sim.tick = (...a) => (ticks++, tick(...a))
        eng.frame = (t) => {
          const s = performance.now()
          frame(t)
          eng.bench.frameTimes?.push(performance.now() - s)
        }
      }
    })
    const counts = await page.evaluate(() => ({ nodes: window.__eng.nodeCount, links: window.__eng.linkCount, renderer: window.__eng.bench.stats().renderer }))

    // phase 1: simulation running (layout settling), no interaction
    const sim = await page.evaluate(async (ms) => {
      const eng = window.__eng
      const frames = (eng.bench.frameTimes = [])
      let tps = 0
      let tpsN = 0
      let tickMs = 0
      const r = await window.__bench.sample(ms, (i) => {
        if (i % 10 === 0) {
          const st = eng.bench.stats()
          if (st.ticksPerSec) (tps += st.ticksPerSec), tpsN++, (tickMs = Math.max(tickMs, st.tickMs))
        }
      })
      eng.bench.frameTimes = null
      return { ...r, engine: window.__bench.stats(frames), engineFps: frames.length / (ms / 1000), tickMs, ticksPerSec: tpsN ? tps / tpsN : 0 }
    }, SAMPLE_MS)

    // settle
    const settleMs = SAMPLE_MS + (await page.evaluate(async () => {
      const s = performance.now()
      while (!window.__eng.isSettled() && performance.now() - s < 180000) await new Promise((r) => setTimeout(r, 50))
      return performance.now() - s
    }))
    const settled = await page.evaluate(() => window.__eng.isSettled())

    // pure render cost: draw() back to back, each waiting for the GPU to finish the frame
    const draw = await page.evaluate(() => {
      const eng = window.__eng
      const times = []
      // warm-up: the first synchronous GPU readback of a session sets up the readback path (seconds on ANGLE/D3D)
      for (let i = 0; i < 5; i++) eng.bench.draw()
      for (let i = 0; i < 60; i++) {
        const s = performance.now()
        eng.bench.draw()
        times.push(performance.now() - s)
      }
      return window.__bench.stats(times)
    })

    // phase 2: interaction on a settled graph, phase 3: the same while the layout restarts from scratch
    const interact = async (kind, settling) =>
      page.evaluate(
        async ({ kind, ms, settling }) => {
          const eng = window.__eng
          const c = eng.canvas
          const r = c.getBoundingClientRect()
          if (settling) {
            eng.bench.restart()
            await new Promise((res) => requestAnimationFrame(res))
          }
          const frames = (eng.bench.frameTimes = [])
          const res = await window.__bench.sample(ms, (i) => {
            if (kind === 'pan') {
              eng.bench.pan(i % 120 < 60 ? 4 : -4, 0)
            } else if (kind === 'zoom') {
              c.dispatchEvent(new WheelEvent('wheel', { deltaY: i % 80 < 40 ? -30 : 30, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, bubbles: true, cancelable: true }))
            } else if (kind === 'hover') {
              const x = r.left + ((i * 7) % r.width)
              const y = r.top + r.height / 2 + Math.sin(i / 10) * r.height * 0.3
              c.dispatchEvent(new PointerEvent('pointermove', { clientX: x, clientY: y, bubbles: true, pointerType: 'mouse' }))
            }
          })
          eng.bench.frameTimes = null
          const stillSettling = settling ? !eng.isSettled() : undefined
          return { ...res, engine: window.__bench.stats(frames), engineFps: frames.length / (ms / 1000), stillSettling }
        },
        { kind, ms: SAMPLE_MS, settling }
      )
    const pan = await interact('pan', false)
    const zoom = await interact('zoom', false)
    const hover = await interact('hover', false)
    // leave the pointer, re-fit, then interact while the layout restarts
    await page.evaluate(() => window.__eng.canvas.dispatchEvent(new PointerEvent('pointerleave', { bubbles: true })))
    await page.evaluate(() => window.__eng.zoomToFit())
    const settlingPan = await interact('pan', true)
    const settlingZoom = await interact('zoom', true)
    const settlingHover = await interact('hover', true)

    // update latency: add a link to a note and wait until the graph has it
    const update = await page.evaluate(async () => {
      const md = Object.values(window.__cs2d3k.stores.vault.getState().files).filter((f) => f.ext === 'md')
      const a = md[0].path
      const b = md[md.length - 1].path.replace(/\.md$/, '')
      const before = window.__eng.linkCount
      const s = performance.now()
      const content = await window.api.fs.readText(a)
      await window.__cs2d3k.fileops.saveFile(a, content + `\n[[${b}]] [[Brand new note ${Date.now()}]]\n`)
      while (window.__eng.linkCount === before && performance.now() - s < 10000) await new Promise((r) => setTimeout(r, 5))
      return performance.now() - s
    })
    const heapMB = await page.evaluate(() => window.__bench.heapMB())
    return {
      scenario: name, notes, ...counts, readyMs, openMs, settleMs, settled, heapMB,
      sim: { fps: sim.fps, browserP95: sim.frame.p95, engineFps: sim.engineFps, frameP95: sim.engine.p95, frameAvg: sim.engine.avg, tickMs: sim.tickMs, ticksPerSec: sim.ticksPerSec },
      drawMs: draw,
      pan: summarize(pan), zoom: summarize(zoom), hover: summarize(hover),
      settling: { pan: summarize(settlingPan), zoom: summarize(settlingZoom), hover: summarize(settlingHover) },
      updateMs: update, errors
    }
  } finally {
    await app.close().catch(() => {})
  }
}

function summarize(r) {
  // fps = frames the browser actually presented (uncapped); engine cost = time the graph spent per frame
  return { fps: r.fps, engineFps: r.engineFps, frameAvg: r.engine?.avg ?? r.frame.avg, frameP95: r.engine?.p95 ?? r.frame.p95, browserP95: r.frame.p95, long: r.long, stillSettling: r.stillSettling }
}

// ---------------------------------------------------------------- canvas / form-map (DOM based)

// The engine culls to the viewport (+ margin); zoomed out on a big board it draws cards on its canvas layer instead of
// the DOM. So "open" = until the engine reports its first render (data-ready, set in the commit that draws the board)
// and "DOM nodes" = mounted node elements vs the total in the file.
async function openAndTime(page, path) {
  return page.evaluate(async (p) => {
    const s = performance.now()
    window.__cs2d3k.stores.workspace.getState().openFile(p)
    const ready = () => {
      const root = document.querySelector('.view:not(.hidden) .canvas-view[data-ready]')
      return root && Number(root.dataset.nodeCount) > 0 ? root : null
    }
    while (!ready() && performance.now() - s < 60000) await new Promise((r) => setTimeout(r, 5))
    await window.__bench.nextPaint()
    const root = ready()
    return { ms: performance.now() - s, domNodes: root?.querySelectorAll('.canvas-world [data-node-id]').length ?? 0, render: root?.dataset.render }
  }, path)
}

async function domInteract(page, kind) {
  return page.evaluate(
    async ({ kind, ms }) => {
      const world = document.querySelector('.view:not(.hidden) .canvas-world')
      const root = world.parentElement
      const r = root.getBoundingClientRect()
      const res = await window.__bench.sample(ms, (i) => {
        if (kind === 'pan') root.dispatchEvent(new WheelEvent('wheel', { deltaX: i % 120 < 60 ? 6 : -6, deltaY: 0, clientX: r.left + 40, clientY: r.top + 40, bubbles: true, cancelable: true }))
        // 'zoom': the original sweep (40 frames in, 40 out) runs into the 0.1x / 4x zoom limits for over half its frames;
        // the camera doesn't move there, Chrome produces no new frame and rAF falls back to ~60 Hz, so it under-reports.
        // 'zoomRange': same wheel deltas, 12 frames each way (~11x range from the fit zoom), never clamped.
        else if (kind === 'zoomRange') root.dispatchEvent(new WheelEvent('wheel', { deltaY: i % 24 < 12 ? -20 : 20, ctrlKey: true, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, bubbles: true, cancelable: true }))
        else root.dispatchEvent(new WheelEvent('wheel', { deltaY: i % 80 < 40 ? -20 : 20, ctrlKey: true, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, bubbles: true, cancelable: true }))
      })
      return summarizeIn(res)
      function summarizeIn(x) {
        return { fps: x.fps, frameAvg: x.frame.avg, frameP95: x.frame.p95, long: x.long }
      }
    },
    { kind, ms: SAMPLE_MS }
  )
}

/** drag the on-screen card nearest the view center by 300px over `steps` pointer moves; returns ms per move */
async function dragCard(page, types) {
  // culling: the card may be a DOM element or drawn on the canvas layer — pick it from the engine's data (any card
  // whose grab point is on screen and not covered by UI), then drag it with the real mouse like a user
  const box = await page.evaluate((types) => {
    const rootEl = document.querySelector('.view:not(.hidden) .canvas-view')
    const eng = rootEl.__canvasEngine
    const root = rootEl.getBoundingClientRect()
    const cx = root.left + root.width / 2
    const cy = root.top + root.height / 2
    const v = eng.getViewport()
    let best = null
    for (const n of eng.data().nodes) {
      if (!types.includes(n.type)) continue
      const w = n.width * v.zoom
      const h = n.height * v.zoom
      // grab point (as before: horizontal center, 12px below the top) and drop point must be on the canvas
      const gx = root.left + v.x + n.x * v.zoom + w / 2
      const gy = root.top + v.y + n.y * v.zoom + Math.min(12, h / 2)
      if (w < 8 || gx < root.left + 20 || gy < root.top + 20 || gx + 300 > root.right - 20 || gy + 60 > root.bottom - 80) continue
      if (document.elementFromPoint(gx, gy)?.closest('[data-canvas-ui], .canvas-world [data-node-id]:not([data-node-id="' + n.id + '"])')) continue
      const d = Math.hypot(gx - cx, gy - cy)
      if (!best || d < best.d) best = { d, sx: gx, sy: gy }
    }
    return best
  }, types)
  if (!box) return null
  const sx = box.sx
  const sy = box.sy
  await page.mouse.move(sx, sy)
  await page.mouse.down()
  const steps = 60
  const t0 = Date.now()
  for (let i = 1; i <= steps; i++) await page.mouse.move(sx + (300 * i) / steps, sy + (60 * i) / steps)
  const ms = (Date.now() - t0) / steps
  await page.mouse.up()
  // let the debounced save finish before the app is closed (closing mid-write truncates the file)
  await page.waitForTimeout(1200)
  return ms
}

async function benchCanvas(n) {
  const dir = canvasVault(n, { fresh: FRESH })
  const { app, page, readyMs, errors } = await launch(dir)
  try {
    await page.evaluate(() => window.__cs2d3k.stores.workspace.getState().toggleSidebar('left', false))
    const open = await openAndTime(page, `Bench ${n}.canvas`)
    await page.evaluate(() => window.__bench.nextPaint())
    const pan = await domInteract(page, 'pan')
    const zoom = await domInteract(page, 'zoom')
    await page.evaluate(() => document.querySelector('.view:not(.hidden) .canvas-view').__canvasEngine.fitAll())
    await page.waitForTimeout(600)
    const zoomRange = await domInteract(page, 'zoomRange')
    // drag from the fitted view (the zoom sweep ends at an arbitrary zoom)
    await page.evaluate(() => document.querySelector('.view:not(.hidden) .canvas-view').__canvasEngine.fitAll())
    await page.waitForTimeout(600)
    const dragMsPerMove = await dragCard(page, ['text', 'code'])
    const heapMB = await page.evaluate(() => window.__bench.heapMB())
    return { scenario: `canvas ${n} nodes`, nodes: n, totalNodes: n, edges: Math.round(n * 1.2), readyMs, openMs: open.ms, domNodes: open.domNodes, render: open.render, pan, zoom, zoomRange, dragMsPerMove, heapMB, errors }
  } finally {
    await app.close().catch(() => {})
  }
}

async function benchFormmap(n) {
  const dir = formmapVault(n, { fresh: FRESH })
  const { app, page, readyMs, errors } = await launch(dir)
  try {
    await page.evaluate(() => window.__cs2d3k.stores.workspace.getState().toggleSidebar('left', false))
    const open = await openAndTime(page, `Bench ${n}.formmap`)
    const pan = await domInteract(page, 'pan')
    const zoom = await domInteract(page, 'zoom')
    await page.evaluate(() => document.querySelector('.view:not(.hidden) .canvas-view').__canvasEngine.fitAll())
    await page.waitForTimeout(600)
    const zoomRange = await domInteract(page, 'zoomRange')
    await page.evaluate(() => document.querySelector('.view:not(.hidden) .canvas-view').__canvasEngine.fitAll())
    await page.waitForTimeout(600)
    const dragMsPerMove = await dragCard(page, ['form'])
    const lens = {}
    for (const l of ['Board', 'Table', 'Doc', 'Map', 'Board', 'Map']) {
      const ms = await page.evaluate(async (label) => {
        const btn = [...document.querySelectorAll('.fm-lens-btn')].find((b) => b.textContent.includes(label))
        const s = performance.now()
        btn.click()
        await window.__bench.nextPaint()
        await window.__bench.nextPaint()
        return performance.now() - s
      }, l)
      lens[l in lens ? `${l} (warm)` : l] = ms
    }
    const heapMB = await page.evaluate(() => window.__bench.heapMB())
    return { scenario: `form-map ${n} cards`, cards: n, totalNodes: n + 6, readyMs, openMs: open.ms, domNodes: open.domNodes, render: open.render, pan, zoom, zoomRange, dragMsPerMove, lensMs: lens, heapMB, errors }
  } finally {
    await app.close().catch(() => {})
  }
}

// ---------------------------------------------------------------- main

const results = { date: new Date().toISOString(), machine: process.env.COMPUTERNAME ?? '', uncapped: true, graph: [], canvas: [], formmap: [] }
const log = (...a) => console.log('[bench]', ...a)

if (!ONLY || ONLY === 'graph') {
  const graphCases = QUICK
    ? [['synthetic 1k', () => synthetic(1000, { fresh: FRESH })]]
    : [
        ['synthetic 1k', () => synthetic(1000, { fresh: FRESH })],
        ['synthetic 5k', () => synthetic(5000, { fresh: FRESH })],
        ['synthetic 10k', () => synthetic(10000, { fresh: FRESH })],
        ['Bible (chapters)', () => bible({ level: 'chapter', fresh: FRESH })],
        ['Bible (verses + 78k xrefs)', () => bible({ level: 'verse', crossRefs: 78000, fresh: FRESH })],
        ['Bible (verses + 340k xrefs)', () => bible({ level: 'verse', crossRefs: 340000, fresh: FRESH })]
      ]
  for (const [name, make] of graphCases.filter(([name]) => !CASE || name.includes(CASE))) {
    log('generating', name)
    const dir = make()
    log('graph', name)
    try {
      const r = await benchGraph(name, dir)
      results.graph.push(r)
      log(JSON.stringify({ name, nodes: r.nodes, links: r.links, panFps: round(r.pan.fps), drawMs: round(r.drawMs.avg, 2) }))
    } catch (e) {
      results.graph.push({ scenario: name, error: String(e) })
      log('FAILED', name, e)
    }
  }
}
if (!ONLY || ONLY === 'canvas') {
  for (const n of QUICK ? [200] : [200, 1000, 3000]) {
    log('canvas', n)
    try {
      results.canvas.push(await benchCanvas(n))
    } catch (e) {
      results.canvas.push({ scenario: `canvas ${n}`, error: String(e) })
      log('FAILED canvas', n, e)
    }
  }
}
if (!ONLY || ONLY === 'formmap') {
  for (const n of QUICK ? [300] : [300, 1000, 3000]) {
    log('formmap', n)
    try {
      results.formmap.push(await benchFormmap(n))
    } catch (e) {
      results.formmap.push({ scenario: `formmap ${n}`, error: String(e) })
      log('FAILED formmap', n, e)
    }
  }
}

mkdirSync(join(ROOT, 'bench', 'results'), { recursive: true })
const file = join(ROOT, 'bench', 'results', `${OUT}.json`)
// merge with an existing result file of the same name (lets --only runs accumulate)
const prev = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null
for (const k of ['graph', 'canvas', 'formmap']) if (prev && !results[k].length) results[k] = prev[k]
writeFileSync(file, JSON.stringify(results, null, 2))
log('wrote', file)

// markdown summary
const f = (v, d = 0) => (typeof v === 'number' ? v.toFixed(d) : '—')
let md = '\n### Graph\n\nFPS = presented browser frames per second (uncapped), (p95) = 95th percentile frame interval in ms. "While settling" restarts the layout and interacts during it.\n\n| Scenario | Nodes | Links | Renderer | Vault ready | Graph open | Settle | Draw+GPU avg / p95 | Settling FPS (p95) / ticks/s | Pan FPS (p95) | Zoom FPS (p95) | Hover FPS (p95) | Pan / Zoom / Hover FPS while settling (p95) | Update | Heap |\n|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|\n'
for (const r of results.graph) {
  const fp = (x) => (x ? `${f(x.fps)} (${f(x.browserP95, 1)})` : '—')
  if (r.error) md += `| ${r.scenario} | error: ${r.error.slice(0, 80)} |\n`
  else
    md += `| ${r.scenario} | ${r.nodes} | ${r.links} | ${r.renderer ?? 'canvas2d'} | ${f(r.readyMs / 1000, 1)} s | ${f(r.openMs)} ms | ${r.settled ? f(r.settleMs / 1000, 1) + ' s' : '> limit'} | ${f(r.drawMs.avg, 2)} / ${f(r.drawMs.p95, 2)} ms | ${f(r.sim.fps)} (${f(r.sim.browserP95, 1)}) / ${f(r.sim.ticksPerSec)} | ${fp(r.pan)} | ${fp(r.zoom)} | ${fp(r.hover)} | ${r.settling ? `${fp(r.settling.pan)} / ${fp(r.settling.zoom)} / ${fp(r.settling.hover)}` : '—'} | ${f(r.updateMs)} ms | ${f(r.heapMB)} MB |\n`
}
md += '\n### Canvas / Form-map\n\n| Scenario | Open | DOM nodes (mounted / total) | Pan FPS (p95 ms) | Zoom FPS (p95 ms) | Zoom in range FPS (p95 ms) | Drag ms/move | Heap |\n|---|---|---|---|---|---|---|---|\n'
for (const r of [...results.canvas, ...results.formmap]) {
  if (r.error) md += `| ${r.scenario} | error: ${r.error.slice(0, 80)} |\n`
  else md += `| ${r.scenario} | ${f(r.openMs)} ms | ${r.domNodes}${r.totalNodes ? ` / ${r.totalNodes}` : ''} | ${f(r.pan.fps)} (${f(r.pan.frameP95, 1)}) | ${f(r.zoom.fps)} (${f(r.zoom.frameP95, 1)}) | ${r.zoomRange ? `${f(r.zoomRange.fps)} (${f(r.zoomRange.frameP95, 1)})` : '—'} | ${f(r.dragMsPerMove, 1)} | ${f(r.heapMB)} MB |\n`
}
const fm = results.formmap.filter((r) => r.lensMs)
if (fm.length) {
  md += '\n| Form-map lens switch | ' + Object.keys(fm[0].lensMs).join(' | ') + ' |\n|---|' + Object.keys(fm[0].lensMs).map(() => '---').join('|') + '|\n'
  for (const r of fm) md += `| ${r.scenario} | ${Object.values(r.lensMs).map((v) => f(v) + ' ms').join(' | ')} |\n`
}
console.log(md)
writeFileSync(join(ROOT, 'bench', 'results', `${OUT}.md`), md)
