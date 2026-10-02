// Typed field editors for the inspector (one per field type) + small form primitives.
// FieldInput edits a value through `onSet`, so the same editors serve card fields, group assigns and preset defaults.
import { useLayoutEffect, useRef, useState } from 'react'
import { ChevronDown, ChevronUp, ExternalLink, Plus, X } from 'lucide-react'
import type { FormMapCtl } from '../context'
import { isEmptyValue, optionsFor, type ChecklistItem, type FieldDef } from '../schema'
import { updateFieldDef } from '../lenses/ops'
import { OptionChip, Stars } from '../lenses/widgets'
import { openLinkText } from '@/lib/fileops'
import { promptText } from '@/store/ui'

/** Textarea that grows with its content. */
export function AutoTextarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement> & { minRows?: number }) {
  const { minRows = 2, className, ...rest } = props
  const ref = useRef<HTMLTextAreaElement>(null)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight + 2}px`
  }, [props.value])
  return <textarea ref={ref} rows={minRows} className={`fm-i-textarea ${className ?? ''}`} {...rest} />
}

export function Row({ label, help, children, wide, onLabel, onRemove }: { label: React.ReactNode; help?: string; children: React.ReactNode; wide?: boolean; onLabel?: (e: React.MouseEvent) => void; onRemove?: () => void }) {
  return (
    <div className={`fm-i-row${wide ? ' is-wide' : ''}`}>
      <div className={`fm-i-label${onLabel ? ' is-clickable' : ''}`} title={help} onClick={onLabel} onContextMenu={onLabel}>
        {label}
      </div>
      <div className="fm-i-control">{children}</div>
      {onRemove && (
        <button className="clickable-icon small fm-i-row-x" title="Remove from this card" aria-label="Remove field" onClick={onRemove}>
          <X />
        </button>
      )}
    </div>
  )
}

const linkTarget = (v: string): string => v.trim().replace(/^\[\[/, '').replace(/\]\]$/, '').split('|')[0].trim()

export interface FieldInputProps {
  ctl: FormMapCtl
  name: string
  def: FieldDef | undefined
  value: unknown
  /** card tags (scopes select options) */
  tags?: string[]
  /** set the value; `history` coalesces typing into one undo step */
  onSet(value: unknown, e?: React.MouseEvent, history?: string): void
  /** a stable key for typing coalescing */
  historyKey: string
}

export function FieldInput({ ctl, name, def, value: v, tags, onSet, historyKey }: FieldInputProps) {
  const type = (nv: unknown): void => onSet(nv === '' ? undefined : nv, undefined, historyKey)
  const pick = (nv: unknown, e?: React.MouseEvent): void => onSet(nv, e)
  const addOption = async (multi: boolean): Promise<void> => {
    const label = await promptText({ title: `New ${name} option`, placeholder: 'e.g. Blocked', okLabel: 'Add', validate: (s) => (!s.trim() ? 'Enter a value' : def?.options?.some((o) => o.value === s.trim()) ? 'Already an option' : null) })
    if (!label?.trim()) return
    const value = label.trim()
    updateFieldDef(ctl, name, { options: [...(def?.options ?? []), { value }] })
    pick(multi ? [...(Array.isArray(v) ? v : []), value] : value)
  }

  switch (def?.type) {
    case 'select':
      return (
        <div className="fm-i-chips">
          {optionsFor(def, tags).map((o) => (
            <OptionChip key={o.value} option={o} active={v === o.value} onClick={(e) => pick(v === o.value ? undefined : o.value, e)} title={v === o.value ? 'Click again to clear' : undefined} />
          ))}
          <button className="fm-i-addopt" title="Add an option" onClick={() => void addOption(false)}>
            <Plus size={12} />
          </button>
        </div>
      )
    case 'multiselect': {
      const list = Array.isArray(v) ? (v as unknown[]) : isEmptyValue(v) ? [] : [v]
      return (
        <div className="fm-i-chips">
          {optionsFor(def, tags).map((o) => (
            <OptionChip key={o.value} option={o} active={list.includes(o.value)} onClick={(e) => pick(list.includes(o.value) ? list.filter((x) => x !== o.value) : [...list, o.value], e)} />
          ))}
          <button className="fm-i-addopt" title="Add an option" onClick={() => void addOption(true)}>
            <Plus size={12} />
          </button>
        </div>
      )
    }
    case 'rating':
      return (
        <div className="fm-i-rating">
          <Stars value={Number(v) || 0} max={def.max ?? 5} size={18} onChange={(n, e) => pick(n || undefined, e)} label={name} />
          {def.help && <span className="fm-i-help">{def.help}</span>}
        </div>
      )
    case 'checkbox':
      return <button className={`toggle${v === true ? ' is-on' : ''}`} role="switch" aria-checked={v === true} aria-label={name} onClick={(e) => pick(v === true ? undefined : true, e)} />
    case 'number':
      return <input className="input" type="number" value={v === undefined ? '' : String(v)} placeholder={def.placeholder} onChange={(e) => type(e.target.value === '' ? '' : Number(e.target.value))} />
    case 'date':
      return <input className="input" type="date" value={typeof v === 'string' ? v : ''} onChange={(e) => type(e.target.value)} />
    case 'longtext':
      return <AutoTextarea value={typeof v === 'string' ? v : ''} placeholder={def.placeholder ?? `${name}…`} onChange={(e) => type(e.target.value)} />
    case 'checklist':
      return <ChecklistEditor items={Array.isArray(v) ? (v as ChecklistItem[]) : []} save={(next, history) => onSet(next.length ? next : undefined, undefined, history)} historyKey={historyKey} />
    case 'link': {
      const s = typeof v === 'string' ? v : ''
      return (
        <div className="fm-i-link">
          <input className="input" value={s} placeholder={def.placeholder ?? '[[Note]]'} onChange={(e) => type(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && linkTarget(s) && void openLinkText(linkTarget(s), ctl.path, e.ctrlKey || e.metaKey)} />
          <button className="clickable-icon small" title="Open note (Ctrl+click: new tab)" disabled={!linkTarget(s)} onClick={(e) => void openLinkText(linkTarget(s), ctl.path, e.ctrlKey || e.metaKey)}>
            <ExternalLink />
          </button>
        </div>
      )
    }
    default:
      return <input className="input" value={typeof v === 'string' ? v : v === undefined ? '' : String(v)} placeholder={def?.placeholder} onChange={(e) => type(e.target.value)} />
  }
}

function ChecklistEditor({ items, save, historyKey }: { items: ChecklistItem[]; save: (next: ChecklistItem[], history?: string) => void; historyKey: string }) {
  const [draft, setDraft] = useState('')
  const listRef = useRef<HTMLDivElement>(null)
  const move = (i: number, dir: -1 | 1): void => {
    const j = i + dir
    if (j < 0 || j >= items.length) return
    const next = [...items]
    ;[next[i], next[j]] = [next[j], next[i]]
    save(next)
    requestAnimationFrame(() => listRef.current?.querySelectorAll<HTMLInputElement>('.fm-cl-text')[j]?.focus())
  }
  const add = (): void => {
    const t = draft.trim()
    if (!t) return
    save([...items, { text: t, done: false }])
    setDraft('')
  }
  const done = items.filter((i) => i.done).length

  return (
    <div className="fm-cl" ref={listRef}>
      {items.length > 0 && (
        <div className="fm-cl-progress" title={`${done} of ${items.length} done`}>
          <div className="fm-cl-bar">
            <span style={{ width: `${(done / items.length) * 100}%` }} />
          </div>
          <span>
            {done}/{items.length}
          </span>
        </div>
      )}
      {items.map((it, i) => (
        <div key={i} className={`fm-cl-item${it.done ? ' is-done' : ''}`}>
          <input type="checkbox" checked={it.done} onChange={() => save(items.map((x, k) => (k === i ? { ...x, done: !x.done } : x)))} aria-label="Done" />
          <input
            className="fm-cl-text"
            value={it.text}
            onChange={(e) => save(items.map((x, k) => (k === i ? { ...x, text: e.target.value } : x)), `cl:${historyKey}:${i}`)}
            onKeyDown={(e) => {
              if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
                e.preventDefault()
                move(i, e.key === 'ArrowUp' ? -1 : 1)
              } else if (e.key === 'Backspace' && !it.text) {
                e.preventDefault()
                save(items.filter((_, k) => k !== i))
              }
            }}
          />
          <span className="fm-cl-tools">
            <button className="clickable-icon small" title="Move up (Alt+↑)" disabled={i === 0} onClick={() => move(i, -1)}>
              <ChevronUp />
            </button>
            <button className="clickable-icon small" title="Move down (Alt+↓)" disabled={i === items.length - 1} onClick={() => move(i, 1)}>
              <ChevronDown />
            </button>
            <button className="clickable-icon small" title="Remove" onClick={() => save(items.filter((_, k) => k !== i))}>
              <X />
            </button>
          </span>
        </div>
      ))}
      <input
        className="fm-cl-add"
        value={draft}
        placeholder="+ Add item (Enter)"
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            add()
          }
        }}
        onBlur={add}
      />
    </div>
  )
}
