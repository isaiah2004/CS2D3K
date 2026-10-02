// Progress HUD overlay for the map: MVP progress ring, open questions, decisions and votes. Collapsible.
import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import type { FormMapCtl } from '../context'
import { features, isOpenQuestion, mapStats, mvpStats } from '../analysis'
import { forms } from '../schema'
import './fun.css'

const KEY = 'cs2d3k.formmap.hudCollapsed'

export default function Hud({ ctl }: { ctl: FormMapCtl }) {
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem(KEY) === '1')
  const mvp = useMemo(() => mvpStats(ctl.data), [ctl.data])
  const stats = useMemo(() => mapStats(ctl.data), [ctl.data])
  const pct = mvp.total ? mvp.done / mvp.total : 0
  const complete = mvp.total > 0 && mvp.done === mvp.total

  // little bump whenever progress grows
  const [bump, setBump] = useState(false)
  const prevDone = useRef(mvp.done)
  useEffect(() => {
    if (mvp.done > prevDone.current) {
      setBump(true)
      const t = setTimeout(() => setBump(false), 600)
      prevDone.current = mvp.done
      return () => clearTimeout(t)
    }
    prevDone.current = mvp.done
  }, [mvp.done])

  const toggle = (): void => {
    setCollapsed(!collapsed)
    localStorage.setItem(KEY, collapsed ? '0' : '1')
  }
  const show = (ids: string[]): void => ctl.setHighlight(ids.length ? ids : null)
  const mvpIds = (): string[] => features(ctl.data, 'mvp').filter((f) => f.fields.status !== 'cut').map((f) => f.id)
  const openIds = (): string[] => forms(ctl.data).filter(isOpenQuestion).map((f) => f.id)
  const decidedIds = (): string[] =>
    forms(ctl.data)
      .filter((f) => (f.kind === 'question' && f.fields.status === 'decided') || (f.kind === 'approach' && f.fields.status === 'accepted'))
      .map((f) => f.id)
  const votedIds = (): string[] =>
    forms(ctl.data)
      .filter((f) => f.votes)
      .map((f) => f.id)

  const R = 15
  const C = 2 * Math.PI * R

  return (
    <div className={`fm-hud${collapsed ? ' is-collapsed' : ''}${complete ? ' is-complete' : ''}`} onPointerDown={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
      <button className={`fm-hud-ring${bump ? ' is-bump' : ''}`} title={`MVP progress: ${mvp.done} of ${mvp.total} features done — click to highlight`} onClick={() => show(mvpIds())}>
        <svg width="40" height="40" viewBox="0 0 40 40" aria-hidden>
          <circle className="fm-hud-ring-track" cx="20" cy="20" r={R} />
          <circle className="fm-hud-ring-fill" cx="20" cy="20" r={R} strokeDasharray={C} strokeDashoffset={C * (1 - pct)} />
        </svg>
        <span className="fm-hud-ring-label">{complete ? '🎉' : `${Math.round(pct * 100)}%`}</span>
      </button>
      {!collapsed && (
        <div className="fm-hud-stats">
          <div className="fm-hud-title">
            MVP <b>{mvp.done}</b>/{mvp.total} done
          </div>
          <div className="fm-hud-row">
            <button className="fm-hud-stat" title="Open questions — click to highlight" onClick={() => show(openIds())}>
              <span>❓</span>
              <b>{stats.openQuestions}</b>
              <span className="fm-hud-cap">open</span>
            </button>
            <button className="fm-hud-stat" title="Decisions: accepted approaches + decided questions" onClick={() => show(decidedIds())}>
              <span>✅</span>
              <b>{stats.decisions}</b>
              <span className="fm-hud-cap">decided</span>
            </button>
            <button className="fm-hud-stat" title="Total dot votes" onClick={() => show(votedIds())}>
              <span>🗳️</span>
              <b>{stats.votes}</b>
              <span className="fm-hud-cap">votes</span>
            </button>
          </div>
        </div>
      )}
      <button className="fm-hud-toggle" onClick={toggle} title={collapsed ? 'Expand' : 'Collapse'} aria-label={collapsed ? 'Expand HUD' : 'Collapse HUD'}>
        {collapsed ? <ChevronRight size={13} /> : <ChevronLeft size={13} />}
      </button>
    </div>
  )
}
