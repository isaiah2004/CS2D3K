// Inspector "Card" tab: edits whatever is selected (form card, several cards, a zone, an edge or a plain canvas node).
import { useMemo, useState } from 'react'
import { Eye, Pencil, MapPin, Trash2, HelpCircle, Lock, Unlock, ExternalLink, X } from 'lucide-react'
import type { FormMapCtl } from '../context'
import { whyTrace } from '../analysis'
import {
  cardTitle,
  fieldDef,
  isForm,
  isZone,
  KIND_ORDER,
  KINDS,
  RELATIONS,
  zoneAt,
  type FieldDef,
  type FormKind,
  type FormMapEdge,
  type FormNode,
  type Relation,
  type ZoneNode
} from '../schema'
import { deleteNodes, patchNode, removeEdge, setField, setKind, setRelation, vote } from '../lenses/ops'
import { KindChip, OptionChip } from '../lenses/widgets'
import { AutoTextarea, FieldEditor, Row } from './fields'
import Relations from './Relations'
import MarkdownPreview from '@/lib/markdown/MarkdownPreview'
import { useWorkspace } from '@/store/workspace'
import type { CanvasNode } from '../../canvas/model'

export default function CardTab({ ctl }: { ctl: FormMapCtl }) {
  const sel = ctl.selection
  const nodes = useMemo(() => new Map(ctl.data.nodes.map((n) => [n.id, n])), [ctl.data])
  const picked = sel.map((id) => nodes.get(id)).filter((n): n is CanvasNode => !!n)
  const formsSel = picked.filter(isForm)

  if (!sel.length) return <EmptyCard ctl={ctl} />
  if (formsSel.length > 1) return <MultiEditor ctl={ctl} cards={formsSel} />
  if (picked.length === 1) {
    const n = picked[0]
    if (isForm(n)) return <FormEditor key={n.id} ctl={ctl} card={n} />
    if (isZone(n)) return <ZoneEditor key={n.id} ctl={ctl} zone={n} />
    return <PlainInfo ctl={ctl} node={n} />
  }
  const edge = (ctl.data.edges as FormMapEdge[]).find((e) => e.id === sel[0])
  if (edge && sel.length === 1) return <EdgeEditor ctl={ctl} edge={edge} />
  if (formsSel.length === 1) return <FormEditor key={formsSel[0].id} ctl={ctl} card={formsSel[0]} />
  return <div className="fm-i-empty">{sel.length} items selected</div>
}

// ---------------------------------------------------------------- form card

function FormEditor({ ctl, card }: { ctl: FormMapCtl; card: FormNode }) {
  const [preview, setPreview] = useState(false)
  const def = KINDS[card.kind]
  const trace = useMemo(() => whyTrace(ctl.data, card.id), [ctl.data, card.id])
  const tracing = !!ctl.highlight && ctl.highlight.length === trace.length && trace.every((t) => ctl.highlight!.includes(t))
  const zone = zoneAt(ctl.data, card)
  const votes = card.votes ?? 0
  const [bump, setBump] = useState(0)

  return (
    <div className="fm-i-form" style={{ '--fm-card-color': def.color } as React.CSSProperties}>
      <div className="fm-i-kinds" role="radiogroup" aria-label="Kind">
        {KIND_ORDER.map((k) => (
          <KindChip key={k} kind={k} label={k === card.kind} active={k === card.kind} onClick={() => setKind(ctl, card.id, k)} title={`${KINDS[k].label} — ${KINDS[k].hint}`} />
        ))}
      </div>
      {zone && (
        <div className="fm-i-zoneline">
          in {zone.emoji} <b>{zone.label}</b>
        </div>
      )}
      <input
        className="fm-i-title"
        value={card.title ?? ''}
        placeholder={cardTitle(card)}
        onChange={(e) => ctl.updateForm(card.id, { title: e.target.value }, { history: `title:${card.id}` })}
        aria-label="Title"
      />

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
          <AutoTextarea
            value={card.text ?? ''}
            minRows={3}
            placeholder="Markdown… [[links]] work too"
            onChange={(e) => ctl.updateForm(card.id, { text: e.target.value }, { history: `text:${card.id}` })}
          />
        )}
      </div>

      {def.fields.length > 0 && (
        <div className="fm-i-section">
          {def.fields.map((f) => (
            <Row key={f.key} label={f.label} help={f.help} wide={f.type === 'longtext' || f.type === 'checklist'}>
              <FieldEditor ctl={ctl} card={card} def={f} />
            </Row>
          ))}
        </div>
      )}

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

// ---------------------------------------------------------------- several cards

/** select fields every selected card has with the same options */
function sharedSelects(cards: FormNode[]): FieldDef[] {
  return KINDS[cards[0].kind].fields.filter((f) => {
    if (f.type !== 'select') return false
    const sig = f.options?.map((o) => o.value).join('|')
    return cards.every((c) => {
      const d = fieldDef(c.kind, f.key)
      return d?.type === 'select' && d.options?.map((o) => o.value).join('|') === sig
    })
  })
}

function MultiEditor({ ctl, cards }: { ctl: FormMapCtl; cards: FormNode[] }) {
  const shared = sharedSelects(cards)
  const ids = cards.map((c) => c.id)
  const sameKind = cards.every((c) => c.kind === cards[0].kind) ? cards[0].kind : null
  const traceAll = (): void => ctl.setHighlight([...new Set(ids.flatMap((id) => whyTrace(ctl.data, id)))])
  return (
    <div className="fm-i-form">
      <div className="fm-i-multi-head">{cards.length} cards selected</div>
      <div className="fm-i-multi-list">
        {cards.map((c) => (
          <button key={c.id} className="fm-i-multi-item" onClick={() => ctl.setSelection([c.id])} title="Select only this card">
            <span>{KINDS[c.kind].emoji}</span>
            <span className="fm-rel-title">{cardTitle(c)}</span>
          </button>
        ))}
      </div>
      <div className="fm-i-section">
        <Row label="Kind">
          <div className="fm-i-kinds">
            {KIND_ORDER.map((k) => (
              <KindChip key={k} kind={k} label={false} active={k === sameKind} onClick={() => setKind(ctl, ids, k as FormKind)} />
            ))}
          </div>
        </Row>
        {shared.map((f) => {
          const vals = new Set(cards.map((c) => c.fields[f.key]))
          const common = vals.size === 1 ? [...vals][0] : undefined
          return (
            <Row key={f.key} label={f.label}>
              <div className="fm-i-chips">
                {f.options!.map((o) => (
                  <OptionChip key={o.value} option={o} active={common === o.value} onClick={(e) => setField(ctl, ids, f.key, o.value, e)} />
                ))}
                {vals.size > 1 && <span className="fm-i-mixed">mixed</span>}
              </div>
            </Row>
          )
        })}
        {!shared.length && <div className="fm-i-muted">These cards share no select fields. Pick cards of the same kind to bulk-edit.</div>}
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

// ---------------------------------------------------------------- zone

const ZONE_EMOJI = ['🌱', '🧭', '🛠️', '🎯', '🚀', '🔭', '❓', '📥', '💎', '🧪', '🎨', '⚡']

function ZoneEditor({ ctl, zone }: { ctl: FormMapCtl; zone: ZoneNode }) {
  const patch = (p: Partial<ZoneNode>, history?: string): void => patchNode(ctl, zone.id, p, history)
  const inside = ctl.data.nodes.filter((n) => isForm(n) && zoneAt(ctl.data, n)?.id === zone.id).length
  // fields a zone can assign: select fields of its default kind (or of every kind)
  const assignable = useMemo(() => {
    const kinds = zone.defaultKind ? [zone.defaultKind] : KIND_ORDER
    const m = new Map<string, FieldDef>()
    for (const k of kinds) for (const f of KINDS[k].fields) if (f.type === 'select' && !m.has(f.key)) m.set(f.key, f)
    return [...m.values()]
  }, [zone.defaultKind])
  const assign = zone.assign ?? {}
  const setAssign = (key: string, value: unknown): void => {
    const next = { ...assign }
    if (value === undefined || next[key] === value) delete next[key]
    else next[key] = value
    patch({ assign: Object.keys(next).length ? next : undefined })
  }

  return (
    <div className="fm-i-form">
      <div className="fm-i-zonehead">
        <span className="fm-i-zone-emoji">{zone.emoji || '▢'}</span>
        <div>
          <div className="fm-i-zone-kicker">Zone</div>
          <div className="fm-i-zone-count">
            {inside} card{inside === 1 ? '' : 's'} inside
          </div>
        </div>
        <span className="fm-toolbar-spacer" />
        <button className={`clickable-icon small${zone.locked ? ' is-active' : ''}`} title={zone.locked ? 'Locked — click to unlock' : 'Unlocked — click to lock'} onClick={() => patch({ locked: !zone.locked })}>
          {zone.locked ? <Lock /> : <Unlock />}
        </button>
      </div>
      <input className="fm-i-title" value={zone.label ?? ''} placeholder="Zone label" onChange={(e) => patch({ label: e.target.value }, `zl:${zone.id}`)} aria-label="Label" />
      <div className="fm-i-section">
        <Row label="Emoji">
          <div className="fm-i-emoji-row">
            <input className="input fm-i-emoji-input" value={zone.emoji ?? ''} maxLength={8} onChange={(e) => patch({ emoji: e.target.value || undefined }, `ze:${zone.id}`)} />
            {ZONE_EMOJI.map((em) => (
              <button key={em} className={`fm-i-emoji-btn${zone.emoji === em ? ' is-active' : ''}`} onClick={() => patch({ emoji: em })}>
                {em}
              </button>
            ))}
          </div>
        </Row>
        <Row label="Prompt" wide help="Guidance shown in the empty zone and in pitch mode">
          <AutoTextarea value={zone.prompt ?? ''} placeholder="What belongs here?" onChange={(e) => patch({ prompt: e.target.value || undefined }, `zp:${zone.id}`)} />
        </Row>
        <Row label="New cards" help="Kind created by double-clicking inside the zone">
          <div className="fm-i-kinds">
            {KIND_ORDER.map((k) => (
              <KindChip key={k} kind={k} label={k === zone.defaultKind} active={k === zone.defaultKind} onClick={() => patch({ defaultKind: zone.defaultKind === k ? undefined : k })} />
            ))}
          </div>
        </Row>
        <Row label="Assigns" wide help="Cards dropped into this zone get these values — position = meaning">
          <div className="fm-i-assign">
            {assignable.map((f) => (
              <div key={f.key} className="fm-i-assign-row">
                <span className="fm-i-assign-key">{f.label}</span>
                <div className="fm-i-chips">
                  {f.options!.map((o) => (
                    <OptionChip key={o.value} option={o} compact active={assign[f.key] === o.value} onClick={() => setAssign(f.key, o.value)} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </Row>
        <Row label="Pitch order" help="Slide order in pitch mode (empty = skipped)">
          <input className="input fm-i-num" type="number" min={1} value={zone.order ?? ''} placeholder="—" onChange={(e) => patch({ order: e.target.value === '' ? undefined : Number(e.target.value) }, `zo:${zone.id}`)} />
        </Row>
        <Row label="Locked" help="Locked zones can't be dragged or resized on the map">
          <button className={`toggle${zone.locked ? ' is-on' : ''}`} role="switch" aria-checked={!!zone.locked} onClick={() => patch({ locked: !zone.locked })} />
        </Row>
      </div>
      <div className="fm-i-actions">
        <button className="btn" onClick={() => ctl.reveal([zone.id])}>
          <MapPin size={14} /> Reveal
        </button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------- edge

function EdgeEditor({ ctl, edge }: { ctl: FormMapCtl; edge: FormMapEdge }) {
  const name = (id: string): string => {
    const n = ctl.data.nodes.find((x) => x.id === id)
    return n && isForm(n) ? `${KINDS[n.kind].emoji} ${cardTitle(n)}` : n && isZone(n) ? n.label : 'Card'
  }
  const cur: Relation = edge.relation ?? 'relates'
  return (
    <div className="fm-i-form">
      <div className="fm-i-multi-head">Relation</div>
      <div className="fm-i-edge">
        <div className="fm-i-edge-end">{name(edge.fromNode)}</div>
        <div className="fm-i-edge-verb" style={{ color: RELATIONS[cur].color }}>
          ↓ {RELATIONS[cur].verb || 'relates to'}
        </div>
        <div className="fm-i-edge-end">{name(edge.toNode)}</div>
      </div>
      <div className="fm-i-section">
        {(Object.keys(RELATIONS) as Relation[]).map((r) => (
          <button key={r} className={`fm-i-relopt${r === cur ? ' is-active' : ''}`} style={{ '--fm-rel-color': RELATIONS[r].color } as React.CSSProperties} onClick={() => setRelation(ctl, edge.id, r)}>
            <span className="fm-rel-line" />
            <b>{RELATIONS[r].label}</b>
            <span className="fm-i-muted">{RELATIONS[r].hint}</span>
          </button>
        ))}
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
      <div className="fm-i-muted fm-i-tip">Plain canvas nodes are edited directly on the map. Convert ideas into form cards to give them fields and relations.</div>
      <div className="fm-i-actions">
        <button className="btn" onClick={() => ctl.reveal([node.id])}>
          <MapPin size={14} /> Reveal
        </button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------- nothing selected

function EmptyCard({ ctl }: { ctl: FormMapCtl }) {
  return (
    <div className="fm-i-empty">
      <div className="fm-i-empty-emoji">🃏</div>
      <div className="fm-i-empty-title">Nothing selected</div>
      <div>Select a card on the map, board or table to edit its fields, votes and relations.</div>
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
      </div>
      <button className="btn" onClick={() => ctl.setLens('board')}>
        Open the board
      </button>
    </div>
  )
}
