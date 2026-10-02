// Inspector "Map" tab: map metadata, Spark, the groups navigator, and the editors of the map-wide registries:
// fields (rename / type / options / delete), tags (color / rename / delete), card presets, and the tag focus filter.
import { useMemo, useState } from 'react'
import { Sparkles, Presentation, ChevronRight, Trash2, Plus, Eye, EyeOff, Focus, X, CopyPlus } from 'lucide-react'
import type { FormMapCtl } from '../context'
import {
  cleanTag,
  fieldLabel,
  FIELD_TYPES,
  fmColor,
  forms,
  groupIn,
  groups,
  groupTitle,
  isForm,
  tagColor,
  type FieldDef,
  type FieldType,
  type FormMapData,
  type Preset
} from '../schema'
import { addCard, addField, deleteField, deleteTag, fieldUsage, groupsInOrder, renameField, renameTag, savePresets, setMeta, setTagColor, tagUsage, updateFieldDef } from '../lenses/ops'
import { colorItems, TagChip, tagMenuItems, TypeIcon } from '../lenses/widgets'
import { randomSpark } from '../fun/spark'
import { FieldInput, Row } from './fields'
import { dirname, join, stem } from '@/lib/path'
import { hexId } from '@/lib/util'
import { confirmDialog, showContextMenu } from '@/store/ui'

type CssVars = React.CSSProperties & Record<`--${string}`, string>

export default function MapTab({ ctl }: { ctl: FormMapCtl }) {
  const meta = (ctl.data as FormMapData).formmap
  const ordered = useMemo(() => groupsInOrder(ctl.data), [ctl.data])
  const counts = useMemo(() => {
    const m = new Map<string, number>()
    const gs = groups(ctl.data)
    for (const f of forms(ctl.data)) {
      const g = groupIn(gs, f)
      if (g) m.set(g.id, (m.get(g.id) ?? 0) + 1)
    }
    return m
  }, [ctl.data])
  const [spark, setSpark] = useState<{ text: string; n: number } | null>(null)

  const doSpark = (): void => {
    const text = randomSpark()
    const gs = groups(ctl.data)
    const inbox = gs.find((g) => /inbox/i.test(g.label ?? '')) ?? gs.find((g) => g.preset === 'idea')
    const id = addCard(ctl, { title: text, tags: ['spark'], groupId: inbox?.id ?? null, preset: inbox?.preset })
    setSpark({ text, n: (spark?.n ?? 0) + 1 })
    ctl.setHighlight(null)
    ctl.setSelection([id])
    // let the new card render in the map before flying to it
    setTimeout(() => ctl.reveal([id], { select: true }), 60)
  }

  return (
    <div className="fm-maptab">
      <div className="fm-i-section">
        <Row label="Title">
          <input className="input" value={meta?.title ?? ''} placeholder={stem(ctl.path)} onChange={(e) => setMeta(ctl, { title: e.target.value || undefined }, 'title')} />
        </Row>
        <Row label="Export to" help="Markdown note the Doc lens exports to">
          <input className="input" value={meta?.exportPath ?? ''} placeholder={join(dirname(ctl.path), `${stem(ctl.path)} - Doc.md`)} onChange={(e) => setMeta(ctl, { exportPath: e.target.value || undefined }, 'export')} />
        </Row>
      </div>

      <div className="fm-spark">
        <button className="fm-spark-btn" onClick={doSpark} title="Add a provocative prompt as a new card (#spark)">
          <Sparkles size={16} />
          Spark
        </button>
        <div className="fm-spark-text" key={spark?.n ?? 0}>
          {spark ? `“${spark.text}”` : 'Stuck? Get a provocative prompt as a new card.'}
        </div>
      </div>

      <Section title="Groups" count={ordered.length} action={<PitchButton ctl={ctl} />}>
        {!ordered.length && <div className="fm-i-muted">No groups on this map yet.</div>}
        <div className="fm-znav">
          {ordered.map((z) => (
            <button key={z.id} className={`fm-znav-item${ctl.selection.includes(z.id) ? ' is-active' : ''}`} onClick={() => ctl.reveal([z.id])} onDoubleClick={() => ctl.setSelection([z.id])} title={z.prompt ?? 'Reveal group (double-click to edit)'}>
              <span className="fm-znav-order">{z.order ?? '·'}</span>
              <span className="fm-znav-emoji">{z.emoji ?? '▢'}</span>
              <span className="fm-znav-label">{groupTitle(z)}</span>
              <span className="fm-znav-count">{counts.get(z.id) ?? 0}</span>
            </button>
          ))}
        </div>
      </Section>

      <FieldsEditor ctl={ctl} />
      <TagsEditor ctl={ctl} />
      <PresetsEditor ctl={ctl} />
    </div>
  )
}

function PitchButton({ ctl }: { ctl: FormMapCtl }) {
  return (
    <button className="clickable-icon small" title="Pitch mode" onClick={() => ctl.present()}>
      <Presentation />
    </button>
  )
}

function Section({ title, count, action, children }: { title: string; count?: number; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="fm-i-section">
      <div className="fm-i-section-head">
        <span>
          {title}
          {count !== undefined && <span className="fm-i-section-count">{count}</span>}
        </span>
        {action}
      </div>
      {children}
    </div>
  )
}

// ---------------------------------------------------------------- fields

function FieldsEditor({ ctl }: { ctl: FormMapCtl }) {
  const reg = ctl.meta.fields ?? {}
  const [open, setOpen] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [type, setType] = useState<FieldType>('select')
  const add = (): void => {
    const k = name.trim()
    if (!k || reg[k]) return
    addField(ctl, k, { type, ...(type === 'select' || type === 'multiselect' ? { options: [] } : {}) })
    setName('')
    setOpen(k)
  }
  return (
    <Section title="Fields" count={Object.keys(reg).length}>
      {!Object.keys(reg).length && <div className="fm-i-muted">No fields yet. Add one here or from a card.</div>}
      <div className="fm-reg">
        {Object.entries(reg).map(([k, def]) => (
          <div key={k} className={`fm-reg-item${open === k ? ' is-open' : ''}`}>
            <button className="fm-reg-row" onClick={() => setOpen(open === k ? null : k)} aria-expanded={open === k}>
              <TypeIcon type={def.type} />
              <span className="fm-reg-name">{fieldLabel(k, def)}</span>
              {def.hidden && <EyeOff size={12} className="fm-reg-muted" />}
              <span className="fm-reg-count" title="Cards with a value">
                {fieldUsage(ctl.data, k)}
              </span>
              <ChevronRight size={13} className="fm-reg-chevron" />
            </button>
            {open === k && <FieldDetail ctl={ctl} name={k} def={def} onRenamed={(n) => setOpen(n)} />}
          </div>
        ))}
      </div>
      <div className="fm-i-newfield">
        <input className="input" value={name} placeholder="New field" onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add()} aria-label="New field name" />
        <select className="dropdown" value={type} onChange={(e) => setType(e.target.value as FieldType)} aria-label="New field type">
          {FIELD_TYPES.map((t) => (
            <option key={t.type} value={t.type}>
              {t.label}
            </option>
          ))}
        </select>
        <button className="btn" disabled={!name.trim() || !!reg[name.trim()]} onClick={add} title={reg[name.trim()] ? 'A field with this name exists' : 'Add field'}>
          <Plus size={13} />
        </button>
      </div>
    </Section>
  )
}

function FieldDetail({ ctl, name, def, onRenamed }: { ctl: FormMapCtl; name: string; def: FieldDef; onRenamed: (n: string) => void }) {
  const [draft, setDraft] = useState(fieldLabel(name, def))
  const [opt, setOpt] = useState('')
  const usage = fieldUsage(ctl.data, name)
  const commitName = (): void => {
    const v = draft.trim()
    if (!v || v === fieldLabel(name, def)) return setDraft(fieldLabel(name, def))
    if (v === name && def.label) return updateFieldDef(ctl, name, { label: undefined })
    if (ctl.meta.fields?.[v]) return setDraft(fieldLabel(name, def))
    if (renameField(ctl, name, v)) onRenamed(v)
  }
  const options = def.options ?? []
  const setOptions = (next: FieldDef['options']): void => updateFieldDef(ctl, name, { options: next })
  const addOption = (): void => {
    const v = opt.trim()
    if (!v || options.some((o) => o.value === v)) return
    setOptions([...options, { value: v }])
    setOpt('')
  }
  const remove = async (): Promise<void> => {
    const ok = await confirmDialog({
      title: `Delete the “${fieldLabel(name, def)}” field?`,
      message: usage ? `Its value is removed from ${usage} card${usage === 1 ? '' : 's'}, and from groups, presets and boards using it.` : 'No card uses it.',
      okLabel: 'Delete',
      danger: true
    })
    if (ok) deleteField(ctl, name)
  }
  return (
    <div className="fm-reg-detail">
      <Row label="Name">
        <input className="input" value={draft} onChange={(e) => setDraft(e.target.value)} onBlur={commitName} onKeyDown={(e) => e.key === 'Enter' && (e.currentTarget as HTMLInputElement).blur()} aria-label="Field name" />
      </Row>
      <Row label="Type">
        <select className="dropdown" value={def.type} onChange={(e) => updateFieldDef(ctl, name, { type: e.target.value as FieldType })} aria-label="Field type">
          {FIELD_TYPES.map((t) => (
            <option key={t.type} value={t.type}>
              {t.label}
            </option>
          ))}
        </select>
      </Row>
      {(def.type === 'select' || def.type === 'multiselect') && (
        <div className="fm-reg-options">
          {options.map((o, i) => (
            <div key={o.value} className="fm-reg-option">
              <button className="fm-reg-dot" style={{ background: fmColor(o.color) ?? 'var(--text-faint)' }} title="Color" onClick={(e) => showContextMenu(e, colorItems(o.color, (c) => setOptions(options.map((x, j) => (j === i ? { ...x, color: c } : x)))))} />
              <input
                className="fm-reg-optlabel"
                value={o.label ?? o.value}
                onChange={(e) => setOptions(options.map((x, j) => (j === i ? { ...x, label: e.target.value === x.value ? undefined : e.target.value } : x)))}
                aria-label="Option label"
                title={`Stored value: ${o.value}`}
              />
              {o.for?.length ? <span className="fm-reg-for" title="Offered to cards with these tags">{o.for.map((t) => `#${t}`).join(' ')}</span> : null}
              <button className="clickable-icon small" title="Remove option (cards keep their value)" onClick={() => setOptions(options.filter((_, j) => j !== i))}>
                <X />
              </button>
            </div>
          ))}
          <div className="fm-reg-option is-new">
            <input className="fm-reg-optlabel" value={opt} placeholder="+ Add option (Enter)" onChange={(e) => setOpt(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addOption()} onBlur={addOption} aria-label="New option" />
          </div>
        </div>
      )}
      {def.type === 'rating' && (
        <Row label="Max">
          <input className="input fm-i-num" type="number" min={1} max={10} value={def.max ?? 5} onChange={(e) => updateFieldDef(ctl, name, { max: Math.max(1, Math.min(10, Number(e.target.value) || 5)) }, `max:${name}`)} />
        </Row>
      )}
      <Row label="On cards">
        <button className={`toggle${def.hidden ? '' : ' is-on'}`} role="switch" aria-checked={!def.hidden} aria-label="Show on cards" onClick={() => updateFieldDef(ctl, name, { hidden: def.hidden ? undefined : true })} />
      </Row>
      <div className="fm-reg-actions">
        <span className="fm-i-muted">
          {usage} card{usage === 1 ? '' : 's'}
        </span>
        <span className="fm-toolbar-spacer" />
        <button className="btn fm-i-danger-btn" onClick={() => void remove()}>
          <Trash2 size={13} /> Delete field
        </button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------- tags

function TagsEditor({ ctl }: { ctl: FormMapCtl }) {
  const usage = useMemo(() => tagUsage(ctl.data), [ctl.data])
  const tags = Object.keys(ctl.meta.tags ?? {}).sort((a, b) => (usage.get(b) ?? 0) - (usage.get(a) ?? 0) || a.localeCompare(b))
  const focus = ctl.focusFilter?.tags ?? []
  const toggleFocus = (t: string): void => {
    const next = focus.includes(t) ? focus.filter((x) => x !== t) : [...focus, t]
    ctl.setFocusFilter(next.length ? { tags: next } : null)
  }
  return (
    <Section
      title="Tags"
      count={tags.length}
      action={
        focus.length > 0 ? (
          <button className="fm-i-textbtn" onClick={() => ctl.setFocusFilter(null)}>
            Clear focus
          </button>
        ) : undefined
      }
    >
      {!tags.length && <div className="fm-i-muted">No tags yet. Add them on cards (+ Tag) or with presets.</div>}
      <div className="fm-reg">
        {tags.map((t) => (
          <TagRow key={t} ctl={ctl} tag={t} count={usage.get(t) ?? 0} focused={focus.includes(t)} onFocus={() => toggleFocus(t)} />
        ))}
      </div>
    </Section>
  )
}

function TagRow({ ctl, tag, count, focused, onFocus }: { ctl: FormMapCtl; tag: string; count: number; focused: boolean; onFocus: () => void }) {
  const [draft, setDraft] = useState(tag)
  const commit = (): void => {
    const v = cleanTag(draft)
    if (!v || v === tag || /\s/.test(v)) return setDraft(tag)
    renameTag(ctl, tag, v)
  }
  return (
    <div className={`fm-reg-tag${focused ? ' is-focused' : ''}`}>
      <button className="fm-reg-dot" style={{ background: tagColor(ctl.meta, tag) }} title="Color" onClick={(e) => showContextMenu(e, colorItems(ctl.meta.tags?.[tag]?.color, (c) => setTagColor(ctl, tag, c)))} />
      <span className="fm-reg-hash">#</span>
      <input className="fm-reg-optlabel" value={draft} onChange={(e) => setDraft(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === 'Enter' && (e.currentTarget as HTMLInputElement).blur()} aria-label={`Rename #${tag}`} />
      <span className="fm-reg-count">{count}</span>
      <button className={`clickable-icon small${focused ? ' is-active' : ''}`} title={focused ? 'Stop focusing' : `Focus on #${tag} (dim the rest)`} onClick={onFocus}>
        {focused ? <Eye /> : <Focus />}
      </button>
      <button
        className="clickable-icon small"
        title="Delete tag (removes it from every card)"
        onClick={() =>
          void (count ? confirmDialog({ title: `Delete #${tag}?`, message: `It is removed from ${count} card${count === 1 ? '' : 's'}.`, okLabel: 'Delete', danger: true }) : Promise.resolve(true)).then((ok) => {
            if (ok) deleteTag(ctl, tag)
          })
        }
      >
        <Trash2 />
      </button>
    </div>
  )
}

// ---------------------------------------------------------------- presets

function PresetsEditor({ ctl }: { ctl: FormMapCtl }) {
  const presets = ctl.meta.presets ?? []
  const [open, setOpen] = useState<string | null>(null)
  const save = (next: Preset[], history?: string): void => savePresets(ctl, next, history)
  const patch = (id: string, p: Partial<Preset>, history?: string): void => save(presets.map((x) => (x.id === id ? { ...x, ...p } : x)), history)
  const selCard = ctl.selection.length === 1 ? ctl.data.nodes.find((n) => n.id === ctl.selection[0] && isForm(n)) : undefined
  const add = (fromCard: boolean): void => {
    const c = fromCard && selCard && isForm(selCard) ? selCard : null
    const p: Preset = { id: hexId(), name: c ? (c.tags?.[0] ? c.tags[0].charAt(0).toUpperCase() + c.tags[0].slice(1) : 'Preset') : 'New preset', emoji: '🃏', tags: c ? [...(c.tags ?? [])] : [], fields: c ? structuredClone(c.fields) : {} }
    save([...presets, p])
    setOpen(p.id)
  }
  return (
    <Section title="Card presets" count={presets.length}>
      <div className="fm-i-muted fm-i-tip">One-click cards with tags and fields (toolbar, double-click in a group, Tab children).</div>
      <div className="fm-reg">
        {presets.map((p, i) => (
          <div key={p.id} className={`fm-reg-item${open === p.id ? ' is-open' : ''}`}>
            <button className="fm-reg-row" onClick={() => setOpen(open === p.id ? null : p.id)} aria-expanded={open === p.id}>
              <span className="fm-reg-emoji">{p.emoji ?? '▫️'}</span>
              <span className="fm-reg-name">{p.name}</span>
              <span className="fm-reg-tags">
                {(p.tags ?? []).map((t) => (
                  <span key={t} className="fm-reg-tagdot" style={{ '--fm-chip-color': tagColor(ctl.meta, t) } as CssVars}>
                    #{t}
                  </span>
                ))}
              </span>
              <ChevronRight size={13} className="fm-reg-chevron" />
            </button>
            {open === p.id && <PresetDetail ctl={ctl} p={p} index={i} presets={presets} patch={(x, h) => patch(p.id, x, h)} remove={() => save(presets.filter((x) => x.id !== p.id))} move={(d) => {
              const next = [...presets]
              const j = i + d
              if (j < 0 || j >= next.length) return
              ;[next[i], next[j]] = [next[j], next[i]]
              save(next)
            }} />}
          </div>
        ))}
      </div>
      <div className="fm-i-actions is-wrap">
        <button className="btn" onClick={() => add(false)}>
          <Plus size={13} /> New preset
        </button>
        {selCard && (
          <button className="btn" onClick={() => add(true)} title="Use the selected card's tags and fields as the preset's defaults">
            <CopyPlus size={13} /> From selected card
          </button>
        )}
      </div>
    </Section>
  )
}

function PresetDetail({ ctl, p, index, presets, patch, remove, move }: { ctl: FormMapCtl; p: Preset; index: number; presets: Preset[]; patch: (x: Partial<Preset>, history?: string) => void; remove: () => void; move: (d: -1 | 1) => void }) {
  const reg = ctl.meta.fields ?? {}
  const fields = p.fields ?? {}
  const free = Object.keys(reg).filter((k) => !(k in fields))
  const setFieldValue = (k: string, v: unknown, history?: string): void => {
    const next = { ...fields }
    if (v === undefined) delete next[k]
    else next[k] = v
    patch({ fields: next }, history)
  }
  return (
    <div className="fm-reg-detail">
      <Row label="Name">
        <div className="fm-i-newfield">
          <input className="input fm-i-emoji-input" value={p.emoji ?? ''} maxLength={8} onChange={(e) => patch({ emoji: e.target.value || undefined }, `pe:${p.id}`)} aria-label="Preset emoji" />
          <input className="input" value={p.name} onChange={(e) => patch({ name: e.target.value }, `pn:${p.id}`)} aria-label="Preset name" />
        </div>
      </Row>
      <Row label="Tags" wide>
        <div className="fm-i-chips">
          {(p.tags ?? []).map((t) => (
            <TagChip key={t} tag={t} meta={ctl.meta} compact onRemove={() => patch({ tags: (p.tags ?? []).filter((x) => x !== t) })} />
          ))}
          <button className="fm-i-addtag" onClick={(e) => showContextMenu(e, tagMenuItems(ctl.meta, p.tags ?? [], (t) => patch({ tags: p.tags?.includes(t) ? p.tags.filter((x) => x !== t) : [...(p.tags ?? []), cleanTag(t)] })))}>
            <Plus size={12} /> Tag
          </button>
        </div>
      </Row>
      {Object.entries(fields).map(([k, v]) => (
        <Row key={k} label={fieldLabel(k, reg[k])} wide onRemove={() => setFieldValue(k, undefined)}>
          <FieldInput ctl={ctl} name={k} def={reg[k]} value={v} tags={p.tags} onSet={(nv, _e, h) => setFieldValue(k, nv, h)} historyKey={`pf:${p.id}:${k}`} />
        </Row>
      ))}
      {free.length > 0 && (
        <select className="dropdown fm-reg-addfield" value="" onChange={(e) => e.target.value && setFieldValue(e.target.value, reg[e.target.value]?.type === 'checkbox' ? true : reg[e.target.value]?.type === 'select' ? reg[e.target.value].options?.[0]?.value : '')} aria-label="Add a default field">
          <option value="">+ Default field…</option>
          {free.map((k) => (
            <option key={k} value={k}>
              {fieldLabel(k, reg[k])}
            </option>
          ))}
        </select>
      )}
      <Row label="Tab child" help="Preset of mind-map children (Tab on a card made from this preset)">
        <select className="dropdown" value={p.child ?? ''} onChange={(e) => patch({ child: e.target.value || undefined })} aria-label="Child preset">
          <option value="">Plain card</option>
          {presets.map((x) => (
            <option key={x.id} value={x.id}>
              {x.emoji ? `${x.emoji} ` : ''}
              {x.name}
            </option>
          ))}
        </select>
      </Row>
      <div className="fm-reg-actions">
        <button className="clickable-icon small" title="Move up" disabled={index === 0} onClick={() => move(-1)}>
          ↑
        </button>
        <button className="clickable-icon small" title="Move down" disabled={index === presets.length - 1} onClick={() => move(1)}>
          ↓
        </button>
        <span className="fm-toolbar-spacer" />
        <button className="btn fm-i-danger-btn" onClick={remove}>
          <Trash2 size={13} /> Delete preset
        </button>
      </div>
    </div>
  )
}

