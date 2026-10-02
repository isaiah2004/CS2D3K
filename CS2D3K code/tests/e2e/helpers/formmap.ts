// Form-map page object: the map lens is the canvas engine (CanvasPage), plus lenses, inspector and domain lookups.
import { expect, type Locator } from '@playwright/test'
import type { App } from './app'
import { CanvasPage, type Box, type CData, type CNode, type Pt } from './canvas'

export const DEFINITION = 'CS2D3K Definition.formmap'

export type Lens = 'Map' | 'Board' | 'Table' | 'Doc'

export interface FormCard extends CNode {
  title: string
  text?: string
  tags?: string[]
  fields: Record<string, unknown>
  votes?: number
}
export interface Group extends CNode {
  label: string
  emoji?: string
  locked?: boolean
  order?: number
  preset?: string
  assign?: Record<string, unknown>
}
export interface KanbanCard {
  id: string
  title: string
  text?: string
  tags?: string[]
  fields?: Record<string, unknown>
  done?: boolean
}
export interface Kanban extends CNode {
  title: string
  columns: { id: string; title: string; color?: string; collapsed?: boolean; cards: KanbanCard[] }[]
}
export interface Board {
  id: string
  name: string
  source: { mode: 'groups'; groupIds: string[] } | { mode: 'field'; field: string; groupId?: string }
  order?: Record<string, string[]>
  filter?: { tags?: string[] }
  wip?: Record<string, number>
}
export interface Meta {
  version: number
  title?: string
  fields?: Record<string, { type: string; label?: string; options?: { value: string; label?: string }[] }>
  tags?: Record<string, { color?: string }>
  presets?: { id: string; name: string; tags?: string[]; fields?: Record<string, unknown> }[]
  boards?: Board[]
  [k: string]: unknown
}

export const meta = (d: CData): Meta => d.formmap as Meta
export const forms = (d: CData): FormCard[] => d.nodes.filter((n) => n.type === 'form') as FormCard[]
export const groups = (d: CData): Group[] => d.nodes.filter((n) => n.type === 'group') as Group[]
export const kanbans = (d: CData): Kanban[] => d.nodes.filter((n) => n.type === 'kanban') as Kanban[]
export const formByTitle = (d: CData, title: string): FormCard => {
  const f = forms(d).find((n) => n.title === title)
  if (!f) throw new Error(`no card titled ${title}`)
  return f
}
export const groupByLabel = (d: CData, label: string): Group => {
  const z = groups(d).find((n) => n.label === label)
  if (!z) throw new Error(`no group ${label}`)
  return z
}
export const boardByName = (d: CData, name: string): Board => {
  const b = meta(d).boards?.find((x) => x.name === name)
  if (!b) throw new Error(`no board ${name}`)
  return b
}
/** innermost group containing the node's center (smallest wins) — same rule as the app */
export const groupOf = (d: CData, n: CNode): Group | undefined => {
  const cx = n.x + n.width / 2
  const cy = n.y + n.height / 2
  return groups(d)
    .filter((z) => z.id !== n.id && cx >= z.x && cx <= z.x + z.width && cy >= z.y && cy <= z.y + z.height)
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
  boardTab(name: string): Locator {
    return this.fmRoot().locator('.fm-board-tab', { hasText: name })
  }
  /** a kanban node's column on the map */
  kanbanColumn(kanbanId: string, colId: string): Locator {
    return this.node(kanbanId).locator(`[data-kanban-col="${colId}"]`)
  }
  kanbanCard(kanbanId: string, cardId: string): Locator {
    return this.node(kanbanId).locator(`[data-kcard="${cardId}"]`)
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
    if ((await this.root().getAttribute('data-render')) !== 'canvas' && (await this.root().getAttribute('data-node-count')) !== '0')
      await expect(this.root().locator('.canvas-world [data-node-id]').first()).toBeVisible()
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

  /** select a card on the map by clicking its top-left corner (card padding, never a chip or button) */
  async clickCard(id: string, opts: { modifiers?: ('Shift' | 'Control')[]; button?: 'left' | 'right' } = {}): Promise<void> {
    const b = await this.nodeBox(id)
    for (const m of opts.modifiers ?? []) await this.page.keyboard.down(m)
    await this.page.mouse.click(b.x + 6, b.y + 5, { button: opts.button ?? 'left' })
    for (const m of opts.modifiers ?? []) await this.page.keyboard.up(m)
  }

  /** fly the camera to fit nodes (engine api, no animation) */
  async fit(ids: string[], maxZoom = 1): Promise<void> {
    await this.root().evaluate((el, a) => (el as HTMLElement & { __canvasEngine: { fitNodes(ids: string[], z: number, an: boolean): void } }).__canvasEngine.fitNodes(a.ids, a.maxZoom, false), { ids, maxZoom })
    await this.settle()
  }

  /** zoom the map onto a group (select it via its header, Shift+2 = zoom to selection), then clear the selection */
  async zoomToGroup(id: string): Promise<void> {
    const b = await this.nodeBox(id, '.fm-group-label')
    await this.page.mouse.click(b.x + Math.min(8, b.width / 2), b.y + b.height / 2)
    await expect(this.node(id)).toHaveClass(/is-selected/)
    await this.moveCamera(() => this.page.keyboard.press('Shift+2'))
    await this.page.keyboard.press('Escape')
    await expect(this.node(id)).not.toHaveClass(/is-selected/)
  }

  /** an empty screen point inside a group's body (not on a card nor its header), scanning bottom-up */
  async groupSpot(id: string, clearance = 30): Promise<Pt> {
    const b = await this.nodeBox(id)
    const r = await this.rootBox()
    const p = await this.root().evaluate(
      (_root, { id, b, r, clearance }) => {
        const inBody = (x: number, y: number): boolean => {
          if (x < r.x || y < r.y || x > r.x + r.width || y > r.y + r.height) return false
          const el = document.elementFromPoint(x, y) as HTMLElement | null
          if (!el || el.closest('[data-canvas-ui]') || el.closest('[data-group-head]')) return false
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
    if (!p) throw new Error(`no empty spot in group ${id}`)
    return p
  }
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
