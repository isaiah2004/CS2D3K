// Shared helper to execute a code snippet through the main-process runner.
import type { RunResult } from '@shared/types'
import { getSettings } from '@/store/settings'
import { useVault } from '@/store/vault'
import { dirname } from './path'

export interface RunHandle {
  runId: string
  /** resolves when the process exits */
  done: Promise<RunResult>
  kill(): void
}

export interface RunOptions {
  /** vault path of the note/file the code came from — cwd defaults to its folder */
  sourcePath?: string
  onOutput?: (stream: 'stdout' | 'stderr', data: string) => void
}

const ALIASES: Record<string, string> = {
  javascript: 'js', mjs: 'js', cjs: 'js', node: 'js', jsx: 'js',
  typescript: 'ts', tsx: 'ts', mts: 'ts',
  py: 'python', python3: 'python',
  sh: 'bash', shell: 'bash', zsh: 'bash',
  ps: 'powershell', ps1: 'powershell', pwsh: 'powershell',
  cmd: 'bat', batch: 'bat', rb: 'ruby', golang: 'go', rs: 'rust', 'c++': 'cpp', cc: 'cpp'
}

/** Canonical runner language for a fence/extension name. */
export function normalizeRunLang(lang: string): string {
  const l = lang.trim().toLowerCase()
  return ALIASES[l] ?? l
}

export function runCode(lang: string, code: string, opts: RunOptions = {}): RunHandle {
  const runId = window.api.runner.newRunId()
  const canonical = normalizeRunLang(lang)
  const override = getSettings().runners[canonical]
  const unsub = opts.onOutput
    ? window.api.runner.onOutput((id, stream, data) => {
        if (id === runId) opts.onOutput!(stream, data)
      })
    : () => {}
  const vaultRoot = useVault.getState().info?.path
  const cwdPromise = opts.sourcePath ? window.api.fs.absPath(dirname(opts.sourcePath)).catch(() => vaultRoot) : Promise.resolve(vaultRoot)
  const timeout = getSettings().runTimeoutSec
  let timer: ReturnType<typeof setTimeout> | null = null
  const done = cwdPromise
    .then((cwd) => {
      if (timeout > 0) timer = setTimeout(() => window.api.runner.kill(runId), timeout * 1000)
      return window.api.runner.run({ runId, lang: canonical, code, cwd: cwd ?? undefined, command: override || undefined })
    })
    .finally(() => {
      if (timer) clearTimeout(timer)
      unsub()
    })
  return { runId, done, kill: () => window.api.runner.kill(runId) }
}
