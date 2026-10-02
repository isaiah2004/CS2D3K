// Typed field editors for the inspector (one per FieldType) + small form primitives.
import { useLayoutEffect, useRef, useState } from 'react'
import { ChevronDown, ChevronUp, ExternalLink, X } from 'lucide-react'
import type { FormMapCtl } from '../context'
import type { ChecklistItem, FieldDef, FormNode } from '../schema'
import { setField } from '../lenses/ops'
import { OptionChip, Stars } from '../lenses/widgets'
import { openLinkText } from '@/lib/fileops'

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

export function Row({ label, help, children, wide }: { label: string; help?: string; children: React.ReactNode; wide?: boolean }) {
  return (
    <div className={`fm-i-row${wide ? ' is-wide' : ''}`}>
      <div className="fm-i-label" title={help}>
        {label}
      </div>
      <div className="fm-i-control">{children}</div>
    </div>
  )
}

const linkTarget = (v: string): string => v.trim().replace(/^\[\[/, '').replace(/\]\]$/, '').trim()

export function FieldEditor({ ctl, card, def }: { ctl: FormMapCtl; card: FormNode; def: FieldDef }) {
  const v = card.fields[def.key]
  const id = card.id
  /** typing: coalesce into one undo step per field */
  const type = (nv: unknown): void => ctl.updateForm(id, { fields: { [def.key]: nv === '' ? undefined : nv } }, { history: `f:${id}:${def.key}` })
  const pick = (nv: unknown, e?: React.MouseEvent): void => setField(ctl, id, def.key, nv, e)

  switch (def.type) {
    case 'select':
      return (
        <div className="fm-i-chips">
          {def.options?.map((o) => (
            <OptionChip key={o.value} option={o} active={v === o.value} onClick={(e) => pick(v === o.value ? undefined : o.value, e)} title={v === o.value ? 'Click again to clear' : undefined} />
          ))}
        </div>
      )
    case 'rating':
      return (
        <div className="fm-i-rating">
          <Stars value={Number(v) || 0} max={def.max ?? 5} size={18} onChange={(n, e) => pick(n || undefined, e)} label={def.label} />
          {def.help && <span className="fm-i-help">{def.help}</span>}
        </div>
      )
    case 'checkbox':
      return <button className={`toggle${v ? ' is-on' : ''}`} role="switch" aria-checked={!!v} aria-label={def.label} onClick={() => pick(v ? undefined : true)} />
    case 'number':
      return <input className="input" type="number" value={v === undefined ? '' : String(v)} placeholder={def.placeholder} onChange={(e) => type(e.target.value === '' ? '' : Number(e.target.value))} />
    case 'date':
      return <input className="input" type="date" value={typeof v === 'string' ? v : ''} onChange={(e) => type(e.target.value)} />
    case 'longtext':
      return <AutoTextarea value={typeof v === 'string' ? v : ''} placeholder={def.placeholder ?? `${def.label}…`} onChange={(e) => type(e.target.value)} />
    case 'checklist':
      return <ChecklistEditor ctl={ctl} card={card} def={def} />
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
      return <input className="input" value={typeof v === 'string' ? v : v === undefined ? '' : String(v)} placeholder={def.placeholder} onChange={(e) => type(e.target.value)} />
  }
}

function ChecklistEditor({ ctl, card, def }: { ctl: FormMapCtl; card: FormNode; def: FieldDef }) {
  const items = Array.isArray(card.fields[def.key]) ? (card.fields[def.key] as ChecklistItem[]) : []
  const [draft, setDraft] = useState('')
  const listRef = useRef<HTMLDivElement>(null)
  const save = (next: ChecklistItem[], history?: string): void => ctl.updateForm(card.id, { fields: { [def.key]: next.length ? next : undefined } }, history ? { history } : undefined)
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
            onChange={(e) => save(items.map((x, k) => (k === i ? { ...x, text: e.target.value } : x)), `cl:${card.id}:${i}`)}
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
        placeholder="+ Add criterion (Enter)"
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
