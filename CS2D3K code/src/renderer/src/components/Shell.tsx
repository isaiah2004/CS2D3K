import { useEffect } from 'react'
import { PanelLeft, PanelRight, ChevronLeft, ChevronRight } from 'lucide-react'
import { useWorkspace } from '@/store/workspace'
import { useVault } from '@/store/vault'
import { handleHotkey } from '@/store/commands'
import { registerCoreCommands } from '@/lib/coreCommands'
import { preloadPanes } from '@/panes/registry'
import { preloadViews } from '@/views/registry'
import Ribbon from './Ribbon'
import Sidebar from './Sidebar'
import LayoutView from './Layout'
import StatusBar from './StatusBar'
import BottomPanelHost from './BottomPanelHost'
import './terminal'

export default function Shell() {
  const left = useWorkspace((s) => s.left)
  const right = useWorkspace((s) => s.right)
  const vaultName = useVault((s) => s.info?.name)

  useEffect(() => registerCoreCommands(), [])
  useEffect(() => {
    const t = setTimeout(() => {
      preloadPanes()
      preloadViews()
    }, 1200)
    return () => clearTimeout(t)
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      handleHotkey(e)
    }
    // capture so we beat CodeMirror/Monaco default bindings for app-level hotkeys
    window.addEventListener('keydown', onKey, true)
    const onMouse = (e: MouseEvent): void => {
      if (e.button === 3) useWorkspace.getState().goBack()
      if (e.button === 4) useWorkspace.getState().goForward()
    }
    window.addEventListener('mouseup', onMouse)
    return () => {
      window.removeEventListener('keydown', onKey, true)
      window.removeEventListener('mouseup', onMouse)
    }
  }, [])

  const ws = useWorkspace.getState()
  return (
    <div className="app">
      <div className="titlebar">
        <div className="titlebar-left">
          <button className="clickable-icon small" title="Toggle left sidebar (Ctrl+Shift+L)" onClick={() => ws.toggleSidebar('left')}>
            <PanelLeft />
          </button>
        </div>
        <div className="no-drag" style={{ display: 'flex', gap: 2, paddingLeft: 4 }}>
          <button className="clickable-icon small" title="Navigate back" onClick={() => useWorkspace.getState().goBack()}>
            <ChevronLeft />
          </button>
          <button className="clickable-icon small" title="Navigate forward" onClick={() => useWorkspace.getState().goForward()}>
            <ChevronRight />
          </button>
        </div>
        <div className="titlebar-title">{vaultName} — CS2D3K</div>
        <button className="clickable-icon small" style={{ marginRight: 6 }} title="Toggle right sidebar (Ctrl+Shift+R)" onClick={() => ws.toggleSidebar('right')}>
          <PanelRight />
        </button>
      </div>
      <div className="app-body">
        <Ribbon />
        <Sidebar side="left" state={left} />
        <div className="app-center">
          <div className="app-main">
            <LayoutView />
          </div>
          <BottomPanelHost />
        </div>
        <Sidebar side="right" state={right} />
      </div>
      <StatusBar />
    </div>
  )
}
