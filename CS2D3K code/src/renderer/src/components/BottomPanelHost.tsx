import { lazy, Suspense } from 'react'
import { useWorkspace } from '@/store/workspace'
import { startDrag } from './Sidebar'

const BottomPanel = lazy(() => import('./BottomPanel'))

/** Resizable container for the bottom panel (terminals, run output). */
export default function BottomPanelHost() {
  const bottom = useWorkspace((s) => s.bottom)
  // keep mounted once any tab exists so terminals survive hiding the panel
  if (bottom.tabs.length === 0) return null
  return (
    <div className="bottom-panel" style={{ height: bottom.height, display: bottom.open ? 'flex' : 'none' }}>
      <div
        className="bottom-panel-resize"
        onMouseDown={(e) => {
          const h0 = bottom.height
          startDrag(e, (_dx, dy) => useWorkspace.getState().setBottomHeight(h0 - dy), undefined, 'row-resize')
        }}
      />
      <Suspense fallback={null}>
        <BottomPanel />
      </Suspense>
    </div>
  )
}
