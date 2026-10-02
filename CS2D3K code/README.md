# CS2D3K

An Obsidian-style knowledge base with first-class support for code. Notes, canvases, a link graph, Monaco code editors, runnable code blocks and an integrated terminal, all in one desktop app.

Built with Electron, React 19, TypeScript, Zustand, CodeMirror 6, Monaco, xterm.js + node-pty and d3-force.

## Quick start

```bash
npm install
npm run dev        # development with hot reload
npm run build      # production build into out/
npm start          # run the production build
npm run typecheck
```

When the app starts, open any folder as a vault, or open `sample-vault/` to try every feature.

> If you launch from a terminal that has `ELECTRON_RUN_AS_NODE=1` set (some editor-integrated terminals do), unset it first, or Electron will start as plain Node.

## Features

| Area | What you get |
| --- | --- |
| **Vaults** | Any folder is a vault. Plain files on disk with a live file watcher. Settings, layout, themes and bookmarks live in `<vault>/.cs2d3k/`. Recent-vault picker. |
| **Note editor** | CodeMirror 6 markdown with **Live Preview** (markup hides away from the cursor), **Source** and **Reading** modes (`Ctrl+E`). Wikilinks, embeds, callouts, tasks, tables, tags, frontmatter, `[[` autocomplete, heading folding, hover previews (`Ctrl`+hover), inline title, autosave. |
| **Runnable code** | ▶ Run on fenced code blocks (js, ts, python, bash, powershell, go, rust, c/cpp, ruby, lua, php…) with streaming output inline. Per-language commands are configurable. |
| **Code editor** | Monaco (VS Code's editor) for every non-markdown text file. Themed to match the app, with IntelliSense for TS/JS, minimap, run-file, and a status bar showing line/column, language and EOL. |
| **Terminal** | Integrated terminals (xterm.js + node-pty) in a bottom panel (`` Ctrl+` ``), plus an Output tab for runs. "Open terminal here" from the explorer. |
| **Form-map** | A more advanced canvas (`.formmap`). **Plain cards** with free **tags** (colored chips) and typed **fields** from a map-wide registry (text, number, select, multi-select, checkbox, date, rating, checklist, link) that you can rename, retype or delete everywhere. **Groups** give cards meaning: dropping a card into one sets its fields ("Later" sets `phase: later`), and groups nest. **Kanban**: saved boards made from groups (moving a card between columns moves it between groups on the canvas) or split by a field, plus self-contained **kanban nodes** on the canvas (drag cards in and out, convert groups ↔ kanban). **Card presets**, typed or custom **relations** with a **Why?** trace, a **Coach** with generic checks plus the map's own rules, and **lenses** over the same data: Map, Board, Table, Doc (exports a note). Also **Pitch mode**, dot votes, a progress HUD, Spark prompts, a pen, minimap, mind-map keys (Tab/Enter), and confetti when a card is done. Templates: Blank, Brainstorm, Kanban and Product definition (the example). See `FORMMAP.md`. |
| **Canvas** | Infinite canvas built from scratch: text/markdown cards, note and file embeds, web pages, groups, and **code cells you can run**. Edges with arrows, labels and colors. Box-select, resize, snapping, copy/paste and undo/redo. Format: JSON Canvas plus a `code` node type. |
| **Graph** | Force-directed graph of notes, attachments, tags and unresolved links. Filters, color groups, display and force controls, hover highlighting. A local graph pane follows the active note. |
| **File explorer** | Tree with inline rename, drag-and-drop move (links are updated automatically), multi-select, sorting, context menus, and reveal-active-file. |
| **Sidebars** | Two sidebars with tabbed, splittable pane groups: Files, Search, Bookmarks, Tags, Backlinks (with unlinked mentions), Outgoing links, Outline and Local graph. Drag pane icons between sidebars. |
| **Workspace** | Tabs, pinning, split right/down by drag or command, per-tab back/forward history, and layout persisted per vault. |
| **Command palette** | `Ctrl+P` for every command and `Ctrl+O` quick switcher (create-on-enter). Customizable hotkeys. |
| **Settings** | Editor, Files & links, Appearance, Hotkeys, Code editor, Code runner, Terminal, Core panes, About. |
| **Theming** | CSS-variable design tokens with Obsidian-compatible names. Dark/light/system mode, accent color, fonts, built-in themes (Nord, Dracula, Solarized, Gruvbox, Rosé Pine, Midnight), vault themes and CSS snippets, all applied live. Monaco, the terminal and the graph follow the theme. |

## Keyboard shortcuts (defaults)

| Action | Shortcut |
| --- | --- |
| Command palette | `Ctrl+P` |
| Quick switcher | `Ctrl+O` |
| New note / new note in tab | `Ctrl+N` / `Ctrl+Shift+N` |
| Toggle reading / editing | `Ctrl+E` |
| Graph view | `Ctrl+G` |
| Settings | `Ctrl+,` |
| Search in all files | `Ctrl+Shift+F` |
| Close tab / new tab | `Ctrl+W` / `Ctrl+T` |
| Split right | `Ctrl+\` |
| Toggle terminal panel | `` Ctrl+` `` |
| Toggle left / right sidebar | `Ctrl+Shift+L` / `Ctrl+Shift+R` |
| Back / forward | `Alt+←` / `Alt+→` |
| Run code block / file | `Ctrl+Shift+Enter` |
| Rename file | `F2` |

On macOS, `Ctrl` is `Cmd`. Every hotkey can be changed in **Settings → Hotkeys**.

## Theming

Themes are CSS files in `<vault>/.cs2d3k/themes/`, either `My Theme.css` or `My Theme/theme.css`. They override the design tokens:

```css
body.theme-dark {
  --color-base-00: #1a1b26;   /* editor background */
  --color-base-20: #16161e;   /* sidebars */
  --color-base-100: #c0caf5;  /* text */
  --code-keyword: #bb9af7;
}
body.theme-light { /* ... */ }
```

**Settings → Appearance → New theme…** creates a commented template. Snippets in `.cs2d3k/snippets/*.css` are toggled one by one. Saving any theme or snippet file reloads it live. Variable names follow Obsidian's (`--background-primary`, `--text-normal`, `--interactive-accent`, …), so many Obsidian snippets work unchanged.

## Canvas format

`.canvas` files are [JSON Canvas](https://jsoncanvas.org) with one extra node type:

```json
{ "id": "a4", "type": "code", "language": "python", "code": "print('hi')", "x": 0, "y": 0, "width": 360, "height": 220 }
```

## Architecture

```
src/main/        Electron main process: vault FS + watcher (chokidar), search, config,
                 pty terminals (@lydell/node-pty), code runner, vault:// protocol
src/preload/     contextBridge → window.api (typed in src/shared/api.ts)
src/renderer/src/
  store/         zustand stores: vault, workspace (tabs/splits/sidebars/bottom panel),
                 settings, metadata (link/tag index), commands, ui, bookmarks
  lib/           file ops (rename with link updating), markdown parse/render, code runner
  components/    shell: ribbon, sidebars, tab/split layout, status bar, palette, dialogs
  panes/         sidebar panes
  views/         markdown, code (Monaco), canvas, graph, image/pdf/media
  settings/      settings modal
  theme/         theme manager + built-in themes
  styles/        design tokens + shell + markdown CSS
e2e/             Playwright-Electron scripts (screenshots to e2e/screenshots)
sample-vault/    demo content
```

## Tests and benchmarks

See **[TESTING.md](TESTING.md)**. It is modelled on Logseq: unit tests mirror the source tree, there is one end-to-end spec per feature area against the real Electron app, plus performance budgets and CI.

```bash
npm run test:unit       # Vitest (main + renderer, ~1,135 tests)
npm run build
npm run test:e2e        # Playwright end-to-end suite (fresh app + vault per test)
npm run test:perf       # performance budgets (@perf)
npm run test:all        # typecheck + unit + build + every e2e project
node bench/run.mjs      # graph / canvas / form-map frame-rate benchmarks (uncapped) -> bench/results/
```

Code-quality audit and remaining risks: [QUALITY.md](QUALITY.md). Benchmarks and optimizations: [PERFORMANCE.md](PERFORMANCE.md).
