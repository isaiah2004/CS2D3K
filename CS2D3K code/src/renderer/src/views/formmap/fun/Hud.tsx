// Progress HUD overlay for the map: a progress ring for a chosen board's last column (or the checklists), and map
// stats (cards, groups, boards, checklist items done, votes). Collapsible.
import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react'
import type { FormMapCtl } from '../context'
import { checklistCards, mapStats } from '../analysis'
import { boardProgress } from '../boards'
import { forms } from '../schema'
import { setMeta } from '../lenses/ops'
import { showContextMenu } from '@/store/ui'
import './fun.css'

const KEY = 'cs2d3k.formmap.hudCollapsed'

export default function Hud({ ctl }: { ctl: FormMapCtl }) {
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem(KEY) === '1')
  const stats = useMemo(() => mapStats(ctl.data), [ctl.data])
  const boards = ctl.meta.boards ?? []
  const board = boards.find((b) => b.id === ctl.meta.hudBoard) ?? boards[0]
  const prog = useMemo(() => (board ? boardProgress(ctl.data, board) : null), [ctl.data, board])
  const ring = prog ? { done: prog.done, total: prog.total } : stats.checklist.total ? stats.checklist : null
  const pct = ring?.total ? ring.done / ring.total : 0
  const complete = !!ring && ring.total > 0 && ring.done === ring.total

  // little bump whenever progress grows
  const [bump, setBump] = useState(false)
  const prevDone = useRef(ring?.done ?? 0)
  useEffect(() => {
    const done = ring?.done ?? 0
    if (done > prevDone.current) {
      setBump(true)
      const t = setTimeout(() => setBump(false), 600)
      prevDone.current = done
      return () => clearTimeout(t)
    }
    prevDone.current = done
  }, [ring?.done])

  const toggle = (): void => {
    setCollapsed(!collapsed)
    localStorage.setItem(KEY, collapsed ? '0' : '1')
  }
  const show = (ids: string[]): void => ctl.setHighlight(ids.length ? ids : null)
  const ringIds = (): string[] => (prog?.column ? prog.column.cards.map((c) => c.id) : checklistCards(ctl.data))
  const chooseBoard = (e: React.MouseEvent): void =>
    showContextMenu(e, [
      ...boards.map((b) => ({ label: b.name, checked: b.id === board?.id, onClick: () => setMeta(ctl, { hudBoard: b.id }) })),
      ...(boards.length ? [{ separator: true }] : []),
      { label: 'Open the Board lens', onClick: () => (board ? ctl.openBoard(board.id) : ctl.setLens('board')) }
    ])

  const R = 15
  const C = 2 * Math.PI * R
  const title = prog && board ? board.name : ring ? 'Checklists' : 'This map'

  return (
    <div className={`fm-hud${collapsed ? ' is-collapsed' : ''}${complete ? ' is-complete' : ''}`} onPointerDown={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
      <button
        className={`fm-hud-ring${bump ? ' is-bump' : ''}`}
        title={ring ? `${title}: ${ring.done} of ${ring.total} done — click to highlight` : 'No board yet — create one in the Board lens'}
        onClick={() => (ring ? show(ringIds()) : ctl.setLens('board'))}
      >
        <svg width="40" height="40" viewBox="0 0 40 40" aria-hidden>
          <circle className="fm-hud-ring-track" cx="20" cy="20" r={R} />
          <circle className="fm-hud-ring-fill" cx="20" cy="20" r={R} strokeDasharray={C} strokeDashoffset={C * (1 - pct)} />
        </svg>
        <span className="fm-hud-ring-label">{complete ? '🎉' : ring ? `${Math.round(pct * 100)}%` : '—'}</span>
      </button>
      {!collapsed && (
        <div className="fm-hud-stats">
          <button className="fm-hud-title" title={boards.length ? 'Choose the board the ring follows' : 'Boards'} onClick={chooseBoard}>
            <span className="fm-hud-title-name">{title}</span>
            {ring && (
              <span className="fm-hud-title-num">
                <b>{ring.done}</b>/{ring.total} done
              </span>
            )}
            <ChevronDown size={12} />
          </button>
          <div className="fm-hud-row">
            <button className="fm-hud-stat" title="Cards on the map" onClick={() => show(forms(ctl.data).map((f) => f.id))}>
              <span>🃏</span>
              <b>{stats.cards}</b>
              <span className="fm-hud-cap">cards</span>
            </button>
            <button className="fm-hud-stat" title="Groups" onClick={() => ctl.setInspectorOpen(true)}>
              <span>🗂️</span>
              <b>{stats.groups}</b>
              <span className="fm-hud-cap">groups</span>
            </button>
            <button className="fm-hud-stat" title="Saved boards + kanban nodes — click to open the Board lens" onClick={() => (board ? ctl.openBoard(board.id) : ctl.setLens('board'))}>
              <span>📋</span>
              <b>{stats.boards + stats.kanbans}</b>
              <span className="fm-hud-cap">boards</span>
            </button>
            <button className="fm-hud-stat" title="Checklist items done — click to highlight cards with checklists" onClick={() => show(checklistCards(ctl.data))}>
              <span>☑️</span>
              <b>
                {stats.checklist.done}
                {stats.checklist.total ? `/${stats.checklist.total}` : ''}
              </b>
              <span className="fm-hud-cap">checked</span>
            </button>
            <button
              className="fm-hud-stat"
              title="Total dot votes — click to highlight voted cards"
              onClick={() =>
                show(
                  forms(ctl.data)
                    .filter((f) => f.votes)
                    .map((f) => f.id)
                )
              }
            >
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
