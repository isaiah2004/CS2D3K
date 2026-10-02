// Tiny typed app-wide event bus for cross-component signals.

export interface AppEvents {
  'reveal-file': { path: string }
  'focus-search': { query?: string }
  /** ask the file explorer to start inline rename for a path */
  'rename-file': { path: string }
  /** a code run finished / produced output (consumed by the bottom panel "Output" tab) */
  'run-output': { title: string; text: string; stream: 'stdout' | 'stderr' | 'info' }
}

type Handler<T> = (payload: T) => void
const handlers = new Map<keyof AppEvents, Set<Handler<unknown>>>()

export function on<K extends keyof AppEvents>(ev: K, fn: Handler<AppEvents[K]>): () => void {
  let set = handlers.get(ev)
  if (!set) handlers.set(ev, (set = new Set()))
  set.add(fn as Handler<unknown>)
  return () => set!.delete(fn as Handler<unknown>)
}

const recent = new Map<keyof AppEvents, { payload: unknown; at: number }>()

export function emit<K extends keyof AppEvents>(ev: K, payload: AppEvents[K]): void {
  const set = handlers.get(ev)
  if (set?.size) set.forEach((fn) => fn(payload))
  // nobody listening yet (e.g. lazily-loaded pane) — keep it briefly so it can be picked up on mount
  else recent.set(ev, { payload, at: Date.now() })
}

/** Returns (and clears) an event emitted while nobody was listening, if it happened within `maxAgeMs`. */
export function takeUnhandled<K extends keyof AppEvents>(ev: K, maxAgeMs = 3000): AppEvents[K] | null {
  const r = recent.get(ev)
  recent.delete(ev)
  return r && Date.now() - r.at <= maxAgeMs ? (r.payload as AppEvents[K]) : null
}
