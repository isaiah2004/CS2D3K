import { Suspense, useRef, useState } from 'react'
import { useWorkspace, type Side, type SidebarState, type PaneId, type SidebarGroup } from '@/store/workspace'
import { useSettings } from '@/store/settings'
import { showContextMenu } from '@/store/ui'
import { PANES } from '@/panes/registry'
import ErrorBoundary from './ErrorBoundary'
import { ArrowLeftRight, SplitSquareVertical, X } from 'lucide-react'

const PANE_MIME = 'application/x-cs2d3k-pane'

function startDrag(e: React.MouseEvent, onMove: (dx: number, dy: number) => void, onEnd?: () => void, cursor = 'col-resize'): void {
  e.preventDefault()
  const sx = e.clientX
  const sy = e.clientY
  const target = e.currentTarget as HTMLElement
  target.classList.add('dragging')
  document.body.style.cursor = cursor
  const move = (ev: MouseEvent): void => onMove(ev.clientX - sx, ev.clientY - sy)
  const up = (): void => {
    target.classList.remove('dragging')
    document.body.style.cursor = ''
    window.removeEventListener('mousemove', move)
    window.removeEventListener('mouseup', up)
    onEnd?.()
  }
  window.addEventListener('mousemove', move)
  window.addEventListener('mouseup', up)
}
export { startDrag }

function Group({ side, group, enabled }: { side: Side; group: SidebarGroup; enabled: Record<string, boolean> }) {
  const ws = useWorkspace.getState()
  const [dropIdx, setDropIdx] = useState<number | null>(null)
  const panes = group.panes.filter((p) => enabled[p] !== false)
  const active = panes.includes(group.active) ? group.active : panes[0]
  const Pane = active ? PANES[active].component : null

  const onDrop = (e: React.DragEvent, index?: number): void => {
    const pane = e.dataTransfer.getData(PANE_MIME) as PaneId
    setDropIdx(null)
    if (!pane) return
    e.preventDefault()
    ws.movePane(pane, side, group.id, index)
  }

  return (
    <>
      <div
        className={`sidebar-tabs${dropIdx !== null ? ' drop-target' : ''}`}
        onDragOver={(e) => {
          if (e.dataTransfer.types.includes(PANE_MIME)) {
            e.preventDefault()
            if (dropIdx === null) setDropIdx(panes.length)
          }
        }}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node)) setDropIdx(null)
        }}
        onDrop={(e) => onDrop(e, dropIdx ?? undefined)}
      >
        {panes.map((p, i) => {
          const def = PANES[p]
          const Icon = def.icon
          return (
            <button
              key={p}
              draggable
              className={`sidebar-tab${p === active ? ' is-active' : ''}${dropIdx === i ? ' drop-before' : ''}`}
              title={def.title}
              aria-label={def.title}
              onClick={() => ws.setGroupActive(side, group.id, p)}
              onDragStart={(e) => {
                e.dataTransfer.setData(PANE_MIME, p)
                e.dataTransfer.effectAllowed = 'move'
              }}
              onDragOver={(e) => {
                if (e.dataTransfer.types.includes(PANE_MIME)) {
                  e.preventDefault()
                  e.stopPropagation()
                  setDropIdx(i)
                }
              }}
              onDrop={(e) => {
                e.stopPropagation()
                onDrop(e, i)
              }}
              onContextMenu={(e) =>
                showContextMenu(e, [
                  { label: `Move to ${side === 'left' ? 'right' : 'left'} sidebar`, icon: <ArrowLeftRight />, onClick: () => ws.movePane(p, side === 'left' ? 'right' : 'left') },
                  { label: 'Split down', icon: <SplitSquareVertical />, disabled: group.panes.length < 2, onClick: () => ws.movePane(p, side, 'new') },
                  { separator: true },
                  { label: 'Hide pane', icon: <X />, onClick: () => useSettings.getState().set('corePanes', { ...enabled, [p]: false }) }
                ])
              }
            >
              <Icon size={17} />
            </button>
          )
        })}
      </div>
      <div className="sidebar-pane">
        {Pane && (
          <ErrorBoundary key={active} label="this pane">
            <Suspense fallback={<div className="empty-state">Loading…</div>}>
              <Pane key={active} />
            </Suspense>
          </ErrorBoundary>
        )}
      </div>
    </>
  )
}

export default function Sidebar({ side, state }: { side: Side; state: SidebarState }) {
  const ref = useRef<HTMLDivElement>(null)
  const enabled = useSettings((s) => s.settings.corePanes)
  const groups = state.groups.filter((g) => g.panes.some((p) => enabled[p] !== false))
  const total = groups.reduce((a, g) => a + g.size, 0) || 1

  const resizeGroups = (i: number, e: React.MouseEvent): void => {
    const el = ref.current
    if (!el) return
    const h = el.getBoundingClientRect().height
    const sizes0 = groups.map((g) => g.size)
    startDrag(
      e,
      (_dx, dy) => {
        const delta = (dy / h) * total
        const a = Math.max(0.15, sizes0[i] + delta)
        const b = Math.max(0.15, sizes0[i + 1] - delta)
        if (a <= 0.15 || b <= 0.15) return
        const sizes = [...sizes0]
        sizes[i] = a
        sizes[i + 1] = b
        // map back to full group list
        const full = state.groups.map((g) => {
          const k = groups.findIndex((x) => x.id === g.id)
          return k >= 0 ? sizes[k] : g.size
        })
        useWorkspace.getState().setGroupSizes(side, full)
      },
      undefined,
      'row-resize'
    )
  }

  return (
    <div ref={ref} className={`sidebar ${side}${state.open ? '' : ' collapsed'}`} style={{ width: state.width }}>
      {groups.map((g, i) => (
        <div key={g.id} style={{ display: 'contents' }}>
          {i > 0 && <div className="group-resize" onMouseDown={(e) => resizeGroups(i - 1, e)} />}
          <div className="sidebar-group" style={{ flex: `${g.size} 1 0` }}>
            <Group side={side} group={g} enabled={enabled} />
          </div>
        </div>
      ))}
      <div
        className="resize-handle"
        onMouseDown={(e) => {
          const w0 = state.width
          startDrag(e, (dx) => useWorkspace.getState().setSidebarWidth(side, side === 'left' ? w0 + dx : w0 - dx))
        }}
        onDoubleClick={() => useWorkspace.getState().setSidebarWidth(side, side === 'left' ? 280 : 300)}
      />
    </div>
  )
}
