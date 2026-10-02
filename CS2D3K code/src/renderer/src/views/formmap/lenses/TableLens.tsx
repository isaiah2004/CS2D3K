// Table lens: one row per card; the columns are the field registry. Filter by group and tags, sort any column,
// edit inline.
import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowDown, ArrowUp, MapPin, Plus, Trash2, Filter, X } from 'lucide-react'
import type { FormMapCtl, LensProps } from '../context'
import {
  cardTitle,
  fieldLabel,
  fieldText,
  forms,
  groupIn,
  groups,
  groupTitle,
  isEmptyValue,
  optionOf,
  type ChecklistItem,
  type FieldDef,
  type FormNode,
  type GroupNode
} from '../schema'
import { addCard, deleteNodes, groupsInOrder, moveToGroup, setField, setTags, vote } from './ops'
import { OptionChip, openOptionMenu, Stars, TagChip, tagMenuItems, TypeIcon } from './widgets'
import { useWorkspace } from '@/store/workspace'
import { showContextMenu, type MenuItem } from '@/store/ui'
import './lenses.css'
import './board.css'

interface SortState {
  key: string
  dir: 1 | -1
}
interface TableState {
  /** group id, '__none' (outside groups) or null (all) */
  group: string | null
  tags: string[]
  sort: SortState | null
}

interface Col {
  key: string
  label: string
  field?: FieldDef
  className?: string
}

const NO_GROUP = '__none'
const BASE_COLS: Col[] = [{ key: '@title', label: 'Title', className: 'is-title' }, { key: '@tags', label: 'Tags', className: 'is-tags' }]
const TAIL_COLS: Col[] = [
  { key: '@group', label: 'Group', className: 'is-zone' },
  { key: '@votes', label: 'Votes', className: 'is-num' },
  { key: '@rels', label: 'Links', className: 'is-num' }
]

function readState(ctl: FormMapCtl): TableState {
  const s = (ctl.tab.state?.table ?? {}) as Partial<TableState>
  return { group: typeof s.group === 'string' ? s.group : null, tags: Array.isArray(s.tags) ? s.tags.filter((t) => typeof t === 'string') : [], sort: s.sort ?? null }
}

export default function TableLens({ ctl }: LensProps) {
  const [st, setSt] = useState<TableState>(() => readState(ctl))
  const update = (patch: Partial<TableState>): void => {
    const next = { ...st, ...patch }
    setSt(next)
    useWorkspace.getState().updateTabState(ctl.tab.id, { table: next })
  }
  const [editing, setEditing] = useState<{ id: string; key: string } | null>(null)
  const meta = ctl.meta
  const reg = meta.fields ?? {}

  const all = useMemo(() => forms(ctl.data), [ctl.data])
  const gs = useMemo(() => groupsInOrder(ctl.data), [ctl.data])
  const groupOf = useMemo(() => {
    const list = groups(ctl.data)
    const m = new Map<string, GroupNode | null>()
    for (const f of all) m.set(f.id, groupIn(list, f))
    return m
  }, [ctl.data, all])
  const relCount = useMemo(() => {
    const m = new Map<string, number>()
    for (const e of ctl.data.edges) {
      m.set(e.fromNode, (m.get(e.fromNode) ?? 0) + 1)
      m.set(e.toNode, (m.get(e.toNode) ?? 0) + 1)
    }
    return m
  }, [ctl.data])

  const cols = useMemo<Col[]>(() => [...BASE_COLS, ...Object.entries(reg).map(([k, f]) => ({ key: k, label: fieldLabel(k, f), field: f, className: `is-${f.type}` })), ...TAIL_COLS], [reg])

  const sortValue = (f: FormNode, key: string): string | number => {
    switch (key) {
      case '@title':
        return cardTitle(f).toLowerCase()
      case '@tags':
        return (f.tags ?? []).join(' ').toLowerCase() || '￿'
      case '@group':
        return groupOf.get(f.id)?.label?.toLowerCase() ?? '￿'
      case '@votes':
        return f.votes ?? 0
      case '@rels':
        return relCount.get(f.id) ?? 0
    }
    const def = reg[key]
    const v = f.fields[key]
    if (isEmptyValue(v)) return '￿'
    if (def?.type === 'select') {
      const i = def.options?.findIndex((o) => o.value === v) ?? -1
      return i < 0 ? 999 : i
    }
    if (def?.type === 'rating' || def?.type === 'number') return Number(v) || 0
    if (def?.type === 'checklist') return Array.isArray(v) ? v.length : 0
    if (def?.type === 'checkbox') return v ? 0 : 1
    return fieldText(def, v).toLowerCase()
  }

  const rows = useMemo(() => {
    const list = all.filter((f) => {
      if (st.group === NO_GROUP && groupOf.get(f.id)) return false
      if (st.group && st.group !== NO_GROUP && groupOf.get(f.id)?.id !== st.group) return false
      return st.tags.every((t) => f.tags?.includes(t))
    })
    const s = st.sort
    if (!s) return list.sort((a, b) => a.y - b.y || a.x - b.x)
    return list.sort((a, b) => {
      const va = sortValue(a, s.key)
      const vb = sortValue(b, s.key)
      const c = typeof va === 'number' && typeof vb === 'number' ? va - vb : String(va).localeCompare(String(vb))
      return c * s.dir || a.y - b.y
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [all, st, groupOf, relCount, reg])

  const toggleSort = (key: string): void => {
    const s = st.sort
    // numbers/votes/ratings read best biggest-first
    const firstDir: 1 | -1 = key === '@votes' || key === '@rels' || reg[key]?.type === 'rating' || reg[key]?.type === 'number' ? -1 : 1
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

  const addRow = (): void => {
    const id = addCard(ctl, { tags: st.tags, groupId: st.group === NO_GROUP ? null : (st.group ?? null) })
    ctl.setSelection([id])
    setEditing({ id, key: '@title' })
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

  const tagFilterMenu = (e: React.MouseEvent): void => {
    const known = Object.keys(meta.tags ?? {}).sort((a, b) => a.localeCompare(b))
    showContextMenu(e, known.length ? known.map((t) => ({ label: `#${t}`, checked: st.tags.includes(t), onClick: () => update({ tags: st.tags.includes(t) ? st.tags.filter((x) => x !== t) : [...st.tags, t] }) })) : [{ label: 'No tags on this map yet', disabled: true }])
  }

  const dim = (f: FormNode): boolean => !!ctl.highlight && !ctl.highlight.includes(f.id) && !selected.has(f.id)
  const filtered = st.group !== null || st.tags.length > 0

  return (
    <div className="fm-table-lens">
      <div className="fm-lens-toolbar">
        <span className="fm-toolbar-label">Group</span>
        <select className="dropdown fm-table-group" value={st.group ?? ''} onChange={(e) => update({ group: e.target.value || null })} aria-label="Group filter">
          <option value="">All cards ({all.length})</option>
          {gs.map((g) => (
            <option key={g.id} value={g.id}>
              {g.emoji ? `${g.emoji} ` : ''}
              {groupTitle(g)}
            </option>
          ))}
          <option value={NO_GROUP}>Outside groups</option>
        </select>
        <button className={`btn fm-board-filter${st.tags.length ? ' is-active' : ''}`} onClick={tagFilterMenu} title="Only cards with all these tags">
          <Filter size={13} /> Tags
        </button>
        {st.tags.map((t) => (
          <TagChip key={t} tag={t} meta={meta} compact onRemove={() => update({ tags: st.tags.filter((x) => x !== t) })} />
        ))}
        {filtered && (
          <button className="fm-i-textbtn" onClick={() => update({ group: null, tags: [] })}>
            <X size={12} /> Clear
          </button>
        )}
        <span className="fm-toolbar-spacer" />
        <span className="fm-toolbar-count">
          {rows.length} of {all.length}
        </span>
        <button className="btn fm-table-add" onClick={addRow}>
          <Plus size={14} /> New card
        </button>
      </div>
      <div className="fm-table-wrap" ref={wrapRef} tabIndex={0} onKeyDown={onKey}>
        <table className="fm-table">
          <thead>
            <tr>
              {cols.map((c) => (
                <th key={c.key} className={c.className} onClick={() => toggleSort(c.key)} aria-sort={st.sort?.key === c.key ? (st.sort.dir === 1 ? 'ascending' : 'descending') : 'none'}>
                  <span className="fm-th">
                    {c.field && <TypeIcon type={c.field.type} />}
                    {c.label}
                    {st.sort?.key === c.key && (st.sort.dir === 1 ? <ArrowUp size={12} /> : <ArrowDown size={12} />)}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((f) => (
              <tr key={f.id} data-row={f.id} className={`${selected.has(f.id) ? 'is-selected' : ''}${dim(f) ? ' is-dim' : ''}`} onClick={(e) => onRowClick(e, f.id)} onContextMenu={(e) => rowMenu(e, f)}>
                {cols.map((c) => (
                  <td key={c.key} className={c.className}>
                    <Cell ctl={ctl} f={f} col={c} group={groupOf.get(f.id) ?? null} rels={relCount.get(f.id) ?? 0} editing={editing?.id === f.id && editing.key === c.key} setEditing={(on) => setEditing(on ? { id: f.id, key: c.key } : null)} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        {!rows.length && (
          <div className="fm-table-empty">
            <div className="fm-col-empty-emoji">🗂️</div>
            {filtered ? 'No cards match the filter.' : 'No cards yet.'}
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
  (fn: (e: React.MouseEvent) => void) =>
  (e: React.MouseEvent): void => {
    e.stopPropagation()
    fn(e)
  }

interface CellProps {
  ctl: FormMapCtl
  f: FormNode
  col: Col
  group: GroupNode | null
  rels: number
  editing: boolean
  setEditing: (on: boolean) => void
}

function Cell({ ctl, f, col, group, rels, editing, setEditing }: CellProps) {
  const meta = ctl.meta
  switch (col.key) {
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
            onClick={stop(() => ctl.reveal([f.id], { select: true }))}
          >
            <MapPin />
          </button>
        </div>
      )
    case '@tags':
      return (
        <button className="fm-cell-tags" title="Edit tags" onClick={stop((e) => showContextMenu(e, tagMenuItems(meta, f.tags ?? [], (t) => setTags(ctl, f.id, f.tags?.includes(t) ? { remove: [t] } : { add: [t] }))))}>
          {f.tags?.length ? f.tags.map((t) => <TagChip key={t} tag={t} meta={meta} compact />) : <span className="is-placeholder">+ tag</span>}
        </button>
      )
    case '@group':
      return (
        <button
          className="fm-cell-zone"
          title="Move to group"
          onClick={stop((e) => {
            const gs = groupsInOrder(ctl.data)
            showContextMenu(e, [
              ...gs.map((g) => ({ label: `${g.emoji ?? '▢'}  ${groupTitle(g)}`, checked: g.id === group?.id, onClick: () => moveToGroup(ctl, f.id, g.id, e) })),
              { separator: true },
              { label: 'Outside groups', checked: !group, onClick: () => moveToGroup(ctl, f.id, null) }
            ])
          })}
        >
          {group ? `${group.emoji ?? ''} ${groupTitle(group)}` : <span className="is-placeholder">—</span>}
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
  const def = col.field
  const key = col.key
  const v = f.fields[key]
  const set = (nv: unknown, e?: React.MouseEvent): void => setField(ctl, f.id, key, nv, e)
  switch (def?.type) {
    case 'select': {
      const o = optionOf(def, v)
      const open = (e: React.MouseEvent): void => {
        e.stopPropagation()
        openOptionMenu(e, def, v, f.tags, (nv, ev) => set(nv, ev))
      }
      return o ? (
        <OptionChip option={o} compact onClick={open} title={`${col.label}: click to change`} />
      ) : (
        <button className="fm-cell-empty" onClick={open}>
          {isEmptyValue(v) ? 'Set…' : String(v)}
        </button>
      )
    }
    case 'multiselect': {
      const list = Array.isArray(v) ? v : isEmptyValue(v) ? [] : [v]
      const open = (e: React.MouseEvent): void => {
        e.stopPropagation()
        showContextMenu(
          e,
          (def.options ?? []).map((o) => ({ label: o.label ?? o.value, checked: list.includes(o.value), onClick: () => set(list.includes(o.value) ? list.filter((x) => x !== o.value) : [...list, o.value], e) }))
        )
      }
      return list.length ? (
        <button className="fm-cell-multi" onClick={open}>
          {list.map((x) => (
            <OptionChip key={String(x)} option={optionOf(def, x) ?? { value: String(x) }} compact />
          ))}
        </button>
      ) : (
        <button className="fm-cell-empty" onClick={open}>
          Set…
        </button>
      )
    }
    case 'rating':
      return <Stars value={Number(v) || 0} max={def.max ?? 5} size={13} onChange={(n, e) => set(n || undefined, e)} />
    case 'checkbox':
      return <input type="checkbox" checked={v === true} onChange={(e) => set(e.target.checked || undefined)} onClick={(e) => e.stopPropagation()} aria-label={col.label} />
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
      const text = isEmptyValue(v) ? '' : String(v)
      if (editing)
        return (
          <InlineEditor
            value={text}
            multiline={def?.type === 'longtext'}
            type={def?.type === 'number' ? 'number' : def?.type === 'date' ? 'date' : 'text'}
            placeholder={def?.placeholder}
            onDone={(nv) => {
              setEditing(false)
              if (nv === null || nv === text) return
              set(def?.type === 'number' ? (nv === '' ? undefined : Number(nv)) : nv.trim() ? nv : undefined)
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
