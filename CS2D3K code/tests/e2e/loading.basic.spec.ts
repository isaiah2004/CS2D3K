// Vault loading screen and the persistent metadata cache: progress while a big vault is indexed, the graph growing
// behind it, the fade into the workspace, the cache making the next start read (almost) nothing, errors with Retry.
import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import { test, expect, ROOT } from './fixtures'

const NOTES = 1500

function generateVault(n: number): Record<string, string> {
  const files: Record<string, string> = {}
  for (let i = 0; i < n; i++) {
    const links = [1, 7, 31].map((d) => `[[Note ${(i + d) % n}]]`).join(' ')
    files[`Area ${String(i % 30).padStart(2, '0')}/Note ${i}.md`] = `# Note ${i}\n\n${links} #area${i % 30}\n`
  }
  return files
}

interface Stats {
  total: number
  cached: number
  read: number
  failed: number
  cacheFound: boolean
}

/** Launches the app ourselves (the fixture's `page` waits until the app is ready, which is too late here). */
async function launch(vaultDir: string, userDataDir: string, env: Record<string, string> = {}): Promise<{ app: ElectronApplication; page: Page; errors: string[] }> {
  const e: Record<string, string> = { ...(process.env as Record<string, string>), ...env }
  delete e.ELECTRON_RUN_AS_NODE
  e.CS2D3K_TEST = '1'
  e.CS2D3K_VAULT = vaultDir
  e.CS2D3K_USER_DATA = userDataDir
  const app = await electron.launch({ args: [join(ROOT, process.env.CS2D3K_OUT || 'out', 'main', 'index.js')], cwd: ROOT, env: e })
  const page = await app.firstWindow()
  const errors: string[] = []
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
  page.on('pageerror', (err) => errors.push(String(err)))
  await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0]
    w.unmaximize()
    w.setSize(1500, 950)
  })
  return { app, page, errors }
}

async function waitReady(page: Page): Promise<void> {
  await page.waitForFunction(() => !!window.__cs2d3k, null, { timeout: 30_000 })
  await page.evaluate(() => window.__cs2d3k!.ready())
}

const loadStats = (page: Page): Promise<Stats> => page.evaluate(() => window.__cs2d3k!.loadStats() as unknown as Stats)
const cacheFile = (vaultDir: string): string => join(vaultDir, '.cs2d3k', 'cache', 'metadata.json')

test.describe('loading screen @basic', () => {
  test.use({ vault: { source: 'empty', files: generateVault(NOTES) } })

  for (const theme of ['dark', 'light'] as const) {
    test(`shows progress and the growing graph while a big vault is indexed, then fades into the workspace (${theme})`, async ({ vaultDir, userDataDir }, testInfo) => {
      test.setTimeout(120_000)
      if (theme === 'light') {
        mkdirSync(join(vaultDir, '.cs2d3k'), { recursive: true })
        writeFileSync(join(vaultDir, '.cs2d3k', 'app.json'), JSON.stringify({ baseTheme: 'light' }))
      }
      // slow the batch reads down (test hook) so the screen stays up long enough to look at
      const { app, page, errors } = await launch(vaultDir, userDataDir, { CS2D3K_READ_DELAY: '90' })
      try {
        const screen = page.locator('.loading-screen')
        await expect(screen).toBeVisible()
        await expect(screen.locator('.loading-vault-name')).toHaveText('vault')
        await expect(screen.locator('.loading-stage')).toHaveText(/Reading notes · [\d,]+ \/ 1,500/, { timeout: 20_000 })
        const bar = screen.getByRole('progressbar')
        const first = Number(await bar.getAttribute('aria-valuenow'))
        await expect.poll(async () => Number(await bar.getAttribute('aria-valuenow'))).toBeGreaterThan(first)
        await expect(screen.locator('.loading-details')).toContainText('notes/s')
        // the real graph engine, fed with the notes parsed so far
        await expect
          .poll(() => screen.locator('canvas').evaluate((c) => (c as HTMLCanvasElement & { __graph: { nodeCount: number } }).__graph.nodeCount))
          .toBeGreaterThan(20)
        await expect(page.locator('body')).toHaveClass(new RegExp(`theme-${theme}`))
        await testInfo.attach(`loading-${theme}`, { body: await page.screenshot(), contentType: 'image/png' })

        // ready: the workspace is mounted and the loading screen fades out and goes away
        await waitReady(page)
        await expect(page.locator('.titlebar-title')).toHaveText('vault — CS2D3K')
        await expect(screen).toHaveCount(0)
        await expect(page.locator('.tree-item[data-path="Area 00"]')).toBeVisible()
        const stages = await page.evaluate(() =>
          (window.__cs2d3k!.stores.loading.getState() as { log: { stage: string }[] }).log.map((l) => l.stage).filter((s, i, a) => s !== a[i - 1])
        )
        expect(stages).toEqual(['opening', 'scanning', 'reading', 'linking', 'restoring'])
        expect(await loadStats(page)).toMatchObject({ total: NOTES, cached: 0, read: NOTES })
        expect(await page.evaluate(() => Object.keys((window.__cs2d3k!.stores.metadata.getState() as { metas: object }).metas).length)).toBe(NOTES)
        expect(errors).toEqual([])
      } finally {
        await app.close()
      }
    })
  }
})

test.describe('metadata cache @basic', () => {
  test.use({ vault: { source: 'empty', files: generateVault(300) } })

  test('the next start takes notes from the cache and re-reads only what changed on disk', async ({ page, app, vaultDir, relaunch }) => {
    expect(await loadStats(page)).toMatchObject({ total: 300, cached: 0, read: 300, cacheFound: false })
    // written shortly after the vault was indexed
    await expect.poll(() => existsSync(cacheFile(vaultDir)), { timeout: 15_000 }).toBe(true)
    expect(readFileSync(join(vaultDir, '.cs2d3k', 'cache', '.gitignore'), 'utf8')).toBe('*\n')
    expect(await app.page.locator('.tree-item[data-path^=".cs2d3k"]').count()).toBe(0)

    // unchanged vault: nothing is read
    let next = await relaunch()
    expect(await loadStats(next.page)).toMatchObject({ total: 300, cached: 300, read: 0, cacheFound: true })
    expect(await next.page.evaluate(() => window.__cs2d3k!.getBacklinks('Area 01/Note 1.md').map((b) => b.source))).toEqual(['Area 00/Note 0.md', 'Area 00/Note 270.md', 'Area 24/Note 294.md'])

    // edited, deleted and added while the app was closed
    await next.electronApp.close()
    const edited = join(vaultDir, 'Area 05', 'Note 5.md')
    writeFileSync(edited, '# Note 5 rewritten\n\n[[Note 250]] #rewritten\n')
    rmSync(join(vaultDir, 'Area 09', 'Note 9.md'))
    mkdirSync(dirname(join(vaultDir, 'New', 'Fresh.md')), { recursive: true })
    writeFileSync(join(vaultDir, 'New', 'Fresh.md'), '[[Note 2]]')
    next = await relaunch()
    expect(await loadStats(next.page)).toMatchObject({ total: 300, cached: 298, read: 2, cacheFound: true })
    const meta = await next.page.evaluate(() => {
      const s = window.__cs2d3k!.stores.metadata.getState() as {
        metas: Record<string, { tags: { tag: string }[] }>
        resolved: Record<string, Record<string, number>>
        unresolved: Record<string, Record<string, number>>
      }
      return {
        tags: s.metas['Area 05/Note 5.md'].tags.map((t) => t.tag),
        links: s.resolved['Area 05/Note 5.md'],
        deleted: 'Area 09/Note 9.md' in s.metas,
        // Note 8 links to Note 9 (deleted while closed): now unresolved
        note8: s.unresolved['Area 08/Note 8.md'],
        fresh: s.resolved['New/Fresh.md']
      }
    })
    expect(meta).toEqual({ tags: ['rewritten'], links: { 'Area 10/Note 250.md': 1 }, deleted: false, note8: { 'Note 9': 1 }, fresh: { 'Area 02/Note 2.md': 1 } })
    // the backlinks pane reflects the edit
    await next.app.openFile('Area 10/Note 250.md')
    await expect.poll(() => next.page.evaluate(() => window.__cs2d3k!.getBacklinks('Area 10/Note 250.md').map((b) => b.source))).toContain('Area 05/Note 5.md')
  })

  test('a corrupt cache falls back to reading every note', async ({ page, vaultDir, relaunch }) => {
    await page.evaluate(() => window.__cs2d3k!.saveMetadataCache())
    await expect.poll(() => existsSync(cacheFile(vaultDir))).toBe(true)
    writeFileSync(cacheFile(vaultDir), '{"format":1,"parser":1,"paths":[[[')
    const next = await relaunch()
    expect(await loadStats(next.page)).toMatchObject({ total: 300, cached: 0, read: 300, cacheFound: false })
    expect(await next.page.evaluate(() => Object.keys((window.__cs2d3k!.stores.metadata.getState() as { metas: object }).metas).length)).toBe(300)
  })
})

test.describe('loading from the vault picker @basic', () => {
  test.use({ vault: { source: 'sample', noVault: true } })

  test('opening a vault shows the loading screen, then the workspace', async ({ page, electronApp, vaultDir, app }) => {
    await electronApp.evaluate(({ dialog }, p) => {
      dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [p] })) as unknown as typeof dialog.showOpenDialog
    }, vaultDir)
    await page.locator('.vault-action', { hasText: 'Open folder as vault' }).locator('.btn').click()
    // up while the vault loads and during the fade into the workspace
    await expect(page.locator('.loading-screen')).toBeAttached()
    await expect(page.locator('.titlebar-title')).toHaveText('vault — CS2D3K')
    await expect(app.treeItem('Welcome.md')).toBeVisible()
    await expect(page.locator('.loading-screen')).toHaveCount(0)
    await expect(page.locator('.vault-picker')).toHaveCount(0)
  })

  test('a vault that cannot be opened shows the error with Retry and a way back', async ({ page, electronApp, vaultDir, app }) => {
    // a file where the vault folder should be
    const target = join(dirname(vaultDir), 'Broken')
    writeFileSync(target, 'not a folder')
    await electronApp.evaluate(({ dialog }, p) => {
      dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [p] })) as unknown as typeof dialog.showOpenDialog
    }, target)
    await page.locator('.vault-action', { hasText: 'Open folder as vault' }).locator('.btn').click()
    const screen = page.locator('.loading-screen.is-error')
    await expect(screen).toBeVisible()
    await expect(screen.locator('.loading-vault-name')).toHaveText('Broken')
    await expect(screen.locator('.loading-error-title')).toHaveText(/Couldn't open vault/)
    await expect(screen.getByRole('button', { name: 'Retry' })).toBeFocused()

    // fix it, then Retry
    rmSync(target)
    mkdirSync(target)
    writeFileSync(join(target, 'Fixed.md'), '# Fixed\n')
    await screen.getByRole('button', { name: 'Retry' }).click()
    await expect(page.locator('.titlebar-title')).toHaveText('Broken — CS2D3K')
    await expect(app.page.locator('.tree-item[data-path="Fixed.md"]')).toBeVisible()
    await expect(page.locator('.loading-screen')).toHaveCount(0)
  })

  test('"Open another vault" on the error goes back to the picker', async ({ page, electronApp, vaultDir }) => {
    const target = join(dirname(vaultDir), 'AlsoBroken')
    writeFileSync(target, 'x')
    await electronApp.evaluate(({ dialog }, p) => {
      dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [p] })) as unknown as typeof dialog.showOpenDialog
    }, target)
    await page.locator('.vault-action', { hasText: 'Open folder as vault' }).locator('.btn').click()
    await page.getByRole('button', { name: 'Open another vault' }).click()
    await expect(page.locator('.vault-picker')).toBeVisible()
    await expect(page.locator('.loading-screen')).toHaveCount(0)
  })
})
