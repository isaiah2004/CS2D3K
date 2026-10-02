// Regression test from the robustness audit (QUALITY.md): a crashing view must not blank the whole app.
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import ErrorBoundary from '@/components/ErrorBoundary'

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

describe('components/ErrorBoundary', () => {
  it('shows the error in place of the crashed child, keeps siblings alive and retries', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    let explode = true
    function Bomb() {
      if (explode) throw new Error('kaboom')
      return <div className="ok">recovered</div>
    }
    const host = document.createElement('div')
    root = createRoot(host)
    act(() =>
      root!.render(
        <div>
          <div className="sibling">still here</div>
          <ErrorBoundary label="this view">
            <Bomb />
          </ErrorBoundary>
        </div>
      )
    )
    expect(host.querySelector('.sibling')?.textContent).toBe('still here')
    expect(host.querySelector('.error-boundary')?.textContent).toContain('kaboom')
    explode = false
    act(() => host.querySelector<HTMLButtonElement>('.error-boundary button')!.click())
    expect(host.querySelector('.ok')?.textContent).toBe('recovered')
  })
})
