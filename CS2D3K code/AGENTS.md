# CS2D3K — contributor brief (read fully before coding)

CS2D3K is an Obsidian-like desktop app (Electron + React 19 + TypeScript + Zustand) with first-class code support.
Project root: `A:\Work\CS2D3K\CS2D3K code` (note the space in the path — always quote it).

## Commands
- Typecheck: `npm run typecheck` (TypeScript 7 — no `baseUrl`; `paths` are set up).
- Build into YOUR OWN out dir (several people build concurrently): `npx electron-vite build --outDir out-<you>`
- Tests: see `TESTING.md` (Vitest unit tests in `tests/unit`, Playwright e2e specs in `tests/e2e`). Run a spec against your
  own build with `CS2D3K_OUT=out-<you> PW_OUT=<you> npx playwright test tests/e2e/<spec>`.
- IMPORTANT: the shell has `ELECTRON_RUN_AS_NODE=1` set; `launch.mjs` already deletes it. If you run electron yourself, unset it.
- Other people are editing other files at the same time. If typecheck shows errors ONLY in files you don't own, ignore them
  (re-run later). Never "fix" files you don't own, unless listed as allowed below. Never run `git` commands that change state.

## Layout of the code
```
src/main/            Electron main: vault fs (vault.ts), terminal (node-pty), runner (code execution), IPC (index.ts)
src/preload/         contextBridge → window.api (typed in src/shared/api.ts)
src/shared/          api.ts (window.api types), types.ts
src/renderer/src/
  store/             zustand stores: vault, workspace (tabs/splits/sidebars/bottom panel), settings, metadata (links/tags index),
                     commands (registry + hotkeys), ui (menus, prompts, notices, modals), bookmarks
  lib/               path, filetypes, util, fileops (create/rename/delete/save + link updating), mdparse (links/tags/headings),
                     markdown/render.ts + markdown/MarkdownPreview.tsx (markdown→HTML with wikilinks, embeds, callouts, tasks,
                     runnable code blocks), runCode.ts (execute code via main), events.ts (app event bus), terminalCwd.ts
  components/        Shell, Layout (tabs/splits), Sidebar, Ribbon, StatusBar, BottomPanelHost, Slots, dialogs, palette...
  panes/             sidebar panes (explorer, search, backlinks, outline...)
  views/             main-area views; registry.tsx maps ViewType → component (lazy)
  theme/             theme.ts (applyTheme, onThemeChange, themePalette, cssVar), builtin.ts
  styles/            variables.css (design tokens), app.css (shell), markdown.css (rendered markdown)
  settings/          SettingsModal
```

## Key contracts
### Views (`src/renderer/src/views/types.ts`)
```ts
interface ViewProps { tab: TabState; leafId: string; visible: boolean; focused: boolean }
```
- Default-export a component from your view file. It is mounted inside an absolutely-positioned flex column container
  (`.view`) — make your root `flex: 1; min-height: 0` (or absolute inset 0).
- The view is keyed by `tab.id + tab.navId`; it stays mounted while hidden (`visible=false`), so pause expensive work when hidden.
- `tab.path` can CHANGE while mounted (file renamed/moved). Always save to the latest path (keep it in a ref).
- `tab.state` holds per-tab view state. Persist your view state with `useWorkspace.getState().updateTabState(tab.id, patch)`
  (debounce it). Navigation requests arrive as `tab.state.line` (0-based line), `tab.state.subpath` ("#Heading" / "#^block"),
  `tab.state.query` (text to highlight) and `tab.state._nav` (timestamp, changes on every request) — react to `_nav` changes.
- Header buttons: render `<ViewHeaderActions>…</ViewHeaderActions>` (from `@/components/Slots`) — portals into the view
  header right side; only shown while the tab is visible. Use `<button className="clickable-icon small">` with lucide-react icons.
- Status bar: `<StatusBarItem active={focused}><div className="status-bar-item">…</div></StatusBarItem>`.

### Files (`@/lib/fileops`)
- `readFile(path)` → content (records it as "last known" so watcher echoes are ignored).
- `saveFile(path, content)` → writes, updates vault + metadata index. Use this for every write.
- `onExternalChange(path, cb)` → called with new content when the file changes on disk from elsewhere (other app, link
  updater, another tab). `broadcastContent(path, content, exceptCb)` → notify other open views of the same file.
- `openLinkText(linktext, sourcePath, newTab)` → follow a wikilink (creates note if unresolved).
- `createNote`, `createCanvas`, `renamePath`, `deletePath`.
- Workspace: `useWorkspace.getState().openFile(path, { target?: 'tab'|'split-right'|'split-down', state? })`, `openView('graph')`.
- Metadata: `useMetadata` (metas, resolved, unresolved, version), `resolveLink(link, sourcePath)`, `linkTextFor(path)`,
  `getBacklinks(path)`, `getAllTags()`.
- Vault files: `useVault` (`files: Record<path, FileEntry>`, `version`), `allFiles()`, `fileExists(p)`.
- Raw IPC: `window.api` (see `src/shared/api.ts`) — e.g. `window.api.fs.resourceUrl(path)` for <img src>.

### Commands & hotkeys (`@/store/commands`)
`registerCommands([{ id, name, hotkeys?: ['Mod+E'], check?: () => boolean, run }])` returns an unregister fn.
Register view-specific commands from your view module ONCE (module-level or a singleton effect), using `check` to
only enable them when an instance of your view is focused (track the focused instance in a module-level variable).
Never register per-instance commands with the same id from multiple tabs. `Mod` = Ctrl/Cmd. App-level hotkeys
are handled in the capture phase, so editors' own keymaps should not reuse: Mod+P, Mod+O, Mod+N, Mod+W, Mod+T, Mod+G,
Mod+, Mod+\\ Mod+Shift+F/E/L/R, Ctrl+`.

### Settings (`@/store/settings`)
`useSettings((s) => s.settings.<key>)`. Relevant keys: defaultViewMode ('live'|'source'|'reading'), editorFontSize,
readableLineLength, showLineNumbers, tabSize, spellcheck, foldHeadings, autoPairBrackets, showFrontmatter, vimMode,
codeFontSize, codeMinimap, codeWordWrap, codeLineNumbers, codeFontLigatures, codeAutoSave, runners (lang → command),
terminalShell, terminalFontSize, terminalCursorBlink. Add NO new settings keys yourself — tell the lead if you need one.

### Theming
- Everything must be styled with CSS variables from `styles/variables.css` (Obsidian-compatible names: --background-primary,
  --background-secondary, --text-normal, --text-muted, --text-faint, --text-accent, --interactive-accent,
  --background-modifier-border, --background-modifier-hover, --font-text, --font-monospace, --code-* tokens, --graph-*,
  --canvas-*, --radius-s/m/l, --color-red/green/... and --color-*-rgb).
- Non-CSS consumers (canvas 2D, Monaco, xterm): `themePalette()` returns resolved hex colors; re-read on `onThemeChange(cb)`.
- Light and dark must both look right (`body.theme-dark` / `body.theme-light`).
- Put your CSS in your own file next to your code and import it from your component.

### Code execution
`runCode(lang, code, { sourcePath, onOutput })` from `@/lib/runCode` → `{ runId, done: Promise<RunResult>, kill() }`.
`emit('run-output', { title, text, stream })` from `@/lib/events` publishes a finished run to the bottom-panel Output tab.

### Quality bar
Obsidian-level polish: smooth, no layout jank, keyboard friendly, right-click context menus (`showContextMenu(e, items)` from
`@/store/ui`), no console errors. Clean, readable code matching the surrounding style (2-space, no semicolons, single quotes,
function components, small helpers). Verify visually with e2e screenshots in BOTH dark and light themes
(`page.evaluate(() => document.body.classList.replace('theme-dark','theme-light'))` works for a quick check).
