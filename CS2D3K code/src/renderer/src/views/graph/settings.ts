// Graph settings (global graph + local graph pane), persisted to `.cs2d3k/graph.json`.
import { create } from 'zustand'
import { debounce } from '@/lib/util'
import { useVault } from '@/store/vault'

export interface GraphGroup {
  query: string
  color: string
}

export interface GraphSettings {
  // filters
  search: string
  showTags: boolean
  showAttachments: boolean
  existingOnly: boolean
  showOrphans: boolean
  // groups
  groups: GraphGroup[]
  // display
  showArrows: boolean
  textFade: number
  nodeSize: number
  linkThickness: number
  // forces
  centerStrength: number
  repelStrength: number
  linkStrength: number
  linkDistance: number
  // controls panel
  panelOpen: boolean
  collapsed: Record<string, boolean>
}

export interface LocalGraphSettings {
  depth: number
  showTags: boolean
  showAttachments: boolean
  neighborLinks: boolean
}

export const DEFAULT_SETTINGS: GraphSettings = {
  search: '',
  showTags: false,
  showAttachments: false,
  existingOnly: false,
  showOrphans: true,
  groups: [],
  showArrows: false,
  textFade: 0,
  nodeSize: 1,
  linkThickness: 1,
  centerStrength: 0.5,
  repelStrength: 10,
  linkStrength: 1,
  linkDistance: 120,
  panelOpen: false,
  collapsed: {}
}

export const DEFAULT_LOCAL: LocalGraphSettings = {
  depth: 1,
  showTags: false,
  showAttachments: true,
  neighborLinks: true
}

interface GraphSettingsStore {
  settings: GraphSettings
  local: LocalGraphSettings
  loaded: boolean
  load(): Promise<void>
  set(patch: Partial<GraphSettings>): void
  setLocal(patch: Partial<LocalGraphSettings>): void
  /** reset filters/display/forces (keeps the panel open) */
  reset(): void
}

interface StoredGraph extends Partial<GraphSettings> {
  local?: Partial<LocalGraphSettings>
}

const save = debounce((settings: GraphSettings, local: LocalGraphSettings) => {
  void window.api.config.write('graph', { ...settings, local }).catch(() => {})
}, 500)

let loading: Promise<void> | null = null
/** vault the settings were loaded from: another vault (closed + opened in the same window) must load its own */
let loadedFor: string | null = null

export const useGraphSettings = create<GraphSettingsStore>((set, get) => ({
  settings: DEFAULT_SETTINGS,
  local: DEFAULT_LOCAL,
  loaded: false,
  load() {
    const vaultPath = useVault.getState().info?.path ?? null
    if (!loading || loadedFor !== vaultPath) {
      loadedFor = vaultPath
      save.cancel()
      set({ settings: DEFAULT_SETTINGS, local: DEFAULT_LOCAL, loaded: false })
      loading = (async () => {
        try {
          const data = await window.api.config.read<StoredGraph>('graph')
          if (data && typeof data === 'object') {
            const { local, ...rest } = data
            set({
              settings: sanitize(mergeTyped(DEFAULT_SETTINGS, rest)),
              local: mergeTyped(DEFAULT_LOCAL, local)
            })
          }
        } catch {
          /* keep defaults */
        }
        set({ loaded: true })
      })()
    }
    return loading
  },
  set(patch) {
    const settings = { ...get().settings, ...patch }
    set({ settings })
    save(settings, get().local)
  },
  setLocal(patch) {
    const local = { ...get().local, ...patch }
    set({ local })
    save(get().settings, local)
  },
  reset() {
    const s = get().settings
    const settings = { ...DEFAULT_SETTINGS, panelOpen: s.panelOpen, collapsed: s.collapsed }
    set({ settings })
    save(settings, get().local)
  }
}))

/** Stored values override defaults only when they have the default's type (a corrupt graph.json must not break the graph). */
function mergeTyped<T extends object>(defaults: T, stored: unknown): T {
  const out = { ...defaults }
  if (!stored || typeof stored !== 'object') return out
  for (const k of Object.keys(defaults) as (keyof T)[]) {
    const v = (stored as T)[k]
    if (typeof v === typeof defaults[k] && (typeof v !== 'number' || Number.isFinite(v))) out[k] = v
  }
  return out
}

function sanitize(s: GraphSettings): GraphSettings {
  return {
    ...s,
    groups: Array.isArray(s.groups) ? s.groups.filter((g) => g && typeof g.query === 'string' && typeof g.color === 'string') : [],
    collapsed: s.collapsed && typeof s.collapsed === 'object' ? s.collapsed : {}
  }
}
