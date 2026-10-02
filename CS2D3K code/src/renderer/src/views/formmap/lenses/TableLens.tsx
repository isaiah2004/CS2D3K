// Table lens: one row per form card, kind filter tabs, sortable columns, inline editing.
import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowDown, ArrowUp, MapPin, Plus, Trash2 } from 'lucide-react'
import type { FormMapCtl, LensProps } from '../context'
import { cardTitle, fieldDef, forms, KIND_ORDER, KINDS, type ChecklistItem, type FieldDef, type FormKind, type FormNode } from '../schema'
import { addCard, deleteNodes, moveToZone, setField, setKind, vote, zoneIndex, zonesInOrder } from './ops'
import { fieldText, KindChip, OptionChip, openOptionMenu, Stars } from './widgets'
import { useWorkspace } from '@/store/workspace'
import { showContextMenu, type MenuItem } from '@/store/ui'
import './lenses.css'

type KindFilter = 'all' | FormKind
interface SortState {
  key: string
  dir: 1 | -1
}
interface TableState {
  kind: KindFilter
  sort: SortState | null
}

interface Col {
  key: string
  label: string
  /** field columns: the first definition (rows use their own kind's definition) */
  field?: FieldDef
  className?: string
}

const BASE_COLS: Col[] = [
  { key: '@kind', label: 'Kind', className: 'is-kind' },
  { key: '@title', label: 'Title', className: 'is-title' }
]
const TAIL_COLS: Col[] = [
  { key: '@zone', label: 'Zone', className: 'is-zone' },
  { key: '@votes', label: 'Votes', className: 'is-num' },
  { key: '@rels', label: 'Links', className: 'is-num' }
]

function readState(ctl: FormMapCtl): TableState {
  const s = (ctl.tab.state?.table ?? {}) as Partial<TableState>
  return { kind: s.kind === 'all' || (s.kind && s.kind in KINDS) ? s.kind : 'all', sort: s.sort ?? null }
}

export default function TableLens({ ctl }: LensProps) {
  const [st, setSt] = useState<TableState>(() => readState(ctl))
  const update = (patch: Partial<TableState>): void => {
    const next = { ...st, ...patch }
    setSt(next)
    useWorkspace.getState().updateTabState(ctl.tab.id, { table: next })
  }
  const [editing, setEditing] = useState<{ id: string; key: string } | null>(null)

  const all = useMemo(() => forms(ctl.data), [ctl.data])
  const counts = useMemo(() => {
    const m = new Map<KindFilter, number>([['all', all.length]])
    for (const f of all) m.set(f.kind, (m.get(f.kind) ?? 0) + 1)
    return m
  }, [all])
  const zoneOf = useMemo(() => {
    const idx = zoneIndex(ctl.data)
    const byId = new Map(zonesInOrder(ctl.data).map((z) => [z.id, z]))
    return (id: string) => byId.get(idx.get(id) ?? '') ?? null
  }, [ctl.data])
  const relCount = useMemo(() => {
    const m = new Map<string, number>()
    for (const e of ctl.data.edges) {
      m.set(e.fromNode, (m.get(e.fromNode) ?? 0) + 1)
      m.set(e.toNode, (m.get(e.toNode) ?? 0) + 1)
    }
    return m
  }, [ctl.data])

  const cols = useMemo<Col[]>(() => {
    const kinds = st.kind === 'all' ? KIND_ORDER : [st.kind]
    const seen = new Map<string, FieldDef>()
    for (const k of kinds)
      for (const f of KINDS[k].fields) {
        // "All" shows the on-card fields only, so the table stays scannable
        if (st.kind === 'all' && !f.onCard) continue
        if (!seen.has(f.key)) seen.set(f.key, f)
      }
    return [...BASE_COLS, ...[...seen.values()].map((f) => ({ key: f.key, label: f.label, field: f, className: `is-${f.type}` })), ...TAIL_COLS]
  }, [st.kind])

  const sortValue = (f: FormNode, key: string): string | number => {
    switch (key) {
      case '@kind':
        return KIND_ORDER.indexOf(f.kind)
      case '@title':
        return cardTitle(f).toLowerCase()
      case '@zone':
        return zoneOf(f.id)?.label?.toLowerCase() ?? '￿'
      case '@votes':
        return f.votes ?? 0
      case '@rels':
        return relCount.get(f.id) ?? 0
    }
    const def = fieldDef(f.kind, key)
    const v = f.fields[key]
    if (!def || v === undefined || v === '') return '￿'
    if (def.type === 'select') {
      const i = def.options?.findIndex((o) => o.value === v) ?? -1
      return i < 0 ? 999 : i
    }
    if (def.type === 'rating' || def.type === 'number') return Number(v) || 0
    if (def.type === 'checklist') return Array.isArray(v) ? v.length : 0
    if (def.type === 'checkbox') return v ? 0 : 1
    return String(v).toLowerCase()
  }

  const rows = useMemo(() => {
    const list = all.filter((f) => st.kind === 'all' || f.kind === st.kind)
    const s = st.sort
    if (!s) return list.sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) || a.y - b.y || a.x - b.x)
    return list.sort((a, b) => {
      const va = sortValue(a, s.key)
      const vb = sortValue(b, s.key)
      const c = typeof va === 'number' && typeof vb === 'number' ? va - vb : String(va).localeCompare(String(vb))
      return c * s.dir || a.y - b.y
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [all, st, zoneOf, relCount])

  const toggleSort = (key: string): void => {
    const s = st.sort
    // numbers/votes/ratings read best biggest-first
    const firstDir: 1 | -1 = key === '@votes' || key === '@rels' || cols.find((c) => c.key === key)?.field?.type === 'rating' ? -1 : 1
    if (!s || s.key !== key) update({ sort: { key, dir: firstDir } })
    else if (s.dir === firstDir) update({ sort: { key, dir: (firstDir * -1) as 1 | -1 } })
    else update({ sort: null })
  }

  // ------------------------------------------------ selection
  const selected = useMemo(() => new Set(ctl.selection), [ctl.selection])
  const anchor = useRef<string | null>(null)
  const onRowClick = (e: React.MouseEvent, id: string): void => {
    if (e.shiftKey && anchor.current) {
      const a = rows.findIndex((r) => r.id === anchor.current)
      const b = rows.findIndex((r) => r.id === id)
      if (a >= 0 && b >= 0) {
        ctl.setSelection(rows.slice(Math.min(a, b), Math.max(a, b) + 1).map((r) => r.id))
        return
      }
    }
    anchor.current = id
    if (e.ctrlKey || e.metaKey) ctl.setSelection(selected.has(id) ? ctl.selection.filter((s) => s !== id) : [...ctl.selection, id])
    else if (!(selected.size === 1 && selected.has(id))) ctl.setSelection([id])
  }

  const wrapRef = useRef<HTMLDivElement>(null)
  // keep the (externally) selected row in view
  useEffect(() => {
    if (ctl.selection.length !== 1) return
    wrapRef.current?.querySelector(`[data-row="${ctl.selection[0]}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [ctl.selection])

  const onKey = (e: React.KeyboardEvent): void => {
    if (editing || (e.target as HTMLElement).closest('input, textarea')) return
    const i = rows.findIndex((r) => selected.has(r.id))
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      const n = rows[Math.max(0, Math.min(rows.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)))]
      if (n) {
        anchor.current = n.id
        ctl.setSelection([n.id])
      }
    } else if ((e.key === 'Enter' || e.key === 'F2') && i >= 0) {
      e.preventDefault()
      setEditing({ id: rows[i].id, key: '@title' })
    } else if (e.key === 'Escape') {
      if (ctl.highlight) ctl.setHighlight(null)
      else ctl.setSelection([])
    } else if (e.key === 'Delete' && ctl.selection.length) {
      e.preventDefault()
      deleteNodes(ctl, ctl.selection)
    }
  }

  const addRow = (e: React.MouseEvent): void => {
    const create = (k: FormKind): void => {
      const id = addCard(ctl, k)
      ctl.setSelection([id])
      setEditing({ id, key: '@title' })
    }
    if (st.kind !== 'all') return create(st.kind)
    showContextMenu(
      e,
      KIND_ORDER.map((k) => ({ label: `${KINDS[k].emoji}  ${KINDS[k].label}`, hint: KINDS[k].hint, onClick: () => create(k) }))
    )
  }

  const rowMenu = (e: React.MouseEvent, f: FormNode): void => {
    if (!selected.has(f.id)) ctl.setSelection([f.id])
    const ids = selected.has(f.id) ? ctl.selection : [f.id]
    const items: MenuItem[] = [
      { label: 'Reveal in map', icon: <MapPin size={14} />, onClick: () => ctl.reveal(ids, { select: true }) },
      { label: 'Edit title', onClick: () => setEditing({ id: f.id, key: '@title' }) },
      { label: 'Vote', onClick: () => vote(ctl, f.id, 1) },
      { label: 'Remove vote', disabled: !f.votes, onClick: () => vote(ctl, f.id, -1) },
      { separator: true },
      { label: ids.length > 1 ? `Delete ${ids.length} cards` : 'Delete', icon: <Trash2 size={14} />, danger: true, onClick: () => deleteNodes(ctl, ids) }
    ]
    showContextMenu(e, items)
  }

  const dim = (f: FormNode): boolean => !!ctl.highlight && !ctl.highlight.includes(f.id) && !selected.has(f.id)

  return (
    <div className="fm-table-lens">
      <div className="fm-lens-toolbar">
        <div className="fm-tabs" role="tablist" aria-label="Kind filter">
          {(['all', ...KIND_ORDER] as KindFilter[]).map((k) => (
            <button key={k} role="tab" aria-selected={st.kind === k} className={`fm-tab${st.kind === k ? ' is-active' : ''}`} onClick={() => update({ kind: k, sort: st.kind === k ? st.sort : null })}>
              {k === 'all' ? 'All' : `${KINDS[k].emoji} ${KINDS[k].plural}`}
              <span className="fm-tab-count">{counts.get(k) ?? 0}</span>
            </button>
          ))}
        </div>
        <span className="fm-toolbar-spacer" />
        <button className="btn fm-table-add" onClick={addRow}>
          <Plus size={14} /> New {st.kind === 'all' ? 'card' : KINDS[st.kind].label.toLowerCase()}
        </button>
      </div>
      <div className="fm-table-wrap" ref={wrapRef} tabIndex={0} onKeyDown={onKey}>
        <table className="fm-table">
          <thead>
            <tr>
              {cols.map((c) => (
                <th key={c.key} className={c.className} onClick={() => toggleSort(c.key)} aria-sort={st.sort?.key === c.key ? (st.sort.dir === 1 ? 'ascending' : 'descending') : 'none'}>
                  <span className="fm-th">
                    {c.label}
                    {st.sort?.key === c.key && (st.sort.dir === 1 ? <ArrowUp size={12} /> : <ArrowDown size={12} />)}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((f) => (
              <tr
                key={f.id}
                data-row={f.id}
                className={`${selected.has(f.id) ? 'is-selected' : ''}${dim(f) ? ' is-dim' : ''}`}
                onClick={(e) => onRowClick(e, f.id)}
                onContextMenu={(e) => rowMenu(e, f)}
              >
                {cols.map((c) => (
                  <td key={c.key} className={c.className}>
                    <Cell ctl={ctl} f={f} col={c} zone={zoneOf(f.id)?.label} zoneEmoji={zoneOf(f.id)?.emoji} rels={relCount.get(f.id) ?? 0} editing={editing?.id === f.id && editing.key === c.key} setEditing={(on) => setEditing(on ? { id: f.id, key: c.key } : null)} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        {!rows.length && (
          <div className="fm-table-empty">
            <div className="fm-col-empty-emoji">{st.kind === 'all' ? '🗂️' : KINDS[st.kind].emoji}</div>
            No {st.kind === 'all' ? 'cards' : KINDS[st.kind].plural.toLowerCase()} yet.
          </div>
        )}
        <button className="fm-table-addrow" onClick={addRow}>
          <Plus size={13} /> Add row
        </button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------- cells

/** click handler that doesn't also select/toggle the row */
const stop =
  (fn: () => void) =>
  (e: React.MouseEvent): void => {
    e.stopPropagation()
    fn()
  }

interface CellProps {
  ctl: FormMapCtl
  f: FormNode
  col: Col
  zone?: string
  zoneEmoji?: string
  rels: number
  editing: boolean
  setEditing: (on: boolean) => void
}

function Cell({ ctl, f, col, zone, zoneEmoji, rels, editing, setEditing }: CellProps) {
  switch (col.key) {
    case '@kind':
      return (
        <button
          className="fm-cell-kind"
          title="Change kind"
          onClick={(e) => {
            e.stopPropagation()
            showContextMenu(
              e,
              KIND_ORDER.map((k) => ({ label: `${KINDS[k].emoji}  ${KINDS[k].label}`, checked: k === f.kind, onClick: () => setKind(ctl, f.id, k) }))
            )
          }}
        >
          <KindChip kind={f.kind} />
        </button>
      )
    case '@title':
      return editing ? (
        <InlineEditor
          value={f.title ?? ''}
          placeholder={cardTitle(f)}
          onDone={(v) => {
            setEditing(false)
            if (v !== null && v !== f.title) ctl.updateForm(f.id, { title: v })
          }}
        />
      ) : (
        <div className="fm-cell-title" onDoubleClick={() => setEditing(true)} title="Double-click to edit">
          <span className={f.title?.trim() ? '' : 'is-placeholder'}>{cardTitle(f)}</span>
          <button
            className="clickable-icon small fm-row-reveal"
            title="Reveal in map"
            onClick={(e) => {
              e.stopPropagation()
              ctl.reveal([f.id], { select: true })
            }}
          >
            <MapPin />
          </button>
        </div>
      )
    case '@zone':
      return (
        <button
          className="fm-cell-zone"
          title="Move to zone"
          onClick={(e) => {
            e.stopPropagation()
            const zs = zonesInOrder(ctl.data)
            showContextMenu(e, [
              ...zs.map((z) => ({ label: `${z.emoji ?? '▢'}  ${z.label}`, checked: z.label === zone, onClick: () => moveToZone(ctl, f.id, z.id) })),
              { separator: true },
              { label: 'Outside zones', checked: !zone, onClick: () => moveToZone(ctl, f.id, null) }
            ])
          }}
        >
          {zone ? `${zoneEmoji ?? ''} ${zone}` : <span className="is-placeholder">—</span>}
        </button>
      )
    case '@votes':
      return (
        <span className="fm-cell-votes">
          <button className="fm-mini-btn" title="Remove vote" disabled={!f.votes} onClick={stop(() => vote(ctl, f.id, -1))}>
            −
          </button>
          <b>{f.votes ?? 0}</b>
          <button className="fm-mini-btn" title="Vote" onClick={stop(() => vote(ctl, f.id, 1))}>
            +
          </button>
        </span>
      )
    case '@rels':
      return <span className={rels ? '' : 'is-placeholder'}>{rels}</span>
  }
  const def = fieldDef(f.kind, col.key)
  if (!def) return <span className="fm-cell-na" />
  const v = f.fields[col.key]
  const set = (nv: unknown, e?: React.MouseEvent): void => setField(ctl, f.id, def.key, nv, e)
  switch (def.type) {
    case 'select': {
      const o = def.options?.find((x) => x.value === v)
      const open = (e: React.MouseEvent): void => {
        e.stopPropagation()
        openOptionMenu(e, def, v, (nv, ev) => set(nv, ev))
      }
      return o ? (
        <OptionChip option={o} compact onClick={open} title={`${def.label}: click to change`} />
      ) : (
        <button className="fm-cell-empty" onClick={open}>
          Set…
        </button>
      )
    }
    case 'rating':
      return <Stars value={Number(v) || 0} max={def.max ?? 5} size={13} onChange={(n, e) => set(n || undefined, e)} />
    case 'checkbox':
      return <input type="checkbox" checked={!!v} onChange={(e) => set(e.target.checked || undefined)} onClick={(e) => e.stopPropagation()} />
    case 'checklist': {
      const list = Array.isArray(v) ? (v as ChecklistItem[]) : []
      return list.length ? (
        <span className="fm-cell-progress" title={list.map((i) => `${i.done ? '☑' : '☐'} ${i.text}`).join('\n')}>
          <span className="fm-cell-progress-bar">
            <span style={{ width: `${(list.filter((i) => i.done).length / list.length) * 100}%` }} />
          </span>
          {fieldText(def, v)}
        </span>
      ) : (
        <span className="is-placeholder">—</span>
      )
    }
    default: {
      const text = v === undefined || v === null ? '' : String(v)
      if (editing)
        return (
          <InlineEditor
            value={text}
            multiline={def.type === 'longtext'}
            type={def.type === 'number' ? 'number' : def.type === 'date' ? 'date' : 'text'}
            placeholder={def.placeholder}
            onDone={(nv) => {
              setEditing(false)
              if (nv === null || nv === text) return
              set(def.type === 'number' ? (nv === '' ? undefined : Number(nv)) : nv.trim() ? nv : undefined)
            }}
          />
        )
      return (
        <div className="fm-cell-text" onDoubleClick={() => setEditing(true)} title={text || 'Double-click to edit'}>
          {text || <span className="is-placeholder">—</span>}
        </div>
      )
    }
  }
}

/** Input that commits on Enter / blur (null = cancelled with Escape). */
function InlineEditor({ value, onDone, multiline, type = 'text', placeholder }: { value: string; onDone: (v: string | null) => void; multiline?: boolean; type?: string; placeholder?: string }) {
  const [v, setV] = useState(value)
  const done = useRef(false)
  const finish = (r: string | null): void => {
    if (done.current) return
    done.current = true
    onDone(r)
  }
  const props = {
    autoFocus: true,
    className: 'fm-cell-input',
    value: v,
    placeholder,
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setV(e.target.value),
    onBlur: () => finish(v),
    onClick: (e: React.MouseEvent) => e.stopPropagation(),
    onFocus: (e: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement>) => e.target.select(),
    onKeyDown: (e: React.KeyboardEvent) => {
      e.stopPropagation()
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        finish(v)
      } else if (e.key === 'Escape') {
        e.preventDefault()
        finish(null)
      }
    }
  }
  return multiline ? <textarea rows={3} {...props} /> : <input type={type} {...props} />
}
