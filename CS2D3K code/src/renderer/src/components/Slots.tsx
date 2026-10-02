// Portal slots that let views put content in the shared chrome
// (the view header actions area and the status bar).
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

/** Provided by TabGroup: the DOM node for the active view's header actions. */
export const HeaderActionsContext = createContext<HTMLElement | null>(null)

/** Render children into the view header (right side). Only renders when the view is visible. */
export function ViewHeaderActions({ children }: { children: ReactNode }): ReactNode {
  const el = useContext(HeaderActionsContext)
  if (!el) return null
  return createPortal(children, el)
}

/** Render into the status bar, only while `active` is true. */
export function StatusBarItem({ children, active = true }: { children: ReactNode; active?: boolean }): ReactNode {
  const [el, setEl] = useState<HTMLElement | null>(null)
  useEffect(() => {
    setEl(document.getElementById('status-bar-view-items'))
  }, [])
  if (!el || !active) return null
  return createPortal(children, el)
}
