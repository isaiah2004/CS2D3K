// Canvas page object (cf. Logseq's e2e helper namespaces): open a .canvas/.formmap, read it from disk,
// convert between world and screen coordinates and drive the pointer like a user does.
import { expect, type Locator, type Page } from '@playwright/test'
import type { App } from './app'

export interface Pt {
  x: number
  y: number
}
export interface Box extends Pt {
  width: number
  height: number
}
export interface Viewport {
  x: number
  y: number
  zoom: number
}
export interface CNode {
  id: string
  type: string
  x: number
  y: number
  width: number
  height: number
  [k: string]: unknown
}
export interface CEdge {
  id: string
  fromNode: string
  toNode: string
  [k: string]: unknown
}
export interface CData {
  nodes: CNode[]
  edges: CEdge[]
  [k: string]: unknown
}

export const center = (b: Box): Pt => ({ x: b.x + b.width / 2, y: b.y + b.height / 2 })

/** read the vault file and parse it (JSON Canvas / form-map) */
export function readCanvas(app: App, file: string): CData {
  return app.readJson<CData>(file)
}

export class CanvasPage {
  constructor(
    readonly app: App,
    readonly file: string
  ) {}

  get page(): Page {
    return this.app.page
  }

  /** the canvas engine root of the active tab */
  root(): Locator {
    return this.app.activeView().locator('.canvas-view')
  }
  world(): Locator {
    return this.root().locator('.canvas-world')
  }
  node(id: string): Locator {
    return this.root().locator(`[data-node-id="${id}"]`)
  }
  edge(id: string): Locator {
    return this.root().locator(`g.canvas-edge[data-edge-id="${id}"]`)
  }
  edgeLabel(id: string): Locator {
    return this.root().locator(`.canvas-edge-label[data-edge-id="${id}"]`)
  }
  menuItem(label: string | RegExp): Locator {
    return this.page.locator('.menu-item', { hasText: label }).last()
  }

  // ---------------------------------------------------------------- disk

  data(): CData {
    return readCanvas(this.app, this.file)
  }
  nodeOnDisk(id: string): CNode | undefined {
    return this.data().nodes.find((n) => n.id === id)
  }
  /** poll the file on disk until `fn(data)` is truthy (saves are debounced) */
  async expectData(fn: (d: CData) => unknown, message?: string): Promise<void> {
    await this.app.expectFile(this.file, (c) => !!fn(JSON.parse(c) as CData), message)
  }
  /** wait for the file to contain a node matching `pred` and return it */
  async waitForNode(pred: (n: CNode) => boolean, message?: string): Promise<CNode> {
    let found: CNode | undefined
    await this.expectData((d) => (found = d.nodes.find(pred)), message)
    return found!
  }

  // ---------------------------------------------------------------- open

  async open(opts: { newTab?: boolean } = {}): Promise<void> {
    await this.app.openFile(this.file, opts)
    await expect(this.root()).toBeVisible()
    await this.settle()
  }

  // ---------------------------------------------------------------- viewport + coordinates

  async viewport(): Promise<Viewport> {
    const t = await this.world().evaluate((el) => (el as HTMLElement).style.transform)
    const m = /translate\(([-\d.e]+)px,\s*([-\d.e]+)px\)\s*scale\(([-\d.e]+)\)/.exec(t)
    if (!m) throw new Error(`unexpected canvas transform: ${t}`)
    return { x: Number(m[1]), y: Number(m[2]), zoom: Number(m[3]) }
  }
  async zoomPercent(): Promise<number> {
    return Math.round((await this.viewport()).zoom * 100)
  }
  async transform(): Promise<string> {
    return this.world().evaluate((el) => (el as HTMLElement).style.transform)
  }
  /** wait until the camera has been still for ~320ms (longer than the 260ms fit / zoom animation) */
  async settle(): Promise<void> {
    let prev = ''
    let still = 0
    await expect
      .poll(
        async () => {
          const cur = await this.transform()
          still = cur === prev ? still + 1 : 0
          prev = cur
          return still >= 4
        },
        { intervals: [80], timeout: 8_000, message: 'canvas viewport settles' }
      )
      .toBe(true)
  }
  /** run an action that moves the camera: wait for the move to start, then to finish */
  async moveCamera(action: () => Promise<unknown>): Promise<void> {
    const before = await this.transform()
    await action()
    await expect.poll(() => this.transform(), { message: 'camera moves' }).not.toBe(before)
    await this.settle()
  }
  async rootBox(): Promise<Box> {
    const b = await this.root().boundingBox()
    if (!b) throw new Error('canvas not visible')
    return b
  }
  async toScreen(p: Pt): Promise<Pt> {
    const [r, v] = await Promise.all([this.rootBox(), this.viewport()])
    return { x: r.x + v.x + p.x * v.zoom, y: r.y + v.y + p.y * v.zoom }
  }
  async toWorld(p: Pt): Promise<Pt> {
    const [r, v] = await Promise.all([this.rootBox(), this.viewport()])
    return { x: (p.x - r.x - v.x) / v.zoom, y: (p.y - r.y - v.y) / v.zoom }
  }
  /** screen box of a node (its DOM rect) */
  async nodeBox(id: string, sel = ''): Promise<Box> {
    const loc = sel ? this.node(id).locator(sel).first() : this.node(id)
    await expect(loc).toBeVisible()
    const b = await loc.boundingBox()
    if (!b) throw new Error(`no box for node ${id} ${sel}`)
    return b
  }

  /** a screen point on empty canvas background (nothing but the canvas root under it), scanning a grid */
  async emptyPoint(opts: { margin?: number; region?: { fx0: number; fx1: number; fy0: number; fy1: number }; clearance?: number } = {}): Promise<Pt> {
    const r = await this.rootBox()
    const p = await this.root().evaluate(
      (root, { r, region, clearance }) => {
        const isBg = (x: number, y: number): boolean => {
          const el = document.elementFromPoint(x, y)
          return el === root || el?.classList.contains('canvas-world') === true
        }
        const { fx0, fx1, fy0, fy1 } = region
        for (let fy = fy0; fy <= fy1; fy += 0.04)
          for (let fx = fx0; fx <= fx1; fx += 0.04) {
            const x = r.x + r.width * fx
            const y = r.y + r.height * fy
            const ok = [
              [0, 0],
              [-clearance, -clearance],
              [clearance, -clearance],
              [-clearance, clearance],
              [clearance, clearance]
            ].every(([dx, dy]) => isBg(x + dx, y + dy))
            if (ok) return { x, y }
          }
        return null
      },
      { r, region: opts.region ?? { fx0: 0.12, fx1: 0.8, fy0: 0.15, fy1: 0.75 }, clearance: opts.clearance ?? 40 }
    )
    if (!p) throw new Error('no empty canvas point found')
    return p
  }

  // ---------------------------------------------------------------- pointer

  /** press at `from`, move in steps to `to` (pointer events fire on every step), release unless hold=true */
  async drag(from: Pt, to: Pt, opts: { steps?: number; hold?: boolean; modifiers?: ('Shift' | 'Control' | 'Alt')[] } = {}): Promise<void> {
    const steps = opts.steps ?? 12
    for (const m of opts.modifiers ?? []) await this.page.keyboard.down(m)
    await this.page.mouse.move(from.x, from.y)
    await this.page.mouse.down()
    for (let i = 1; i <= steps; i++) await this.page.mouse.move(from.x + ((to.x - from.x) * i) / steps, from.y + ((to.y - from.y) * i) / steps)
    if (!opts.hold) await this.page.mouse.up()
    for (const m of opts.modifiers ?? []) await this.page.keyboard.up(m)
  }

  /** drag a node by a point inside it (default: its top-left area, away from content) */
  async dragNode(id: string, dx: number, dy: number, opts: { grab?: Pt; steps?: number } = {}): Promise<void> {
    const b = await this.nodeBox(id)
    const grab = opts.grab ?? { x: b.x + Math.min(30, b.width / 2), y: b.y + Math.min(12, b.height / 2) }
    await this.drag(grab, { x: grab.x + dx, y: grab.y + dy }, { steps: opts.steps })
  }

  /** click a node (selects it) at a point near its top-left */
  async select(id: string, opts: { modifiers?: ('Shift' | 'Control')[]; at?: Pt } = {}): Promise<void> {
    const b = await this.nodeBox(id)
    const at = opts.at ?? { x: b.x + Math.min(30, b.width / 2), y: b.y + Math.min(12, b.height / 2) }
    for (const m of opts.modifiers ?? []) await this.page.keyboard.down(m)
    await this.page.mouse.click(at.x, at.y)
    for (const m of opts.modifiers ?? []) await this.page.keyboard.up(m)
  }

  /** connect two nodes by dragging from a side handle of `from` onto `to` */
  async connect(from: string, to: string, side: 'top' | 'right' | 'bottom' | 'left' = 'right', target?: Pt): Promise<void> {
    const fb = await this.nodeBox(from)
    // hovering the node reveals its handles
    await this.page.mouse.move(fb.x + fb.width / 2, fb.y + fb.height / 2)
    const h = this.node(from).locator(`.canvas-handle-${side}`)
    await expect(h).toBeVisible()
    const hb = (await h.boundingBox())!
    const tb = await this.nodeBox(to)
    await this.drag(center(hb), target ?? center(tb), { steps: 14 })
  }

  /**
   * Click an element inside the canvas world with the real mouse at its center — without Playwright's
   * scroll-into-view (the canvas root clips its content; scrolling it would shift the board). Waits until the element
   * is the topmost thing at that point (floating chips / toolbars may briefly cover it).
   */
  async tap(loc: Locator, opts: { button?: 'left' | 'right'; clickCount?: number; modifiers?: ('Shift' | 'Control')[] } = {}): Promise<void> {
    await expect(loc).toBeVisible()
    let p: Pt = { x: 0, y: 0 }
    await expect
      .poll(
        async () => {
          const b = await loc.boundingBox()
          if (!b) return false
          p = center(b)
          return loc.evaluate((el, { x, y }) => {
            const hit = document.elementFromPoint(x, y)
            return !!hit && (el === hit || el.contains(hit))
          }, p)
        },
        { message: 'element is not covered' }
      )
      .toBe(true)
    for (const m of opts.modifiers ?? []) await this.page.keyboard.down(m)
    await this.page.mouse.click(p.x, p.y, { button: opts.button ?? 'left', clickCount: opts.clickCount ?? 1 })
    for (const m of opts.modifiers ?? []) await this.page.keyboard.up(m)
  }
  async dblTap(loc: Locator): Promise<void> {
    await expect(loc).toBeVisible()
    const b = (await loc.boundingBox())!
    await this.page.mouse.dblclick(b.x + b.width / 2, b.y + b.height / 2)
  }

  async clickBackground(): Promise<void> {
    const p = await this.emptyPoint()
    await this.page.mouse.click(p.x, p.y)
  }

  /** keyboard focus on the canvas (so engine shortcuts fire) */
  async focus(): Promise<void> {
    await this.root().evaluate((el) => (el as HTMLElement).focus())
  }

  async ctrlWheel(at: Pt, deltaY: number, times = 1): Promise<void> {
    await this.page.mouse.move(at.x, at.y)
    await this.page.keyboard.down('Control')
    for (let i = 0; i < times; i++) await this.page.mouse.wheel(0, deltaY)
    await this.page.keyboard.up('Control')
  }

  /** a screen point on an edge's curve, as close to its middle as possible, where the edge is hittable (not under a card) */
  async edgePoint(id: string): Promise<Pt> {
    const pts = await this.edge(id)
      .locator('.canvas-edge-hit')
      .evaluate((p) => {
        const path = p as SVGPathElement
        const len = path.getTotalLength()
        return [0.5, 0.42, 0.58, 0.34, 0.66, 0.26, 0.74, 0.18, 0.82].map((f) => {
          const pt = path.getPointAtLength(len * f)
          return { x: pt.x, y: pt.y }
        })
      })
    for (const w of pts) {
      const s = await this.toScreen(w)
      const hit = await this.page.evaluate(({ x, y }) => (document.elementFromPoint(x, y)?.closest('[data-edge-id]') as HTMLElement | null)?.dataset.edgeId, s)
      if (hit === id) return s
    }
    throw new Error(`edge ${id} is not hittable anywhere along its curve`)
  }

  /** selected node ids, as rendered */
  async selectedIds(): Promise<string[]> {
    return this.root()
      .locator('.canvas-node.is-selected')
      .evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.nodeId!))
  }
}

/** synthesize an HTML5 file drop (the explorer's drag payload) at a screen point */
export async function dropFiles(target: Locator, paths: string[], at: Pt): Promise<void> {
  await target.evaluate(
    (el, { paths, at }) => {
      const dt = new DataTransfer()
      dt.setData('application/x-cs2d3k-file', paths.join('\n'))
      for (const type of ['dragenter', 'dragover', 'drop'])
        el.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, clientX: at.x, clientY: at.y, dataTransfer: dt }))
    },
    { paths, at }
  )
}
