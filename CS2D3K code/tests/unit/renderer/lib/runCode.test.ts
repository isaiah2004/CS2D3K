import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RunRequest, RunResult } from '@shared/types'
import { loadTestVault } from '../../helpers/vault'
import { normalizeRunLang, runCode } from '@/lib/runCode'
import { useSettings } from '@/store/settings'

type OutputCb = (id: string, stream: 'stdout' | 'stderr', data: string) => void

const result = (runId: string): RunResult => ({ runId, code: 0, stdout: 'ok', stderr: '', durationMs: 1 })

describe('lib/runCode normalizeRunLang', () => {
  it('maps fence and extension aliases to canonical runner languages', () => {
    const cases: Record<string, string> = {
      javascript: 'js', node: 'js', mjs: 'js', jsx: 'js',
      typescript: 'ts', tsx: 'ts',
      py: 'python', python3: 'python',
      sh: 'bash', shell: 'bash', zsh: 'bash',
      ps1: 'powershell', pwsh: 'powershell',
      cmd: 'bat', rb: 'ruby', golang: 'go', rs: 'rust', 'c++': 'cpp', cc: 'cpp'
    }
    for (const [from, to] of Object.entries(cases)) expect(normalizeRunLang(from)).toBe(to)
  })
  it('trims and lowercases, passing unknown languages through', () => {
    expect(normalizeRunLang('  JavaScript ')).toBe('js')
    expect(normalizeRunLang('Lua')).toBe('lua')
    expect(normalizeRunLang('python')).toBe('python')
  })
})

describe('lib/runCode runCode', () => {
  let run: ReturnType<typeof vi.spyOn>

  beforeEach(async () => {
    await loadTestVault({ 'notes/a.md': '' })
    run = vi.spyOn(window.api.runner, 'run').mockImplementation(async (req: RunRequest) => result(req.runId!))
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('sends the canonical language, code and run id to the runner', async () => {
    const h = runCode('Python3', 'print(1)')
    const res = await h.done
    expect(run).toHaveBeenCalledWith({ runId: h.runId, lang: 'python', code: 'print(1)', cwd: '/vault', command: undefined })
    expect(res).toEqual(result(h.runId))
  })
  it('runs in the folder of the source note', async () => {
    const abs = vi.spyOn(window.api.fs, 'absPath')
    await runCode('js', '1', { sourcePath: 'notes/a.md' }).done
    expect(abs).toHaveBeenCalledWith('notes')
    expect(run.mock.calls[0][0]).toMatchObject({ cwd: '/vault/notes' })
  })
  it('falls back to the vault root when the source folder cannot be resolved', async () => {
    vi.spyOn(window.api.fs, 'absPath').mockRejectedValue(new Error('nope'))
    await runCode('js', '1', { sourcePath: 'gone/a.md' }).done
    expect(run.mock.calls[0][0]).toMatchObject({ cwd: '/vault' })
  })
  it('uses a runner command override from settings for the canonical language', async () => {
    useSettings.getState().patch({ runners: { python: 'py -3 {file}' } })
    await runCode('py', 'print(1)').done
    expect(run.mock.calls[0][0]).toMatchObject({ lang: 'python', command: 'py -3 {file}' })
  })
  it('ignores an empty runner override', async () => {
    useSettings.getState().patch({ runners: { js: '' } })
    await runCode('node', '1').done
    expect(run.mock.calls[0][0]).toMatchObject({ lang: 'js', command: undefined })
  })
  it('streams only its own output and unsubscribes when done', async () => {
    let emitOutput: OutputCb = () => {}
    const unsub = vi.fn()
    vi.spyOn(window.api.runner, 'onOutput').mockImplementation((cb: OutputCb) => {
      emitOutput = cb
      return unsub
    })
    const onOutput = vi.fn()
    const h = runCode('js', '1', { onOutput })
    emitOutput(h.runId, 'stdout', 'mine')
    emitOutput('other-run', 'stdout', 'not mine')
    emitOutput(h.runId, 'stderr', 'err')
    await h.done
    expect(onOutput.mock.calls).toEqual([
      ['stdout', 'mine'],
      ['stderr', 'err']
    ])
    expect(unsub).toHaveBeenCalledTimes(1)
  })
  it('kill forwards to the runner with the run id', () => {
    const kill = vi.spyOn(window.api.runner, 'kill')
    const h = runCode('js', '1')
    h.kill()
    expect(kill).toHaveBeenCalledWith(h.runId)
  })
  it('kills the run after the configured timeout', async () => {
    useSettings.getState().patch({ runTimeoutSec: 2 })
    vi.useFakeTimers()
    let finish: (r: RunResult) => void = () => {}
    run.mockImplementation((req: RunRequest) => new Promise<RunResult>((r) => (finish = () => r(result(req.runId!)))))
    const kill = vi.spyOn(window.api.runner, 'kill')
    const h = runCode('js', 'while(true){}')
    await vi.advanceTimersByTimeAsync(1999)
    expect(kill).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(kill).toHaveBeenCalledWith(h.runId)
    finish(result(h.runId))
    await h.done
  })
  it('clears the timeout when the run finishes in time', async () => {
    useSettings.getState().patch({ runTimeoutSec: 1 })
    vi.useFakeTimers()
    const kill = vi.spyOn(window.api.runner, 'kill')
    await runCode('js', '1').done
    await vi.advanceTimersByTimeAsync(5000)
    expect(kill).not.toHaveBeenCalled()
  })
  it('unsubscribes from output even when the runner fails', async () => {
    const unsub = vi.fn()
    vi.spyOn(window.api.runner, 'onOutput').mockReturnValue(unsub)
    run.mockRejectedValue(new Error('spawn failed'))
    await expect(runCode('js', '1', { onOutput: () => {} }).done).rejects.toThrow('spawn failed')
    expect(unsub).toHaveBeenCalledTimes(1)
  })
})
