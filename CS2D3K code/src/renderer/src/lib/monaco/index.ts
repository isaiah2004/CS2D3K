// Lazy entry point for Monaco: the editor bundle (and its workers) only load when a code tab opens.
export type MonacoKit = typeof import('./setup')
export type { ModelEntry } from './models'

let kit: Promise<MonacoKit> | null = null

export function loadMonaco(): Promise<MonacoKit> {
  kit ??= import('./setup')
  return kit
}
