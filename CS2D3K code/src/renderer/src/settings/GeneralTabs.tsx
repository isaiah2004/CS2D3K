import { useEffect, useState } from 'react'
import { FolderOpen, RefreshCw, Bug, LogOut, RotateCcw } from 'lucide-react'
import { useSettings, DEFAULT_SETTINGS } from '@/store/settings'
import { useVault } from '@/store/vault'
import { confirmDialog } from '@/store/ui'
import { closeVault } from '@/lib/bootstrap'
import { PANES } from '@/panes/registry'
import type { PaneId } from '@/store/workspace'
import { BoolSetting, SelectSetting, SettingHeading, SettingItem, SliderSetting, TextInput, TextSetting, Toggle } from './controls'

export function EditorTab() {
  return (
    <>
      <SettingHeading>General</SettingHeading>
      <SelectSetting
        k="defaultViewMode"
        name="Default view for new tabs"
        desc="The default view that a new markdown tab gets switched to."
        options={[
          { value: 'live', label: 'Live Preview' },
          { value: 'source', label: 'Source mode' },
          { value: 'reading', label: 'Reading view' }
        ]}
      />
      <BoolSetting k="readableLineLength" name="Readable line length" desc="Limit maximum line length so that text is easier to read." />
      <BoolSetting k="spellcheck" name="Spellcheck" desc="Turn on the spellchecker." />
      <BoolSetting k="showFrontmatter" name="Show properties" desc="Display frontmatter properties at the top of notes in reading view." />
      <SettingHeading>Display</SettingHeading>
      <SliderSetting k="editorFontSize" name="Font size" desc="Font size of notes in the editor and reading view." min={10} max={30} unit="px" />
      <BoolSetting k="showLineNumbers" name="Show line numbers" desc="Show line numbers in the gutter." />
      <BoolSetting k="foldHeadings" name="Fold heading" desc="Allow folding headings and their content." />
      <SettingHeading>Behavior</SettingHeading>
      <BoolSetting k="autoPairBrackets" name="Auto pair brackets" desc="Pair brackets and quotes automatically." />
      <SelectSetting
        k="tabSize"
        name="Tab indent size"
        desc="The number of spaces a tab is equal to."
        options={[2, 3, 4, 6, 8].map((n) => ({ value: n, label: String(n) }))}
      />
    </>
  )
}

export function FilesTab() {
  const loc = useSettings((s) => s.settings.newNoteLocation)
  return (
    <>
      <SettingHeading>Files</SettingHeading>
      <BoolSetting k="confirmDelete" name="Confirm file deletion" desc="Ask before deleting a file. Deleted files go to the system trash." />
      <SelectSetting
        k="newNoteLocation"
        name="Default location for new notes"
        desc="Where newly created notes are placed."
        options={[
          { value: 'root', label: 'Vault folder' },
          { value: 'current', label: 'Same folder as current file' },
          { value: 'folder', label: 'In the folder specified below' }
        ]}
      />
      {loc === 'folder' && <TextSetting k="newNoteFolder" name="Folder to create new notes in" placeholder="Example: folder 1/folder 2" />}
      <TextSetting k="attachmentFolder" name="Default location for new attachments" desc="Leave empty to use the vault root." placeholder="attachments" />
      <BoolSetting k="showAllFileTypes" name="Show all file types" desc="Show code files and other attachments in the file explorer (not only notes and canvases)." />
      <SettingHeading>Links</SettingHeading>
      <BoolSetting k="updateLinksOnRename" name="Automatically update internal links" desc="When renaming or moving a file, rewrite every link that points to it." />
    </>
  )
}

export function CodeEditorTab() {
  return (
    <>
      <SettingHeading>Code editor (Monaco)</SettingHeading>
      <SliderSetting k="codeFontSize" name="Font size" desc="Font size in code editors, code blocks and canvas code cells." min={9} max={28} unit="px" />
      <BoolSetting k="codeMinimap" name="Minimap" desc="Show the minimap in code editors." />
      <BoolSetting k="codeWordWrap" name="Word wrap" desc="Wrap long lines." />
      <BoolSetting k="codeLineNumbers" name="Line numbers" />
      <BoolSetting k="codeFontLigatures" name="Font ligatures" desc="Use programming ligatures if the font supports them." />
      <BoolSetting k="codeAutoSave" name="Auto save" desc="Save code files automatically. When off, use Ctrl+S." />
    </>
  )
}

const RUN_LANGS: { id: string; label: string; def: string }[] = [
  { id: 'js', label: 'JavaScript', def: 'node "{file}"' },
  { id: 'ts', label: 'TypeScript', def: 'node "{file}"' },
  { id: 'python', label: 'Python', def: 'python "{file}"' },
  { id: 'bash', label: 'Bash / shell', def: 'bash "{file}"' },
  { id: 'powershell', label: 'PowerShell', def: 'powershell -NoProfile -ExecutionPolicy Bypass -File "{file}"' },
  { id: 'bat', label: 'Batch', def: 'cmd /c "{file}"' },
  { id: 'go', label: 'Go', def: 'go run "{file}"' },
  { id: 'rust', label: 'Rust', def: 'rustc "{file}" -o "{dir}/main.exe" && "{dir}/main.exe"' },
  { id: 'c', label: 'C', def: 'gcc "{file}" -o "{dir}/main.exe" && "{dir}/main.exe"' },
  { id: 'cpp', label: 'C++', def: 'g++ "{file}" -o "{dir}/main.exe" && "{dir}/main.exe"' },
  { id: 'ruby', label: 'Ruby', def: 'ruby "{file}"' },
  { id: 'lua', label: 'Lua', def: 'lua "{file}"' },
  { id: 'php', label: 'PHP', def: 'php "{file}"' }
]

export function RunnerTab() {
  const runners = useSettings((s) => s.settings.runners)
  const set = (id: string, v: string): void => {
    const next = { ...runners }
    if (v.trim()) next[id] = v.trim()
    else delete next[id]
    useSettings.getState().set('runners', next)
  }
  return (
    <>
      <SettingHeading>Code runner</SettingHeading>
      <div className="setting-note">
        Code blocks in notes, canvas code cells and code files can be executed. Each language runs a shell command where <code>{'{file}'}</code> is a
        temporary file containing the code and <code>{'{dir}'}</code> its folder. The working directory is the folder of the note or file.
        Leave a field empty to use the default.
      </div>
      <SliderSetting k="runTimeoutSec" name="Timeout" desc="Kill runs that take longer than this (0 = no limit)." min={0} max={600} step={5} unit="s" />
      {RUN_LANGS.map((l) => (
        <SettingItem key={l.id} name={l.label} desc={<code>{l.id}</code>}>
          <TextInput value={runners[l.id] ?? ''} placeholder={l.def} width={340} mono onCommit={(v) => set(l.id, v)} />
        </SettingItem>
      ))}
    </>
  )
}

export function TerminalTab() {
  return (
    <>
      <SettingHeading>Terminal</SettingHeading>
      <TextSetting k="terminalShell" name="Shell" desc="Path of the shell executable. Empty = PowerShell 7 / Windows PowerShell on Windows, $SHELL elsewhere." placeholder="default" />
      <SliderSetting k="terminalFontSize" name="Font size" min={9} max={24} unit="px" />
      <BoolSetting k="terminalCursorBlink" name="Cursor blink" />
    </>
  )
}

export function CorePanesTab() {
  const enabled = useSettings((s) => s.settings.corePanes)
  return (
    <>
      <SettingHeading>Core panes</SettingHeading>
      <div className="setting-note">Turn sidebar panes on or off. Drag pane icons between the two sidebars to rearrange them; right-click an icon for more options.</div>
      {(Object.keys(PANES) as PaneId[]).map((id) => {
        const def = PANES[id]
        const Icon = def.icon
        return (
          <SettingItem
            key={id}
            name={
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                <Icon size={15} /> {def.title}
              </span>
            }
          >
            <Toggle value={enabled[id] !== false} label={def.title} onChange={(v) => useSettings.getState().set('corePanes', { ...enabled, [id]: v })} />
          </SettingItem>
        )
      })}
    </>
  )
}

export function AboutTab() {
  const info = useVault((s) => s.info)
  const fileCount = useVault((s) => Object.values(s.files).filter((f) => !f.isDir).length)
  const [version, setVersion] = useState('')
  useEffect(() => {
    void window.api.app.getVersion().then(setVersion)
  }, [])
  return (
    <>
      <SettingHeading>About</SettingHeading>
      <SettingItem name="CS2D3K" desc={`Version ${version} · Electron · React · CodeMirror · Monaco · xterm.js`} />
      <SettingItem name="Current vault" desc={`${info?.path} · ${fileCount} files`}>
        <button className="btn" onClick={() => void window.api.fs.openWithDefaultApp('')}>
          <FolderOpen size={14} /> Open folder
        </button>
      </SettingItem>
      <SettingItem name="Switch vault" desc="Close this vault and return to the vault picker.">
        <button className="btn" onClick={() => void closeVault()}>
          <LogOut size={14} /> Switch
        </button>
      </SettingItem>
      <SettingHeading>Advanced</SettingHeading>
      <SettingItem name="Reload app" desc="Reload the window. Unsaved changes are flushed first by each editor.">
        <button className="btn" onClick={() => void window.api.app.reload()}>
          <RefreshCw size={14} /> Reload
        </button>
      </SettingItem>
      <SettingItem name="Developer tools" desc="Ctrl+Shift+I">
        <button className="btn" onClick={() => void window.api.app.toggleDevTools()}>
          <Bug size={14} /> Toggle
        </button>
      </SettingItem>
      <SettingItem name="Reset all settings" desc="Restore every setting in this vault to its default value.">
        <button
          className="btn mod-warning"
          onClick={async () => {
            if (await confirmDialog({ title: 'Reset settings', message: 'Reset all settings to defaults?', danger: true, okLabel: 'Reset' })) {
              useSettings.getState().patch({ ...DEFAULT_SETTINGS })
            }
          }}
        >
          <RotateCcw size={14} /> Reset
        </button>
      </SettingItem>
    </>
  )
}
