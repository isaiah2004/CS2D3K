import { registerCommands } from '@/store/commands'
import { useUi, notice, promptText } from '@/store/ui'
import { useWorkspace, getActiveTab, getActiveFile, findLeaf, allLeaves } from '@/store/workspace'
import { useSettings } from '@/store/settings'
import { useBookmarks } from '@/store/bookmarks'
import { allFiles, fileExists, useVault } from '@/store/vault'
import { createNote, createCanvas, createFolder, deletePath, renamePath, saveFile, createFormMap, convertCanvasToFormMap } from './fileops'
import { closeVault } from './bootstrap'
import { emit } from './events'
import { basename, dirname, extname, join, stem, validateName } from './path'

function dailyNotePath(): string {
  const d = new Date()
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}.md`
}

function cycleTab(dir: 1 | -1): void {
  const s = useWorkspace.getState()
  const leaf = findLeaf(s.root, s.activeLeaf)
  if (!leaf || leaf.tabs.length < 2) return
  const i = leaf.tabs.findIndex((t) => t.id === leaf.active)
  const next = leaf.tabs[(i + dir + leaf.tabs.length) % leaf.tabs.length]
  s.activateTab(next.id)
}

export function registerCoreCommands(): () => void {
  const ws = (): ReturnType<typeof useWorkspace.getState> => useWorkspace.getState()
  const hasFile = (): boolean => !!getActiveFile()

  return registerCommands([
    // ---- app
    { id: 'app:command-palette', name: 'Open command palette', hotkeys: ['Mod+P'], run: () => useUi.getState().openModal('palette') },
    { id: 'app:quick-switcher', name: 'Quick switcher: Open quick switcher', hotkeys: ['Mod+O'], run: () => useUi.getState().openModal('switcher') },
    { id: 'app:settings', name: 'Open settings', hotkeys: ['Mod+,'], run: () => useUi.getState().openModal('settings') },
    { id: 'app:toggle-devtools', name: 'Toggle developer tools', hotkeys: ['Mod+Shift+I'], run: () => window.api.app.toggleDevTools() },
    { id: 'app:reload', name: 'Reload app without saving', run: () => window.api.app.reload() },
    { id: 'app:close-vault', name: 'Close vault / open another vault', run: () => closeVault() },
    {
      id: 'app:help',
      name: 'Open help',
      run: () =>
        notice('Ctrl+P commands · Ctrl+O switch file · Ctrl+N new note · Ctrl+E toggle edit/read · Ctrl+G graph · Ctrl+` terminal · Ctrl+, settings', 'info', 9000)
    },
    {
      id: 'theme:toggle',
      name: 'Toggle light/dark mode',
      run: () => {
        const s = useSettings.getState()
        const cur = s.settings.baseTheme === 'light' ? 'light' : 'dark'
        s.set('baseTheme', cur === 'light' ? 'dark' : 'light')
      }
    },

    // ---- files
    { id: 'file:new-note', name: 'Create new note', hotkeys: ['Mod+N'], run: () => void createNote() },
    { id: 'file:new-note-tab', name: 'Create new note in new tab', hotkeys: ['Mod+Shift+N'], run: () => void createNote(undefined, 'Untitled', '', 'tab') },
    { id: 'canvas:new', name: 'Canvas: Create new canvas', run: () => void createCanvas() },
    { id: 'formmap:new', name: 'Form-map: Create new form-map', run: () => void createFormMap() },
    {
      id: 'formmap:convert-canvas',
      name: 'Form-map: Convert current canvas to form-map',
      check: () => extname(getActiveFile() ?? '') === 'canvas',
      run: () => void convertCanvasToFormMap(getActiveFile()!)
    },
    {
      id: 'file:new-folder',
      name: 'Create new folder',
      run: async () => {
        const p = await createFolder(getActiveFile() ? dirname(getActiveFile()!) : '')
        emit('reveal-file', { path: p })
        emit('rename-file', { path: p })
      }
    },
    {
      id: 'file:new-code-file',
      name: 'Create new code file...',
      run: async () => {
        const name = await promptText({ title: 'New file', message: 'File name with extension', placeholder: 'script.ts', validate: validateName })
        if (!name) return
        const dir = getActiveFile() ? dirname(getActiveFile()!) : ''
        const path = join(dir, name)
        if (fileExists(path)) return notice('File already exists', 'error')
        await saveFile(path, '')
        ws().openFile(path)
      }
    },
    {
      id: 'file:random-note',
      name: 'Open random note',
      run: () => {
        const notes = allFiles().filter((f) => f.ext === 'md')
        if (!notes.length) return notice('No notes in vault')
        ws().openFile(notes[Math.floor(Math.random() * notes.length)].path)
      }
    },
    {
      id: 'daily:open',
      name: "Daily notes: Open today's daily note",
      run: async () => {
        const p = dailyNotePath()
        if (!fileExists(p)) {
          const content = `# ${stem(p)}\n\n## Tasks\n- [ ] \n\n## Notes\n`
          await saveFile(p, content)
        }
        ws().openFile(p)
      }
    },
    {
      id: 'file:rename',
      name: 'Rename file',
      hotkeys: ['F2'],
      check: hasFile,
      run: async () => {
        const p = getActiveFile()!
        const ext = extname(p)
        const isNote = ext === 'md' || ext === 'canvas' || ext === 'formmap'
        const cur = isNote ? stem(p) : basename(p)
        const name = await promptText({ title: 'Rename file', initial: cur, selectStem: !isNote, validate: validateName })
        if (name && name !== cur) await renamePath(p, join(dirname(p), isNote ? `${name}.${ext}` : name))
      }
    },
    { id: 'file:delete', name: 'Delete current file', check: hasFile, run: () => void deletePath(getActiveFile()!) },
    { id: 'file:bookmark', name: 'Bookmark current file', check: hasFile, run: () => useBookmarks.getState().toggleFile(getActiveFile()!) },
    { id: 'file:copy-path', name: 'Copy file path', check: hasFile, run: () => void navigator.clipboard.writeText(getActiveFile()!) },
    { id: 'file:show-in-system', name: 'Show in system explorer', check: hasFile, run: () => void window.api.fs.showInFolder(getActiveFile()!) },
    {
      id: 'file:open-default',
      name: 'Open in default app',
      check: hasFile,
      run: () => void window.api.fs.openWithDefaultApp(getActiveFile()!)
    },
    {
      id: 'file-explorer:reveal-active-file',
      name: 'Files: Reveal current file in navigation',
      check: hasFile,
      run: () => {
        ws().revealPane('files')
        setTimeout(() => emit('reveal-file', { path: getActiveFile()! }), 30)
      }
    },
    { id: 'file-explorer:open', name: 'Files: Show file explorer', hotkeys: ['Mod+Shift+E'], run: () => ws().revealPane('files') },
    {
      id: 'search:open',
      name: 'Search: Search in all files',
      hotkeys: ['Mod+Shift+F'],
      run: () => {
        ws().revealPane('search')
        setTimeout(() => emit('focus-search', {}), 30)
      }
    },
    { id: 'bookmarks:open', name: 'Bookmarks: Show bookmarks', run: () => ws().revealPane('bookmarks') },
    { id: 'tags:open', name: 'Tags: Show tags', run: () => ws().revealPane('tags') },
    { id: 'backlinks:open', name: 'Backlinks: Show backlinks', run: () => ws().revealPane('backlinks') },
    { id: 'outgoing:open', name: 'Outgoing links: Show outgoing links', run: () => ws().revealPane('outgoing') },
    { id: 'outline:open', name: 'Outline: Show outline', run: () => ws().revealPane('outline') },
    { id: 'graph:open-local', name: 'Graph view: Open local graph', run: () => ws().revealPane('localgraph') },
    { id: 'graph:open', name: 'Graph view: Open graph view', hotkeys: ['Mod+G'], run: () => ws().openView('graph') },

    // ---- tabs & layout
    { id: 'tab:new', name: 'New tab', hotkeys: ['Mod+T'], run: () => ws().newTab() },
    {
      id: 'tab:close',
      name: 'Close current tab',
      hotkeys: ['Mod+W'],
      run: () => {
        const t = getActiveTab()
        if (t) ws().closeTab(t.id)
      }
    },
    { id: 'tab:next', name: 'Go to next tab', hotkeys: ['Mod+Tab', 'Mod+PageDown'], run: () => cycleTab(1) },
    { id: 'tab:prev', name: 'Go to previous tab', hotkeys: ['Mod+Shift+Tab', 'Mod+PageUp'], run: () => cycleTab(-1) },
    {
      id: 'tab:pin',
      name: 'Toggle pin',
      check: () => !!getActiveTab(),
      run: () => ws().togglePin(getActiveTab()!.id)
    },
    {
      id: 'workspace:split-right',
      name: 'Split right',
      hotkeys: ['Mod+\\'],
      check: () => !!getActiveTab(),
      run: () => ws().splitTab(getActiveTab()!.id, 'right')
    },
    { id: 'workspace:split-down', name: 'Split down', check: () => !!getActiveTab(), run: () => ws().splitTab(getActiveTab()!.id, 'down') },
    {
      id: 'workspace:focus-next-split',
      name: 'Focus next split',
      run: () => {
        const s = ws()
        const leaves = allLeaves(s.root)
        const i = leaves.findIndex((l) => l.id === s.activeLeaf)
        s.setActiveLeaf(leaves[(i + 1) % leaves.length].id)
      }
    },
    { id: 'nav:back', name: 'Navigate back', hotkeys: ['Alt+ArrowLeft'], run: () => ws().goBack() },
    { id: 'nav:forward', name: 'Navigate forward', hotkeys: ['Alt+ArrowRight'], run: () => ws().goForward() },
    { id: 'sidebar:toggle-left', name: 'Toggle left sidebar', hotkeys: ['Mod+Shift+L'], run: () => ws().toggleSidebar('left') },
    { id: 'sidebar:toggle-right', name: 'Toggle right sidebar', hotkeys: ['Mod+Shift+R'], run: () => ws().toggleSidebar('right') },
    {
      id: 'ribbon:toggle',
      name: 'Toggle ribbon',
      run: () => useSettings.getState().set('showRibbon', !useSettings.getState().settings.showRibbon)
    },

    // ---- terminal
    {
      id: 'terminal:toggle',
      name: 'Terminal: Toggle terminal panel',
      hotkeys: ['Ctrl+`', 'Mod+`'],
      run: () => {
        const b = ws().bottom
        // panel only holds the Output tab: open a terminal instead of just showing it
        if (!b.open && b.tabs.length && !b.tabs.some((t) => t.kind === 'terminal')) {
          ws().addBottomTab('terminal')
          return
        }
        ws().toggleBottom()
      }
    },
    { id: 'terminal:new', name: 'Terminal: New terminal', hotkeys: ['Mod+Shift+`'], run: () => void ws().addBottomTab('terminal') },
    {
      id: 'vault:reveal',
      name: 'Open vault folder in system explorer',
      run: () => {
        const info = useVault.getState().info
        if (info) void window.api.fs.openWithDefaultApp('')
      }
    }
  ])
}
