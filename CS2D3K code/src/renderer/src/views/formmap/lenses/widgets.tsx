// Small shared UI pieces for the map, inspector and lenses: tag chips, option chips, field value chips, rating stars,
// votes, and the tag / option / color menus.
import { useState } from 'react'
import { Plus, Tag } from 'lucide-react'
import {
  cleanTag,
  fieldLabel,
  fieldText,
  FIELD_TYPES,
  fmColor,
  FM_COLORS,
  isEmptyValue,
  optionLabel,
  optionOf,
  optionsFor,
  tagColor,
  type ChecklistItem,
  type FieldDef,
  type FieldOption,
  type FieldRegistry,
  type FormMapMeta
} from '../schema'
import { promptText, showContextMenu, type MenuItem } from '@/store/ui'
import './widgets.css'
import './chips.css'

type CssVars = React.CSSProperties & Record<`--${string}`, string>

export function TagChip({ tag, meta, active, onClick, onRemove, title, compact }: { tag: string; meta: FormMapMeta; active?: boolean; onClick?: (e: React.MouseEvent) => void; onRemove?: () => void; title?: string; compact?: boolean }) {
  const style: CssVars = { '--fm-chip-color': tagColor(meta, tag) }
  const cls = `fm-tag${active ? ' is-active' : ''}${onClick ? ' is-clickable' : ''}${compact ? ' is-compact' : ''}`
  const body = (
    <>
      <span className="fm-tag-hash">#</span>
      {tag}
      {onRemove && (
        <span
          className="fm-tag-x"
          role="button"
          title={`Remove #${tag}`}
          onClick={(e) => {
            e.stopPropagation()
            onRemove()
          }}
        >
          ×
        </span>
      )}
    </>
  )
  return onClick ? (
    <button type="button" className={cls} style={style} onClick={onClick} title={title} aria-pressed={active}>
      {body}
    </button>
  ) : (
    <span className={cls} style={style} title={title}>
      {body}
    </span>
  )
}

export function OptionChip({ option, active, onClick, compact, title }: { option: FieldOption; active?: boolean; onClick?: (e: React.MouseEvent) => void; compact?: boolean; title?: string }) {
  const style: CssVars = { '--fm-chip-color': fmColor(option.color) ?? 'var(--text-muted)' }
  const cls = `fm-opt-chip${active ? ' is-active' : ''}${onClick ? ' is-clickable' : ''}${compact ? ' is-compact' : ''}`
  return onClick ? (
    <button type="button" className={cls} style={style} onClick={onClick} aria-pressed={active} title={title}>
      <span className="fm-opt-dot" />
      {optionLabel(option)}
    </button>
  ) : (
    <span className={cls} style={style} title={title}>
      <span className="fm-opt-dot" />
      {optionLabel(option)}
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

/** Read-only chips summarizing a card's field values (board cards, kanban cards). */
export function FieldChips({ fields, reg, skip, max = 5 }: { fields: Record<string, unknown> | undefined; reg: FieldRegistry; skip?: string; max?: number }) {
  const out: React.ReactNode[] = []
  for (const [k, v] of Object.entries(fields ?? {})) {
    if (k === skip || isEmptyValue(v)) continue
    const def = reg[k]
    if (def?.hidden || def?.type === 'longtext') continue
    if (out.length >= max) break
    out.push(<ValueChip key={k} name={k} def={def} value={v} />)
  }
  return out.length ? <>{out}</> : null
}

export function ValueChip({ name, def, value }: { name: string; def?: FieldDef; value: unknown }) {
  const label = fieldLabel(name, def)
  switch (def?.type) {
    case 'select': {
      const o = optionOf(def, value)
      return <OptionChip option={o ?? { value: String(value) }} compact title={label} />
    }
    case 'multiselect':
      return (
        <>
          {(Array.isArray(value) ? value : [value]).map((v) => (
            <OptionChip key={String(v)} option={optionOf(def, v) ?? { value: String(v) }} compact title={label} />
          ))}
        </>
      )
    case 'rating':
      return (
        <span className="fm-vchip is-rating" title={label}>
          <Stars value={Number(value) || 0} max={def.max ?? 5} size={10.5} />
        </span>
      )
    case 'checkbox':
      return (
        <span className="fm-vchip is-check" title={label}>
          ✓ {label}
        </span>
      )
    case 'checklist': {
      const list = Array.isArray(value) ? (value as ChecklistItem[]) : []
      const done = list.filter((i) => i?.done).length
      return (
        <span className={`fm-vchip is-checklist${done === list.length ? ' is-complete' : ''}`} title={label}>
          ☑ {done}/{list.length}
        </span>
      )
    }
    default:
      return (
        <span className="fm-vchip" title={`${label}: ${fieldText(def, value)}`} style={def?.color ? ({ '--fm-chip-color': fmColor(def.color)! } as CssVars) : undefined}>
          <span className="fm-vchip-key">{label}</span>
          <span className="fm-vchip-val">{fieldText(def, value)}</span>
        </span>
      )
  }
}

const dot = (color?: string) => <span className="fm-mdot" style={{ background: fmColor(color) ?? 'var(--text-faint)' }} />

/** Context menu of a select field's options for a card (plus "Clear"). */
export function openOptionMenu(e: React.MouseEvent, def: FieldDef, value: unknown, tags: string[] | undefined, onPick: (v: string | undefined, e: React.MouseEvent) => void, clearLabel = 'Clear'): void {
  const items: MenuItem[] = optionsFor(def, tags).map((o) => ({ label: optionLabel(o), icon: dot(o.color), checked: o.value === value, onClick: () => onPick(o.value, e) }))
  if (!isEmptyValue(value)) items.push({ separator: true }, { label: clearLabel, onClick: () => onPick(undefined, e) })
  showContextMenu(e, items)
}

/** Ask for a new tag name (returns the cleaned name or null). */
export async function askTag(title = 'New tag'): Promise<string | null> {
  const v = await promptText({ title, placeholder: 'e.g. feature', okLabel: 'Add', validate: (s) => (cleanTag(s) && !/\s/.test(cleanTag(s)) ? null : 'One word, no spaces') })
  return v ? cleanTag(v) : null
}

/** Menu of the map's tags (checked = on the card) plus "New tag…". */
export function tagMenuItems(meta: FormMapMeta, current: string[], toggle: (tag: string) => void): MenuItem[] {
  const all = [...new Set([...Object.keys(meta.tags ?? {}), ...current])].sort((a, b) => a.localeCompare(b))
  return [
    ...all.map((t) => ({ label: `#${t}`, icon: <span className="fm-mdot" style={{ background: tagColor(meta, t) }} />, checked: current.includes(t), onClick: () => toggle(t) })),
    ...(all.length ? [{ separator: true } as MenuItem] : []),
    {
      label: 'New tag…',
      icon: <Plus />,
      onClick: () =>
        void askTag().then((t) => {
          if (t) toggle(t)
        })
    }
  ]
}

export function openTagMenu(e: React.MouseEvent, meta: FormMapMeta, current: string[], toggle: (tag: string) => void): void {
  showContextMenu(e, tagMenuItems(meta, current, toggle))
}

/** Color submenu for tags, options and fields. */
export function colorItems(current: string | undefined, onPick: (c: string | undefined) => void): MenuItem[] {
  return FM_COLORS.map((c) => ({ label: c.name, icon: <span className="fm-mdot" style={{ background: c.css }} />, checked: current === c.id, onClick: () => onPick(c.id) }))
}

export function TypeIcon({ type }: { type: FieldDef['type'] }) {
  return <span className="fm-type-icon">{FIELD_TYPES.find((t) => t.type === type)?.icon ?? 'Aa'}</span>
}

export const TagIcon = Tag
