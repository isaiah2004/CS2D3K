// Form-map inspector: right panel with Card / Coach / Map tabs.
import { useEffect, useMemo, useRef, useState } from 'react'
import { X } from 'lucide-react'
import type { LensProps } from '../context'
import { coachChecks } from '../analysis'
import { useWorkspace } from '@/store/workspace'
import CardTab from './CardTab'
import CoachTab from './CoachTab'
import MapTab from './MapTab'
import '../lenses/lenses.css'
import './inspector.css'
import './editors.css'

type TabId = 'card' | 'coach' | 'map'
const TABS: { id: TabId; label: string }[] = [
  { id: 'card', label: 'Card' },
  { id: 'coach', label: 'Coach' },
  { id: 'map', label: 'Map' }
]

export default function Inspector({ ctl }: LensProps) {
  const saved = ctl.tab.state?.inspectorTab
  const [tab, setTabState] = useState<TabId>(TABS.some((t) => t.id === saved) ? (saved as TabId) : 'card')
  const setTab = (t: TabId): void => {
    setTabState(t)
    useWorkspace.getState().updateTabState(ctl.tab.id, { inspectorTab: t })
  }
  // a new selection starts at the top of the card editor
  const bodyRef = useRef<HTMLDivElement>(null)
  const selKey = ctl.selection.join(',')
  useEffect(() => {
    if (tab === 'card') bodyRef.current?.scrollTo({ top: 0 })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selKey])
  const warns = useMemo(() => coachChecks(ctl.data).filter((c) => c.level === 'warn').length, [ctl.data])

  const onTabKey = (e: React.KeyboardEvent): void => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
    const i = TABS.findIndex((t) => t.id === tab)
    const next = TABS[(i + (e.key === 'ArrowRight' ? 1 : TABS.length - 1)) % TABS.length]
    setTab(next.id)
    ;(e.currentTarget.querySelector(`[data-tab="${next.id}"]`) as HTMLElement | null)?.focus()
  }

  return (
    <div className="fm-insp">
      <div className="fm-insp-tabs" role="tablist" aria-label="Inspector" onKeyDown={onTabKey}>
        {TABS.map((t) => (
          <button key={t.id} data-tab={t.id} role="tab" aria-selected={tab === t.id} tabIndex={tab === t.id ? 0 : -1} className={`fm-insp-tab${tab === t.id ? ' is-active' : ''}`} onClick={() => setTab(t.id)}>
            {t.label}
            {t.id === 'card' && ctl.selection.length > 0 && <span className="fm-insp-badge is-sel">{ctl.selection.length}</span>}
            {t.id === 'coach' && warns > 0 && <span className="fm-insp-badge is-warn">{warns}</span>}
          </button>
        ))}
      </div>
      {ctl.highlight && (
        <div className="fm-insp-hl">
          <span className="fm-insp-hl-dot" />
          Highlighting {ctl.highlight.filter((id) => ctl.data.nodes.some((n) => n.id === id)).length} cards
          <span className="fm-toolbar-spacer" />
          <button className="clickable-icon small" title="Clear highlight" onClick={() => ctl.setHighlight(null)}>
            <X />
          </button>
        </div>
      )}
      <div className="fm-insp-body" role="tabpanel" ref={bodyRef}>
        {tab === 'card' ? <CardTab ctl={ctl} /> : tab === 'coach' ? <CoachTab ctl={ctl} /> : <MapTab ctl={ctl} />}
      </div>
    </div>
  )
}
