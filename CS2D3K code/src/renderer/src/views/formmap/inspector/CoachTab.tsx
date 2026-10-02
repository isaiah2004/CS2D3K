// Inspector "Coach" tab: budgets (sum rules), tag counts and the checks (generic ones + the map's own rules).
import { useMemo } from 'react'
import { Wand2 } from 'lucide-react'
import type { FormMapCtl } from '../context'
import { coachChecks, type CoachCheck } from '../analysis'
import { tagColor, type CheckRule } from '../schema'
import { applyGroupFields, setMeta, tagUsage } from '../lenses/ops'

const LEVEL_ICON: Record<CoachCheck['level'], string> = { warn: '⚠️', info: '💡', good: '✅' }

export default function CoachTab({ ctl }: { ctl: FormMapCtl }) {
  const checks = useMemo(() => coachChecks(ctl.data), [ctl.data])
  const warns = checks.filter((c) => c.level === 'warn').length
  const mood = warns === 0 ? { emoji: '😄', text: 'Looking healthy' } : warns <= 2 ? { emoji: '🙂', text: 'A few things to decide' } : { emoji: '😬', text: 'Needs some decisions' }
  const sums = (ctl.meta.checks ?? []).filter((r): r is Extract<CheckRule, { type: 'sum' }> => r.type === 'sum')
  const listed = checks.filter((c) => !c.sum || c.level === 'warn')

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
      {sums.map((r) => (
        <Budget key={r.id} ctl={ctl} rule={r} check={checks.find((c) => c.id === r.id)} />
      ))}
      <TagTiles ctl={ctl} />
      <div className="fm-i-section-head fm-coach-checks-head">
        <span>Checks</span>
      </div>
      <div className="fm-coach-checks">
        {listed.map((c) => {
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
                {c.fix === 'apply-groups' && (
                  <button
                    className="fm-check-fix"
                    onClick={(e) => {
                      e.stopPropagation()
                      applyGroupFields(ctl, c.nodes)
                    }}
                  >
                    <Wand2 size={12} /> Apply the group fields
                  </button>
                )}
              </div>
              {c.nodes.length > 0 && <span className="fm-check-count">{c.nodes.filter((id) => ctl.data.nodes.some((n) => n.id === id)).length}</span>}
            </div>
          )
        })}
        {!listed.length && <div className="fm-i-muted">Nothing to flag. Nice.</div>}
      </div>
    </div>
  )
}

/** A sum rule as a budget bar with an editable limit. */
function Budget({ ctl, rule, check }: { ctl: FormMapCtl; rule: Extract<CheckRule, { type: 'sum' }>; check?: CoachCheck }) {
  const value = check?.sum?.value ?? 0
  const max = rule.max ?? 0
  const scale = Math.max(value, max, 1)
  const ratio = max ? value / max : 0
  const tone = !max ? '' : ratio > 1 ? 'is-over' : ratio > 0.85 ? 'is-tight' : 'is-ok'
  const unit = rule.unit ?? ''
  const setMax = (v: number | undefined): void => setMeta(ctl, { checks: (ctl.meta.checks ?? []).map((r) => (r.id === rule.id ? ({ ...r, max: v } as CheckRule) : r)) }, `budget:${rule.id}`)
  return (
    <div className="fm-coach-card">
      <div className="fm-coach-row">
        <span className="fm-coach-label">{rule.label} budget</span>
        <span className={`fm-coach-points ${tone}`}>
          <b>{value}</b> /
        </span>
        <input
          className="input fm-i-num fm-coach-budget"
          type="number"
          min={0}
          value={rule.max ?? ''}
          placeholder="—"
          title={`Budget in ${unit || 'points'}`}
          onChange={(e) => setMax(e.target.value === '' ? undefined : Math.max(0, Number(e.target.value)))}
          aria-label={`${rule.label} budget`}
        />
        <span className="fm-i-muted">{unit}</span>
      </div>
      <div className={`fm-budget ${tone}`}>
        <span className="fm-budget-fill" style={{ width: `${(value / scale) * 100}%` }} />
        {max > 0 && <span className="fm-budget-line" style={{ left: `${(max / scale) * 100}%` }} title={`Budget: ${max} ${unit}`} />}
      </div>
      <div className="fm-coach-row fm-coach-sub">
        {!max ? 'Set a budget to keep the scope honest.' : ratio > 1 ? `${value - max} ${unit} over — something has to move out.` : `${max - value} ${unit} of room left.`}
      </div>
    </div>
  )
}

function TagTiles({ ctl }: { ctl: FormMapCtl }) {
  const usage = useMemo(() => tagUsage(ctl.data), [ctl.data])
  const tags = [...usage.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 12)
  if (!tags.length) return null
  const active = ctl.focusFilter?.tags
  return (
    <div className="fm-kind-grid">
      {tags.map(([t, n]) => {
        const on = active?.length === 1 && active[0] === t
        return (
          <button
            key={t}
            className={`fm-kind-tile${on ? ' is-active' : ''}`}
            style={{ '--fm-chip-color': tagColor(ctl.meta, t) } as React.CSSProperties}
            title={on ? 'Clear focus' : `Focus on #${t}`}
            onClick={() => ctl.setFocusFilter(on ? null : { tags: [t] })}
          >
            <b>{n}</b>
            <span className="fm-kind-tile-label">#{t}</span>
          </button>
        )
      })}
    </div>
  )
}
