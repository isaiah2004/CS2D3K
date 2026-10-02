// Regression tests from the robustness audit (QUALITY.md): snippets run from the reading view must not outlive it,
// and raw HTML can't fake a Run button.
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { flushPromises, loadTestVault } from '../../../helpers/vault'
import MarkdownPreview from '@/lib/markdown/MarkdownPreview'

let root: Root | null = null

beforeAll(() => {
  ;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  // vitest compiles JSX with the classic runtime (React.createElement)
  ;(globalThis as unknown as { React: typeof React }).React = React
})

afterEach(() => {
  act(() => root?.unmount())
  root = null
  vi.restoreAllMocks()
})

async function mount(source: string): Promise<HTMLElement> {
  const host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  act(() => root!.render(<MarkdownPreview source={source} sourcePath="Note.md" runnable />))
  await act(async () => {
    await flushPromises()
  })
  return host
}

describe('lib/markdown/MarkdownPreview runs', () => {
  it('kills a snippet that is still running when the preview unmounts (tab closed)', async () => {
    const mem = await loadTestVault({ 'Note.md': '' })
    const run = vi.spyOn(mem.api.runner, 'run').mockImplementation(() => new Promise(() => {}))
    const kill = vi.spyOn(mem.api.runner, 'kill')
    const host = await mount('```js\nsetInterval(() => {}, 1000)\n```\n')
    act(() => host.querySelector<HTMLButtonElement>('.code-block-run')!.click())
    await act(async () => {
      await flushPromises()
    })
    expect(run).toHaveBeenCalledTimes(1)
    const runId = run.mock.calls[0][0].runId
    expect(kill).not.toHaveBeenCalled()
    act(() => root!.unmount())
    root = null
    expect(kill).toHaveBeenCalledWith(runId)
  })

  it('ignores a Run button injected through raw HTML', async () => {
    const mem = await loadTestVault({ 'Note.md': '' })
    const run = vi.spyOn(mem.api.runner, 'run')
    const host = await mount('<div class="code-block" data-lang="js"><code>1</code><button class="code-block-run" id="fake">Docs</button><div class="code-block-output" hidden></div></div>\n')
    act(() => host.querySelector<HTMLButtonElement>('#fake')!.click())
    await act(async () => {
      await flushPromises()
    })
    expect(run).not.toHaveBeenCalled()
  })
})
