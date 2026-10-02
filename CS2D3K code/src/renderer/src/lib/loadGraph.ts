// The graph the loading screen grows while a vault is indexed: the vault's real notes and resolved links, fed in
// as batches are parsed. Huge vaults are represented by a stable sample (each note is in or out by a hash of its
// path, so the picture is the same on every start) that keeps every per-update cost of the graph engine small.
import type { GraphData, GraphLinkData, GraphNodeData } from '@/views/graph/data'
import type { IndexedNote } from '@/store/metadata'

const NOTE_EXT = /\.(md|canvas|formmap)$/i

/** FNV-1a of the path, mapped to [0, 1) */
function sampleKey(s: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0) / 4294967296
}

export class LoadGraph {
  readonly nodes: GraphNodeData[] = []
  readonly links: GraphLinkData[] = []
  /** bumped whenever nodes or links were added */
  version = 0
  private byId = new Map<string, GraphNodeData>()
  private linkIndex = new Map<string, GraphLinkData>()
  /** share of the notes shown (fixed by the first batch) */
  private rate = -1
  /** nodes added since the last `take()`: the growing edge of the graph, drawn in the accent color */
  private front: GraphNodeData[] = []
  /** the edges of the last few `take()`s, newest first (fading from the accent to the normal node color) */
  private trail: GraphNodeData[][] = []

  constructor(
    private maxNodes = 4500,
    private maxLinks = 18000
  ) {}

  private include(path: string): boolean {
    return this.rate >= 1 || sampleKey(path) < this.rate
  }

  private node(path: string): GraphNodeData {
    let n = this.byId.get(path)
    if (!n) {
      const name = path.slice(path.lastIndexOf('/') + 1)
      const isMd = name.toLowerCase().endsWith('.md')
      n = { id: path, kind: isMd ? 'note' : 'canvas', label: isMd ? name.slice(0, -3) : name, path }
      this.byId.set(path, n)
      this.nodes.push(n)
      this.front.push(n)
      this.version++
    }
    return n
  }

  /** `expected`: how many notes the vault has (0 = unknown); fixes the sampling rate on the first call */
  add(notes: IndexedNote[], expected: number): void {
    if (this.rate < 0) this.rate = expected > this.maxNodes ? this.maxNodes / expected : 1
    for (const { path, targets } of notes) {
      if (!this.include(path)) continue
      this.node(path)
      for (const t of targets) {
        if (t === path || !NOTE_EXT.test(t) || !this.include(t)) continue
        const fwd = path < t
        const key = fwd ? path + '\u0000' + t : t + '\u0000' + path
        let l = this.linkIndex.get(key)
        if (!l) {
          if (this.links.length >= this.maxLinks) continue
          this.node(t)
          l = { source: fwd ? path : t, target: fwd ? t : path, kind: 'link', dir: 0 }
          this.linkIndex.set(key, l)
          this.links.push(l)
          this.version++
        }
        l.dir |= fwd ? 1 : 2
      }
    }
  }

  /** some recently added nodes still carry a trail color (another `take()` fades them further) */
  get glowing(): boolean {
    return this.trail.some((t) => t.length > 0)
  }

  /**
   * The current graph. Nodes added since the last call get `trail[0]` as their color, the ones before `trail[1]`
   * and so on, so the newest part of the graph glows and fades as it grows.
   */
  take(trail: string[]): GraphData {
    this.trail.unshift(this.front)
    this.front = []
    for (const n of this.trail[trail.length] ?? []) n.groupColor = undefined
    this.trail.length = Math.min(this.trail.length, trail.length)
    this.trail.forEach((nodes, i) => {
      for (const n of nodes) n.groupColor = trail[i]
    })
    return { nodes: this.nodes, links: this.links }
  }
}
