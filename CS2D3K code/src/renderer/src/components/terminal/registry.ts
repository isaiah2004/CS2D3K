// Terminal instances (one per bottom-panel terminal tab), pty event routing and terminal commands.
import { useWorkspace } from '@/store/workspace'
import { registerCommands } from '@/store/commands'

export interface TerminalHandle {
  clear(): void
  focus(): void
  /** the pty exited */
  exited(): boolean
}

const handles = new Map<string, TerminalHandle>()
let lastFocused: string | null = null

export function registerTerminal(tabId: string, h: TerminalHandle): () => void {
  handles.set(tabId, h)
  return () => {
    if (handles.get(tabId) === h) handles.delete(tabId)
    if (lastFocused === tabId) lastFocused = null
  }
}

export function markFocused(tabId: string): void {
  lastFocused = tabId
}

/** The terminal of the active bottom tab, else the last focused one. */
export function activeTerminalId(): string | null {
  const b = useWorkspace.getState().bottom
  const active = b.tabs.find((t) => t.id === b.active)
  if (active?.kind === 'terminal') return active.id
  if (lastFocused && b.tabs.some((t) => t.id === lastFocused)) return lastFocused
  return [...b.tabs].reverse().find((t) => t.kind === 'terminal')?.id ?? null
}

export function getTerminal(tabId: string): TerminalHandle | undefined {
  return handles.get(tabId)
}

/** Closing the tab unmounts the terminal, which kills its pty. */
export function killTerminalTab(tabId: string): void {
  useWorkspace.getState().closeBottomTab(tabId)
}

// ------------------------------------------------------------- per-tab shell choice

const shells = new Map<string, string>()

/** Open a new terminal tab running `shell` (empty = settings / platform default). */
export function newTerminal(shell?: string, title?: string): string {
  const id = useWorkspace.getState().addBottomTab('terminal', title)
  if (shell) shells.set(id, shell)
  return id
}

export function takeShell(tabId: string): string | undefined {
  const s = shells.get(tabId)
  shells.delete(tabId)
  return s
}

// ------------------------------------------------------------- pty event routing
// One IPC subscription for all terminals; output that arrives before a terminal claimed its id
// (right after `term.create`) is buffered.

type DataFn = (data: string) => void
type ExitFn = (code: number) => void
const dataHandlers = new Map<string, DataFn>()
const exitHandlers = new Map<string, ExitFn>()
const pendingData = new Map<string, string[]>()
const pendingExit = new Map<string, number>()
let routing = false

function ensureRouting(): void {
  if (routing) return
  routing = true
  window.api.term.onData((id, data) => {
    const h = dataHandlers.get(id)
    if (h) h(data)
    else {
      const buf = pendingData.get(id) ?? []
      if (buf.length < 1000) buf.push(data)
      pendingData.set(id, buf)
    }
  })
  window.api.term.onExit((id, code) => {
    const h = exitHandlers.get(id)
    if (h) h(code)
    else pendingExit.set(id, code)
  })
}

/** Must be called before `term.create` so early output is captured. */
export function prepareRouting(): void {
  ensureRouting()
}

export function attachPty(id: string, onData: DataFn, onExit: ExitFn): () => void {
  ensureRouting()
  dataHandlers.set(id, onData)
  exitHandlers.set(id, onExit)
  const buf = pendingData.get(id)
  pendingData.delete(id)
  buf?.forEach(onData)
  const code = pendingExit.get(id)
  pendingExit.delete(id)
  if (code !== undefined) onExit(code)
  return () => {
    dataHandlers.delete(id)
    exitHandlers.delete(id)
  }
}

// ------------------------------------------------------------- commands

function withTerminal(fn: (id: string, h: TerminalHandle) => void): () => void {
  return () => {
    const id = activeTerminalId()
    const h = id ? handles.get(id) : undefined
    if (id && h) fn(id, h)
  }
}

export function focusTerminal(): void {
  const ws = useWorkspace.getState()
  const id = activeTerminalId()
  if (!id) {
    newTerminal()
    return
  }
  ws.setBottomActive(id)
  // after the panel became visible
  requestAnimationFrame(() => handles.get(id)?.focus())
}

registerCommands([
  { id: 'terminal:clear', name: 'Terminal: Clear terminal', check: () => !!activeTerminalId(), run: withTerminal((_id, h) => h.clear()) },
  { id: 'terminal:kill', name: 'Terminal: Kill terminal', check: () => !!activeTerminalId(), run: withTerminal((id) => killTerminalTab(id)) },
  { id: 'terminal:focus', name: 'Terminal: Focus terminal', run: focusTerminal }
])
