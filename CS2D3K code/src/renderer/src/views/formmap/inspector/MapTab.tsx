// Inspector "Map" tab: map metadata, Spark, zone navigator and the focus filter.
import { useMemo, useState } from 'react'
import { Sparkles, Presentation } from 'lucide-react'
import type { FormMapCtl } from '../context'
import { forms, KIND_ORDER, KINDS, PHASES, zoneAt, zones, type FormKind, type FormMapData } from '../schema'
import { addCard, setMeta, zonesInOrder } from '../lenses/ops'
import { KindChip, OptionChip } from '../lenses/widgets'
import { randomSpark } from '../fun/spark'
import { Row } from './fields'
import { dirname, join, stem } from '@/lib/path'

export default function MapTab({ ctl }: { ctl: FormMapCtl }) {
  const meta = (ctl.data as FormMapData).formmap
  const ordered = useMemo(() => zonesInOrder(ctl.data), [ctl.data])
  const counts = useMemo(() => {
    const m = new Map<string, number>()
    for (const f of forms(ctl.data)) {
      const z = zoneAt(ctl.data, f)
      if (z) m.set(z.id, (m.get(z.id) ?? 0) + 1)
    }
    return m
  }, [ctl.data])
  const [spark, setSpark] = useState<{ text: string; n: number } | null>(null)

  const doSpark = (): void => {
    const text = randomSpark()
    const inbox = zones(ctl.data).find((z) => z.defaultKind === 'idea') ?? zones(ctl.data).find((z) => /inbox/i.test(z.label))
    const id = addCard(ctl, 'idea', { title: text, fields: { status: 'raw', source: 'Spark ✨' }, zoneId: inbox?.id ?? null })
    setSpark({ text, n: (spark?.n ?? 0) + 1 })
    ctl.setHighlight(null)
    ctl.setSelection([id])
    // let the new card render in the map before flying to it
    setTimeout(() => ctl.reveal([id], { select: true }), 60)
  }

  const filter = ctl.focusFilter
  const toggleKind = (k: FormKind): void => {
    const cur = filter?.kinds ?? []
    const kinds = cur.includes(k) ? cur.filter((x) => x !== k) : [...cur, k]
    const next = { ...filter, kinds: kinds.length ? kinds : undefined }
    ctl.setFocusFilter(next.kinds || next.phase ? next : null)
  }
  const togglePhase = (p: string): void => {
    const next = { ...filter, phase: filter?.phase === p ? undefined : p }
    ctl.setFocusFilter(next.kinds?.length || next.phase ? next : null)
  }

  return (
    <div className="fm-maptab">
      <div className="fm-i-section">
        <Row label="Title">
          <input className="input" value={meta?.title ?? ''} placeholder={stem(ctl.path)} onChange={(e) => setMeta(ctl, { title: e.target.value || undefined }, 'title')} />
        </Row>
        <Row label="Export to" help="Markdown note the Doc lens exports the Project Definition to">
          <input
            className="input"
            value={meta?.exportPath ?? ''}
            placeholder={join(dirname(ctl.path), `${stem(ctl.path)} - Definition.md`)}
            onChange={(e) => setMeta(ctl, { exportPath: e.target.value || undefined }, 'export')}
          />
        </Row>
      </div>

      <div className="fm-spark">
        <button className="fm-spark-btn" onClick={doSpark} title="Add a provocative prompt to the idea inbox">
          <Sparkles size={16} />
          Spark
        </button>
        <div className="fm-spark-text" key={spark?.n ?? 0}>
          {spark ? `“${spark.text}”` : 'Stuck? Get a provocative prompt as a new idea card.'}
        </div>
      </div>

      <div className="fm-i-section">
        <div className="fm-i-section-head">
          <span>Zones</span>
          <button className="clickable-icon small" title="Pitch mode" onClick={() => ctl.present()}>
            <Presentation />
          </button>
        </div>
        {!ordered.length && <div className="fm-i-muted">No zones on this map.</div>}
        <div className="fm-znav">
          {ordered.map((z) => (
            <button key={z.id} className={`fm-znav-item${ctl.selection.includes(z.id) ? ' is-active' : ''}`} onClick={() => ctl.reveal([z.id])} onDoubleClick={() => ctl.setSelection([z.id])} title={z.prompt ?? 'Reveal zone (double-click to edit)'}>
              <span className="fm-znav-order">{z.order ?? '·'}</span>
              <span className="fm-znav-emoji">{z.emoji ?? '▢'}</span>
              <span className="fm-znav-label">{z.label}</span>
              <span className="fm-znav-count">{counts.get(z.id) ?? 0}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="fm-i-section">
        <div className="fm-i-section-head">
          <span>Focus</span>
          {filter && (
            <button className="fm-i-textbtn" onClick={() => ctl.setFocusFilter(null)}>
              Clear
            </button>
          )}
        </div>
        <div className="fm-i-muted fm-i-tip">Dim everything except…</div>
        <div className="fm-i-chips">
          {KIND_ORDER.map((k) => (
            <KindChip key={k} kind={k} active={!!filter?.kinds?.includes(k)} onClick={() => toggleKind(k)} title={`Focus on ${KINDS[k].plural.toLowerCase()}`} />
          ))}
        </div>
        <div className="fm-i-chips" style={{ marginTop: 8 }}>
          {PHASES.map((p) => (
            <OptionChip key={p.value} option={p} active={filter?.phase === p.value} onClick={() => togglePhase(p.value)} title="Features in this phase" />
          ))}
        </div>
      </div>
    </div>
  )
}
