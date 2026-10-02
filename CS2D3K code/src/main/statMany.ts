// Stats many paths at once, fast. Listing a vault is one stat per file; Node runs async stats on a small shared thread
// pool (and a busy Electron main thread handles every completion), which made listing a 32k-note vault take 1.5–2 s on
// Windows. Synchronous stats in a few worker threads run in parallel instead: about 0.6 s for the same vault.
import { promises as fsp } from 'fs'
import { Worker } from 'worker_threads'

/** per path: mtimeMs, birthtime (or ctime) ms, size, 1 for folders; mtime NaN = could not stat (vanished) */
export const STAT_FIELDS = 4

/** below this many paths the async stats are fast enough and spawning workers isn't worth it */
const WORKER_THRESHOLD = 3000
const PATHS_PER_WORKER = 2500
const MAX_WORKERS = 8

// plain CommonJS, run with `eval` so it needs no separate bundle entry
const WORKER_SOURCE = `
const { parentPort, workerData } = require('worker_threads')
const { statSync } = require('fs')
const paths = workerData.paths
const out = new Float64Array(paths.length * ${STAT_FIELDS})
for (let i = 0; i < paths.length; i++) {
  let st
  try {
    st = statSync(paths[i], { throwIfNoEntry: false })
  } catch {
    st = undefined
  }
  const o = i * ${STAT_FIELDS}
  if (!st) {
    out[o] = NaN
    continue
  }
  out[o] = st.mtimeMs
  out[o + 1] = st.birthtimeMs || st.ctimeMs
  out[o + 2] = st.size
  out[o + 3] = st.isDirectory() ? 1 : 0
}
parentPort.postMessage(out, [out.buffer])
`

function statInWorker(paths: string[]): Promise<Float64Array> {
  return new Promise((resolve, reject) => {
    const w = new Worker(WORKER_SOURCE, { eval: true, workerData: { paths } })
    w.once('message', (out: Float64Array) => {
      resolve(out)
      void w.terminate()
    })
    w.once('error', reject)
    w.once('exit', (code) => {
      if (code !== 0) reject(new Error(`stat worker exited with ${code}`))
    })
  })
}

async function statHere(paths: string[]): Promise<Float64Array> {
  const out = new Float64Array(paths.length * STAT_FIELDS)
  await Promise.all(
    paths.map(async (p, i) => {
      const o = i * STAT_FIELDS
      try {
        const st = await fsp.stat(p)
        out[o] = st.mtimeMs
        out[o + 1] = st.birthtimeMs || st.ctimeMs
        out[o + 2] = st.size
        out[o + 3] = st.isDirectory() ? 1 : 0
      } catch {
        out[o] = NaN
      }
    })
  )
  return out
}

/** Stats every path (following symlinks). `workers`: override the number of worker threads (0 = in this thread). */
export async function statMany(paths: string[], workers?: number): Promise<Float64Array> {
  const n = workers ?? (paths.length < WORKER_THRESHOLD ? 0 : Math.min(MAX_WORKERS, Math.ceil(paths.length / PATHS_PER_WORKER)))
  if (n <= 0) return statHere(paths)
  const size = Math.ceil(paths.length / n)
  const chunks: string[][] = []
  for (let i = 0; i < paths.length; i += size) chunks.push(paths.slice(i, i + size))
  let parts: Float64Array[]
  try {
    parts = await Promise.all(chunks.map(statInWorker))
  } catch {
    // workers unavailable: fall back to async stats
    return statHere(paths)
  }
  const out = new Float64Array(paths.length * STAT_FIELDS)
  let o = 0
  for (const p of parts) {
    out.set(p, o)
    o += p.length
  }
  return out
}
