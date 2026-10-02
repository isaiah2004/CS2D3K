import { create } from 'zustand'
import { debounce } from '@/lib/util'

export type ViewMode = 'live' | 'source' | 'reading'
export type BaseTheme = 'dark' | 'light' | 'system'

export interface Settings {
  // Editor
  defaultViewMode: ViewMode
  editorFontSize: number
  readableLineLength: boolean
  showLineNumbers: boolean
  tabSize: number
  spellcheck: boolean
  foldHeadings: boolean
  autoPairBrackets: boolean
  showFrontmatter: boolean
  vimMode: boolean

  // Files & links
  newNoteLocation: 'root' | 'current' | 'folder'
  newNoteFolder: string
  attachmentFolder: string
  confirmDelete: boolean
  updateLinksOnRename: boolean
  showAllFileTypes: boolean
  fileSortOrder: 'name-asc' | 'name-desc' | 'mtime-desc' | 'mtime-asc' | 'ctime-desc' | 'ctime-asc'

  // Appearance
  baseTheme: BaseTheme
  accentColor: string
  theme: string // '' = default, 'builtin:<name>' or vault theme name
  enabledSnippets: string[]
  uiFontSize: number
  textFont: string
  monoFont: string
  interfaceFont: string
  showRibbon: boolean
  showStatusBar: boolean
  showInlineTitle: boolean
  showTabTitleBar: boolean

  // Code editor (Monaco)
  codeFontSize: number
  codeMinimap: boolean
  codeWordWrap: boolean
  codeLineNumbers: boolean
  codeFontLigatures: boolean
  codeAutoSave: boolean

  // Code runner — per language command overrides ({file}, {dir})
  runners: Record<string, string>
  runTimeoutSec: number

  // Terminal
  terminalShell: string
  terminalFontSize: number
  terminalCursorBlink: boolean

  // Hotkeys: commandId -> list of key combos ("Mod+Shift+P")
  hotkeys: Record<string, string[]>

  // Core panes toggles
  corePanes: Record<string, boolean>
}

export const DEFAULT_SETTINGS: Settings = {
  defaultViewMode: 'live',
  editorFontSize: 16,
  readableLineLength: true,
  showLineNumbers: false,
  tabSize: 4,
  spellcheck: false,
  foldHeadings: true,
  autoPairBrackets: true,
  showFrontmatter: true,
  vimMode: false,

  newNoteLocation: 'current',
  newNoteFolder: '',
  attachmentFolder: '',
  confirmDelete: true,
  updateLinksOnRename: true,
  showAllFileTypes: true,
  fileSortOrder: 'name-asc',

  baseTheme: 'dark',
  accentColor: '#8a5cf5',
  theme: '',
  enabledSnippets: [],
  uiFontSize: 13,
  textFont: '',
  monoFont: '',
  interfaceFont: '',
  showRibbon: true,
  showStatusBar: true,
  showInlineTitle: true,
  showTabTitleBar: true,

  codeFontSize: 14,
  codeMinimap: true,
  codeWordWrap: false,
  codeLineNumbers: true,
  codeFontLigatures: true,
  codeAutoSave: true,

  runners: {},
  runTimeoutSec: 0,

  terminalShell: '',
  terminalFontSize: 13,
  terminalCursorBlink: true,

  hotkeys: {},

  corePanes: {
    files: true,
    search: true,
    bookmarks: true,
    tags: true,
    backlinks: true,
    outgoing: true,
    outline: true,
    localgraph: true
  }
}

interface SettingsStore {
  settings: Settings
  loaded: boolean
  load(): Promise<void>
  set<K extends keyof Settings>(key: K, value: Settings[K]): void
  patch(p: Partial<Settings>): void
  reset(): void
}

const persist = debounce((s: Settings) => {
  window.api.config.write('app', s).catch((e) => console.warn('could not save settings', e))
}, 300)

/** Write a pending settings save now (before the vault closes / the window unloads). */
export function flushSettings(): void {
  persist.flush()
}

export const useSettings = create<SettingsStore>((set, get) => ({
  settings: DEFAULT_SETTINGS,
  loaded: false,
  async load() {
    const raw = await window.api.config.read<Partial<Settings>>('app')
    // null values (hand-edited / corrupt config) fall back to the defaults
    const saved: Partial<Settings> =
      raw && typeof raw === 'object' ? Object.fromEntries(Object.entries(raw).filter(([, v]) => v != null)) : {}
    set({
      settings: {
        ...DEFAULT_SETTINGS,
        ...saved,
        corePanes: { ...DEFAULT_SETTINGS.corePanes, ...(saved.corePanes ?? {}) }
      },
      loaded: true
    })
  },
  set(key, value) {
    const settings = { ...get().settings, [key]: value }
    set({ settings })
    persist(settings)
  },
  patch(p) {
    const settings = { ...get().settings, ...p }
    set({ settings })
    persist(settings)
  },
  reset() {
    set({ settings: DEFAULT_SETTINGS })
    persist(DEFAULT_SETTINGS)
  }
}))

/** Non-react accessor */
export const getSettings = (): Settings => useSettings.getState().settings
