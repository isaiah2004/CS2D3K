# CS2D3K

**Constrained State Space Documentation Defined Development Kit** — pronounced *CS2-Deck*.

CS2D3K is a new way to write software with AI. Its goal is to bring out every ounce of ability in AI models while building
**Secure, Scalable and Satisfying** software, in that order. Documentation defines the project, agents do the mundane
work, and the fun comes back into software development.

This repository contains two things:

| Folder | What it is |
| --- | --- |
| [`CS2D3K-doc/`](CS2D3K-doc/) | The product definition: an Obsidian vault with the beliefs, the UI layout (Idea, Task Queue, Dev Agent and Review panels) and the project model (Definition → Architecture → Code). |
| [`CS2D3K code/`](CS2D3K%20code/) | **The CS2D3K desktop app**: an Obsidian-style knowledge base with first-class code support, built to work on CS2D3K projects. |

![Graph of the whole Bible: 32,359 notes and 364k links](CS2D3K%20code/docs/images/graph-bible.png)
<sub>The graph view rendering the King James Bible: 31,102 verse notes and the OpenBible.info cross-references, drawn with WebGL2.</sub>

## The app

An Electron + React + TypeScript desktop app. Any folder of Markdown files is a vault.

| | |
| --- | --- |
| ![Note editor with live preview](CS2D3K%20code/docs/images/note-live-preview.png) | ![Form-map with groups, cards and a kanban node](CS2D3K%20code/docs/images/formmap-sprint-map.png) |
| **Notes**: CodeMirror 6 editor with Live Preview, Source and Reading modes. Wikilinks, embeds, callouts, tasks, properties, backlinks, outline, and **runnable code blocks**. | **Form-map**: a more advanced canvas. Plain cards with free tags and typed fields, groups that give cards meaning (and nest), kanban boards made from groups and kanban nodes on the canvas, relations, a Why-trace, a Coach, and Pitch mode. |
| ![Canvas](CS2D3K%20code/docs/images/canvas.png) | ![Bible verse note](CS2D3K%20code/docs/images/bible-verse.png) |
| **Canvas**: an infinite canvas built from scratch, with cards, note and file embeds, web pages, groups, edges, and **code cells you can run**. | **Big vaults**: the full King James Bible as 32k linked notes, each verse with its real cross-references. |
| ![Code editor and terminal](CS2D3K%20code/docs/images/code-terminal.png) | ![Settings and themes](CS2D3K%20code/docs/images/settings-themes.png) |
| **Code**: Monaco editor for every code file, run-file, an integrated terminal (xterm.js + node-pty) and an Output panel. | **Theming**: dark/light, accent colour, built-in themes, vault themes and CSS snippets, all applied live. |
| ![Loading screen](CS2D3K%20code/docs/images/loading-screen.png) | ![Board lens built from groups](CS2D3K%20code/docs/images/formmap-board.png) |
| **Loading**: big vaults open behind a live loading screen, where the real graph assembles as notes are read. A metadata cache then makes re-opening the 32k-note Bible take about 1.5 s. | **Kanban**: saved boards built from canvas groups (columns = groups) or from a field, live-synced with the canvas, plus self-contained kanban nodes you place on the map. |


Also included: two configurable sidebars, tabs and splits, a command palette and quick switcher, custom hotkeys,
full-text search, bookmarks, a tags pane, and a local graph.

### Quick start

```bash
cd "CS2D3K code"
npm install
npm run dev          # development
npm run build        # production build
npm start            # run the production build
```

Open `CS2D3K code/sample-vault` to try everything, including the `CS2D3K Definition` form-map (built from the doc vault,
with the Product Definition example template) and the `Sprint board` form-map (saved boards and a kanban node). To generate the full KJV Bible vault (32k notes with real cross-references), run
`node scripts/gen-bible.mjs` (output in `CS2D3K code/vaults/`, gitignored).

> If Electron starts as plain Node from your terminal, unset `ELECTRON_RUN_AS_NODE`.

### Quality and performance

- **Tests**, modelled on Logseq: about 1,135 Vitest unit tests that mirror the source tree, plus about 270 Playwright
  end-to-end tests that drive the real Electron app (a fresh app and vault per test, failure dumps, perf budgets).
  CI is in `.github/workflows/test.yml`. See [TESTING.md](CS2D3K%20code/TESTING.md).
- **Robustness and security audit**: [QUALITY.md](CS2D3K%20code/QUALITY.md).
- **Performance**: the graph view renders the 32k-note Bible at over 1,000 fps uncapped, and vaults under 10k notes at
  about 2,000–3,000 fps. Canvas and form-map pan at about 1,000 fps with 3,000 cards. See
  [PERFORMANCE.md](CS2D3K%20code/PERFORMANCE.md).

More docs: [app README](CS2D3K%20code/README.md) · [form-map design](CS2D3K%20code/FORMMAP.md) ·
[contributor brief](CS2D3K%20code/AGENTS.md).

## Credits

- Bible text: King James Version (public domain). Cross-references:
  [OpenBible.info](https://www.openbible.info/labs/cross-references/) (CC-BY). Both are used only by the optional
  vault generator.
- Built on Electron, React, CodeMirror, Monaco, xterm.js, markdown-it and highlight.js.
