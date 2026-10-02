// State of the vault being opened, shown by the loading screen (components/LoadingScreen.tsx).
import { create } from 'zustand'
import { LoadGraph } from '@/lib/loadGraph'

export type LoadStage = 'opening' | 'scanning' | 'reading' | 'linking' | 'restoring' | 'error'

export interface LoadSample {
  stage: LoadStage
  done: number
  total: number
  /** ms since the load started */
  t: number
}

interface LoadingStore {
  /** a vault is being opened (or failed to open): the loading screen is up and the workspace isn't mounted */
  active: boolean
  vault: { path: string; name: string } | null
  stage: LoadStage
  /** notes indexed so far / to index (0 = not known yet) */
  done: number
  total: number
  /** notes taken from the metadata cache */
  cached: number
  /** notes read per second */
  rate: number
  startedAt: number
  error: string | null
  retry: (() => void) | null
  /** stage changes and progress samples of the current load (diagnostics, tests) */
  log: LoadSample[]
  /** the graph growing behind the progress bar (notes and links as they are indexed) */
  graph: LoadGraph | null
  begin(vault: { path: string; name: string }): void
  update(p: Partial<Pick<LoadingStore, 'stage' | 'done' | 'total' | 'cached' | 'rate' | 'vault'>>): void
  fail(message: string, retry: () => void): void
  /** loading finished: the workspace mounts and the loading screen fades out */
  finish(): void
  /** leave the error screen (back to the vault picker) */
  dismiss(): void
}

const MAX_LOG = 400

export const useLoading = create<LoadingStore>((set, get) => ({
  active: false,
  vault: null,
  stage: 'opening',
  done: 0,
  total: 0,
  cached: 0,
  rate: 0,
  startedAt: 0,
  error: null,
  retry: null,
  log: [],
  graph: null,
  begin(vault) {
    set({
      active: true,
      vault,
      stage: 'opening',
      done: 0,
      total: 0,
      cached: 0,
      rate: 0,
      startedAt: performance.now(),
      error: null,
      retry: null,
      log: [{ stage: 'opening', done: 0, total: 0, t: 0 }],
      graph: new LoadGraph()
    })
  },
  update(p) {
    const s = get()
    if (!s.active || s.error) return
    const next = { ...s, ...p }
    const log = s.log.length < MAX_LOG ? [...s.log, { stage: next.stage, done: next.done, total: next.total, t: Math.round(performance.now() - s.startedAt) }] : s.log
    set({ ...p, log })
  },
  fail(message, retry) {
    set({ active: true, stage: 'error', error: message, retry })
  },
  finish() {
    set({ active: false, error: null, retry: null })
  },
  dismiss() {
    set({ active: false, vault: null, error: null, retry: null })
  }
}))
