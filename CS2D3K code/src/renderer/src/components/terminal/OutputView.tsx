// Scrollable log of code runs (bottom panel "Output" tab).
import { useLayoutEffect, useRef } from 'react'
import { CircleCheck, CircleX, Copy, Eraser, LoaderCircle, Square } from 'lucide-react'
import { showContextMenu } from '@/store/ui'
import { useOutput, clearOutput, type OutputRun } from './output'

// eslint-disable-next-line no-control-regex
const ANSI = /\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07]*\x07/g

function formatTime(t: number): string {
  return new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

function formatDuration(ms: number): string {
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(ms < 10000 ? 2 : 1)} s`
}

function runText(r: OutputRun): string {
  return r.chunks.map((c) => c.text).join('').replace(ANSI, '')
}

function RunEntry({ run }: { run: OutputRun }) {
  const icon =
    run.status === 'running' ? <LoaderCircle className="output-spin" /> : run.status === 'ok' ? <CircleCheck className="output-ok" /> : <CircleX className="output-fail" />
  const meta =
    run.status === 'running'
      ? 'running…'
      : [run.code !== undefined && run.code !== null ? `exit ${run.code}` : run.status === 'error' ? 'failed' : '', run.durationMs !== undefined ? formatDuration(run.durationMs) : '']
          .filter(Boolean)
          .join(' · ')
  return (
    <div className={`output-run is-${run.status}`}>
      <div className="output-run-header">
        {icon}
        <span className="output-run-title">{run.title}</span>
        <span className="output-run-meta">
          {formatTime(run.time)}
          {meta && ` · ${meta}`}
        </span>
        {run.kill && (
          <button className="clickable-icon small output-stop" title="Stop" onClick={run.kill}>
            <Square />
          </button>
        )}
      </div>
      {run.chunks.length > 0 ? (
        <pre className="output-run-body">
          {run.chunks.map((c, i) => (
            <span key={i} className={`output-${c.stream}`}>
              {c.text.replace(ANSI, '')}
            </span>
          ))}
        </pre>
      ) : (
        run.status !== 'running' && <div className="output-run-empty">(no output)</div>
      )}
    </div>
  )
}

export default function OutputView() {
  const runs = useOutput((s) => s.runs)
  const ref = useRef<HTMLDivElement>(null)
  const stick = useRef(true)

  useLayoutEffect(() => {
    const el = ref.current
    if (el && stick.current) el.scrollTop = el.scrollHeight
  }, [runs])

  const onContextMenu = (e: React.MouseEvent): void => {
    const sel = window.getSelection()?.toString() ?? ''
    showContextMenu(e, [
      { label: sel ? 'Copy' : 'Copy all', icon: <Copy />, disabled: !sel && !runs.length, onClick: () => void navigator.clipboard.writeText(sel || runs.map((r) => `${r.title}\n${runText(r)}`).join('\n\n')) },
      { separator: true },
      { label: 'Clear output', icon: <Eraser />, disabled: !runs.length, onClick: clearOutput }
    ])
  }

  return (
    <div
      className="output-view"
      ref={ref}
      tabIndex={-1}
      onContextMenu={onContextMenu}
      onScroll={(e) => {
        const el = e.currentTarget
        stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24
      }}
    >
      {runs.length === 0 ? (
        <div className="output-empty">No output yet. Run a file with ▶ in a code tab, or run a code block in a note.</div>
      ) : (
        runs.map((r) => <RunEntry key={r.id} run={r} />)
      )}
    </div>
  )
}
