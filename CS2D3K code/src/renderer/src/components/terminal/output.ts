// Output log shown in the bottom panel "Output" tab: streamed "Run file" output + `run-output` events.
import { create } from 'zustand'
import type { RunResult } from '@shared/types'
import { on, emit, takeUnhandled, type AppEvents } from '@/lib/events'
import { useWorkspace } from '@/store/workspace'
import { registerCommands } from '@/store/commands'
import { uid } from '@/lib/util'

export type OutputStream = 'stdout' | 'stderr' | 'info'

export interface OutputChunk {
  stream: OutputStream
  text: string
}

export interface OutputRun {
  id: string
  title: string
  time: number
  chunks: OutputChunk[]
  status: 'running' | 'ok' | 'error'
  code?: number | null
  durationMs?: number
  kill?: () => void
}

interface OutputStore {
  runs: OutputRun[]
}

const MAX_RUNS = 50
const MAX_CHARS = 400_000

export const useOutput = create<OutputStore>(() => ({ runs: [] }))

function update(id: string, fn: (r: OutputRun) => OutputRun): void {
  useOutput.setState((s) => ({ runs: s.runs.map((r) => (r.id === id ? fn(r) : r)) }))
}

function pushRun(run: OutputRun): void {
  useOutput.setState((s) => ({ runs: [...s.runs, run].slice(-MAX_RUNS) }))
}

function appendChunks(chunks: OutputChunk[], add: OutputChunk[]): OutputChunk[] {
  const out = chunks.slice()
  let size = out.reduce((n, c) => n + c.text.length, 0)
  for (const c of add) {
    if (!c.text) continue
    if (size > MAX_CHARS) break
    let text = c.text
    if (size + text.length > MAX_CHARS) text = text.slice(0, MAX_CHARS - size) + '\n… output truncated …\n'
    size += text.length
    const last = out[out.length - 1]
    if (last && last.stream === c.stream) out[out.length - 1] = { stream: c.stream, text: last.text + text }
    else out.push({ stream: c.stream, text })
  }
  return out
}

export interface LiveRun {
  id: string
  append(stream: OutputStream, text: string): void
  setKill(kill: () => void): void
  finish(res: RunResult): void
}

/** Start a live (streaming) entry in the Output log. */
export function beginRun(title: string): LiveRun {
  const id = uid('run-')
  pushRun({ id, title, time: Date.now(), chunks: [], status: 'running' })
  // batch streamed chunks per frame so chatty programs don't re-render per write
  let pending: OutputChunk[] = []
  let raf = 0
  const flush = (): void => {
    raf = 0
    if (!pending.length) return
    const add = pending
    pending = []
    update(id, (r) => ({ ...r, chunks: appendChunks(r.chunks, add) }))
  }
  return {
    id,
    append(stream, text) {
      pending.push({ stream, text })
      if (!raf) raf = requestAnimationFrame(flush)
    },
    setKill(kill) {
      update(id, (r) => ({ ...r, kill }))
    },
    finish(res) {
      if (raf) cancelAnimationFrame(raf)
      flush()
      const ok = res.code === 0 && !res.error
      update(id, (r) => {
        let chunks = r.chunks
        // runner reports output it couldn't stream (e.g. spawn errors) only in the result
        if (!chunks.length && (res.stdout || res.stderr)) chunks = appendChunks([], [{ stream: 'stdout', text: res.stdout }, { stream: 'stderr', text: res.stderr }])
        if (res.error) chunks = appendChunks(chunks, [{ stream: 'stderr', text: (chunks.length ? '\n' : '') + res.error }])
        return { ...r, chunks, kill: undefined, status: ok ? 'ok' : 'error', code: res.code, durationMs: res.durationMs }
      })
    }
  }
}

/** Append a finished, non-streamed entry. */
export function logOutput(title: string, text: string, stream: OutputStream): void {
  pushRun({ id: uid('run-'), title, time: Date.now(), chunks: appendChunks([], [{ stream, text }]), status: stream === 'stderr' ? 'error' : 'ok' })
}

export function clearOutput(): void {
  useOutput.setState((s) => ({ runs: s.runs.filter((r) => r.status === 'running') }))
}

/** Open the bottom panel on the Output tab (creating it once). */
export function showOutput(): void {
  const ws = useWorkspace.getState()
  const existing = ws.bottom.tabs.find((t) => t.kind === 'output')
  if (existing) ws.setBottomActive(existing.id)
  else ws.addBottomTab('output', 'Output')
}

// ------------------------------------------------------------- run-output events

let suppress = false

/** Publish a finished run to other listeners without logging it twice here. */
export function emitRunOutput(payload: AppEvents['run-output']): void {
  suppress = true
  try {
    emit('run-output', payload)
  } finally {
    suppress = false
  }
}

const onRunOutput = (p: AppEvents['run-output']): void => {
  if (!suppress) logOutput(p.title, p.text, p.stream)
}
on('run-output', onRunOutput)
const missed = takeUnhandled('run-output')
if (missed) onRunOutput(missed)

registerCommands([
  { id: 'output:show', name: 'Output: Show output', run: showOutput },
  { id: 'output:clear', name: 'Output: Clear output', run: clearOutput }
])
