import { defineConfig } from '@playwright/test'

/**
 * E2E suite (modelled on Logseq's clj-e2e):
 *   tests/e2e/<feature>.basic.spec.ts — one spec per feature area, fresh app + vault per test
 *   tests/e2e/<feature>.perf.spec.ts  — performance budgets (tagged @perf)
 * The app must be built first (`npm run build`). On failure each test attaches a screenshot,
 * the renderer console log and the vault's file listing (see tests/e2e/fixtures.ts).
 */
// overridable so several runs can happen concurrently (e.g. CS2D3K_OUT=out-x PW_OUT=x npx playwright test …)
const OUT = process.env.PW_OUT ? `test-results-${process.env.PW_OUT}` : 'test-results'
const REPORT = process.env.PW_OUT ? `test-report-${process.env.PW_OUT}` : 'test-report'

export default defineConfig({
  testDir: 'tests/e2e',
  testMatch: /.*\.spec\.ts/,
  outputDir: OUT,
  timeout: 90_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  // each worker runs its own Electron instance; keep it modest so timing-sensitive UI stays stable
  workers: process.env.CI ? 2 : 3,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list'], ['html', { open: 'never', outputFolder: REPORT }], ['junit', { outputFile: `${OUT}/junit.xml` }]],
  projects: [
    { name: 'basic', grepInvert: /@perf/ },
    { name: 'perf', grep: /@perf/, workers: 1 }
  ]
})
