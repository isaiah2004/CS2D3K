// Relations of the selected card, grouped by relation, plus an "Add relation" fuzzy picker.
import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, ArrowRight, Plus, X } from 'lucide-react'
import type { FormMapCtl } from '../context'
import { relationsOf } from '../analysis'
import { cardAccent, cardTitle, forms, groupTitle, inferRelation, isForm, isGroup, isKanban, relationDef, RELATION_ORDER, RELATIONS, type FormNode, type Relation } from '../schema'
import { addRelation, removeEdge, setRelation } from '../lenses/ops'
import { fuzzyMatch } from '@/lib/util'
import { promptText, showContextMenu } from '@/store/ui'

const REL_ORDER = RELATION_ORDER
const inverse = (r: Relation): string => relationDef(r).inverse
const rank = (r: Relation): number => (REL_ORDER.includes(r) ? REL_ORDER.indexOf(r) : REL_ORDER.length)

type CssVars = React.CSSProperties & Record<`--${string}`, string>

export default function Relations({ ctl, card }: { ctl: FormMapCtl; card: FormNode }) {
  const [picking, setPicking] = useState(false)
  const rels = useMemo(() => relationsOf(ctl.data, card.id), [ctl.data, card.id])
  const nodes = useMemo(() => new Map(ctl.data.nodes.map((n) => [n.id, n])), [ctl.data])

  const groups = useMemo(() => {
    const m = new Map<string, { relation: Relation; dir: 'out' | 'in'; items: typeof rels }>()
    for (const r of rels) {
      const k = `${r.dir}:${r.relation}`
      if (!m.has(k)) m.set(k, { relation: r.relation, dir: r.dir, items: [] })
      m.get(k)!.items.push(r)
    }
    return [...m.values()].sort((a, b) => (a.dir === b.dir ? rank(a.relation) - rank(b.relation) || a.relation.localeCompare(b.relation) : a.dir === 'out' ? -1 : 1))
  }, [rels])

  const label = (id: string): { emoji: React.ReactNode; title: string } => {
    const n = nodes.get(id)
    if (!n) return { emoji: '❔', title: 'Missing card' }
    if (isForm(n)) return { emoji: <span className="fm-rel-dot" style={{ background: cardAccent(n, ctl.meta) ?? 'var(--text-faint)' }} />, title: cardTitle(n) }
    if (isGroup(n)) return { emoji: n.emoji ?? '▢', title: groupTitle(n) }
    if (isKanban(n)) return { emoji: '📋', title: n.title || 'Kanban' }
    return { emoji: '▫️', title: (n.text ?? n.label ?? n.file ?? n.url ?? n.type).toString().split('\n')[0].slice(0, 60) }
  }

  return (
    <div className="fm-rels">
      {!groups.length && !picking && <div className="fm-i-muted">No relations yet. Why does this card exist? Connect it.</div>}
      {groups.map((g) => {
        const def = relationDef(g.relation)
        return (
          <div key={`${g.dir}:${g.relation}`} className="fm-rel-group" style={{ '--fm-rel-color': def.color } as CssVars}>
            <div className="fm-rel-head">
              <span className="fm-rel-line" />
              {g.dir === 'out' ? def.label : inverse(g.relation)}
              <span className="fm-rel-count">{g.items.length}</span>
            </div>
            {g.items.map((r) => {
              const l = label(r.other)
              return (
                <div
                  key={r.edgeId}
                  className="fm-rel-item"
                  role="button"
                  tabIndex={0}
                  title="Click: reveal · Double-click: select"
                  onClick={() => ctl.reveal([r.other])}
                  onDoubleClick={() => ctl.setSelection([r.other])}
                  onKeyDown={(e) => e.key === 'Enter' && ctl.reveal([r.other])}
                  onContextMenu={(e) =>
                    showContextMenu(e, [
                      { label: 'Reveal in map', onClick: () => ctl.reveal([r.other]) },
                      { label: 'Select', onClick: () => ctl.setSelection([r.other]) },
                      { separator: true },
                      ...REL_ORDER.map((rel) => ({ label: RELATIONS[rel].label, checked: rel === g.relation, onClick: () => setRelation(ctl, r.edgeId, rel) })),
                      {
                        label: 'Custom…',
                        onClick: () =>
                          void promptText({ title: 'Custom relation', initial: RELATIONS[g.relation] ? '' : g.relation, okLabel: 'Set' }).then((v) => {
                            if (v?.trim()) setRelation(ctl, r.edgeId, v.trim())
                          })
                      },
                      { separator: true },
                      { label: 'Remove relation', danger: true, onClick: () => removeEdge(ctl, r.edgeId) }
                    ])
                  }
                >
                  <span className="fm-rel-emoji">{l.emoji}</span>
                  <span className="fm-rel-title">{l.title}</span>
                  <button
                    className="clickable-icon small fm-rel-remove"
                    title="Remove relation"
                    onClick={(e) => {
                      e.stopPropagation()
                      removeEdge(ctl, r.edgeId)
                    }}
                  >
                    <X />
                  </button>
                </div>
              )
            })}
          </div>
        )
      })}
      {picking ? (
        <RelationPicker ctl={ctl} card={card} onClose={() => setPicking(false)} />
      ) : (
        <button className="fm-i-addbtn" onClick={() => setPicking(true)}>
          <Plus size={13} /> Add relation
        </button>
      )}
    </div>
  )
}

function RelationPicker({ ctl, card, onClose }: { ctl: FormMapCtl; card: FormNode; onClose: () => void }) {
  const [q, setQ] = useState('')
  const [rel, setRel] = useState<Relation | null>(null)
  const [customRel, setCustomRel] = useState('')
  const [dir, setDir] = useState<'out' | 'in'>('out')
  const [idx, setIdx] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    inputRef.current?.focus({ preventScroll: true })
    inputRef.current?.closest('.fm-relpick')?.scrollIntoView({ block: 'nearest' })
  }, [])

  const results = useMemo(() => {
    const list = forms(ctl.data).filter((f) => f.id !== card.id)
    if (!q.trim()) return list.slice(0, 8)
    return list
      .map((f) => ({ f, m: fuzzyMatch(q, `${cardTitle(f)} ${(f.tags ?? []).join(' ')}`) }))
      .filter((x) => x.m)
      .sort((a, b) => b.m!.score - a.m!.score)
      .slice(0, 8)
      .map((x) => x.f)
  }, [ctl.data, q, card.id])
  const active = results[Math.min(idx, results.length - 1)]
  const relFor = (other: FormNode): Relation => (customRel.trim() || rel) ?? (dir === 'out' ? inferRelation(ctl.meta, card, other) : inferRelation(ctl.meta, other, card))

  const choose = (other: FormNode | undefined): void => {
    if (!other) return
    const r = relFor(other)
    if (dir === 'out') addRelation(ctl, card.id, other.id, r)
    else addRelation(ctl, other.id, card.id, r)
    onClose()
  }

  return (
    <div
      className="fm-relpick"
      onKeyDown={(e) => {
        if (e.key !== 'Escape') return
        e.stopPropagation()
        onClose()
      }}
    >
      <div className="fm-relpick-rels">
        <button className={`fm-relpick-rel${rel === null && !customRel.trim() ? ' is-active' : ''}`} onClick={() => (setRel(null), setCustomRel(''))} title="Pick the relation from the map's relation rules (tags)">
          Auto
        </button>
        {REL_ORDER.map((r) => (
          <button key={r} className={`fm-relpick-rel${rel === r && !customRel.trim() ? ' is-active' : ''}`} style={{ '--fm-rel-color': RELATIONS[r].color } as CssVars} onClick={() => (setRel(r), setCustomRel(''))} title={RELATIONS[r].hint}>
            {RELATIONS[r].label}
          </button>
        ))}
        <input className="fm-relpick-custom" value={customRel} placeholder="custom…" onChange={(e) => setCustomRel(e.target.value)} aria-label="Custom relation" />
      </div>
      <div className="fm-relpick-search">
        <button className="clickable-icon small" title={dir === 'out' ? 'This card → other (click to flip)' : 'Other → this card (click to flip)'} onClick={() => setDir(dir === 'out' ? 'in' : 'out')}>
          {dir === 'out' ? <ArrowRight /> : <ArrowLeft />}
        </button>
        <input
          ref={inputRef}
          className="input"
          value={q}
          placeholder="Find a card…"
          onChange={(e) => {
            setQ(e.target.value)
            setIdx(0)
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault()
              setIdx((i) => Math.min(i + 1, results.length - 1))
            } else if (e.key === 'ArrowUp') {
              e.preventDefault()
              setIdx((i) => Math.max(i - 1, 0))
            } else if (e.key === 'Enter') {
              e.preventDefault()
              choose(active)
            }
          }}
        />
      </div>
      <div className="fm-relpick-list" role="listbox">
        {results.map((f, i) => {
          const r = relFor(f)
          return (
            <div key={f.id} role="option" aria-selected={f === active} className={`fm-relpick-item${f === active ? ' is-active' : ''}`} onMouseEnter={() => setIdx(i)} onMouseDown={(e) => e.preventDefault()} onClick={() => choose(f)}>
              <span className="fm-rel-dot" style={{ background: cardAccent(f, ctl.meta) ?? 'var(--text-faint)' }} />
              <span className="fm-relpick-title">{cardTitle(f)}</span>
              <span className="fm-relpick-verb" style={{ color: relationDef(r).color }}>
                {dir === 'out' ? relationDef(r).label.toLowerCase() : inverse(r).toLowerCase()}
              </span>
            </div>
          )
        })}
        {!results.length && <div className="fm-i-muted">No matching cards.</div>}
      </div>
      <div className="fm-relpick-foot">
        <span>↑↓ Enter · Esc</span>
        <button className="btn" onClick={onClose}>
          Cancel
        </button>
      </div>
    </div>
  )
}
