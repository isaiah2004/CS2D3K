// Bottom panel: tab strip of terminals + the Output log.
import { useRef, useState } from 'react'
import { ChevronDown, Eraser, ScrollText, Maximize2, Minimize2, Plus, SquareTerminal, Trash2, X } from 'lucide-react'
import { useWorkspace, type BottomTab } from '@/store/workspace'
import { promptText, showContextMenu, useUi, type MenuItem } from '@/store/ui'
import { hotkeysFor, formatHotkey } from '@/store/commands'
import TerminalView from './terminal/TerminalView'
import OutputView from './terminal/OutputView'
import { clearOutput } from './terminal/output'
import { getTerminal, killTerminalTab, newTerminal } from './terminal/registry'
import './terminal/bottomPanel.css'

interface ShellChoice {
  label: string
  shell: string
}

function shellChoices(): ShellChoice[] {
  if (window.api.platform === 'win32') {
    return [
      { label: 'PowerShell', shell: 'powershell.exe' },
      { label: 'PowerShell 7', shell: 'pwsh.exe' },
      { label: 'Command Prompt', shell: 'cmd.exe' },
      { label: 'Git Bash', shell: 'C:\\Program Files\\Git\\bin\\bash.exe' },
      { label: 'WSL', shell: 'wsl.exe' }
    ]
  }
  return [
    { label: 'bash', shell: '/bin/bash' },
    { label: 'zsh', shell: '/bin/zsh' },
    { label: 'sh', shell: '/bin/sh' }
  ]
}

function hint(id: string): string {
  const h = hotkeysFor(id)[0]
  return h ? ` (${formatHotkey(h)})` : ''
}

async function renameTab(t: BottomTab): Promise<void> {
  const title = await promptText({ title: 'Rename tab', initial: t.title, okLabel: 'Rename', validate: (v) => (v.trim() ? null : 'Name cannot be empty') })
  if (title?.trim()) useWorkspace.getState().renameBottomTab(t.id, title.trim())
}

export default function BottomPanel() {
  const bottom = useWorkspace((s) => s.bottom)
  const ws = useWorkspace.getState()
  const active = bottom.tabs.find((t) => t.id === bottom.active) ?? bottom.tabs[0]
  // maximize: remember the height to restore and the height we applied
  const [maxed, setMaxed] = useState<{ restore: number; applied: number } | null>(null)
  const isMax = !!maxed && maxed.applied === bottom.height
  const newBtnRef = useRef<HTMLButtonElement>(null)

  const toggleMax = (): void => {
    if (isMax) {
      ws.setBottomHeight(maxed!.restore)
      setMaxed(null)
      return
    }
    const restore = bottom.height
    ws.setBottomHeight(Math.round(window.innerHeight * 0.7))
    setMaxed({ restore, applied: useWorkspace.getState().bottom.height })
  }

  const clearActive = (): void => {
    if (!active) return
    if (active.kind === 'output') clearOutput()
    else getTerminal(active.id)?.clear()
  }

  const shellMenu = (): void => {
    const r = newBtnRef.current?.getBoundingClientRect()
    const items: MenuItem[] = [
      { label: 'Default shell', icon: <SquareTerminal />, onClick: () => newTerminal() },
      { separator: true },
      ...shellChoices().map((c) => ({ label: c.label, onClick: () => newTerminal(c.shell, c.label) }))
    ]
    useUi.getState().showMenu({ x: r ? r.left : 0, y: r ? r.bottom + 2 : 0 }, items)
  }

  const tabMenu = (e: React.MouseEvent, t: BottomTab): void => {
    showContextMenu(e, [
      { label: 'Rename…', onClick: () => void renameTab(t) },
      ...(t.kind === 'terminal' ? [{ label: 'Clear', onClick: () => getTerminal(t.id)?.clear() }] : [{ label: 'Clear output', onClick: clearOutput }]),
      { separator: true },
      { label: t.kind === 'terminal' ? 'Kill terminal' : 'Close', danger: t.kind === 'terminal', onClick: () => ws.closeBottomTab(t.id) }
    ])
  }

  return (
    <div className="bottom-panel-inner">
      <div className="bottom-panel-header" onDoubleClick={(e) => e.target === e.currentTarget && toggleMax()}>
        <div className="bottom-tabs">
          {bottom.tabs.map((t) => (
            <div
              key={t.id}
              className={`bottom-tab${t.id === active?.id ? ' is-active' : ''}`}
              title={t.title}
              onMouseDown={(e) => {
                if (e.button === 0) ws.setBottomActive(t.id)
              }}
              onAuxClick={(e) => {
                if (e.button === 1) ws.closeBottomTab(t.id)
              }}
              onDoubleClick={() => void renameTab(t)}
              onContextMenu={(e) => tabMenu(e, t)}
            >
              {t.kind === 'terminal' ? <SquareTerminal className="bottom-tab-icon" /> : <ScrollText className="bottom-tab-icon" />}
              <span className="bottom-tab-title">{t.title}</span>
              <button
                className="clickable-icon bottom-tab-close"
                title={t.kind === 'terminal' ? 'Kill terminal' : 'Close'}
                onMouseDown={(e) => e.stopPropagation()}
                onClick={() => ws.closeBottomTab(t.id)}
              >
                <X />
              </button>
            </div>
          ))}
          <div className="bottom-new">
            <button className="clickable-icon small" title={`New terminal${hint('terminal:new')}`} onClick={() => newTerminal()}>
              <Plus />
            </button>
            <button className="clickable-icon small bottom-new-menu" title="New terminal with shell…" ref={newBtnRef} onClick={shellMenu}>
              <ChevronDown />
            </button>
          </div>
        </div>
        <div className="bottom-panel-actions">
          <button className="clickable-icon small" title={active?.kind === 'output' ? 'Clear output' : 'Clear terminal'} onClick={clearActive} disabled={!active}>
            <Eraser />
          </button>
          {active?.kind === 'terminal' && (
            <button className="clickable-icon small" title="Kill terminal" onClick={() => killTerminalTab(active.id)}>
              <Trash2 />
            </button>
          )}
          <button className="clickable-icon small" title={isMax ? 'Restore panel size' : 'Maximize panel'} onClick={toggleMax}>
            {isMax ? <Minimize2 /> : <Maximize2 />}
          </button>
          <button className="clickable-icon small" title={`Hide panel${hint('terminal:toggle')}`} onClick={() => ws.toggleBottom(false)}>
            <X />
          </button>
        </div>
      </div>
      <div className="bottom-panel-body">
        {bottom.tabs.map((t) => (
          <div key={t.id} className="bottom-panel-pane" style={{ display: t.id === active?.id ? 'flex' : 'none' }}>
            {t.kind === 'terminal' ? <TerminalView tabId={t.id} visible={bottom.open && t.id === active?.id} /> : <OutputView />}
          </div>
        ))}
      </div>
    </div>
  )
}
