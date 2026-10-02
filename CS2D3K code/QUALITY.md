# CS2D3K — robustness & quality audit

Scope: everything under `src/` — the main process (vault fs, watcher, search, terminal, runner, IPC, `vault://`), the preload, and the renderer (stores, lib, components, panes, settings, theme, and the markdown/code/canvas/graph/formmap views). Audit date: 2026-10-02.

## Overall assessment

The codebase is in good shape for its age. Paths are vault-relative everywhere, and `Vault.abs()` contains them correctly. Canvas parsing is defensive: ids are de-duplicated, numbers are coerced, and an invalid file is not overwritten until the user edits it. Editors keep their save path in a ref, the Monaco model layer never drops unsaved work, and listeners and observers are almost always cleaned up.

The serious problems were at the edges:

1. **A note could take over the app.** Notes render with `html: true` and nothing sanitized the output. On top of that, the `vault://` scheme was registered with `bypassCSP`. Together this meant a note containing an `<iframe srcdoc>` could load a script from the vault into a frame with the same origin as the app, reach `window.top.api`, and drive the terminal or runner. That is arbitrary code execution just from *opening* a note in an untrusted vault. Separately, `will-navigate` let a link in a note navigate the window to any `file:` page, or to any URL starting with `http://localhost` (including `http://localhost.evil.com`). Such a page loads with the preload, so it gets `window.api` too.
2. **Saves raced with rename, delete, vault switch and quit.** Mutations ran concurrently in the main process. Debounced saves were flushed fire-and-forget, and a delete never flushed at all. Any of these could leave a resurrected file or a duplicate.
3. **One bad file could blank the whole app.** There was no React error boundary, so a single unexpected value (for example a form-map card whose `kind` the app doesn't know) unmounted the entire window.

All three are fixed. Every fix has at least one regression test, and every test was checked against the defect it guards.

Verification at the end of the audit:
- `npx vitest run`: 49 files, 1050 tests, all passing.
- `tests/e2e/robustness.basic.spec.ts`: 11 of 11 passing.
- The other basic e2e specs on the audit build: 196 of 196 pass. One tabs/splits test failed once at 3 workers and passed on its own, so it looks timing-sensitive.
- `npm run typecheck`: clean.

## Findings

Severity: **critical** = remote/untrusted-content code execution or silent data loss in normal use; **high** = data loss or app-wide crash under plausible conditions; **medium** = data loss or leaks in narrower conditions, defense-in-depth security; **low** = minor/edge.

| id | sev | area | description | status |
| --- | --- | --- | --- | --- |
| S1 | critical | security: `vault://` + markdown | `vault` was registered with `bypassCSP: true`, and raw HTML in notes was not sanitized. `<iframe srcdoc="<script src='vault://local/x.js'>">` ran a vault script in a same-origin frame, which could reach `window.top.api`: terminal, runner and file system. That is RCE when opening a note. | **fixed**: `bypassCSP` removed (`src/main/index.ts`; `vault:` added to CSP `frame-src` for PDFs). Rendered HTML is sanitized (`sanitizeHtml` in `lib/markdown/render.ts`). It drops `script/object/embed/meta/base/link/frame`, `on*` handlers and `srcdoc`; strips `javascript:`/`vbscript:`/`file:`/`data:` (non-image) URLs; and sandboxes https iframes. Tests: e2e `robustness: hostile notes › raw HTML in a note cannot run scripts…`, e2e `robustness: CSP blocks vault scripts even without the sanitizer` (verified to fail with `bypassCSP`), unit `render.security.test.ts` |
| S2 | high | security: window | `will-navigate` allowed every `file:` URL and every URL starting with `http://localhost` (`http://localhost.evil.com`). A link, form or `<meta refresh>` in a note could load another page into the app window, and that page gets the preload's `window.api`. | **fixed**: the window only allows a reload of its own URL. Web links open in the browser and everything else is blocked. Test: e2e `robustness: window hardening › the app window refuses to navigate to other pages` |
| S3 | high | security: IPC | Config names weren't validated. `config:read/write('../../x')` could read or write `*.json` anywhere, and `config:openFolder(sub)` passed any path to `shell.openPath`. | **fixed**: names must match `^[\w-]+$`; `configPath()` is contained in `.cs2d3k`; `openFolder` only accepts `themes` / `snippets`. Tests: unit `vault.robustness.test.ts › config names cannot escape .cs2d3k` |
| S4 | medium | security: runner | Raw HTML could fake a ▶ Run button (`class="code-block-run"`) labelled anything, with hidden code that runs on click. | **fixed**: only buttons rendered from real fences carry a per-session `RUN_TOKEN`. Tests: unit `MarkdownPreview.robustness.test.tsx › ignores a Run button injected through raw HTML`, `render.security.test.ts › run buttons`, e2e hostile notes |
| S5 | medium | security: paths | `Vault.abs()` rejected every path when the vault is a drive root (`C:\`), because the root already ends with the separator. | **fixed**. Test: unit `vault.robustness.test.ts › abs() at a drive / file-system root` |
| D1 | high | data loss: save vs rename/delete | Main-process mutations ran concurrently. A debounced save flushed just before a rename or trash could finish after it, recreating the old path (a duplicate or resurrected note). `deletePath` didn't flush pending saves, so the editor that the delete closed saved again on unmount and recreated the file. | **fixed**: `Vault` runs writes, creates, mkdir, rename, trash, copy and config writes one at a time, in IPC order (`serial`). `deletePath` calls `flushAll()` before trashing. Tests: unit `vault.robustness.test.ts › mutations run in call order` (verified to fail without the queue), `fileops.robustness.test.ts › deletePath with a pending save`, e2e `deleting a note right after typing does not resurrect it`, `renaming a note right after typing keeps the text…` |
| D2 | medium | data loss: quit / vault switch | `window-all-closed` quit right away, while saves flushed in `beforeunload` could still be in flight. Opening or closing a vault disposed it without waiting for queued writes. | **fixed**: `vault.idle()` is awaited before quitting, switching or closing. Test: unit `idle() waits for queued writes` (no e2e for quit) |
| D3 | medium | data loss: config | An unparsable config (a hand-edited `app.json`, `workspace.json`, `bookmarks.json` or `graph.json`) was read as "missing", and the next settings change silently overwrote the user's file with defaults. | **fixed**: the file is copied to `<name>.json.bak` before the app saves over it. Tests: unit `corrupt config`, e2e `robustness: corrupt config` |
| D4 | medium | data loss: watcher echo | A late watcher echo of an *earlier* save (read back after a newer save was sent) looked like an external edit. The editor rolled back and the pending save of what the user had typed since was cancelled. | **fixed**: contents written in the last 3s are recognised as echoes (`recentWrites`). Metadata is no longer reverted by echoes. Test: unit `fileops.robustness.test.ts › watcher echoes` |
| D5 | medium | data loss: vault switch | Pending debounced workspace and settings saves fired after `closeVault`, which gave an unhandled rejection or wrote into the *next* vault. Graph settings were cached for the session and written into the next vault's `graph.json`. | **fixed**: `flushWorkspace()` / `flushSettings()` run on close and unload, and `workspace.reset()` cancels a pending save. Graph settings reload per vault. Tests: unit `workspace.robustness.test.ts`, `graph/settings.robustness.test.ts` |
| D6 | low | data loss: canvas | An unreadable canvas (locked, EBUSY, permissions) looked like a valid empty canvas, so the first edit replaced the real content. | **fixed**: flagged `invalid`, with the existing "will not be modified unless you add something" hint. Test: unit `useCanvasDoc.robustness.test.ts` |
| D7 | medium | data loss: canvas | Canvas and form-map save failures (read-only file, disk full…) were only logged to the console. The user believed the file was saved, and the same content was never retried. | **fixed**: a notice is shown and the next change retries. Test: unit `useCanvasDoc.robustness.test.ts › a failed save is reported…` |
| D8 | medium | data loss: rename | On a case-sensitive file system, renaming `a.md` → `A.md` overwrote an existing `A.md`. | **fixed** (by the unit-test agent: `sameFile` check in `Vault.rename`). Test: e2e `case-only rename works and keeps the tab` (case-insensitive path), plus their unit tests |
| D9 | low | link rewriting | When a note moved, its own heading links (`[[#H]]`, `[x](#H)`) were rewritten to `[[Note#H]]`. | **fixed** (by the unit-test agent, in `renamePath`). Test: unit `fileops.robustness.test.ts › leaves same-note heading links…` |
| C1 | high | crash | There was no error boundary, so a render exception in any view or pane blanked the whole window. Real trigger: a `.formmap` card with an unknown `kind` (or `fields: "x"`, a bad `relation`…) threw `Cannot read properties of undefined (reading 'label')` in the lenses and inspector. | **fixed**: `components/ErrorBoundary.tsx` wraps each view (Layout) and sidebar pane (Sidebar). `normalizeFormMap()` (schema.ts) repairs odd form-map data in memory when it loads (`useCanvasDoc(path, normalize)`) without touching the file. Tests: unit `ErrorBoundary.test.tsx`, `schema.robustness.test.ts`, e2e `robustness: malformed files › every malformed file opens without crashing a view…` |
| C2 | low | crash / console | The form-map minimap computed `NaN` coordinates for an empty or invalid map before it was measured, causing SVG console errors. | **fixed** (`map/Minimap.tsx`). Test: e2e malformed files (console errors fail the test) |
| C3 | low | unhandled errors | `[[Why?]]` (or a quick-switcher name with `? : * " < > \|`) failed to create on Windows with an unhandled rejection, and nothing visible happened. | **fixed**: an error notice is shown. Test: unit `fileops.robustness.test.ts › openLinkText for a name the file system rejects` |
| C4 | low | unhandled errors | Runner rejections in the reading view left the block stuck on "Running…". Config writes were `void`ed, giving unhandled rejections after a vault closed. If `taskkill` failed to spawn there was no `error` listener, which crashes the main process. | **fixed** (handlers added; no dedicated test) |
| R1 | medium | leaks: processes | Runner processes survived a vault close or switch, a window reload, a renderer crash and quitting. Terminal ptys survived reloads. Snippets started from the reading view survived closing the tab, and nothing in the UI could stop them. | **fixed**: `killAllRuns()`; terminals and runs are killed on `did-navigate`, `render-process-gone`, vault open/close and quit; `MarkdownPreview` kills its runs on unmount. Tests: unit `runner.robustness.test.ts`, `MarkdownPreview.robustness.test.tsx › kills a snippet…`, e2e `reloading the window stops running snippets and terminal processes` |
| R2 | medium | robustness: fs | A symlink or junction pointing at an ancestor made `Vault.list()` recurse until path limits, re-walking the whole vault at each level (exponential with two loops), so opening the vault hung. | **fixed**: folders are visited once, by real path. Test: unit `vault.robustness.test.ts › symlink loops` |
| E1 | low | edge: names | Names with `#`, `%`, `&`, spaces and unicode in `resourceUrl` / `vault://`. | verified OK (no change). Test: e2e `robustness: special file names`. `#` can only be linked via a markdown link, because in a wikilink it starts a heading (same as Obsidian) |
| E2 | low | edge: malformed files | Invalid or unclosed frontmatter, NUL bytes in a `.md`, 0-byte `.md`/`.canvas`/`.formmap`, CRLF, a 200k-char line, truncated JSON, a top-level JSON array, dangling edges and duplicate ids. | verified OK, nothing rewritten just by opening. Test: e2e malformed files |
| A1 | medium | security: symlinks | `abs()` checks paths lexically. A symlink *inside* the vault can point outside it, and reads and writes follow it. | **accepted risk**: same as Obsidian and created by the user. See recommendations |
| A2 | medium | data loss: partial writes | `writeFile` truncates and then writes, so a crash or power loss mid-write can leave a truncated note or config (observed: a canvas truncated to 512 KiB / 0 bytes when the app closed mid-save). | **fixed** — `durableWrite` in `src/main/vault.ts` (notes + config): complete copy to a hidden journal first (temp + fsync + atomic rename), then in-place write + fsync, then the journal is removed; `recoverInterruptedWrites()` runs when a vault opens and restores any note whose save was cut short. In-place writing keeps file identity (created time, hard links, ACLs) — a rename-based save would reset Windows created time on every save. Tests: `tests/unit/main/vault.atomic.test.ts`. |
| A3 | low | data loss: trash | If `shell.trashItem` fails (network drives, some Linux setups), `trash()` silently falls back to a permanent `rm -rf`. | **not fixed**: should ask first (needs a UI decision) |
| A4 | low | security: open with default app | `fs:openDefault` runs `.exe`, `.bat`, `.lnk` and similar files from the vault via `shell.openPath`. | **accepted**: explicit user action from the context menu |
| A5 | low | edge: CRLF | The markdown editor (CodeMirror) saves CRLF files with LF on the first edit. Monaco keeps the file's line endings. | **accepted** (Obsidian-like) |
| A6 | low | perf / edge | The markdown view has no size or binary guard (the code view has 5 MB and NUL detection). A huge `.md` is slow, and editing a binary `.md` corrupts it. | **not fixed**: lives in the editors owner's view; reuse the CodeView guards |
| A7 | low | data loss: concurrent edits | A true external edit while typing replaces the editor content and drops up to 400 ms of unsaved typing, with no conflict prompt. The code view does ask. | **accepted** (Obsidian-like) |
| A8 | low | perf | A user-supplied search regex runs in the main process, so a catastrophic pattern can freeze the app. | **not fixed**: move search to a worker or add a time budget |
| A9 | low | security hardening | `sandbox: false` for the preload, and the CSP has `'unsafe-eval'` (Monaco). | **not fixed**: the preload only uses `contextBridge`/`ipcRenderer`, so `sandbox: true` should work; needs testing with Monaco and node-pty |
| A10 | low | link rewriting | Rename link rewriting is text based, so a link text inside a fenced code block is rewritten too when the same link also appears in prose. | **not fixed** (rare) |
| A11 | low | edge: deleted files | A file deleted outside the app while its tab is open keeps the tab, and the next edit recreates the file. Obsidian closes the tab. | **not fixed** (behavioural choice) |
| A12 | low | perf | Bulk adds (git checkout) read and re-index each indexed file one IPC at a time, with a store update per file. `metadata.updateContent` copies whole maps on each (debounced) edit. | **accepted** for typical vault sizes |
| A13 | low | leaks | The terminal router buffers output for a pty that was killed before it attached (bounded to 1000 chunks) and never clears it. | **accepted** (tiny) |
| A14 | n/a | runner | Code execution is intended. All four entry points (reading-view button, live-preview button, canvas code node, code view F5 / Run) are explicit user actions on visible code. Raw-HTML lookalikes are rejected (S4). | **verified** |

## Files changed

Main / preload:
- `src/main/vault.ts`
  - serialized mutation queue + `idle()`
  - `abs()` works at drive roots
  - `configPath()` / `configFile()` containment and name validation
  - corrupt-config `.bak`
  - symlink-loop guard in `list()`
- `src/main/index.ts`
  - no `bypassCSP`
  - strict `will-navigate`
  - kill terminals and runs on `did-navigate` / `render-process-gone` / vault open/close / quit
  - wait for `vault.idle()` before switching vaults or quitting
  - `config:openFolder` whitelist
- `src/main/runner.ts`: `killAllRuns()`; `taskkill` error handler.
- `src/renderer/index.html`: CSP `frame-src https: vault:`.

Renderer:
- `src/renderer/src/lib/markdown/render.ts`: `sanitizeHtml`, `RUN_TOKEN`.
- `src/renderer/src/lib/markdown/MarkdownPreview.tsx`
  - run-token check
  - runs tracked per preview and killed on unmount
  - runner rejection handled
- `src/renderer/src/lib/fileops.ts`
  - `deletePath` flushes first
  - recent-write echo filter
  - `openLinkText` create errors
- `src/renderer/src/lib/bootstrap.ts`, `src/renderer/src/main.tsx`: flush workspace and settings on close / unload.
- `src/renderer/src/store/workspace.ts`, `src/renderer/src/store/settings.ts`, `src/renderer/src/store/bookmarks.ts`
  - `flushWorkspace` / `flushSettings`
  - `reset()` cancels pending saves
  - write errors caught
- `src/renderer/src/components/ErrorBoundary.tsx` (new), `src/renderer/src/components/Layout.tsx`, `src/renderer/src/components/Sidebar.tsx`: boundaries around views and panes.
- `src/renderer/src/components/QuickSwitcher.tsx`: create errors shown.
- `src/renderer/src/views/canvas/useCanvasDoc.ts`
  - optional `normalize`
  - read error → `invalid`
  - save errors shown and retried
- `src/renderer/src/views/formmap/schema.ts` (`normalizeFormMap`, added export), `src/renderer/src/views/formmap/FormMapView.tsx` (uses it), `src/renderer/src/views/formmap/map/Minimap.tsx` (NaN guard).
- `src/renderer/src/views/graph/settings.ts`: reload per vault.

## Tests added

- `tests/unit/main/vault.robustness.test.ts` (12)
- `tests/unit/main/runner.robustness.test.ts` (1)
- `tests/unit/renderer/lib/fileops.robustness.test.ts` (5)
- `tests/unit/renderer/lib/markdown/render.security.test.ts` (7)
- `tests/unit/renderer/lib/markdown/MarkdownPreview.robustness.test.tsx` (2)
- `tests/unit/renderer/views/canvas/useCanvasDoc.robustness.test.ts` (3)
- `tests/unit/renderer/views/formmap/schema.robustness.test.ts` (2)
- `tests/unit/renderer/views/graph/settings.robustness.test.ts` (1)
- `tests/unit/renderer/components/ErrorBoundary.test.tsx` (1)
- `tests/unit/renderer/store/workspace.robustness.test.ts` (2)
- `tests/e2e/robustness.basic.spec.ts` (11): hostile notes, window navigation, CSP vs `vault://` scripts, delete/rename right after typing, case-only rename, malformed files, corrupt config, special file names, PDF frames, processes vs reload

## Remaining risks & recommendations

1. ~~**Atomic writes (A2).**~~ Done (write-ahead journal + recovery on open).
2. **Hostile-vault threat model.** The sanitizer and the CSP now close the known script paths. Next steps:
   - enable `sandbox: true` for the preload (A9) and drop `'unsafe-eval'` if Monaco allows;
   - consider an "untrusted vault" mode (Obsidian's "restricted mode") that disables raw HTML and runners until the user trusts the vault;
   - resolve symlinks (`realpath`) in `abs()` if vaults from strangers are in scope (A1).
3. **Trash fallback (A3).** Ask before deleting permanently when the OS trash is unavailable.
4. **Markdown view guards (A6).** Reuse CodeView's size and NUL checks: show "File is too large / binary" with an "Open anyway" button.
5. **External edit while typing (A7).** Mirror the code view: if the editor has unsaved changes, ask before reloading (or merge when the edits don't overlap).
6. **Search (A8).** Run regex search in a worker thread with a time budget, and stream results.
7. **Deleted-file tabs (A11).** Close the tab (or mark it "deleted") on an external `unlink`, so the next keystroke doesn't recreate the file.
8. **Process ownership.** Runs from the code view intentionally keep streaming to the Output panel after the tab closes. They now stop on reload, vault close and quit, but a "running processes" indicator in the status bar would make them discoverable.
9. Keep the rule that every new raw-HTML sink (`innerHTML`) goes through `renderMarkdown` or `escapeHtml`. A lint rule against `innerHTML =` outside those helpers would enforce it.
