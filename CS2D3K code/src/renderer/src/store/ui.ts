import { create } from 'zustand'
import type { ReactNode } from 'react'
import { uid } from '@/lib/util'

export interface MenuItem {
  label?: string
  icon?: ReactNode
  hint?: string
  danger?: boolean
  disabled?: boolean
  checked?: boolean
  separator?: boolean
  submenu?: MenuItem[]
  onClick?: () => void
}

export interface Notice {
  id: string
  message: string
  kind: 'info' | 'error' | 'success'
}

export interface PromptRequest {
  id: string
  title: string
  message?: string
  placeholder?: string
  initial?: string
  /** select only the part before the extension */
  selectStem?: boolean
  okLabel?: string
  validate?: (v: string) => string | null
  resolve: (v: string | null) => void
}

export interface ConfirmRequest {
  id: string
  title: string
  message: string
  okLabel?: string
  danger?: boolean
  resolve: (ok: boolean) => void
}

export type ModalKind = 'settings' | 'palette' | 'switcher' | null

interface UiStore {
  menu: { x: number; y: number; items: MenuItem[] } | null
  notices: Notice[]
  prompt: PromptRequest | null
  confirm: ConfirmRequest | null
  modal: ModalKind
  settingsTab: string
  /** path currently being renamed inline in the file explorer */
  renaming: string | null
  showMenu(e: { clientX: number; clientY: number } | { x: number; y: number }, items: MenuItem[]): void
  closeMenu(): void
  openModal(m: ModalKind, settingsTab?: string): void
  closeModal(): void
  setRenaming(p: string | null): void
}

export const useUi = create<UiStore>((set) => ({
  menu: null,
  notices: [],
  prompt: null,
  confirm: null,
  modal: null,
  settingsTab: 'editor',
  renaming: null,
  showMenu(e, items) {
    const x = 'clientX' in e ? e.clientX : e.x
    const y = 'clientY' in e ? e.clientY : e.y
    set({ menu: { x, y, items } })
  },
  closeMenu() {
    set({ menu: null })
  },
  openModal(m, settingsTab) {
    set((s) => ({ modal: m, settingsTab: settingsTab ?? s.settingsTab }))
  },
  closeModal() {
    set({ modal: null })
  },
  setRenaming(p) {
    set({ renaming: p })
  }
}))

export function notice(message: string, kind: Notice['kind'] = 'info', ms = 4000): void {
  const n: Notice = { id: uid('n-'), message, kind }
  useUi.setState((s) => ({ notices: [...s.notices, n] }))
  setTimeout(() => useUi.setState((s) => ({ notices: s.notices.filter((x) => x.id !== n.id) })), ms)
}

export function promptText(opts: Omit<PromptRequest, 'id' | 'resolve'>): Promise<string | null> {
  // a newer prompt replaces a pending one: cancel it so its caller doesn't hang
  useUi.getState().prompt?.resolve(null)
  return new Promise((resolve) => {
    useUi.setState({ prompt: { ...opts, id: uid('p-'), resolve } })
  })
}

export function confirmDialog(opts: Omit<ConfirmRequest, 'id' | 'resolve'>): Promise<boolean> {
  useUi.getState().confirm?.resolve(false)
  return new Promise((resolve) => {
    useUi.setState({ confirm: { ...opts, id: uid('c-'), resolve } })
  })
}

export function showContextMenu(e: React.MouseEvent | MouseEvent, items: MenuItem[]): void {
  e.preventDefault()
  e.stopPropagation()
  useUi.getState().showMenu(e, items)
}
