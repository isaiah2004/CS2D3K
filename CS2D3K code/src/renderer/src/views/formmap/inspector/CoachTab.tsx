// Inspector "Coach" tab: MVP budget + progress, counts per kind, and decision-support checks.
import { useMemo } from 'react'
import type { FormMapCtl } from '../context'
import { coachChecks, features, mvpStats, type CoachCheck } from '../analysis'
import { cardTitle, effortPoints, EFFORTS, FEATURE_STATUS, forms, KIND_ORDER, KINDS, type FormKind } from '../schema'
import { setMeta } from '../lenses/ops'

const LEVEL_ICON: Record<CoachCheck['level'], string> = { warn: '⚠️', info: '💡', good: '✅' }

export default function CoachTab({ ctl }: { ctl: FormMapCtl }) {
  const checks = useMemo(() => coachChecks(ctl.data), [ctl.data])
  const warns = checks.filter((c) => c.level === 'warn').length
  const mood = warns === 0 ? { emoji: '😄', text: 'Looking healthy' } : warns <= 2 ? { emoji: '🙂', text: 'A few things to decide' } : { emoji: '😬', text: 'Needs some decisions' }

  const onCheck = (c: CoachCheck): void => {
    if (!c.nodes.length) return
    const active = ctl.highlight?.length === c.nodes.length && c.nodes.every((n) => ctl.highlight!.includes(n))
    if (active) return ctl.setHighlight(null)
    ctl.setHighlight(c.nodes)
    ctl.reveal(c.nodes.filter((id) => ctl.data.nodes.some((n) => n.id === id)))
  }

  return (
    <div className="fm-coach">
      <div className="fm-coach-mood">
        <span className="fm-coach-mood-emoji">{mood.emoji}</span>
        <div>
          <div className="fm-coach-mood-title">{mood.text}</div>
          <div className="fm-i-muted">
            {warns} warning{warns === 1 ? '' : 's'} · {checks.filter((c) => c.level === 'info').length} suggestions · {checks.filter((c) => c.level === 'good').length} wins
          </div>
        </div>
      </div>
      <Budget ctl={ctl} />
      <KindCounts ctl={ctl} />
      <div className="fm-i-section-head fm-coach-checks-head">
        <span>Checks</span>
      </div>
      <div className="fm-coach-checks">
        {checks.map((c) => {
          const active = !!c.nodes.length && ctl.highlight?.length === c.nodes.length && c.nodes.every((n) => ctl.highlight!.includes(n))
          return (
            <div
              key={c.id}
              className={`fm-check is-${c.level}${c.nodes.length ? ' is-clickable' : ''}${active ? ' is-active' : ''}`}
              role={c.nodes.length ? 'button' : undefined}
              tabIndex={c.nodes.length ? 0 : undefined}
              onClick={() => onCheck(c)}
              onKeyDown={(e) => e.key === 'Enter' && onCheck(c)}
              title={c.nodes.length ? 'Click to highlight and reveal these cards' : undefined}
            >
              <span className="fm-check-icon">{LEVEL_ICON[c.level]}</span>
              <div className="fm-check-body">
                <div className="fm-check-title">{c.title}</div>
                {c.detail && <div className="fm-check-detail">{c.detail}</div>}
              </div>
              {c.nodes.length > 0 && <span className="fm-check-count">{c.nodes.filter((id) => ctl.data.nodes.some((n) => n.id === id)).length}</span>}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function Budget({ ctl }: { ctl: FormMapCtl }) {
  const s = useMemo(() => mvpStats(ctl.data), [ctl.data])
  const mvp = useMemo(
    () =>
      features(ctl.data, 'mvp')
        .filter((f) => f.fields.status !== 'cut')
        .sort((a, b) => effortPoints(b.fields.effort) - effortPoints(a.fields.effort)),
    [ctl.data]
  )
  const budget = s.budget ?? 0
  const scale = Math.max(s.points, budget, 1)
  const ratio = budget ? s.points / budget : 0
  const tone = !budget ? '' : ratio > 1 ? 'is-over' : ratio > 0.85 ? 'is-tight' : 'is-ok'
  const progress = s.total ? s.done / s.total : 0
  const statusColor = (v: unknown): string => FEATURE_STATUS.find((o) => o.value === v)?.color ?? 'var(--text-faint)'

  return (
    <div className="fm-coach-card">
      <div className="fm-coach-row">
        <span className="fm-coach-label">MVP budget</span>
        <span className={`fm-coach-points ${tone}`}>
          <b>{s.points}</b> /
        </span>
        <input
          className="input fm-i-num fm-coach-budget"
          type="number"
          min={0}
          value={s.budget ?? ''}
          placeholder="—"
          title="Effort budget in points (XS=1 S=2 M=3 L=5 XL=8)"
          onChange={(e) => setMeta(ctl, { mvpBudget: e.target.value === '' ? undefined : Math.max(0, Number(e.target.value)) }, 'budget')}
        />
        <span className="fm-i-muted">pts</span>
      </div>
      <div className={`fm-budget ${tone}`} title={EFFORTS.map((e) => `${e.label}=${e.points}`).join(' · ')}>
        {mvp.map((f) => {
          const pts = effortPoints(f.fields.effort)
          if (!pts) return null
          return (
            <span
              key={f.id}
              className="fm-budget-seg"
              style={{ width: `${(pts / scale) * 100}%`, background: statusColor(f.fields.status) }}
              title={`${cardTitle(f)} — ${pts} pts`}
              onClick={() => ctl.setSelection([f.id])}
            />
          )
        })}
        {budget > 0 && <span className="fm-budget-line" style={{ left: `${(budget / scale) * 100}%` }} title={`Budget: ${budget} pts`} />}
      </div>
      <div className="fm-coach-row fm-coach-sub">
        {!budget ? 'Set a budget to keep the MVP honest.' : ratio > 1 ? `${s.points - budget} pts over — something has to move to Later.` : `${budget - s.points} pts of room left.`}
      </div>
      <div className="fm-coach-row">
        <span className="fm-coach-label">MVP progress</span>
        <span className="fm-coach-points">
          <b>{s.done}</b> / {s.total} done
        </span>
        <span className="fm-toolbar-spacer" />
        <span className="fm-coach-pct">{Math.round(progress * 100)}%</span>
      </div>
      <div className="fm-progress">
        <span style={{ width: `${progress * 100}%` }} />
      </div>
    </div>
  )
}

function KindCounts({ ctl }: { ctl: FormMapCtl }) {
  const counts = useMemo(() => {
    const m = new Map<FormKind, number>()
    for (const f of forms(ctl.data)) m.set(f.kind, (m.get(f.kind) ?? 0) + 1)
    return m
  }, [ctl.data])
  const active = ctl.focusFilter?.kinds
  return (
    <div className="fm-kind-grid">
      {KIND_ORDER.map((k) => {
        const on = active?.length === 1 && active[0] === k
        return (
          <button
            key={k}
            className={`fm-kind-tile${on ? ' is-active' : ''}`}
            style={{ '--fm-chip-color': KINDS[k].color } as React.CSSProperties}
            title={on ? 'Clear focus' : `Focus on ${KINDS[k].plural.toLowerCase()}`}
            onClick={() => ctl.setFocusFilter(on ? null : { kinds: [k] })}
          >
            <span className="fm-kind-tile-emoji">{KINDS[k].emoji}</span>
            <b>{counts.get(k) ?? 0}</b>
            <span className="fm-kind-tile-label">{KINDS[k].plural}</span>
          </button>
        )
      })}
    </div>
  )
}
