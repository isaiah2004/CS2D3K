import { create } from 'zustand'
import { isMac } from '@/lib/util'
import { getSettings } from './settings'

export interface Command {
  id: string
  name: string
  /** default hotkeys like "Mod+Shift+P" (Mod = Ctrl / Cmd) */
  hotkeys?: string[]
  /** return false when the command is not available right now */
  check?: () => boolean
  run: () => void | Promise<void>
}

interface CommandStore {
  commands: Record<string, Command>
  recent: string[]
  register(cmd: Command | Command[]): () => void
  execute(id: string): boolean
}

export const useCommands = create<CommandStore>((set, get) => ({
  commands: {},
  recent: [],
  register(cmd) {
    const list = Array.isArray(cmd) ? cmd : [cmd]
    set((s) => {
      const commands = { ...s.commands }
      for (const c of list) commands[c.id] = c
      return { commands }
    })
    return () =>
      set((s) => {
        const commands = { ...s.commands }
        for (const c of list) if (commands[c.id] === c) delete commands[c.id]
        return { commands }
      })
  },
  execute(id) {
    const c = get().commands[id]
    if (!c || (c.check && !c.check())) return false
    set((s) => ({ recent: [id, ...s.recent.filter((r) => r !== id)].slice(0, 10) }))
    const fail = (e: unknown): void => console.error(`command ${id} failed`, e)
    try {
      void Promise.resolve(c.run()).catch(fail)
    } catch (e) {
      fail(e)
    }
    return true
  }
}))

export function registerCommands(cmds: Command[]): () => void {
  return useCommands.getState().register(cmds)
}

export function executeCommand(id: string): boolean {
  return useCommands.getState().execute(id)
}

/** Normalize a KeyboardEvent into "Mod+Alt+Shift+Key" form. */
export function eventToHotkey(e: KeyboardEvent): string | null {
  const key = e.key
  if (['Control', 'Shift', 'Alt', 'Meta'].includes(key)) return null
  const parts: string[] = []
  const mac = isMac()
  if (mac ? e.metaKey : e.ctrlKey) parts.push('Mod')
  if (mac && e.ctrlKey) parts.push('Ctrl')
  if (!mac && e.metaKey) parts.push('Meta')
  if (e.altKey) parts.push('Alt')
  if (e.shiftKey) parts.push('Shift')
  let k = key.length === 1 ? key.toUpperCase() : key
  // use physical key for letters/digits so Shift/Alt combos are stable
  if (/^Key[A-Z]$/.test(e.code)) k = e.code.slice(3)
  else if (/^Digit\d$/.test(e.code)) k = e.code.slice(5)
  else if (e.code === 'Backquote') k = '`'
  else if (e.code === 'Comma') k = ','
  else if (e.code === 'Period') k = '.'
  else if (e.code === 'Slash') k = '/'
  else if (e.code === 'BracketLeft') k = '['
  else if (e.code === 'BracketRight') k = ']'
  else if (key === ' ') k = 'Space'
  parts.push(k)
  return parts.join('+')
}

export function formatHotkey(h: string): string {
  const mac = isMac()
  return h
    .split('+')
    .map((p) => {
      if (p === 'Mod') return mac ? '⌘' : 'Ctrl'
      if (p === 'Alt') return mac ? '⌥' : 'Alt'
      if (p === 'Shift') return mac ? '⇧' : 'Shift'
      if (p === 'Ctrl') return mac ? '⌃' : 'Ctrl'
      if (p === 'ArrowLeft') return '←'
      if (p === 'ArrowRight') return '→'
      if (p === 'ArrowUp') return '↑'
      if (p === 'ArrowDown') return '↓'
      return p
    })
    .join(mac ? '' : '+')
}

/** Effective hotkeys for a command (user override or defaults). */
export function hotkeysFor(id: string): string[] {
  const user = getSettings().hotkeys[id]
  if (user) return user
  return useCommands.getState().commands[id]?.hotkeys ?? []
}

const MOD_ORDER = ['Mod', 'Ctrl', 'Meta', 'Alt', 'Shift']

/** Canonical form so "Shift+Alt+F" and "Alt+Shift+F" compare equal. */
export function normalizeHotkey(h: string): string {
  const parts = h.split('+')
  const key = parts.pop()!
  const mods = parts.sort((a, b) => MOD_ORDER.indexOf(a) - MOD_ORDER.indexOf(b))
  return [...mods, key.length === 1 ? key.toUpperCase() : key].join('+')
}

/** Set while the hotkey editor is recording, so app hotkeys don't fire. */
export const hotkeyRecorder = { active: false }

/** Global keydown handler: returns true if a command was executed. */
export function handleHotkey(e: KeyboardEvent): boolean {
  if (hotkeyRecorder.active) return false
  const hk = eventToHotkey(e)
  if (!hk) return false
  const { commands } = useCommands.getState()
  const overrides = getSettings().hotkeys
  for (const c of Object.values(commands)) {
    const keys = overrides[c.id] ?? c.hotkeys ?? []
    if (keys.some((k) => normalizeHotkey(k) === hk)) {
      if (c.check && !c.check()) continue
      e.preventDefault()
      e.stopPropagation()
      useCommands.getState().execute(c.id)
      return true
    }
  }
  return false
}
