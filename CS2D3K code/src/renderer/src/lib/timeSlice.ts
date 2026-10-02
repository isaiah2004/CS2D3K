// Cooperative time slicing for long loops on the main thread (vault indexing, cache encoding): work for a few
// milliseconds, then give the browser a chance to render a frame and handle input before continuing.

type SchedulerYield = { scheduler?: { yield?: () => Promise<void> } }

let channel: MessageChannel | null = null
const waiting: (() => void)[] = []

/** Resolves on a fresh macrotask (no 4 ms setTimeout clamping; not affected by fake timers in tests). */
export function yieldToEventLoop(): Promise<void> {
  const s = (globalThis as SchedulerYield).scheduler
  if (typeof s?.yield === 'function') return s.yield()
  if (typeof MessageChannel === 'undefined') return new Promise((r) => setTimeout(r, 0))
  if (!channel) {
    channel = new MessageChannel()
    channel.port1.onmessage = () => waiting.shift()?.()
  }
  return new Promise((r) => {
    waiting.push(r)
    channel!.port2.postMessage(null)
  })
}

/** `await slice.tick()` inside a loop: yields once the current slice ran longer than `budgetMs`. */
export class TimeSlicer {
  private start = performance.now()
  constructor(private budgetMs = 10) {}

  /** true when the slice is used up (check this in hot loops, then await `yield()`) */
  get due(): boolean {
    return performance.now() - this.start > this.budgetMs
  }

  async yield(): Promise<void> {
    await yieldToEventLoop()
    this.start = performance.now()
  }

  async tick(): Promise<void> {
    if (this.due) await this.yield()
  }
}
