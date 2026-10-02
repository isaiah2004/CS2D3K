// Small shared UI pieces for the inspector and lenses: kind chips, option chips, rating stars, votes.
import { useState } from 'react'
import { KINDS, type FieldDef, type FieldOption, type FormKind } from '../schema'
import { showContextMenu, type MenuItem } from '@/store/ui'
import './widgets.css'

type CssVars = React.CSSProperties & Record<`--${string}`, string>

export function KindChip({ kind, label = true, active, onClick, title }: { kind: FormKind; label?: boolean; active?: boolean; onClick?: (e: React.MouseEvent) => void; title?: string }) {
  const def = KINDS[kind]
  const style: CssVars = { '--fm-chip-color': def.color }
  const cls = `fm-kchip${active ? ' is-active' : ''}${onClick ? ' is-clickable' : ''}${label ? '' : ' is-icon'}`
  const body = (
    <>
      <span className="fm-kchip-emoji">{def.emoji}</span>
      {label && <span>{def.label}</span>}
    </>
  )
  return onClick ? (
    <button type="button" className={cls} style={style} onClick={onClick} title={title ?? def.hint} aria-pressed={active}>
      {body}
    </button>
  ) : (
    <span className={cls} style={style} title={title ?? def.hint}>
      {body}
    </span>
  )
}

export function OptionChip({ option, active, onClick, compact, title }: { option: FieldOption; active?: boolean; onClick?: (e: React.MouseEvent) => void; compact?: boolean; title?: string }) {
  const style: CssVars = { '--fm-chip-color': option.color ?? 'var(--text-muted)' }
  const cls = `fm-opt-chip${active ? ' is-active' : ''}${onClick ? ' is-clickable' : ''}${compact ? ' is-compact' : ''}`
  return onClick ? (
    <button type="button" className={cls} style={style} onClick={onClick} aria-pressed={active} title={title}>
      <span className="fm-opt-dot" />
      {option.label}
    </button>
  ) : (
    <span className={cls} style={style} title={title}>
      <span className="fm-opt-dot" />
      {option.label}
    </span>
  )
}

/** Clickable rating stars. Clicking the current value clears it. */
export function Stars({ value, max = 5, onChange, size = 14, label }: { value: number; max?: number; onChange?: (v: number, e: React.MouseEvent) => void; size?: number; label?: string }) {
  const [hover, setHover] = useState(0)
  const shown = hover || value
  return (
    <span className={`fm-rating${onChange ? ' is-editable' : ''}`} style={{ fontSize: size }} onMouseLeave={() => setHover(0)} role={onChange ? 'radiogroup' : 'img'} aria-label={label ?? `${value} of ${max}`}>
      {Array.from({ length: max }, (_, i) => {
        const n = i + 1
        const on = n <= shown
        return onChange ? (
          <button
            key={n}
            type="button"
            role="radio"
            aria-checked={n === value}
            className={`fm-rating-star${on ? ' is-on' : ''}${hover && on ? ' is-hover' : ''}`}
            onMouseEnter={() => setHover(n)}
            onClick={(e) => {
              e.stopPropagation()
              onChange(n === value ? 0 : n, e)
            }}
            title={n === value ? 'Clear' : `${n} / ${max}`}
          >
            ★
          </button>
        ) : (
          <span key={n} className={`fm-rating-star${on ? ' is-on' : ''}`}>
            ★
          </span>
        )
      })}
    </span>
  )
}

export function VoteBadge({ votes }: { votes?: number }) {
  if (!votes) return null
  return (
    <span className="fm-vote-badge" title={`${votes} vote${votes === 1 ? '' : 's'}`}>
      <span className="fm-vote-dot" />
      {votes}
    </span>
  )
}

const dot = (color?: string) => <span className="fm-mdot" style={{ background: color ?? 'var(--text-faint)' }} />

/** Context menu of a select field's options (plus "Clear"). */
export function openOptionMenu(e: React.MouseEvent, def: FieldDef, value: unknown, onPick: (v: string | undefined, e: React.MouseEvent) => void): void {
  const items: MenuItem[] = (def.options ?? []).map((o) => ({ label: o.label, icon: dot(o.color), checked: o.value === value, onClick: () => onPick(o.value, e) }))
  if (value !== undefined) items.push({ separator: true }, { label: 'Clear', onClick: () => onPick(undefined, e) })
  showContextMenu(e, items)
}

/** Plain text of any field value, for search/sorting/markdown. */
export function fieldText(def: FieldDef | undefined, v: unknown): string {
  if (v === undefined || v === null || v === '') return ''
  if (!def) return String(v)
  switch (def.type) {
    case 'select':
      return def.options?.find((o) => o.value === v)?.label ?? String(v)
    case 'checkbox':
      return v ? 'Yes' : 'No'
    case 'rating':
      return Number(v) ? '★'.repeat(Number(v)) : ''
    case 'checklist':
      return Array.isArray(v) ? `${v.filter((i) => i?.done).length}/${v.length}` : ''
    default:
      return String(v)
  }
}
