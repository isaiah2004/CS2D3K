import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { EditorState } from '@codemirror/state'
import type { EditorView } from '@codemirror/view'
import type { RunResult } from '@shared/types'
import { flushPromises, loadTestVault } from '../../../../helpers/vault'
import { RunRecord, codeBlockInfo, codeRunField, fencedCodeAt, killAllRuns, runCodeBlockAt } from '@/views/markdown/editor/codeRun'
import { notePath } from '@/views/markdown/editor/state'
import { on } from '@/lib/events'
import { useUi } from '@/store/ui'
import { destroyViews, makeState, makeView, markdownLang } from './helpers'

// editor tests build real CodeMirror views: give them headroom on a loaded full-suite run
vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 })

const info = (state: EditorState, pos = state.selection.main.head): { lang: string; code: string } | null => {
  const node = fencedCodeAt(state, pos)
  return node ? codeBlockInfo(state, node) : null
}
const blockInfo = (marked: string) => info(makeState(marked, markdownLang()))
const editor = (marked: string): EditorView => makeView(marked, [markdownLang(), notePath.of('dir/note.md'), codeRunField])
const runs = (view: EditorView) => view.state.field(codeRunField).runs
const result = (over: Partial<RunResult> = {}): RunResult => ({ runId: 'r', code: 0, stdout: '', stderr: '', durationMs: 5, ...over })

beforeEach(async () => {
  await loadTestVault({})
  useUi.setState({ notices: [] })
})

afterEach(() => {
  destroyViews()
  vi.restoreAllMocks()
})

describe('views/markdown/editor/codeRun fencedCodeAt / codeBlockInfo', () => {
  it('finds the fenced block around a position and extracts language and code', () => {
    expect(blockInfo('```js\nconsole.log(1)‸\nmore()\n```')).toEqual({ lang: 'js', code: 'console.log(1)\nmore()' })
  })

  it('finds the block from the opening and closing fence lines', () => {
    expect(blockInfo('‸```py\nx\n```')).toEqual({ lang: 'py', code: 'x' })
    expect(blockInfo('```py\nx\n```‸')).toEqual({ lang: 'py', code: 'x' })
  })

  it('returns null outside of fenced code', () => {
    expect(blockInfo('text‸\n```js\nx\n```')).toBeNull()
    expect(blockInfo('    indented‸ code')).toBeNull()
  })

  it('uses only the first word of the info string as language', () => {
    expect(blockInfo('```python title="x.py"\nprint()‸\n```')!.lang).toBe('python')
  })

  it('returns an empty language when the fence has none', () => {
    expect(blockInfo('```\nx‸\n```')).toEqual({ lang: '', code: 'x' })
  })

  it('handles empty, tilde and unclosed blocks', () => {
    expect(blockInfo('```js‸\n```')).toEqual({ lang: 'js', code: '' })
    expect(blockInfo('~~~sh\necho hi‸\n~~~')).toEqual({ lang: 'sh', code: 'echo hi' })
    expect(blockInfo('```js\na\nb‸')).toEqual({ lang: 'js', code: 'a\nb' })
  })

  it('strips list-item indentation from the code', () => {
    expect(blockInfo('- item\n  ```py\n  if x:\n      y()‸\n  ```')).toEqual({ lang: 'py', code: 'if x:\n    y()' })
  })

  it('strips blockquote markers from the code', () => {
    expect(blockInfo('> ```js\n> a()‸\n> ```')).toEqual({ lang: 'js', code: 'a()' })
  })
})

describe('views/markdown/editor/codeRun RunRecord', () => {
  it('streams chunks to subscribers and reports completion', () => {
    const rec = new RunRecord('js')
    const events: unknown[] = []
    const unsub = rec.subscribe((ev, stream, text) => events.push([ev, stream, text]))
    rec.push('stdout', 'a')
    rec.push('stderr', 'b')
    rec.finish(result())
    unsub()
    rec.push('stdout', 'ignored')
    expect(events).toEqual([
      ['chunk', 'stdout', 'a'],
      ['chunk', 'stderr', 'b'],
      ['done', undefined, undefined]
    ])
    expect(rec.status).toBe('done')
    expect(rec.chunks.map((c) => c.text).join('')).toBe('abignored')
  })

  it('records a failure message', () => {
    const rec = new RunRecord('js')
    rec.finish(null, 'boom')
    expect(rec).toMatchObject({ status: 'done', result: null, failure: 'boom' })
  })

  it('kills only while running', () => {
    const rec = new RunRecord('js')
    const kill = vi.fn()
    rec.handle = { runId: 'r', done: new Promise(() => {}), kill }
    rec.kill()
    expect(rec.stopped).toBe(true)
    expect(kill).toHaveBeenCalledTimes(1)
    rec.finish(result())
    rec.kill()
    expect(kill).toHaveBeenCalledTimes(1)
  })
})

describe('views/markdown/editor/codeRun runCodeBlockAt', () => {
  it('returns false when there is no code block at the position', () => {
    expect(runCodeBlockAt(editor('just text‸'), 3)).toBe(false)
  })

  it('shows an error notice for blocks without a language', () => {
    const view = editor('```\nx‸\n```')
    expect(runCodeBlockAt(view, view.state.selection.main.head)).toBe(true)
    expect(useUi.getState().notices.at(-1)).toMatchObject({ kind: 'error', message: expect.stringMatching(/Add a language/) })
    expect(runs(view)).toEqual([])
  })

  it('shows an error notice for languages it cannot run', () => {
    const view = editor('```haskell\nmain‸\n```')
    expect(runCodeBlockAt(view, view.state.selection.main.head)).toBe(true)
    expect(useUi.getState().notices.at(-1)!.message).toMatch(/Don't know how to run "haskell"/)
  })

  it('runs the code through the runner and publishes the output', async () => {
    const run = vi.spyOn(window.api.runner, 'run').mockImplementation(async (req) => result({ runId: req.runId!, stdout: 'hi\n' }))
    const outputs: unknown[] = []
    const off = on('run-output', (p) => outputs.push(p))
    const view = editor('```JavaScript\nconsole.log("hi")‸\n```')
    expect(runCodeBlockAt(view, view.state.selection.main.head)).toBe(true)
    expect(runs(view)).toHaveLength(1)
    expect(runs(view)[0].pos).toBe(0)
    await flushPromises()
    off()
    expect(run).toHaveBeenCalledWith(expect.objectContaining({ lang: 'js', code: 'console.log("hi")', cwd: '/vault/dir' }))
    const rec = runs(view)[0].record
    expect(rec.status).toBe('done')
    expect(rec.result?.stdout).toBe('hi\n')
    expect(outputs).toEqual([{ title: 'JavaScript (note.md)', text: 'hi\n', stream: 'stdout' }])
  })

  it('publishes failed runs as stderr output', async () => {
    vi.spyOn(window.api.runner, 'run').mockResolvedValue(result({ code: 1, stdout: 'out', stderr: 'err' }))
    const outputs: { text: string; stream: string }[] = []
    const off = on('run-output', (p) => outputs.push(p))
    const view = editor('```py\nraise‸\n```')
    runCodeBlockAt(view, view.state.selection.main.head)
    await flushPromises()
    off()
    expect(outputs[0]).toMatchObject({ text: 'out\nerr', stream: 'stderr' })
  })

  it('records a failure when the runner rejects', async () => {
    vi.spyOn(window.api.runner, 'run').mockRejectedValue(new Error('spawn failed'))
    const view = editor('```sh\nls‸\n```')
    runCodeBlockAt(view, view.state.selection.main.head)
    await flushPromises()
    expect(runs(view)[0].record).toMatchObject({ status: 'done', failure: 'spawn failed' })
  })

  it('re-running a block replaces and kills the previous run', async () => {
    vi.spyOn(window.api.runner, 'run').mockImplementation(() => new Promise(() => {}))
    const kill = vi.spyOn(window.api.runner, 'kill')
    const view = editor('```js\nwhile(1){}‸\n```')
    runCodeBlockAt(view, view.state.selection.main.head)
    const first = runs(view)[0].record
    runCodeBlockAt(view, view.state.selection.main.head)
    expect(runs(view)).toHaveLength(1)
    expect(runs(view)[0].record).not.toBe(first)
    expect(first.stopped).toBe(true)
    expect(kill).toHaveBeenCalledTimes(1)
  })

  it('keeps runs of separate blocks and maps them through edits', () => {
    vi.spyOn(window.api.runner, 'run').mockImplementation(() => new Promise(() => {}))
    const view = editor('```js\na\n```\n\n```js\nb\n```')
    runCodeBlockAt(view, 6)
    runCodeBlockAt(view, 19)
    expect(runs(view).map((r) => r.pos)).toEqual([0, 13])
    view.dispatch({ changes: { from: 0, insert: 'intro\n\n' } })
    expect(runs(view).map((r) => r.pos)).toEqual([7, 20])
  })

  it('kills and forgets a run when its block is deleted from its first character', () => {
    vi.spyOn(window.api.runner, 'run').mockImplementation(() => new Promise(() => {}))
    const kill = vi.spyOn(window.api.runner, 'kill')
    const view = editor('```js\na‸\n```\nafter')
    runCodeBlockAt(view, view.state.selection.main.head)
    view.dispatch({ changes: { from: 0, to: 12 } })
    expect(runs(view)).toEqual([])
    expect(kill).toHaveBeenCalledTimes(1)
  })

  it('kills a run when a deletion spans its block', () => {
    vi.spyOn(window.api.runner, 'run').mockImplementation(() => new Promise(() => {}))
    const view = editor('before\n```js\na‸\n```')
    runCodeBlockAt(view, view.state.selection.main.head)
    view.dispatch({ changes: { from: 3, to: view.state.doc.length } })
    expect(runs(view)).toEqual([])
  })

  it('does not attach an old run to a new block typed where a deleted one was', () => {
    vi.spyOn(window.api.runner, 'run').mockImplementation(() => new Promise(() => {}))
    const view = editor('```js\na‸\n```')
    runCodeBlockAt(view, view.state.selection.main.head)
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: '```py\nother\n```' } })
    expect(runs(view)).toEqual([])
  })

  it('killAllRuns stops every running block', () => {
    vi.spyOn(window.api.runner, 'run').mockImplementation(() => new Promise(() => {}))
    const view = editor('```js\na\n```\n\n```js\nb\n```')
    runCodeBlockAt(view, 6)
    runCodeBlockAt(view, 19)
    killAllRuns(view.state)
    expect(runs(view).every((r) => r.record.stopped)).toBe(true)
  })

  it('killAllRuns is a no-op for editors without the run field', () => {
    expect(() => killAllRuns(makeState('x'))).not.toThrow()
  })

  it('renders an output widget below the block', async () => {
    vi.spyOn(window.api.runner, 'run').mockResolvedValue(result({ stdout: 'printed' }))
    const view = editor('```js\nx‸\n```')
    runCodeBlockAt(view, view.state.selection.main.head)
    await flushPromises()
    const out = view.dom.querySelector('.cm-code-output')
    expect(out).not.toBeNull()
    expect(out!.querySelector('.cm-code-output-status')!.textContent).toMatch(/Exited with code 0/)
    expect(out!.querySelector('pre')!.textContent).toBe('printed')
  })
})
