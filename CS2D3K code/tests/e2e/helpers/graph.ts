// Graph view helpers. The canvas exposes its engine as `canvas.__graph` (node screen positions, counts,
// settle state) so tests can click nodes and wait for the layout; assertions prefer the status bar / disk.
import { expect, type Locator, type Page } from '@playwright/test'
import type { App } from './app'

interface EngineHandle {
  nodeCount: number
  linkCount: number
  isSettled(): boolean
  screenPos(id: string): { x: number; y: number } | null
  /** RGB of the rendered frame at a canvas CSS pixel (WebGL canvases can't be read through a 2D context) */
  readPixel(x: number, y: number): [number, number, number]
}

export const GLOBAL_GRAPH = '.graph-view canvas'
export const LOCAL_GRAPH = '.local-graph canvas'

export class Graph {
  constructor(
    readonly app: App,
    /** canvas selector: the global graph view or the local graph pane */
    readonly canvasSel: string = GLOBAL_GRAPH
  ) {}

  get page(): Page {
    return this.app.page
  }

  canvas(): Locator {
    return this.page.locator(this.canvasSel).first()
  }
  /** "N nodes · M links" in the status bar (global graph only) */
  status(): Locator {
    return this.page.locator('#status-bar-view-items .status-bar-item', { hasText: /nodes? · \d+ links?/ })
  }
  headerButton(label: string): Locator {
    return this.page.locator(`.view-header-actions button[aria-label="${label}"]`)
  }
  controls(): Locator {
    return this.page.locator('.graph-controls')
  }
  toggle(label: string): Locator {
    return this.controls().locator('.graph-control-row', { hasText: label })
  }

  /** open the global graph with Ctrl+G */
  async open(): Promise<void> {
    await this.page.keyboard.press('Control+G')
    await expect(this.canvas()).toBeVisible()
  }

  async openSettings(): Promise<void> {
    if (await this.controls().isVisible()) return
    await this.headerButton('Graph settings').click()
    await expect(this.controls()).toBeVisible()
  }

  async expectCounts(nodes: number, links: number): Promise<void> {
    await expect(this.status()).toHaveText(`${nodes} ${nodes === 1 ? 'node' : 'nodes'} · ${links} ${links === 1 ? 'link' : 'links'}`)
    await expect.poll(() => this.counts()).toEqual({ nodes, links })
  }

  counts(): Promise<{ nodes: number; links: number }> {
    return this.canvas().evaluate((c) => {
      const g = (c as HTMLCanvasElement & { __graph: EngineHandle }).__graph
      return { nodes: g.nodeCount, links: g.linkCount }
    })
  }

  async waitSettled(timeout = 30_000): Promise<void> {
    await expect
      .poll(() => this.canvas().evaluate((c) => (c as HTMLCanvasElement & { __graph: EngineHandle }).__graph.isSettled()), {
        message: 'graph layout settled',
        timeout
      })
      .toBe(true)
  }

  /** page coordinates of a node (null when it isn't in the graph) */
  pos(id: string): Promise<{ x: number; y: number } | null> {
    return this.canvas().evaluate((c, nodeId) => {
      const p = (c as HTMLCanvasElement & { __graph: EngineHandle }).__graph.screenPos(nodeId)
      if (!p) return null
      const r = c.getBoundingClientRect()
      return { x: r.left + p.x, y: r.top + p.y }
    }, id)
  }

  /** wait for the layout to settle, then click a node like a user would */
  async clickNode(id: string, opts: { modifiers?: ('Control' | 'Shift')[]; button?: 'left' | 'right' } = {}): Promise<void> {
    await this.waitSettled()
    const p = await this.pos(id)
    expect(p, `node ${id} on screen`).not.toBeNull()
    for (const m of opts.modifiers ?? []) await this.page.keyboard.down(m)
    await this.page.mouse.click(p!.x, p!.y, { button: opts.button ?? 'left' })
    for (const m of opts.modifiers ?? []) await this.page.keyboard.up(m)
  }

  /** RGB of the rendered canvas pixel at a node's center */
  async nodeColor(id: string): Promise<[number, number, number]> {
    return this.canvas().evaluate((c, nodeId) => {
      const g = (c as HTMLCanvasElement & { __graph: EngineHandle }).__graph
      const p = g.screenPos(nodeId)!
      return g.readPixel(p.x, p.y)
    }, id)
  }
}
