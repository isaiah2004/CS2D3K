// Vault startup timing: launches the built app on a vault and measures time to interactive.
//
//   node bench/startup.mjs --vault <dir> [--out out] [--runs 3] [--no-cache]
//
//   --no-cache   delete <vault>/.cs2d3k/cache before every launch (first open / no metadata cache)
//   --copy <dir> copy the vault to <dir> first (isolates it from concurrent regeneration; the first run then
//                also reads freshly written files, which approximates a cold open)
//
// Prints one line per run: window shown, file list loaded, metadata indexed, ready (= __cs2d3k.ready()).
import { _electron as electron } from 'playwright'
import { cpSync, existsSync, mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join, resolve } from 'path'

const ROOT = join(import.meta.dirname, '..')
const args = process.argv.slice(2)
const opt = (f, d) => (args.includes(f) ? args[args.indexOf(f) + 1] : d)
const flag = (f) => args.includes(f)
const OUT = opt('--out', process.env.CS2D3K_OUT || 'out')
const RUNS = Number(opt('--runs', 3))
const NO_CACHE = flag('--no-cache')
let vault = resolve(opt('--vault', ''))
if (!existsSync(vault)) throw new Error(`no vault at ${vault}`)
const copyTo = opt('--copy', null)
if (copyTo) {
  const dst = resolve(copyTo)
  if (!existsSync(join(dst, '.copied'))) {
    if (!existsSync(join(vault, '.complete'))) throw new Error('source vault is incomplete (being regenerated?)')
    rmSync(dst, { recursive: true, force: true })
    const t = Date.now()
    cpSync(vault, dst, { recursive: true, filter: (src) => !src.includes('.cs2d3k') })
    cpSync(join(vault, '.complete'), join(dst, '.copied'))
    console.log(`copied in ${Date.now() - t} ms`)
  }
  vault = dst
}

const userData = mkdtempSync(join(tmpdir(), 'cs2d3k-startup-'))

async function once() {
  if (NO_CACHE) rmSync(join(vault, '.cs2d3k', 'cache'), { recursive: true, force: true })
  const env = { ...process.env, CS2D3K_TEST: '1', CS2D3K_VAULT: vault, CS2D3K_USER_DATA: userData }
  delete env.ELECTRON_RUN_AS_NODE
  const t0 = Date.now()
  const app = await electron.launch({ args: [join(ROOT, OUT, 'main', 'index.js')], cwd: ROOT, env })
  const page = await app.firstWindow()
  const tWin = Date.now() - t0
  try {
    await page.waitForFunction(() => !!window.__cs2d3k, null, { timeout: 180_000 })
  } catch (e) {
    // diagnostics from the main process (the renderer may not answer)
    const info = await app.evaluate(async ({ BrowserWindow, app: a }) => {
      const wc = BrowserWindow.getAllWindows()[0]?.webContents
      return { url: wc?.getURL(), loading: wc?.isLoading(), crashed: wc?.isCrashed(), metrics: a.getAppMetrics().map((m) => ({ type: m.type, cpu: m.cpu.percentCPUUsage, mem: m.memory.workingSetSize })) }
    }).catch((err) => String(err))
    console.log('renderer did not start:', JSON.stringify(info))
    throw e
  }
  const tHooks = Date.now() - t0
  // phases relative to the hooks being installed (polled every 10 ms)
  const phases = await page.evaluate(async () => {
    const s = performance.now()
    const st = window.__cs2d3k.stores
    const w = (f) =>
      new Promise((r) => {
        if (f()) return r(0)
        const i = setInterval(() => {
          if (f()) {
            clearInterval(i)
            r(Math.round(performance.now() - s))
          }
        }, 10)
      })
    const files = w(() => Object.keys(st.vault.getState().files).length > 0)
    const meta = w(() => st.metadata.getState().ready)
    const ready = window.__cs2d3k.ready().then(() => Math.round(performance.now() - s))
    const reads = window.__cs2d3k.loadStats?.() ?? null
    return { files: await files, meta: await meta, ready: await ready, reads }
  })
  const tReady = Date.now() - t0
  const stats = await page.evaluate(() => window.__cs2d3k.loadStats?.() ?? null)
  // like a user who keeps the app open for a moment: let the metadata cache be written before quitting
  await page.evaluate(() => window.__cs2d3k.saveMetadataCache?.())
  const counts = await page.evaluate(() => ({
    files: Object.keys(window.__cs2d3k.stores.vault.getState().files).length,
    metas: Object.keys(window.__cs2d3k.stores.metadata.getState().metas).length
  }))
  await app.close()
  return { tWin, tHooks, tReady, phases, stats, counts }
}

console.log(`vault ${vault} · build ${OUT} · ${NO_CACHE ? 'no cache' : 'cache kept'}`)
for (let i = 0; i < RUNS; i++) {
  const r = await once()
  console.log(
    `run ${i + 1}: window ${r.tWin} ms · hooks ${r.tHooks} ms · files +${r.phases.files} · indexed +${r.phases.meta} · READY ${r.tReady} ms` +
      ` · ${r.counts.files} files / ${r.counts.metas} notes` +
      (r.stats ? ` · ${JSON.stringify(r.stats)}` : '')
  )
}
rmSync(userData, { recursive: true, force: true })
