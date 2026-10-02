// The simulation worker's protocol (SimHost runs inside the worker, or in-thread as a fallback).
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SimHost, padCap, type SimIn, type SimOut } from '@/views/graph/sim'

const forces = { center: 0.5, repel: 10, link: 1, distance: 120, ax: 1 }

function chain(n: number): { src: Uint32Array; tgt: Uint32Array } {
  const src = new Uint32Array(n - 1)
  const tgt = new Uint32Array(n - 1)
  for (let i = 0; i < n - 1; i++) (src[i] = i), (tgt[i] = i + 1)
  return { src, tgt }
}

function data(n: number, gen: number, seq: number, remap: Int32Array | null = null, pos?: Float32Array): SimIn {
  const p = pos ?? new Float32Array(2 * padCap(n))
  if (!pos) for (let i = 0; i < n; i++) (p[2 * i] = Math.cos(i) * i * 5), (p[2 * i + 1] = Math.sin(i) * i * 5)
  const { src, tgt } = chain(n)
  return { t: 'data', gen, seq, n, pos: p, remap, src, tgt, radii: new Float32Array(n).fill(5), forces, alpha: 1 }
}

let host: SimHost | null = null
afterEach(() => host?.destroy())

/** host whose position buffers are handed straight back, like the engine does after drawing them */
function start(): { msgs: SimOut[]; latest: () => Extract<SimOut, { t: 'pos' }> | undefined } {
  const msgs: SimOut[] = []
  let latest: Extract<SimOut, { t: 'pos' }> | undefined
  host = new SimHost((m) => {
    msgs.push(m)
    if (m.t === 'pos') {
      latest = { ...m, buf: m.buf.slice() }
      queueMicrotask(() => host?.handle({ t: 'buf', buf: m.buf }))
    }
  })
  return { msgs, latest: () => latest }
}

describe('views/graph/sim', () => {
  it('acknowledges every command with its sequence number', () => {
    const { msgs } = start()
    host!.handle(data(10, 1, 5))
    expect(msgs[msgs.length - 1]).toMatchObject({ t: 'ack', gen: 1, seq: 5, running: true })
  })

  it('streams positions until the layout settles, then reports it stopped', async () => {
    const { latest } = start()
    host!.handle(data(80, 1, 1))
    await vi.waitFor(() => expect(latest()?.running).toBe(false), { timeout: 20_000, interval: 20 })
    const p = latest()!
    expect(p.gen).toBe(1)
    expect(p.buf).toHaveLength(2 * padCap(80))
    for (let i = 0; i < 80; i++) expect(Number.isFinite(p.buf[2 * i])).toBe(true)
  }, 30_000)

  it('pins a dragged node and releases it', async () => {
    const { latest } = start()
    host!.handle(data(30, 1, 1))
    host!.handle({ t: 'drag', seq: 2, i: 4, x: 500, y: -300 })
    await vi.waitFor(() => expect(latest()?.seq).toBe(2), { timeout: 5000, interval: 10 })
    await vi.waitFor(() => expect([latest()!.buf[8], latest()!.buf[9]]).toEqual([500, -300]), { timeout: 5000, interval: 10 })
    // still running while dragging (alpha target)
    expect(latest()!.running).toBe(true)
    host!.handle({ t: 'release', seq: 3, i: 4, alpha: 0.12 })
    await vi.waitFor(() => expect(latest()?.running).toBe(false), { timeout: 20_000, interval: 20 })
  }, 30_000)

  it('keeps known nodes in place when the data changes', async () => {
    const { latest } = start()
    host!.handle(data(40, 1, 1))
    await vi.waitFor(() => expect(latest()?.running).toBe(false), { timeout: 20_000, interval: 20 })
    const before = latest()!.buf
    // same nodes in reverse order plus a new one
    const remap = new Int32Array(41)
    const pos = new Float32Array(2 * padCap(41))
    for (let i = 0; i < 40; i++) {
      remap[i] = 39 - i
      pos[2 * i] = before[2 * (39 - i)]
      pos[2 * i + 1] = before[2 * (39 - i) + 1]
    }
    remap[40] = -1
    pos[80] = before[0] + 20
    pos[81] = before[1]
    host!.handle({ ...data(41, 2, 2, remap, pos), alpha: 0.35 } as SimIn)
    await vi.waitFor(() => expect(latest()?.gen === 2 && !latest()!.running).toBe(true), { timeout: 20_000, interval: 20 })
    const after = latest()!.buf
    let moved = 0
    for (let i = 0; i < 40; i++) moved += Math.hypot(after[2 * i] - before[2 * (39 - i)], after[2 * i + 1] - before[2 * (39 - i) + 1])
    // a gentle reheat: nodes drift a little, nothing is re-laid out from scratch
    expect(moved / 40).toBeLessThan(120)
  }, 45_000)

  it('stops ticking while paused', async () => {
    const { msgs } = start()
    host!.handle(data(50, 1, 1))
    host!.handle({ t: 'pause', paused: true })
    const count = msgs.filter((m) => m.t === 'pos').length
    await new Promise((r) => setTimeout(r, 100))
    expect(msgs.filter((m) => m.t === 'pos').length).toBe(count)
    host!.handle({ t: 'pause', paused: false })
    await vi.waitFor(() => expect(msgs.filter((m) => m.t === 'pos').length).toBeGreaterThan(count), { timeout: 5000 })
  })
})
