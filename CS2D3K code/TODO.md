# CS2D3K — build TODO

Obsidian-like knowledge base + code workspace. Electron + React + TS.

> Status: **all items complete.** Verified by e2e suites (smoke, shell, fileops, tour, markdown, canvas, graph, code) with zero console errors.

## Phase 1 — Foundation
- [x] 1. Scaffold electron-vite project (main / preload / renderer), TS, deps
- [x] 2. Main process: vault FS API (tree, read, write, create, rename, move, delete), file watcher, recent vaults, dialogs
- [x] 3. Preload bridge (`window.api`) + shared types
- [x] 4. Renderer state stores (vault, workspace/layout, settings, metadata index)
- [x] 5. Vault picker / welcome screen (open folder, create vault, recent vaults)

## Phase 2 — Shell / Layout
- [x] 6. App shell: ribbon, left sidebar, main workspace, right sidebar, status bar, bottom panel
- [x] 7. Resizable + collapsible sidebars, sidebar tab system (pluggable panes)
- [x] 8. Workspace tabs + split panes (split right / down), drag tabs, persist layout
- [x] 9. Command system: command registry, command palette (Ctrl+P), hotkeys, quick switcher (Ctrl+O)
- [x] 10. Context menus + modal/prompt primitives + notices (toasts)

## Phase 3 — Core panes
- [x] 11. File explorer: tree, expand/collapse, create file/folder, rename inline, delete, drag-move, sort, reveal active file
- [x] 12. Search pane (full text, with results + match highlighting)
- [x] 13. Metadata index: wikilinks, md links, tags, headings, frontmatter; link resolution
- [x] 14. Backlinks pane, Outgoing links pane, Outline pane, Tags pane

## Phase 4 — Note viewer / editor
- [x] 15. CodeMirror 6 markdown editor (source mode), autosave
- [x] 16. Live preview decorations (hide markup, headings, bold/italic, links, checkboxes, inline code, hr)
- [x] 17. Reading view (rendered markdown: wikilinks, embeds, callouts, tasks, code highlight, tables)
- [x] 18. Wikilink autocomplete `[[`, click-to-follow links, create-on-click for unresolved
- [x] 19. Runnable code blocks (js/ts/python/shell/etc.) with inline output

## Phase 5 — Code
- [x] 20. Monaco code editor view for code files (language detection, theme sync, save)
- [x] 21. Integrated terminal (xterm + node-pty), multiple terminals, bottom panel
- [x] 22. Code runner service in main (configurable per-language commands)

## Phase 6 — Canvas (custom)
- [x] 23. Canvas data model + file format (.canvas JSON, superset of JSON Canvas)
- [x] 24. Infinite pan/zoom viewport, grid background
- [x] 25. Nodes: text (markdown), file/note embed, link, group, **code** (Monaco/CM editable + run)
- [x] 26. Selection, multi-select (box), drag, resize, delete, duplicate, undo/redo
- [x] 27. Edges: connect from node sides, curved edges, arrows, labels, colors
- [x] 28. Canvas toolbar, context menu, drag files from explorer onto canvas, zoom-to-fit

## Phase 7 — Graph
- [x] 29. Global graph view (d3-force simulation on HTML canvas), pan/zoom, drag nodes, hover highlight, click to open
- [x] 30. Graph settings panel (filters: tags, attachments, orphans, search; forces; display)
- [x] 31. Local graph (right sidebar) for active note with depth

## Phase 8 — Settings + Theming
- [x] 32. Settings modal (Editor, Files & links, Appearance, Hotkeys, Code runner, Terminal, Core panes, About)
- [x] 33. Theming: CSS variables, light/dark, accent color, font settings
- [x] 34. Theme manager: built-in themes + vault themes folder, CSS snippets toggle, live reload
- [x] 35. Monaco + CM6 + xterm themes follow the app theme

## Phase 9 — Polish & verification
- [x] 36. Persist workspace (open tabs, sidebars, sizes) per vault
- [x] 37. Sample/demo vault content
- [x] 38. Typecheck clean, build passes
- [x] 39. End-to-end smoke test with Playwright-Electron (screenshots of every feature)
- [x] 40. README with usage + architecture

## Phase 10 — CS2D3K + Form-map
- [x] 41. Rename product Vaultide → CS2D3K (UI, package, `.cs2d3k` config dir with migration from `.vaultide`)
- [x] 42. Form-map schema (typed cards, zones, relations), templates, `.formmap` file type plumbing
- [x] 43. Canvas engine refactor (shared by canvas + form-map) — no `.canvas` regression
- [x] 44. Map lens: form cards, semantic zones, relations, why-trace, mind-map keys, minimap, align/tidy, pen, pitch mode
- [x] 45. Inspector (Card / Coach / Map), Board, Table, Doc (export Project Definition) lenses
- [x] 46. Fun layer: confetti, HUD, dot votes, fun rating, Spark prompts
- [x] 47. Seeded `CS2D3K Definition.formmap` from the CS2D3K-doc vault

## Phase 11 — Quality, tests, performance
- [x] 48. Test infrastructure modelled on Logseq (Vitest unit tests mirroring src/, Playwright e2e per feature area, fixtures, failure dumps, perf budgets, CI)
- [x] 49. Unit suite: 1,093 tests (main process, lib, stores, theme, canvas/graph/editor/form-map logic)
- [x] 50. E2E suite: 254 tests (250 basic + 4 perf) against the real Electron app
- [x] 51. Robustness & security audit (QUALITY.md) — XSS→code execution, navigation, config path escape, save races, crash isolation, process leaks, crash-safe saves
- [x] 52. Benchmark harness (bench/) + profiling; graph WebGL2 + worker simulation; canvas/form-map culling + LOD (PERFORMANCE.md)
