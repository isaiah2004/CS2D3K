// Inspector "Card" tab: edits whatever is selected — a card (title, body, tags, any field, votes, relations, Why?),
// several cards, a group (label, emoji, color, prompt, preset, assigned fields, pitch order, lock), several groups,
// a kanban node, an edge or a plain canvas node.
import { useMemo, useState } from 'react'
import { Eye, Pencil, MapPin, Trash2, HelpCircle, Lock, Unlock, ExternalLink, X, Plus, Columns3, KanbanSquare, Shapes, ArrowUp, ArrowDown, StickyNote, EyeOff, Type as TypeIcon2 } from 'lucide-react'
import type { FormMapCtl } from '../context'
import { whyTrace } from '../analysis'
import {
  cardAccent,
  cardTitle,
  fieldLabel,
  fmColor,
  FIELD_TYPES,
  groupAt,
  groupTitle,
  isEmptyValue,
  isForm,
  isGroup,
  isKanban,
  presetById,
  relationDef,
  RELATION_ORDER,
  RELATIONS,
  type FieldDef,
  type FieldType,
  type FormMapEdge,
  type FormNode,
  type GroupNode,
  type KanbanNode
} from '../schema'
import { addField, deleteNodes, patchKanban, patchNode, removeEdge, renameField, setField, setRelation, setTags, updateFieldDef, vote } from '../lenses/ops'
import { addKanbanColumn, deleteKanbanColumn, kanbanCount, kanbanToGroups, moveKanbanColumn, updateKanbanColumn, groupsToKanban } from '../kanban'
import { newFieldBoard, newGroupsBoard, BOARD_FIELD_TYPES } from '../boards'
import { createBoard } from '../lenses/ops'
import { OptionChip, TagChip, tagMenuItems, TypeIcon } from '../lenses/widgets'
import { AutoTextarea, FieldInput, Row } from './fields'
import Relations from './Relations'
import MarkdownPreview from '@/lib/markdown/MarkdownPreview'
import { useWorkspace } from '@/store/workspace'
import { notice, promptText, showContextMenu, type MenuItem } from '@/store/ui'
import { COLOR_PRESETS, type CanvasNode } from '../../canvas/model'
import { textExcerpt } from '../../canvas/cull'

type CssVars = React.CSSProperties & Record<`--${string}`, string>

export default function CardTab({ ctl }: { ctl: FormMapCtl }) {
  const sel = ctl.selection
  const nodes = useMemo(() => new Map(ctl.data.nodes.map((n) => [n.id, n])), [ctl.data])
  const picked = sel.map((id) => nodes.get(id)).filter((n): n is CanvasNode => !!n)
  const formsSel = picked.filter(isForm)
  const groupsSel = picked.filter(isGroup)

  if (!sel.length) return <EmptyCard ctl={ctl} />
  if (formsSel.length > 1) return <MultiEditor ctl={ctl} cards={formsSel} />
  if (groupsSel.length > 1 && !formsSel.length) return <GroupsMulti ctl={ctl} groups={groupsSel} />
  if (picked.length === 1) {
    const n = picked[0]
    if (isForm(n)) return <FormEditor key={n.id} ctl={ctl} card={n} />
    if (isGroup(n)) return <GroupEditor key={n.id} ctl={ctl} group={n} />
    if (isKanban(n)) return <KanbanEditor key={n.id} ctl={ctl} k={n} />
    return <PlainInfo ctl={ctl} node={n} />
  }
  const edge = (ctl.data.edges as FormMapEdge[]).find((e) => e.id === sel[0])
  if (edge && sel.length === 1) return <EdgeEditor ctl={ctl} edge={edge} />
  if (formsSel.length === 1) return <FormEditor key={formsSel[0].id} ctl={ctl} card={formsSel[0]} />
  return <div className="fm-i-empty">{sel.length} items selected</div>
}

// ---------------------------------------------------------------- card

/** registry order first, then keys the registry doesn't know */
function fieldKeys(card: FormNode, reg: Record<string, FieldDef>, extra: string[]): string[] {
  const has = (k: string): boolean => !isEmptyValue(card.fields[k]) || card.fields[k] === false
  const keys = Object.keys(reg).filter((k) => has(k) || extra.includes(k))
  for (const k of Object.keys(card.fields)) if (!reg[k] && has(k)) keys.push(k)
  for (const k of extra) if (!keys.includes(k)) keys.push(k)
  return keys
}

function FormEditor({ ctl, card }: { ctl: FormMapCtl; card: FormNode }) {
  const [preview, setPreview] = useState(false)
  const [extra, setExtra] = useState<string[]>([])
  const meta = ctl.meta
  const reg = meta.fields ?? {}
  const trace = useMemo(() => whyTrace(ctl.data, card.id), [ctl.data, card.id])
  const tracing = !!ctl.highlight && ctl.highlight.length === trace.length && trace.every((t) => ctl.highlight!.includes(t))
  const group = groupAt(ctl.data, card)
  const votes = card.votes ?? 0
  const [bump, setBump] = useState(0)
  const keys = fieldKeys(card, reg, extra)
  const accent = cardAccent(card, meta)

  const setValue =
    (key: string) =>
    (v: unknown, e?: React.MouseEvent, history?: string): void => {
      if (history) ctl.updateForm(card.id, { fields: { [key]: v } }, { history })
      else setField(ctl, card.id, key, v, e)
    }
  const removeField = (key: string): void => {
    setExtra(extra.filter((k) => k !== key))
    setField(ctl, card.id, key, undefined)
  }
  const fieldMenu = (e: React.MouseEvent, key: string): void => {
    const def = reg[key]
    const items: MenuItem[] = [
      { label: 'Remove from this card', icon: <X />, onClick: () => removeField(key) },
      {
        label: 'Rename field…',
        icon: <Pencil />,
        disabled: !def,
        onClick: () =>
          void promptText({ title: 'Rename field', message: 'Renames it on every card, group, board and preset.', initial: key, okLabel: 'Rename', validate: (v) => (!v.trim() ? 'Enter a name' : v.trim() !== key && reg[v.trim()] ? 'A field with this name exists' : null) }).then((v) => {
            if (v && v.trim() !== key) renameField(ctl, key, v.trim())
          })
      },
      { label: 'Type', icon: <TypeIcon2 />, disabled: !def, submenu: FIELD_TYPES.map((t) => ({ label: t.label, checked: def?.type === t.type, onClick: () => updateFieldDef(ctl, key, { type: t.type }) })) },
      { label: def?.hidden ? 'Show on cards' : 'Hide on cards', icon: def?.hidden ? <Eye /> : <EyeOff />, disabled: !def, onClick: () => updateFieldDef(ctl, key, { hidden: !def?.hidden || undefined }) }
    ]
    showContextMenu(e, items)
  }

  return (
    <div className="fm-i-form" style={accent ? ({ '--fm-card-color': accent } as CssVars) : undefined}>
      {group && (
        <div className="fm-i-zoneline">
          in {group.emoji} <b>{groupTitle(group)}</b>
        </div>
      )}
      <input className="fm-i-title" value={card.title ?? ''} placeholder={cardTitle(card)} onChange={(e) => ctl.updateForm(card.id, { title: e.target.value }, { history: `title:${card.id}` })} aria-label="Title" />

      <div className="fm-i-tags" aria-label="Tags">
        {(card.tags ?? []).map((t) => (
          <TagChip key={t} tag={t} meta={meta} onRemove={() => setTags(ctl, card.id, { remove: [t] })} />
        ))}
        <button className="fm-i-addtag" onClick={(e) => showContextMenu(e, tagMenuItems(meta, card.tags ?? [], (t) => setTags(ctl, card.id, card.tags?.includes(t) ? { remove: [t] } : { add: [t] })))}>
          <Plus size={12} /> Tag
        </button>
      </div>

      <div className="fm-i-section">
        <div className="fm-i-section-head">
          <span>Notes</span>
          <button className="clickable-icon small" title={preview ? 'Edit markdown' : 'Preview markdown'} onClick={() => setPreview(!preview)} aria-pressed={preview}>
            {preview ? <Pencil /> : <Eye />}
          </button>
        </div>
        {preview ? (
          <div className="fm-i-preview" onDoubleClick={() => setPreview(false)}>
            {card.text?.trim() ? <MarkdownPreview source={card.text} sourcePath={ctl.path} /> : <div className="fm-i-muted">Nothing written yet.</div>}
          </div>
        ) : (
          <AutoTextarea value={card.text ?? ''} minRows={3} placeholder="Markdown… [[links]] work too" onChange={(e) => ctl.updateForm(card.id, { text: e.target.value }, { history: `text:${card.id}` })} />
        )}
      </div>

      <div className="fm-i-section fm-i-fields">
        <div className="fm-i-section-head">
          <span>Fields</span>
        </div>
        {keys.map((k) => {
          const def = reg[k]
          return (
            <Row key={k} label={fieldLabel(k, def)} help={def?.help ?? 'Click for field options'} wide={def?.type === 'longtext' || def?.type === 'checklist' || def?.type === 'multiselect' || (def?.type === 'select' && (def.options?.length ?? 0) > 4)} onLabel={(e) => fieldMenu(e, k)} onRemove={() => removeField(k)}>
              <FieldInput ctl={ctl} name={k} def={def} value={card.fields[k]} tags={card.tags} onSet={setValue(k)} historyKey={`f:${card.id}:${k}`} />
            </Row>
          )
        })}
        <AddField ctl={ctl} taken={keys} onAdd={(k) => setExtra([...extra, k])} />
      </div>

      <div className="fm-i-section">
        <div className="fm-i-section-head">
          <span>Dot votes</span>
        </div>
        <div className="fm-i-votes">
          <button
            className="fm-i-vote"
            onClick={() => {
              vote(ctl, card.id, 1)
              setBump((b) => b + 1)
            }}
            title="Add a dot vote"
          >
            <span className="fm-i-vote-dot" /> Vote
          </button>
          <div className="fm-i-dots" key={bump} aria-label={`${votes} votes`}>
            {Array.from({ length: Math.min(votes, 12) }, (_, i) => (
              <span key={i} className={`fm-i-dot${i === votes - 1 && bump ? ' is-new' : ''}`} />
            ))}
            {votes > 12 && <span className="fm-i-dots-more">+{votes - 12}</span>}
            {!votes && <span className="fm-i-muted">No votes yet</span>}
          </div>
          <button className="clickable-icon small" title="Remove a vote" disabled={!votes} onClick={() => vote(ctl, card.id, -1)}>
            <span className="fm-i-unvote">−1</span>
          </button>
        </div>
      </div>

      <div className="fm-i-section">
        <div className="fm-i-section-head">
          <span>Relations</span>
          <button className={`fm-i-why${tracing ? ' is-active' : ''}`} onClick={() => ctl.setHighlight(tracing ? null : trace)} title="Highlight the chain of reasons around this card (W on the map)">
            <HelpCircle size={13} /> {tracing ? 'Clear why' : 'Why?'}
          </button>
        </div>
        {tracing && <div className="fm-i-why-note">{trace.filter((id) => ctl.data.nodes.some((n) => n.id === id)).length - 1} connected cards highlighted</div>}
        <Relations ctl={ctl} card={card} />
      </div>

      <div className="fm-i-actions">
        <button className="btn" onClick={() => ctl.reveal([card.id], { select: true })}>
          <MapPin size={14} /> Reveal
        </button>
        <span className="fm-toolbar-spacer" />
        <button className="clickable-icon small fm-i-danger" title="Delete card" onClick={() => deleteNodes(ctl, [card.id])}>
          <Trash2 />
        </button>
      </div>
    </div>
  )
}

/** Add a field to the card: one-click chips for the map's fields, or a new field (name + type). */
function AddField({ ctl, taken, onAdd }: { ctl: FormMapCtl; taken: string[]; onAdd: (key: string) => void }) {
  const reg = ctl.meta.fields ?? {}
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [type, setType] = useState<FieldType>('text')
  const free = Object.keys(reg).filter((k) => !taken.includes(k))
  const exists = !!reg[name.trim()]
  const add = (): void => {
    const k = name.trim()
    if (!k) return
    if (!reg[k]) addField(ctl, k, { type, ...(type === 'select' || type === 'multiselect' ? { options: [] } : {}) })
    onAdd(k)
    setName('')
    setOpen(false)
  }
  if (!open)
    return (
      <button className="fm-i-addbtn" onClick={() => setOpen(true)}>
        <Plus size={13} /> Add field
      </button>
    )
  return (
    <div className="fm-i-addfield">
      {free.length > 0 && (
        <div className="fm-i-fieldchips">
          {free.map((k) => (
            <button
              key={k}
              className="fm-i-fieldchip"
              onClick={() => {
                onAdd(k)
                setOpen(false)
              }}
              title={`Add “${fieldLabel(k, reg[k])}”`}
            >
              <TypeIcon type={reg[k].type} />
              {fieldLabel(k, reg[k])}
            </button>
          ))}
        </div>
      )}
      <div className="fm-i-newfield">
        <input
          className="input"
          autoFocus
          value={name}
          placeholder={free.length ? 'Or a new field…' : 'Field name'}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') add()
            else if (e.key === 'Escape') setOpen(false)
          }}
          aria-label="New field name"
        />
        {!exists && (
          <select className="dropdown" value={type} onChange={(e) => setType(e.target.value as FieldType)} aria-label="New field type">
            {FIELD_TYPES.map((t) => (
              <option key={t.type} value={t.type}>
                {t.label}
              </option>
            ))}
          </select>
        )}
        <button className="btn mod-cta" disabled={!name.trim()} onClick={add}>
          Add
        </button>
        <button className="clickable-icon small" title="Close" onClick={() => setOpen(false)}>
          <X />
        </button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------- several cards

function MultiEditor({ ctl, cards }: { ctl: FormMapCtl; cards: FormNode[] }) {
  const meta = ctl.meta
  const reg = meta.fields ?? {}
  const ids = cards.map((c) => c.id)
  const selects = Object.entries(reg).filter(([, f]) => f.type === 'select')
  const common = (meta.tags ? Object.keys(meta.tags) : []).filter((t) => cards.every((c) => c.tags?.includes(t)))
  const traceAll = (): void => ctl.setHighlight([...new Set(ids.flatMap((id) => whyTrace(ctl.data, id)))])
  return (
    <div className="fm-i-form">
      <div className="fm-i-multi-head">{cards.length} cards selected</div>
      <div className="fm-i-multi-list">
        {cards.map((c) => (
          <button key={c.id} className="fm-i-multi-item" onClick={() => ctl.setSelection([c.id])} title="Select only this card">
            <span className="fm-i-multi-dot" style={{ background: cardAccent(c, meta) ?? 'var(--text-faint)' }} />
            <span className="fm-rel-title">{cardTitle(c)}</span>
          </button>
        ))}
      </div>
      <div className="fm-i-section">
        <Row label="Tags" wide>
          <div className="fm-i-chips">
            {common.map((t) => (
              <TagChip key={t} tag={t} meta={meta} onRemove={() => setTags(ctl, ids, { remove: [t] })} />
            ))}
            <button className="fm-i-addtag" onClick={(e) => showContextMenu(e, tagMenuItems(meta, common, (t) => setTags(ctl, ids, common.includes(t) ? { remove: [t] } : { add: [t] })))}>
              <Plus size={12} /> Tag all
            </button>
          </div>
        </Row>
        {selects.map(([k, f]) => {
          const vals = new Set(cards.map((c) => c.fields[k]))
          const cur = vals.size === 1 ? [...vals][0] : undefined
          return (
            <Row key={k} label={fieldLabel(k, f)} wide={(f.options?.length ?? 0) > 4}>
              <div className="fm-i-chips">
                {(f.options ?? []).map((o) => (
                  <OptionChip key={o.value} option={o} active={cur === o.value} onClick={(e) => setField(ctl, ids, k, o.value, e)} />
                ))}
                {vals.size > 1 && <span className="fm-i-mixed">mixed</span>}
              </div>
            </Row>
          )
        })}
        {!selects.length && <div className="fm-i-muted">Add a select field to bulk-edit it here.</div>}
      </div>
      <div className="fm-i-actions">
        <button className="btn" onClick={() => ctl.reveal(ids, { select: true })}>
          <MapPin size={14} /> Reveal all
        </button>
        <button className="btn" onClick={traceAll}>
          <HelpCircle size={14} /> Why?
        </button>
        <span className="fm-toolbar-spacer" />
        <button className="clickable-icon small fm-i-danger" title={`Delete ${cards.length} cards`} onClick={() => deleteNodes(ctl, ids)}>
          <Trash2 />
        </button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------- groups

const GROUP_EMOJI = ['🌱', '🧭', '🛠️', '🎯', '🚀', '🔭', '❓', '📥', '📝', '⚡', '✅', '💎', '🧪', '🎨']

function GroupEditor({ ctl, group }: { ctl: FormMapCtl; group: GroupNode }) {
  const meta = ctl.meta
  const reg = meta.fields ?? {}
  const patch = (p: Partial<GroupNode>, history?: string): void => patchNode(ctl, group.id, p, history)
  const inside = ctl.data.nodes.filter((n) => isForm(n) && groupAt(ctl.data, n)?.id === group.id).length
  const assign = group.assign ?? {}
  const setAssign = (key: string, value: unknown, history?: string): void => {
    const next = { ...assign }
    if (value === undefined) delete next[key]
    else next[key] = value
    patch({ assign: Object.keys(next).length ? next : undefined }, history)
  }
  const [adding, setAdding] = useState(false)
  const assignable = Object.keys(reg).filter((k) => !(k in assign))
  const boardFields = Object.entries(reg).filter(([, f]) => BOARD_FIELD_TYPES.includes(f.type))
  const locked = group.locked === true
  const openBoard = (b: ReturnType<typeof newGroupsBoard>): void => {
    createBoard(ctl, b)
    ctl.openBoard(b.id)
  }

  return (
    <div className="fm-i-form">
      <div className="fm-i-zonehead">
        <span className="fm-i-zone-emoji">{group.emoji || '▢'}</span>
        <div>
          <div className="fm-i-zone-kicker">Group</div>
          <div className="fm-i-zone-count">
            {inside} card{inside === 1 ? '' : 's'} inside
          </div>
        </div>
        <span className="fm-toolbar-spacer" />
        <button className={`clickable-icon small${locked ? ' is-active' : ''}`} title={locked ? 'Locked — click to unlock' : 'Unlocked — click to lock'} onClick={() => patch({ locked: !locked })}>
          {locked ? <Lock /> : <Unlock />}
        </button>
      </div>
      <input className="fm-i-title" value={group.label ?? ''} placeholder="Group label" onChange={(e) => patch({ label: e.target.value }, `gl:${group.id}`)} aria-label="Label" />
      <div className="fm-i-section">
        <Row label="Emoji">
          <div className="fm-i-emoji-row">
            <input className="input fm-i-emoji-input" value={group.emoji ?? ''} maxLength={8} onChange={(e) => patch({ emoji: e.target.value || undefined }, `ge:${group.id}`)} />
            {GROUP_EMOJI.map((em) => (
              <button key={em} className={`fm-i-emoji-btn${group.emoji === em ? ' is-active' : ''}`} onClick={() => patch({ emoji: em })}>
                {em}
              </button>
            ))}
          </div>
        </Row>
        <Row label="Color">
          <div className="fm-i-swatches">
            <button className={`fm-i-swatch is-none${!group.color ? ' is-active' : ''}`} title="No color" onClick={() => patch({ color: undefined })} />
            {COLOR_PRESETS.map((c) => (
              <button key={c.id} className={`fm-i-swatch${group.color === c.id ? ' is-active' : ''}`} style={{ background: c.css }} title={c.name} onClick={() => patch({ color: c.id })} />
            ))}
          </div>
        </Row>
        <Row label="Prompt" wide help="Guidance shown in the empty group and in pitch mode">
          <AutoTextarea value={group.prompt ?? ''} placeholder="What belongs here?" onChange={(e) => patch({ prompt: e.target.value || undefined }, `gp:${group.id}`)} />
        </Row>
        <Row label="New cards" help="Preset of cards created by double-clicking inside the group">
          <div className="fm-i-chips">
            <OptionChip option={{ value: '', label: 'Plain card' }} active={!group.preset} onClick={() => patch({ preset: undefined })} />
            {(meta.presets ?? []).map((p) => (
              <button key={p.id} className={`fm-kchip is-clickable${group.preset === p.id ? ' is-active' : ''}`} onClick={() => patch({ preset: group.preset === p.id ? undefined : p.id })} title={p.hint}>
                <span className="fm-kchip-emoji">{p.emoji ?? '▫️'}</span>
                {p.name}
              </button>
            ))}
          </div>
        </Row>
        <div className="fm-i-assign-block">
          <div className="fm-i-label" title="Cards dropped into this group get these field values — position = meaning">
            Assigns
          </div>
          {Object.keys(assign).length === 0 && <div className="fm-i-muted">Nothing yet. Cards dropped here keep their fields.</div>}
          {Object.entries(assign).map(([k, v]) => (
            <Row key={k} label={fieldLabel(k, reg[k])} wide onRemove={() => setAssign(k, undefined)}>
              <FieldInput ctl={ctl} name={k} def={reg[k]} value={v} onSet={(nv, _e, history) => setAssign(k, nv, history)} historyKey={`ga:${group.id}:${k}`} />
            </Row>
          ))}
          {adding ? (
            <select
              className="dropdown"
              autoFocus
              value=""
              onBlur={() => setAdding(false)}
              onChange={(e) => {
                const k = e.target.value
                setAdding(false)
                if (!k) return
                const def = reg[k]
                const first = def?.type === 'select' ? def.options?.[0]?.value : def?.type === 'checkbox' ? true : def?.type === 'rating' ? 1 : ''
                setAssign(k, first === '' ? '' : first)
              }}
              aria-label="Field to assign"
            >
              <option value="">Choose a field…</option>
              {assignable.map((k) => (
                <option key={k} value={k}>
                  {fieldLabel(k, reg[k])}
                </option>
              ))}
            </select>
          ) : (
            <button className="fm-i-addbtn" disabled={!assignable.length} onClick={() => setAdding(true)} title={assignable.length ? 'Cards dropped here get this field' : 'Add fields to the map first'}>
              <Plus size={13} /> Assign a field
            </button>
          )}
        </div>
        <Row label="Pitch order" help="Slide order in pitch mode (empty = skipped)">
          <input className="input fm-i-num" type="number" min={1} value={group.order ?? ''} placeholder="—" onChange={(e) => patch({ order: e.target.value === '' ? undefined : Number(e.target.value) }, `go:${group.id}`)} />
        </Row>
        <Row label="Locked" help="Locked groups can't be dragged or resized on the map">
          <button className={`toggle${locked ? ' is-on' : ''}`} role="switch" aria-checked={locked} onClick={() => patch({ locked: !locked })} />
        </Row>
      </div>
      <div className="fm-i-actions is-wrap">
        <button className="btn" onClick={() => ctl.reveal([group.id])}>
          <MapPin size={14} /> Reveal
        </button>
        <button className="btn" onClick={() => openBoard(newGroupsBoard(ctl.data, [group.id]))} title="A board with this group as its column">
          <Columns3 size={14} /> Board
        </button>
        {boardFields.length > 0 && (
          <button className="btn" onClick={(e) => showContextMenu(e, boardFields.map(([k, f]) => ({ label: fieldLabel(k, f), onClick: () => openBoard(newFieldBoard(ctl.data, k, group.id)) })))} title="A board of this group's cards split by a field">
            <KanbanSquare size={14} /> Board by…
          </button>
        )}
      </div>
    </div>
  )
}

function GroupsMulti({ ctl, groups }: { ctl: FormMapCtl; groups: GroupNode[] }) {
  const ids = groups.map((g) => g.id)
  return (
    <div className="fm-i-form">
      <div className="fm-i-multi-head">{groups.length} groups selected</div>
      <div className="fm-i-multi-list">
        {[...groups]
          .sort((a, b) => a.x - b.x || a.y - b.y)
          .map((g) => (
            <button key={g.id} className="fm-i-multi-item" onClick={() => ctl.setSelection([g.id])}>
              <span>{g.emoji ?? '▢'}</span>
              <span className="fm-rel-title">{groupTitle(g)}</span>
            </button>
          ))}
      </div>
      <div className="fm-i-muted fm-i-tip">Make them the columns of a board, or fold them into one kanban node on the canvas.</div>
      <div className="fm-i-actions is-wrap">
        <button
          className="btn mod-cta"
          onClick={() => {
            const b = newGroupsBoard(ctl.data, ids)
            createBoard(ctl, b)
            ctl.openBoard(b.id)
          }}
        >
          <Columns3 size={14} /> Create board from groups
        </button>
        <button
          className="btn"
          onClick={() => {
            let r: ReturnType<typeof groupsToKanban> | null = null
            ctl.doc.update((d) => {
              r = groupsToKanban(d, ids)
              return r.data
            })
            const res = r as ReturnType<typeof groupsToKanban> | null
            if (res?.id) {
              ctl.setSelection([res.id])
              notice('Converted to a kanban node', 'success')
            }
          }}
        >
          <KanbanSquare size={14} /> Convert to kanban
        </button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------- kanban node

function KanbanEditor({ ctl, k }: { ctl: FormMapCtl; k: KanbanNode }) {
  const update = (fn: (x: KanbanNode) => KanbanNode, history?: string): void => patchKanban(ctl, k.id, fn, history)
  const n = kanbanCount(k)
  const done = k.columns.reduce((s, c) => s + c.cards.filter((x) => x.done).length, 0)
  return (
    <div className="fm-i-form">
      <div className="fm-i-zonehead">
        <span className="fm-i-zone-emoji">📋</span>
        <div>
          <div className="fm-i-zone-kicker">Kanban node</div>
          <div className="fm-i-zone-count">
            {n} card{n === 1 ? '' : 's'} · {done} done
          </div>
        </div>
      </div>
      <input className="fm-i-title" value={k.title ?? ''} placeholder="Board name" onChange={(e) => update((x) => ({ ...x, title: e.target.value }), `kt:${k.id}`)} aria-label="Board name" />
      <div className="fm-i-section">
        <div className="fm-i-section-head">
          <span>Columns</span>
          <button className="clickable-icon small" title="Add column" onClick={() => update((x) => addKanbanColumn(x).node)}>
            <Plus />
          </button>
        </div>
        <div className="fm-i-kcols">
          {k.columns.map((c, i) => (
            <div key={c.id} className="fm-i-kcol" style={{ '--kb-color': fmCss(c.color) } as CssVars}>
              <span className="fm-i-kcol-dot" />
              <input className="input" value={c.title} onChange={(e) => update((x) => updateKanbanColumn(x, c.id, { title: e.target.value }), `kc:${c.id}`)} aria-label="Column title" />
              <span className="fm-i-kcol-count">{c.cards.length}</span>
              <button className="clickable-icon small" title="Move left" disabled={i === 0} onClick={() => update((x) => moveKanbanColumn(x, c.id, i - 1))}>
                <ArrowUp />
              </button>
              <button className="clickable-icon small" title="Move right" disabled={i === k.columns.length - 1} onClick={() => update((x) => moveKanbanColumn(x, c.id, i + 1))}>
                <ArrowDown />
              </button>
              <button className="clickable-icon small" title={c.cards.length ? 'Delete column (and its cards)' : 'Delete column'} onClick={() => update((x) => deleteKanbanColumn(x, c.id))}>
                <X />
              </button>
            </div>
          ))}
        </div>
      </div>
      <div className="fm-i-muted fm-i-tip">Drag cards between columns on the canvas, drag them out to make canvas cards, or drop canvas cards in.</div>
      <div className="fm-i-actions is-wrap">
        <button className="btn" onClick={() => ctl.reveal([k.id])}>
          <MapPin size={14} /> Reveal
        </button>
        <button
          className="btn"
          onClick={() => {
            let r: ReturnType<typeof kanbanToGroups> | null = null
            ctl.doc.update((d) => {
              r = kanbanToGroups(d, k.id)
              return r.data
            })
            const res = r as ReturnType<typeof kanbanToGroups> | null
            if (res?.groupIds.length) {
              ctl.setSelection(res.groupIds)
              notice('Converted to groups, with a saved board', 'success')
            }
          }}
        >
          <Shapes size={14} /> Convert to groups
        </button>
      </div>
    </div>
  )
}

const fmCss = (c: string | undefined): string => fmColor(c) ?? 'var(--text-faint)'

// ---------------------------------------------------------------- edge

function EdgeEditor({ ctl, edge }: { ctl: FormMapCtl; edge: FormMapEdge }) {
  const name = (id: string): string => {
    const n = ctl.data.nodes.find((x) => x.id === id)
    return n && isForm(n) ? cardTitle(n) : n && isGroup(n) ? groupTitle(n) : n && isKanban(n) ? n.title || 'Kanban' : 'Card'
  }
  const cur = edge.relation ?? 'relates'
  const def = relationDef(cur)
  const [custom, setCustom] = useState(RELATIONS[cur] ? '' : cur)
  return (
    <div className="fm-i-form">
      <div className="fm-i-multi-head">Relation</div>
      <div className="fm-i-edge">
        <div className="fm-i-edge-end">{name(edge.fromNode)}</div>
        <div className="fm-i-edge-verb" style={{ color: def.color }}>
          ↓ {def.verb || 'relates to'}
        </div>
        <div className="fm-i-edge-end">{name(edge.toNode)}</div>
      </div>
      <div className="fm-i-section">
        {RELATION_ORDER.map((r) => (
          <button key={r} className={`fm-i-relopt${r === cur ? ' is-active' : ''}`} style={{ '--fm-rel-color': RELATIONS[r].color } as CssVars} onClick={() => setRelation(ctl, edge.id, r)}>
            <span className="fm-rel-line" />
            <b>{RELATIONS[r].label}</b>
            <span className="fm-i-muted">{RELATIONS[r].hint}</span>
          </button>
        ))}
        <div className="fm-i-customrel">
          <input
            className="input"
            value={custom}
            placeholder="Custom relation, e.g. blocks"
            onChange={(e) => setCustom(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && custom.trim() && setRelation(ctl, edge.id, custom.trim())}
            aria-label="Custom relation"
          />
          <button className="btn" disabled={!custom.trim() || custom.trim() === cur} onClick={() => setRelation(ctl, edge.id, custom.trim())}>
            Set
          </button>
        </div>
      </div>
      <div className="fm-i-actions">
        <span className="fm-toolbar-spacer" />
        <button className="btn" onClick={() => removeEdge(ctl, edge.id)}>
          <X size={14} /> Remove relation
        </button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------- plain canvas node

function PlainInfo({ ctl, node }: { ctl: FormMapCtl; node: CanvasNode }) {
  const kind = node.type === 'drawing' ? 'Drawing' : node.type.charAt(0).toUpperCase() + node.type.slice(1)
  const toCard = (): void => {
    const lines = (node.text ?? '').split('\n')
    const first = lines.findIndex((l) => l.trim())
    const title = first >= 0 ? textExcerpt(lines[first], 0).title : ''
    const text = first >= 0 ? lines.slice(first + 1).join('\n').trim() : ''
    ctl.doc.update((d) => ({
      ...d,
      nodes: d.nodes.map((n) =>
        n.id === node.id ? ({ id: n.id, type: 'form', title, text, tags: [], fields: {}, x: n.x, y: n.y, width: Math.max(n.width, 220), height: Math.max(n.height, 110), ...(n.color ? { color: n.color } : {}) } as FormNode) : n
      )
    }))
  }
  return (
    <div className="fm-i-form">
      <div className="fm-i-multi-head">{kind} node</div>
      <div className="fm-i-section">
        <Row label="Position">
          <span className="fm-i-mono">
            {Math.round(node.x)}, {Math.round(node.y)}
          </span>
        </Row>
        <Row label="Size">
          <span className="fm-i-mono">
            {Math.round(node.width)} × {Math.round(node.height)}
          </span>
        </Row>
        {node.file && (
          <Row label="File">
            <button className="fm-i-linkbtn" onClick={() => useWorkspace.getState().openFile(node.file!, { target: 'tab' })}>
              {node.file} <ExternalLink size={12} />
            </button>
          </Row>
        )}
        {node.url && (
          <Row label="URL">
            <button className="fm-i-linkbtn" onClick={() => void window.api.app.openExternal(node.url!)}>
              {node.url} <ExternalLink size={12} />
            </button>
          </Row>
        )}
        {node.label && <Row label="Label">{node.label}</Row>}
        {node.text && (
          <div className="fm-i-preview">
            <MarkdownPreview source={node.text} sourcePath={ctl.path} />
          </div>
        )}
      </div>
      {node.type === 'text' && (
        <div className="fm-i-muted fm-i-tip">Turn it into a card to give it tags, fields and relations — the first line becomes its title.</div>
      )}
      <div className="fm-i-actions">
        <button className="btn" onClick={() => ctl.reveal([node.id])}>
          <MapPin size={14} /> Reveal
        </button>
        {node.type === 'text' && (
          <button className="btn" onClick={toCard}>
            <StickyNote size={14} /> Convert to card
          </button>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------- nothing selected

function EmptyCard({ ctl }: { ctl: FormMapCtl }) {
  const p = presetById(ctl.meta, ctl.meta.presets?.[0]?.id)
  return (
    <div className="fm-i-empty">
      <div className="fm-i-empty-emoji">🃏</div>
      <div className="fm-i-empty-title">Nothing selected</div>
      <div>Select a card, group or kanban on the map, board or table to edit it here.</div>
      <div className="fm-i-keys">
        <div>
          <kbd>Alt</kbd>+<kbd>1</kbd>…<kbd>4</kbd> switch lens
        </div>
        <div>
          <kbd>W</kbd> why-trace the selection (map)
        </div>
        <div>
          <kbd>Tab</kbd> child · <kbd>Enter</kbd> sibling (map)
        </div>
        {p && <div>Toolbar presets like {p.emoji} {p.name} add tags and fields in one click</div>}
      </div>
      <button className="btn" onClick={() => ctl.setLens('board')}>
        Open the Board lens
      </button>
    </div>
  )
}
