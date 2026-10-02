// Loading screen shown while a vault opens: the vault's graph assembling in the background (the real graph
// engine, fed as notes are indexed), the vault name, a progress bar and what is happening. Fades / zooms into the
// workspace when the vault is ready; shows the error with Retry when it could not be opened.
import { Suspense, lazy, useEffect, useRef, useState } from 'react'
import { AlertTriangle, FolderOpen, RotateCw } from 'lucide-react'
import { useLoading, type LoadStage } from '@/store/loading'
import './loading.css'

const LoadingGraph = lazy(() => import('./LoadingGraph'))

/** fade-out into the workspace (keep in sync with loading.css) */
const LEAVE_MS = 520
/** show the elapsed time once loading takes this long */
const SHOW_ELAPSED_MS = 3000

const fmt = (n: number): string => Math.round(n).toLocaleString('en-US')

const STAGE_LABEL: Record<LoadStage, string> = {
  opening: 'Opening vault',
  scanning: 'Scanning files',
  reading: 'Reading notes',
  linking: 'Linking notes',
  restoring: 'Restoring layout',
  error: "Couldn't open vault"
}

/** overall progress 0..1: listing and linking are short, reading the notes is most of the work */
function fraction(stage: LoadStage, done: number, total: number): number {
  switch (stage) {
    case 'opening':
      return 0.03
    case 'scanning':
      return 0.08
    case 'reading':
      return 0.1 + 0.82 * (total ? done / total : 0)
    case 'linking':
      return 0.94
    default:
      return 0.98
  }
}

function prefersReducedMotion(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

/** Mounted by App for the whole session; renders while a vault loads and for the fade-out after. */
export default function LoadingScreen() {
  const active = useLoading((s) => s.active)
  const [shown, setShown] = useState(active)
  const [leaving, setLeaving] = useState(false)

  useEffect(() => {
    if (active) {
      setShown(true)
      setLeaving(false)
      return
    }
    // let the workspace render its first frame underneath, then fade out
    let raf = requestAnimationFrame(() => {
      raf = requestAnimationFrame(() => setLeaving(true))
    })
    const t = setTimeout(() => {
      setShown(false)
      setLeaving(false)
    }, LEAVE_MS + 150)
    return () => {
      cancelAnimationFrame(raf)
      clearTimeout(t)
    }
  }, [active])

  if (!shown) return null
  return <LoadingView leaving={leaving} />
}

function LoadingView({ leaving }: { leaving: boolean }) {
  const s = useLoading()
  const [reduced] = useState(prefersReducedMotion)
  const [now, setNow] = useState(() => performance.now())
  const retryRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (leaving || s.error) return
    const t = setInterval(() => setNow(performance.now()), 1000)
    return () => clearInterval(t)
  }, [leaving, s.error])

  useEffect(() => {
    if (s.error) retryRef.current?.focus()
  }, [s.error])

  const error = s.stage === 'error'
  const elapsed = now - s.startedAt
  const p = leaving ? 1 : fraction(s.stage, s.done, s.total)
  const indeterminate = !leaving && (s.stage === 'opening' || s.stage === 'scanning')

  let counts = ''
  if (s.stage === 'reading' && s.total) counts = `${fmt(s.done)} / ${fmt(s.total)}`
  else if ((s.stage === 'linking' || s.stage === 'restoring') && s.total) counts = `${fmt(s.total)} ${s.total === 1 ? 'note' : 'notes'}`
  const details: string[] = []
  // the rate means something once a few batches went through
  if (s.stage === 'reading' && s.rate > 0 && s.done - s.cached >= 200) details.push(`${fmt(s.rate)} notes/s`)
  if (s.cached && s.stage !== 'scanning') details.push(`${fmt(s.cached)} from cache`)
  if (elapsed >= SHOW_ELAPSED_MS && !leaving) details.push(`${Math.floor(elapsed / 1000)} s`)

  return (
    <div
      className={`loading-screen${leaving ? ' is-leaving' : ''}${reduced ? ' is-reduced' : ''}${error ? ' is-error' : ''}`}
      data-stage={s.stage}
      aria-busy={!error && !leaving}
    >
      <div className="loading-titlebar" />
      {!reduced && s.graph && (
        <Suspense fallback={null}>
          <LoadingGraph graph={s.graph} />
        </Suspense>
      )}
      <div className="loading-shade" />
      <div className="loading-panel" role="status" aria-live="polite">
        <div className="loading-vault-name" title={s.vault?.path}>
          {s.vault?.name ?? 'Vault'}
        </div>
        {error ? (
          <div className="loading-error">
            <div className="loading-error-title">
              <AlertTriangle size={15} /> {STAGE_LABEL.error}
            </div>
            <div className="loading-error-message">{s.error}</div>
            <div className="loading-error-actions">
              <button ref={retryRef} className="btn mod-cta" onClick={() => s.retry?.()}>
                <RotateCw size={14} /> Retry
              </button>
              <button className="btn" onClick={() => s.dismiss()}>
                <FolderOpen size={14} /> Open another vault
              </button>
            </div>
          </div>
        ) : (
          <>
            <div
              className={`loading-bar${indeterminate ? ' is-indeterminate' : ''}`}
              role="progressbar"
              aria-label="Loading vault"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(p * 100)}
            >
              <div className="loading-bar-fill" style={{ transform: `scaleX(${p})` }} />
            </div>
            <div className="loading-stage">
              <span className="loading-stage-label">{leaving ? 'Ready' : STAGE_LABEL[s.stage]}</span>
              {counts && !leaving && <span className="loading-stage-counts"> · {counts}</span>}
            </div>
            <div className="loading-details">{details.join(' · ') || ' '}</div>
          </>
        )}
      </div>
    </div>
  )
}
