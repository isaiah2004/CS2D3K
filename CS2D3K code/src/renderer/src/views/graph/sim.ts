// Force simulation host shared by the Web Worker (sim.worker.ts) and the in-thread fallback (simClient.ts).
// Runs the typed-array force simulation (forces.ts, d3-force's model) over index-addressed nodes and streams
// positions back as Float32Arrays (x, y per node, padded to the position texture width) that are recycled
// between the two sides, so steady-state ticking allocates nothing.
import { ForceSim } from './forces'
import { multilevelSeed, phyllotaxis } from './layout'

/** width of the position texture; position buffers are padded to a multiple of it */
export const POS_TEX_W = 1024

export const padCap = (n: number): number => Math.max(1, Math.ceil(n / POS_TEX_W)) * POS_TEX_W

export interface SimForces {
  center: number
  repel: number
  link: number
  distance: number
  /** aspect factor of the centering forces (tall local-graph panes) */
  ax: number
}

export type SimIn =
  | {
      t: 'data'
      gen: number
      seq: number
      n: number
      /** seed positions, length 2 * padCap(n) */
      pos: Float32Array
      /** previous node index for every node (-1 = new): carries velocities / pins over; null = fresh graph */
      remap: Int32Array | null
      src: Uint32Array
      tgt: Uint32Array
      radii: Float32Array
      forces: SimForces
      alpha: number
    }
  | { t: 'forces'; seq: number; forces: SimForces; reheat: number }
  | { t: 'radii'; seq: number; radii: Float32Array; reheat: number }
  | { t: 'drag'; seq: number; i: number; x: number; y: number }
  | { t: 'release'; seq: number; i: number; alpha: number }
  | { t: 'animate'; seq: number }
  | { t: 'pause'; paused: boolean }
  | { t: 'buf'; buf: Float32Array }

export type SimOut =
  | { t: 'pos'; gen: number; seq: number; buf: Float32Array; running: boolean; alpha: number; tickMs: number; tps: number }
  | { t: 'ack'; gen: number; seq: number; running: boolean; alpha: number }

/** ticks are paced to at most one per MIN_TICK_MS so small graphs still visibly unfold */
const MIN_TICK_MS = 4
const ALPHA_MIN = 0.001

/** alpha decay that cools from `from` to ALPHA_MIN in `ticks` ticks */
const decayFor = (from: number, ticks: number): number => 1 - Math.pow(ALPHA_MIN / from, 1 / ticks)

export class SimHost {
  private post: (msg: SimOut, transfer?: Transferable[]) => void
  private sim = new ForceSim()
  private forces: SimForces = { center: 0.5, repel: 10, link: 1, distance: 120, ax: 1 }
  /** link count per node (link strength / bias) */
  private deg = new Float64Array(0)
  /** cooling schedule of a full (unseeded) run for the current graph size */
  private fullDecay = decayFor(1, 300)

  private gen = 0
  private seq = 0
  private cap = 0
  private pool: Float32Array[] = []
  /** positions changed since the last post (no free buffer at the time) */
  private dirty = false
  private paused = false
  private scheduled = false
  private timer: ReturnType<typeof setTimeout> | null = null
  private lastTick = 0
  private tickMs = 0
  private tpsCount = 0
  private tpsStart = 0
  private tps = 0
  private wasRunning = false
  private port: MessagePort | null = null

  constructor(post: (msg: SimOut, transfer?: Transferable[]) => void) {
    this.post = post
    const s = this.sim
    s.alphaMin = ALPHA_MIN
    s.velocityDecay = 0.42
    s.distanceMax = 2000
    s.centerStrength = 0.08
    s.collideStrength = 0.6
    // MessageChannel gives an immediate, unclamped "next task" (nested setTimeout(0) is clamped to 4 ms)
    if (typeof MessageChannel !== 'undefined') {
      const ch = new MessageChannel()
      ch.port1.onmessage = () => this.loop()
      this.port = ch.port2
    }
  }

  destroy(): void {
    if (this.timer) clearTimeout(this.timer)
    this.port?.close()
    this.sim.resize(0, 0)
    this.paused = true
  }

  handle(msg: SimIn): void {
    const s = this.sim
    switch (msg.t) {
      case 'data':
        this.setData(msg)
        break
      case 'forces':
        this.forces = msg.forces
        this.applyForces()
        this.reheat(msg.reheat)
        break
      case 'radii':
        for (let i = 0; i < s.n; i++) s.radius[i] = msg.radii[i] + 2
        this.reheat(msg.reheat)
        break
      case 'drag':
        if (msg.i < s.n) {
          s.fx[msg.i] = s.x[msg.i] = msg.x
          s.fy[msg.i] = s.y[msg.i] = msg.y
          s.alphaTarget = 0.25
        }
        break
      case 'release':
        if (msg.i < s.n) s.fx[msg.i] = s.fy[msg.i] = NaN
        s.alphaTarget = 0
        this.reheat(msg.alpha)
        break
      case 'animate':
        // d3's phyllotaxis, then the full cooling schedule so the layout visibly unfolds
        for (let i = 0; i < s.n; i++) {
          const p = phyllotaxis(i, 6)
          s.x[i] = p.x
          s.y[i] = p.y
          s.vx[i] = s.vy[i] = 0
          s.fx[i] = s.fy[i] = NaN
        }
        s.alphaDecay = this.fullDecay
        if (s.n) s.alpha = 1
        this.dirty = true
        break
      case 'pause':
        this.paused = msg.paused
        break
      case 'buf':
        if (msg.buf.length === 2 * this.cap && this.pool.length < 3) this.pool.push(msg.buf)
        if (this.dirty) this.flush()
        return
    }
    if ('seq' in msg) this.seq = msg.seq
    this.post({ t: 'ack', gen: this.gen, seq: this.seq, running: s.running(), alpha: s.alpha })
    if (this.dirty) this.flush()
    this.schedule(0)
  }

  private setData(d: Extract<SimIn, { t: 'data' }>): void {
    const s = this.sim
    const n = d.n
    const m = d.src.length
    // carry velocities / pins of known nodes over (copied first: resize may reuse the arrays)
    const sl = (a: Float64Array): Float64Array => a.slice(0, s.n)
    const old = d.remap ? { n: s.n, x: sl(s.x), y: sl(s.y), vx: sl(s.vx), vy: sl(s.vy), fx: sl(s.fx), fy: sl(s.fy) } : null
    s.resize(n, m)
    for (let i = 0; i < n; i++) {
      const o = old && d.remap![i] >= 0 && d.remap![i] < old.n ? d.remap![i] : -1
      // known nodes continue from the simulation's own (newest) positions
      s.x[i] = o >= 0 ? old!.x[o] : d.pos[2 * i]
      s.y[i] = o >= 0 ? old!.y[o] : d.pos[2 * i + 1]
      s.radius[i] = d.radii[i] + 2
      s.vx[i] = o >= 0 ? old!.vx[o] : 0
      s.vy[i] = o >= 0 ? old!.vy[o] : 0
      s.fx[i] = o >= 0 ? old!.fx[o] : NaN
      s.fy[i] = o >= 0 ? old!.fy[o] : NaN
    }
    s.src.set(d.src)
    s.tgt.set(d.tgt)
    this.deg = new Float64Array(n)
    for (let e = 0; e < m; e++) {
      this.deg[d.src[e]]++
      this.deg[d.tgt[e]]++
    }
    s.computeBias()
    this.gen = d.gen
    this.forces = d.forces
    // big graphs: cheaper Barnes-Hut approximation
    s.theta = n > 20000 ? 1.2 : n > 1500 ? 1.05 : 0.9
    this.fullDecay = n > 1500 ? 0.032 : 0.0228
    this.applyForces()
    this.cap = padCap(n)
    this.pool = [new Float32Array(2 * this.cap), new Float32Array(2 * this.cap)]
    this.dirty = false

    if (!d.remap && n > 48 && m > 0) {
      // fresh graph: multilevel seed, streaming the coarse levels as it goes; the simulation then only polishes
      const f = this.forces
      const seed = multilevelSeed(n, m, d.src, d.tgt, f, (x, y) => this.postPositions(x, y))
      s.x.set(seed.x)
      s.y.set(seed.y)
      s.alpha = 0.3
      s.alphaDecay = decayFor(0.3, n > 20000 ? 110 : n > 5000 ? 130 : 160)
      this.dirty = true
    } else {
      s.alphaDecay = this.fullDecay
      s.alpha = d.remap ? Math.max(d.alpha, s.alpha) : d.alpha
    }
  }

  private applyForces(): void {
    const f = this.forces
    const s = this.sim
    const charge = -(f.repel * 32 + 10)
    for (let i = 0; i < s.n; i++) s.charge[i] = charge
    for (let e = 0; e < s.m; e++) {
      s.linkDist[e] = f.distance
      s.linkStrength[e] = f.link / Math.max(1, Math.min(this.deg[s.src[e]], this.deg[s.tgt[e]]))
    }
    s.xStrength = f.center * 0.12 * f.ax
    s.yStrength = (f.center * 0.12) / f.ax
  }

  private reheat(alpha: number): void {
    const s = this.sim
    if (s.alpha < alpha) {
      s.alpha = alpha
      // reheats cool down on the normal schedule
      s.alphaDecay = this.fullDecay
    }
  }

  private schedule(delay: number): void {
    if (this.scheduled || this.paused) return
    this.scheduled = true
    if (delay <= 0 && this.port) this.port.postMessage(null)
    else
      this.timer = setTimeout(() => {
        this.timer = null
        if (this.port) this.port.postMessage(null)
        else this.loop()
      }, delay)
  }

  private loop(): void {
    this.scheduled = false
    const s = this.sim
    if (this.paused || !s.n) return
    if (!s.running()) {
      if (this.wasRunning || this.dirty) {
        this.wasRunning = false
        this.dirty = true
        this.flush()
      }
      return
    }
    this.wasRunning = true
    const now = performance.now()
    const wait = this.lastTick + MIN_TICK_MS - now
    if (wait > 0.5) {
      this.schedule(wait)
      return
    }
    this.lastTick = now
    s.tick()
    const t1 = performance.now()
    this.tickMs = this.tickMs ? this.tickMs * 0.8 + (t1 - now) * 0.2 : t1 - now
    this.tpsCount++
    if (t1 - this.tpsStart > 500) {
      this.tps = (this.tpsCount * 1000) / (t1 - this.tpsStart)
      this.tpsCount = 0
      this.tpsStart = t1
    }
    this.dirty = true
    this.flush()
    this.schedule(0)
  }

  /** post the current positions if a buffer is free (otherwise when one comes back) */
  private flush(): void {
    const buf = this.pool.pop()
    if (!buf) return
    const s = this.sim
    for (let i = 0; i < s.n; i++) {
      buf[2 * i] = s.x[i]
      buf[2 * i + 1] = s.y[i]
    }
    this.dirty = false
    const running = s.running()
    this.post({ t: 'pos', gen: this.gen, seq: this.seq, buf, running, alpha: s.alpha, tickMs: this.tickMs, tps: running ? this.tps : 0 }, [buf.buffer])
  }

  /** intermediate positions while seeding (fresh buffers; the main thread recycles or drops them) */
  private postPositions(x: Float64Array, y: Float64Array): void {
    const buf = new Float32Array(2 * this.cap)
    for (let i = 0; i < x.length; i++) {
      buf[2 * i] = x[i]
      buf[2 * i + 1] = y[i]
    }
    this.post({ t: 'pos', gen: this.gen, seq: this.seq, buf, running: true, alpha: 1, tickMs: this.tickMs, tps: 0 }, [buf.buffer])
  }
}
