// Main-thread handle of the force simulation: a module Web Worker, or the same SimHost running in-thread when
// workers are unavailable (or the worker fails to start).
import { SimHost, type SimIn, type SimOut } from './sim'

export class SimClient {
  private worker: Worker | null = null
  private local: SimHost | null = null
  private onMsg: (msg: SimOut) => void
  /** messages sent before the worker proved alive, replayed in-thread if it fails to start */
  private backlog: SimIn[] | null = []
  private dead = false

  constructor(onMsg: (msg: SimOut) => void) {
    this.onMsg = onMsg
    try {
      this.worker = new Worker(new URL('./sim.worker.ts', import.meta.url), { type: 'module', name: 'graph-sim' })
      this.worker.onmessage = (e: MessageEvent<SimOut>) => {
        this.backlog = null
        if (!this.dead) this.onMsg(e.data)
      }
      this.worker.onerror = (e) => {
        e.preventDefault()
        this.fallback()
      }
    } catch {
      this.fallback()
    }
  }

  get inThread(): boolean {
    return !!this.local
  }

  send(msg: SimIn, transfer?: Transferable[]): void {
    if (this.dead) return
    if (this.local) {
      this.local.handle(msg)
      return
    }
    // keep a copy until the worker answered once (transferred buffers are only returned recycled buffers)
    if (this.backlog && msg.t !== 'buf') this.backlog.push(msg)
    this.worker!.postMessage(msg, transfer ?? [])
  }

  destroy(): void {
    this.dead = true
    this.worker?.terminate()
    this.worker = null
    this.local?.destroy()
    this.local = null
  }

  private fallback(): void {
    if (this.local || this.dead) return
    const backlog = this.backlog ?? []
    this.worker?.terminate()
    this.worker = null
    this.backlog = null
    // deliver asynchronously like a worker would (callers may still be inside the send() that caused this)
    this.local = new SimHost((msg) => queueMicrotask(() => !this.dead && this.onMsg(msg)))
    for (const m of backlog) this.local.handle(m)
  }
}
