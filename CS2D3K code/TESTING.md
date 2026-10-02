# CS2D3K test suite

Modelled on [Logseq](https://github.com/logseq/logseq)'s setup (`src/test` unit tests mirroring the source tree,
`clj-e2e` feature-area end-to-end tests with shared helper namespaces, fixtures that open a fresh app,
failure dumps with screenshots + console logs, performance tests with budgets, focus tags, CI workflows).

| Layer | Tool | Location | Run |
| --- | --- | --- | --- |
| Unit (main process, node) | Vitest | `tests/unit/main/**`, `tests/unit/shared/**` | `npm run test:unit` |
| Unit (renderer, jsdom) | Vitest | `tests/unit/renderer/**` | `npm run test:unit` |
| End-to-end (real Electron app) | Playwright Test | `tests/e2e/*.basic.spec.ts` | `npm run build && npm run test:e2e` |
| Performance budgets | Playwright Test | `tests/e2e/*.perf.spec.ts` (tag `@perf`) | `npm run test:perf` |
| Everything | | | `npm run test:all` |

## Conventions

### Unit tests
- **Mirror the source tree**: `src/renderer/src/lib/fileops.ts` → `tests/unit/renderer/lib/fileops.test.ts`,
  `src/main/vault.ts` → `tests/unit/main/vault.test.ts`.
- Renderer tests run in jsdom with an **in-memory `window.api`** (`tests/unit/helpers/memoryApi.ts`), installed by
  `tests/unit/helpers/setup-renderer.ts`. Use `loadTestVault({ 'path.md': 'content', … })` from
  `tests/unit/helpers/vault.ts` to reset all stores and load + index a fixture vault (like Logseq's `load-test-files`).
  Inspect writes with `mem.files` / `mem.writes`, simulate watcher events with `mem.emitFs([...])`.
- Main-process tests use real temp directories (`fs.mkdtempSync(os.tmpdir())`), never the repo.
- Test behaviour, not implementation details. Each bug fix gets a regression test.
- Focus: `it.only` / `describe.only`, or `npx vitest run -t "name"`.

### End-to-end tests
- One spec per feature area: `tests/e2e/<area>.basic.spec.ts`, every `describe` title includes `@basic`.
  Perf specs: `tests/e2e/<area>.perf.spec.ts`, tag `@perf`. Temporarily tag `@focus` and run `npm run test:e2e:focus`.
- Import `test`/`expect` from `./fixtures`. Each test gets a **fresh Electron app + fresh copy of a vault**
  (default `sample-vault/`; choose with `test.use({ vault: { source: 'empty' | 'sample' | '<fixture>' , files: {...} } })`,
  fixture vaults live in `tests/e2e/fixtures/vaults/<name>/`).
- **Any renderer console error fails the test** (allow-list with `test.use({ allowConsoleErrors: [/regex/] })` only for
  genuinely external noise). On failure the report gets a screenshot, the console log and the vault file listing.
- Helpers (page objects, cf. Logseq's `block`/`page`/`graph` namespaces) live in `tests/e2e/helpers/`. `App`
  (`helpers/app.ts`) gives: `openFile`, `treeItem`, `runPaletteCommand`, `command(id)`, `layout()`, `activeFile()`,
  `state(store, pickFnSource)`, `setSetting`, `setTheme`, `contextMenu`, `activeView()`, disk helpers `read`, `readJson`,
  `exists`, `writeExternal` (exercises the watcher), `expectFile(rel, predicate)` (polls — saves are debounced).
  Add feature helpers as `helpers/<area>.ts`.
- The renderer exposes `window.__cs2d3k` in test mode (`CS2D3K_TEST=1`, see `src/renderer/src/lib/testHooks.ts`):
  stores, `executeCommand`, `layout()`, `fileops`, `ready()`. Prefer **user-visible interaction** (clicks, keys) for the
  behaviour under test, and use the hooks for setup and for asserting state that has no UI.
- Assert on **what the user sees and what lands on disk**. Use web-first assertions (`await expect(locator)…`,
  `expect.poll`) instead of fixed sleeps; never `waitForTimeout` more than ~300ms except for animations you document.
- Keep tests independent and parallel-safe; no shared state between tests.

### Running in parallel during development
Several people build/test at once: build into your own dir and isolate outputs:
`npx electron-vite build --outDir out-x` then `CS2D3K_OUT=out-x PW_OUT=x npx playwright test tests/e2e/<spec>`.
Note: the shell may have `ELECTRON_RUN_AS_NODE=1`; the fixture removes it.

## CI
`.github/workflows/test.yml`: typecheck → unit → build → e2e (basic) on Windows and Linux (xvfb), uploading the
HTML report and failure artifacts.
