// Shell performance budgets on a generated 3000-note vault (generated into the test's temp vault, not the repo).
import { test, expect } from './fixtures'
import { Palette } from './helpers/palette'

const FOLDERS = 30
const PER_FOLDER = 100

function generateVault(): Record<string, string> {
  const files: Record<string, string> = {}
  for (let f = 0; f < FOLDERS; f++) {
    for (let n = 0; n < PER_FOLDER; n++) {
      const i = f * PER_FOLDER + n
      const links = [1, 7, 31].map((d) => `[[Note ${(i + d) % (FOLDERS * PER_FOLDER)}]]`).join(', ')
      files[`Area ${String(f).padStart(2, '0')}/Note ${i}.md`] =
        `# Note ${i}\n\nGenerated note in area ${f}. Links: ${links}.\n\n## Details\nSome text #area/${f} #perf\n\n- item one\n- item two\n`
    }
  }
  return files
}

test.use({ vault: { source: 'empty', files: generateVault() } })

/** time (ms, measured in the renderer) from an action until `done()` is true, checked every frame */
function measure(page: import('@playwright/test').Page, action: string, arg: string, done: string): Promise<number> {
  return page.evaluate(
    ([a, x, d]) =>
      new Promise<number>((resolve, reject) => {
        const act = new Function('arg', a) as (arg: string) => void
        const isDone = new Function('arg', `return (${d})`) as (arg: string) => boolean
        const t0 = performance.now()
        act(x)
        const check = (): void => {
          if (isDone(x)) resolve(performance.now() - t0)
          else if (performance.now() - t0 > 10_000) reject(new Error('timed out'))
          else requestAnimationFrame(check)
        }
        check()
      }),
    [action, arg, done] as const
  )
}

test.describe('shell performance @perf', () => {
  test.setTimeout(180_000)

  test('3000-note vault: ready < 10 s, quick switcher < 300 ms, explorer expand < 200 ms', async ({ app, relaunch }, testInfo) => {
    expect(await app.page.evaluate(() => Object.keys((window.__cs2d3k!.stores.vault.getState() as { files: object }).files).length)).toBe(FOLDERS * PER_FOLDER + FOLDERS)

    // cold start of the app on the big vault (vault listed, all notes indexed, layout restored)
    const next = await relaunch()
    const page = next.page
    testInfo.annotations.push({ type: 'ready-ms', description: String(next.readyMs) })
    expect(next.readyMs, 'app ready').toBeLessThan(10_000)
    await expect(page.locator('.tree-item[data-path="Area 00"]')).toBeVisible()
    expect(await page.evaluate(() => Object.keys((window.__cs2d3k!.stores.metadata.getState() as { metas: object }).metas).length)).toBe(FOLDERS * PER_FOLDER)

    // quick switcher: results for a query appear within budget
    const palette = new Palette(page)
    await palette.openSwitcher()
    const typeQuery = `
      const input = document.querySelector('.prompt-input')
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, arg)
      input.dispatchEvent(new Event('input', { bubbles: true }))`
    const switcherTimes: number[] = []
    for (const q of ['n', 'note 2', 'Note 2345', 'ar12nt1250']) {
      const firstHas = q === 'ar12nt1250' ? 'Note 1250' : q === 'n' ? 'Note' : q
      switcherTimes.push(
        await measure(page, typeQuery, q, `(() => { const el = document.querySelector('.prompt-results .suggestion-item'); return !!el && document.querySelector('.prompt-input').value === arg && el.textContent.toLowerCase().includes(${JSON.stringify(firstHas.toLowerCase())}) })()`)
      )
    }
    testInfo.annotations.push({ type: 'switcher-ms', description: switcherTimes.map((t) => t.toFixed(0)).join(', ') })
    expect(Math.max(...switcherTimes), `quick switcher (${switcherTimes.map((t) => t.toFixed(0)).join(', ')} ms)`).toBeLessThan(300)
    await expect(palette.items().first()).toContainText('Note 1250')
    await page.keyboard.press('Enter')
    await expect.poll(() => next.app.activeFile()).toBe('Area 12/Note 1250.md')

    // explorer: expanding a 100-note folder renders all children within budget
    const expandTimes: number[] = []
    for (const folder of ['Area 05', 'Area 17', 'Area 29']) {
      await page.locator(`.tree-item[data-path="${folder}"]`).waitFor()
      expandTimes.push(
        await measure(
          page,
          `document.querySelector('.tree-item[data-path="' + arg + '"]').click()`,
          folder,
          `document.querySelectorAll('.tree-item[data-path^="' + arg + '/"]').length === ${PER_FOLDER}`
        )
      )
    }
    testInfo.annotations.push({ type: 'expand-ms', description: expandTimes.map((t) => t.toFixed(0)).join(', ') })
    expect(Math.max(...expandTimes), `explorer expand (${expandTimes.map((t) => t.toFixed(0)).join(', ')} ms)`).toBeLessThan(200)
  })
})
