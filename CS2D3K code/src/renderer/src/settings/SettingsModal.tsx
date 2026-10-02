import { useEffect, useMemo, useState, type ComponentType } from 'react'
import { X, Search } from 'lucide-react'
import { useUi } from '@/store/ui'
import { EditorTab, FilesTab, CodeEditorTab, RunnerTab, TerminalTab, CorePanesTab, AboutTab } from './GeneralTabs'
import AppearanceTab from './AppearanceTab'
import HotkeysTab from './HotkeysTab'
import './settings.css'

interface TabDef {
  id: string
  label: string
  group: string
  component: ComponentType
  /** keywords for the settings search */
  keywords: string
}

const TABS: TabDef[] = [
  { id: 'editor', label: 'Editor', group: 'Options', component: EditorTab, keywords: 'view mode live preview source reading line length spellcheck font size line numbers fold brackets tab indent properties frontmatter' },
  { id: 'files', label: 'Files and links', group: 'Options', component: FilesTab, keywords: 'delete trash new note location folder attachments links rename update file types' },
  { id: 'appearance', label: 'Appearance', group: 'Options', component: AppearanceTab, keywords: 'theme dark light accent color font css snippets ribbon status bar inline title' },
  { id: 'hotkeys', label: 'Hotkeys', group: 'Options', component: HotkeysTab, keywords: 'keyboard shortcut keys bindings' },
  { id: 'code', label: 'Code editor', group: 'Code', component: CodeEditorTab, keywords: 'monaco minimap word wrap ligatures auto save font' },
  { id: 'runner', label: 'Code runner', group: 'Code', component: RunnerTab, keywords: 'run execute python node javascript typescript command timeout' },
  { id: 'terminal', label: 'Terminal', group: 'Code', component: TerminalTab, keywords: 'shell powershell bash cursor font' },
  { id: 'panes', label: 'Core panes', group: 'Core plugins', component: CorePanesTab, keywords: 'sidebar files search bookmarks tags backlinks outline graph' },
  { id: 'about', label: 'About', group: 'Core plugins', component: AboutTab, keywords: 'version vault reload developer tools reset switch' }
]

export default function SettingsModal() {
  const initial = useUi((s) => s.settingsTab)
  const [tab, setTab] = useState(TABS.some((t) => t.id === initial) ? initial : 'editor')
  const [query, setQuery] = useState('')
  const close = (): void => useUi.getState().closeModal()

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && !useUi.getState().prompt && !useUi.getState().confirm) close()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return TABS
    return TABS.filter((t) => t.label.toLowerCase().includes(q) || t.keywords.includes(q))
  }, [query])

  useEffect(() => {
    if (visible.length && !visible.some((t) => t.id === tab)) setTab(visible[0].id)
  }, [visible, tab])

  const Active = TABS.find((t) => t.id === tab)!.component
  const groups = [...new Set(visible.map((t) => t.group))]

  return (
    <div className="modal-backdrop centered" onMouseDown={close}>
      <div className="modal settings-modal" onMouseDown={(e) => e.stopPropagation()} role="dialog" aria-label="Settings">
        <div className="settings-nav">
          <div className="settings-search">
            <Search size={14} />
            <input placeholder="Search settings…" value={query} onChange={(e) => setQuery(e.target.value)} />
          </div>
          {groups.map((g) => (
            <div key={g}>
              <div className="settings-nav-group">{g}</div>
              {visible
                .filter((t) => t.group === g)
                .map((t) => (
                  <div key={t.id} className={`settings-nav-item${t.id === tab ? ' is-active' : ''}`} onClick={() => setTab(t.id)}>
                    {t.label}
                  </div>
                ))}
            </div>
          ))}
        </div>
        <div className="settings-content">
          <button className="clickable-icon settings-close" onClick={close} aria-label="Close">
            <X />
          </button>
          <div className="settings-content-inner">
            <Active />
          </div>
        </div>
      </div>
    </div>
  )
}
