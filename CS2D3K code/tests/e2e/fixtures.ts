// Shared e2e fixtures (cf. Logseq's clj-e2e fixtures.clj + custom_report.clj):
//  - every test gets a fresh Electron app, a fresh copy of a fixture vault and an isolated user-data dir
//  - renderer console errors fail the test (unless allowed)
//  - on failure: screenshot, console log and vault listing are attached to the report
//  - `relaunch()` restarts the app on the same vault + user data (persistence tests)
import { test as base, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test'
import { cpSync, mkdtempSync, rmSync, mkdirSync, readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'fs'
import { tmpdir } from 'os'
import { join, dirname } from 'path'
import { App } from './helpers/app'

export const ROOT = join(__dirname, '..', '..')
export const FIXTURE_VAULTS = join(__dirname, 'fixtures', 'vaults')

export interface VaultOption {
  /** name of a folder in tests/e2e/fixtures/vaults, 'sample' for sample-vault/, or 'empty' */
  source: string
  /** extra files written into the vault before launch (vault-relative path → content) */
  files?: Record<string, string>
  /** launch without CS2D3K_VAULT: the vault is still copied to `vaultDir`, but the app starts on the vault picker */
  noVault?: boolean
  /** JSON written to <userdata>/cs2d3k-state.json before launch (recent vaults, last vault, window bounds) */
  userState?: Record<string, unknown>
}

export interface LaunchOptions {
  /** start on the vault picker (no CS2D3K_VAULT) */
  noVault?: boolean
  /** absolute vault path to open (default: this test's `vaultDir`) */
  vaultPath?: string
}

export interface Launched {
  electronApp: ElectronApplication
  page: Page
  app: App
  /** ms from starting the Electron process until the app reported ready */
  readyMs: number
}

interface Session {
  apps: ElectronApplication[]
  pages: Page[]
  log: string[]
  errors: string[]
}

interface Fixtures {
  /** which fixture vault to copy (test.use({ vault: { source: 'basic' } })) */
  vault: VaultOption
  /** console error messages (regex) that won't fail the test */
  allowConsoleErrors: RegExp[]
  /** absolute path of this test's vault copy */
  vaultDir: string
  /** absolute path of this test's Electron user-data dir (shared by relaunches) */
  userDataDir: string
  electronApp: ElectronApplication
  page: Page
  /** high-level helpers (explorer, palette, editor, files…) */
  app: App
  /** close the running app and start it again on the same vault + user data; returns the new handles */
  relaunch: (opts?: LaunchOptions) => Promise<Launched>
  _session: Session
}

function listTree(dir: string, base = ''): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const rel = base ? `${base}/${name}` : name
    const abs = join(dir, name)
    out.push(rel)
    if (statSync(abs).isDirectory()) out.push(...listTree(abs, rel))
  }
  return out
}

async function launchElectron(vaultPath: string | null, userDataDir: string): Promise<ElectronApplication> {
  const env: Record<string, string> = { ...(process.env as Record<string, string>) }
  delete env.ELECTRON_RUN_AS_NODE
  delete env.CS2D3K_VAULT
  env.CS2D3K_TEST = '1'
  if (vaultPath) env.CS2D3K_VAULT = vaultPath
  env.CS2D3K_USER_DATA = userDataDir
  return electron.launch({ args: [join(ROOT, process.env.CS2D3K_OUT || 'out', 'main', 'index.js')], cwd: ROOT, env })
}

/** wire console capture, size the window and wait until the app is usable */
async function preparePage(electronApp: ElectronApplication, session: Session, allow: RegExp[], noVault: boolean): Promise<Page> {
  const page = await electronApp.firstWindow()
  session.pages.push(page)
  page.on('console', (m) => {
    session.log.push(`[${m.type()}] ${m.text()}`)
    if (m.type() === 'error' && !allow.some((r) => r.test(m.text()))) session.errors.push(m.text())
  })
  page.on('pageerror', (e) => {
    session.log.push(`[pageerror] ${e.stack ?? e}`)
    if (!allow.some((r) => r.test(String(e)))) session.errors.push(String(e))
  })
  await electronApp.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0]
    w.unmaximize()
    w.setSize(1500, 950)
  })
  await page.waitForFunction(() => !!window.__cs2d3k, null, { timeout: 30_000 })
  if (noVault) await page.locator('.vault-picker, .app .titlebar').first().waitFor({ timeout: 30_000 })
  else await page.evaluate(() => window.__cs2d3k!.ready())
  return page
}

export const test = base.extend<Fixtures>({
  vault: [{ source: 'sample' }, { option: true }],
  allowConsoleErrors: [[], { option: true }],

  vaultDir: async ({ vault }, use) => {
    const tmp = mkdtempSync(join(tmpdir(), 'cs2d3k-e2e-'))
    const dir = join(tmp, 'vault')
    if (vault.source === 'empty') mkdirSync(dir)
    else cpSync(vault.source === 'sample' ? join(ROOT, 'sample-vault') : join(FIXTURE_VAULTS, vault.source), dir, { recursive: true })
    for (const [rel, content] of Object.entries(vault.files ?? {})) {
      mkdirSync(dirname(join(dir, rel)), { recursive: true })
      writeFileSync(join(dir, rel), content)
    }
    await use(dir)
    try {
      rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
    } catch {
      /* electron may still hold a handle on Windows */
    }
  },

  userDataDir: async ({ vaultDir, vault }, use) => {
    const dir = join(dirname(vaultDir), 'userdata')
    if (vault.userState) {
      mkdirSync(dir, { recursive: true })
      writeFileSync(join(dir, 'cs2d3k-state.json'), JSON.stringify(vault.userState, null, 2))
    }
    await use(dir)
  },

  _session: async ({}, use) => {
    const session: Session = { apps: [], pages: [], log: [], errors: [] }
    await use(session)
    for (const a of session.apps) await a.close().catch(() => {})
  },

  electronApp: async ({ vaultDir, userDataDir, vault, _session }, use) => {
    const app = await launchElectron(vault.noVault ? null : vaultDir, userDataDir)
    _session.apps.push(app)
    await use(app)
  },

  page: async ({ electronApp, allowConsoleErrors, vault, _session }, use, testInfo) => {
    const page = await preparePage(electronApp, _session, allowConsoleErrors, !!vault.noVault)
    await use(page)

    if (testInfo.status !== testInfo.expectedStatus) {
      const last = _session.pages[_session.pages.length - 1] ?? page
      await testInfo.attach('screenshot', { body: await last.screenshot().catch(() => Buffer.alloc(0)), contentType: 'image/png' }).catch(() => {})
      await testInfo.attach('console.log', { body: _session.log.join('\n'), contentType: 'text/plain' })
    }
    // a feature that "works" but logs errors is a bug
    if (testInfo.status === 'passed') expect(_session.errors, 'renderer console errors').toEqual([])
  },

  app: async ({ page, vaultDir }, use, testInfo) => {
    const app = new App(page, vaultDir)
    await use(app)
    if (testInfo.status !== testInfo.expectedStatus && existsSync(vaultDir))
      await testInfo.attach('vault-files.txt', { body: listTree(vaultDir).join('\n'), contentType: 'text/plain' })
  },

  relaunch: async ({ page, vaultDir, userDataDir, allowConsoleErrors, _session }, use) => {
    void page
    await use(async (opts: LaunchOptions = {}) => {
      for (const a of _session.apps.splice(0)) await a.close().catch(() => {})
      const t0 = Date.now()
      const electronApp = await launchElectron(opts.noVault ? null : (opts.vaultPath ?? vaultDir), userDataDir)
      _session.apps.push(electronApp)
      const next = await preparePage(electronApp, _session, allowConsoleErrors, !!opts.noVault)
      return { electronApp, page: next, app: new App(next, opts.vaultPath ?? vaultDir), readyMs: Date.now() - t0 }
    })
  }
})

export { expect }

/** read a file from the test vault */
export function readVaultFile(vaultDir: string, rel: string): string {
  return readFileSync(join(vaultDir, rel), 'utf8')
}
