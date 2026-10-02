// Form-map page object: the map lens is the canvas engine (CanvasPage), plus lenses, inspector and domain lookups.
import { expect, type Locator } from '@playwright/test'
import type { App } from './app'
import { CanvasPage, type Box, type CData, type CNode, type Pt } from './canvas'

export const DEFINITION = 'CS2D3K Definition.formmap'

export type Lens = 'Map' | 'Board' | 'Table' | 'Doc'

export interface FormCard extends CNode {
  kind: string
  title: string
  text?: string
  fields: Record<string, unknown>
  votes?: number
}
export interface Zone extends CNode {
  label: string
  locked?: boolean
  order?: number
  defaultKind?: string
  assign?: Record<string, unknown>
}

export const forms = (d: CData): FormCard[] => d.nodes.filter((n) => n.type === 'form') as FormCard[]
export const zones = (d: CData): Zone[] => d.nodes.filter((n) => n.type === 'zone') as Zone[]
export const formByTitle = (d: CData, title: string): FormCard => {
  const f = forms(d).find((n) => n.title === title)
  if (!f) throw new Error(`no card titled ${title}`)
  return f
}
export const zoneByLabel = (d: CData, label: string): Zone => {
  const z = zones(d).find((n) => n.label === label)
  if (!z) throw new Error(`no zone ${label}`)
  return z
}
/** zone containing the card's center (smallest wins) — same rule as the app */
export const zoneOf = (d: CData, n: CNode): Zone | undefined => {
  const cx = n.x + n.width / 2
  const cy = n.y + n.height / 2
  return zones(d)
    .filter((z) => cx >= z.x && cx <= z.x + z.width && cy >= z.y && cy <= z.y + z.height)
    .sort((a, b) => a.width * a.height - b.width * b.height)[0]
}

export class FormMapPage extends CanvasPage {
  constructor(app: App, file = DEFINITION) {
    super(app, file)
  }

  fmRoot(): Locator {
    return this.app.activeView().locator('.fm-root')
  }
  lensButton(name: Lens): Locator {
    return this.page.locator('.fm-lens-btn', { hasText: name })
  }
  insp(): Locator {
    return this.fmRoot().locator('.fm-insp')
  }
  inspTab(name: 'Card' | 'Coach' | 'Map'): Locator {
    return this.insp().locator('.fm-insp-tab', { hasText: name })
  }
  card(id: string): Locator {
    return this.node(id)
  }
  boardCard(title: string): Locator {
    return this.fmRoot().locator('.fm-bcard', { has: this.page.locator('.fm-bcard-title', { hasText: new RegExp(`^${escapeRe(title)}$`) }) })
  }
  column(key: string): Locator {
    return this.fmRoot().locator(`.fm-col[data-col="${key}"]`)
  }
  row(title: string): Locator {
    return this.fmRoot().locator('tbody tr', { has: this.page.locator('.fm-cell-title', { hasText: new RegExp(`^${escapeRe(title)}$`) }) })
  }
  submenuItem(label: string | RegExp): Locator {
    return this.page.locator('.menu .menu .menu-item', { hasText: label }).first()
  }

  async open(opts: { newTab?: boolean } = {}): Promise<void> {
    await this.app.openFile(this.file, opts)
    await expect(this.fmRoot()).toBeVisible()
    await expect(this.root()).toBeVisible()
    await expect(this.root()).toHaveAttribute('data-ready', '')
    // the map mounts its cards as DOM; a big map zoomed out draws them on the engine's canvas layer instead
    if ((await this.root().getAttribute('data-render')) !== 'canvas') await expect(this.root().locator('.fm-node-zone').first()).toBeVisible()
    await this.settle()
  }

  async lens(name: Lens): Promise<void> {
    await this.lensButton(name).click()
    await expect(this.lensButton(name)).toHaveAttribute('aria-selected', 'true')
    const root = { Map: '.fm-map', Board: '.fm-board', Table: '.fm-table-lens', Doc: '.fm-doc' }[name]
    await expect(this.fmRoot().locator(root)).toBeVisible()
  }

  async openInspectorTab(name: 'Card' | 'Coach' | 'Map'): Promise<void> {
    await this.inspTab(name).click()
    await expect(this.inspTab(name)).toHaveAttribute('aria-selected', 'true')
  }

  // ---------------------------------------------------------------- map lens

  /** select a card on the map by clicking its header (kind chip area) */
  async clickCard(id: string, opts: { modifiers?: ('Shift' | 'Control')[]; button?: 'left' | 'right' } = {}): Promise<void> {
    const b = await this.nodeBox(id, '.fm-kind-chip')
    for (const m of opts.modifiers ?? []) await this.page.keyboard.down(m)
    await this.page.mouse.click(b.x + Math.min(10, b.width / 2), b.y + b.height / 2, { button: opts.button ?? 'left' })
    for (const m of opts.modifiers ?? []) await this.page.keyboard.up(m)
  }

  /** zoom the map onto a zone (select it via its header, Shift+2 = zoom to selection), then clear the selection */
  async zoomToZone(id: string): Promise<void> {
    const b = await this.nodeBox(id, '.fm-zone-label')
    await this.page.mouse.click(b.x + Math.min(8, b.width / 2), b.y + b.height / 2)
    await expect(this.node(id)).toHaveClass(/is-selected/)
    await this.moveCamera(() => this.page.keyboard.press('Shift+2'))
    await this.page.keyboard.press('Escape')
    await expect(this.node(id)).not.toHaveClass(/is-selected/)
  }

  /** an empty screen point inside a zone's body (not on a card nor its header), scanning bottom-up */
  async zoneSpot(id: string, clearance = 30): Promise<Pt> {
    const b = await this.nodeBox(id)
    const r = await this.rootBox()
    const p = await this.root().evaluate(
      (_root, { id, b, r, clearance }) => {
        const inBody = (x: number, y: number): boolean => {
          if (x < r.x || y < r.y || x > r.x + r.width || y > r.y + r.height) return false
          const el = document.elementFromPoint(x, y) as HTMLElement | null
          if (!el || el.closest('[data-canvas-ui]') || el.closest('[data-zone-head]')) return false
          return el.closest<HTMLElement>('[data-node-id]')?.dataset.nodeId === id
        }
        for (let fy = 0.92; fy >= 0.2; fy -= 0.04)
          for (let fx = 0.5, k = 0; k < 9; k++, fx = 0.5 + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * 0.1) {
            const x = b.x + b.width * fx
            const y = b.y + b.height * fy
            if ([[0, 0], [-clearance, -clearance], [clearance, -clearance], [-clearance, clearance], [clearance, clearance]].every(([dx, dy]) => inBody(x + dx, y + dy))) return { x, y }
          }
        return null
      },
      { id, b: b as Box, r, clearance }
    )
    if (!p) throw new Error(`no empty spot in zone ${id}`)
    return p
  }
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
