import { describe, expect, it } from 'vitest'
import {
  DEFAULT_SIZE,
  autoSides,
  boundsOf,
  cloneWithNewIds,
  colorCss,
  contains,
  edgeGeometry,
  geometryForEdge,
  intersects,
  isHttpsUrl,
  looksLikeUrl,
  nearestSide,
  nodesInsideGroups,
  normRect,
  oppositeSide,
  parseCanvas,
  serializeCanvas,
  sideNormal,
  sidePoint,
  snap,
  toggleTaskLine,
  type CanvasEdge,
  type CanvasNode
} from '@/views/canvas/model'

const node = (id: string, x: number, y: number, width = 100, height = 50, extra: Partial<CanvasNode> = {}): CanvasNode => ({ id, type: 'text', x, y, width, height, ...extra })
const byId = (nodes: CanvasNode[]): Map<string, CanvasNode> => new Map(nodes.map((n) => [n.id, n]))

describe('views/canvas/model parseCanvas', () => {
  it('treats an empty or whitespace-only file as a valid empty canvas', () => {
    expect(parseCanvas('')).toEqual({ data: { nodes: [], edges: [] }, valid: true })
    expect(parseCanvas('  \n\t')).toEqual({ data: { nodes: [], edges: [] }, valid: true })
  })

  it('flags invalid JSON as invalid and yields an empty canvas', () => {
    expect(parseCanvas('{ nodes: [')).toEqual({ data: { nodes: [], edges: [] }, valid: false })
  })

  it('flags JSON that is not an object (array, null, number, string) as invalid', () => {
    for (const text of ['[]', 'null', '42', '"canvas"', 'true']) {
      expect(parseCanvas(text).valid, text).toBe(false)
      expect(parseCanvas(text).data).toEqual({ nodes: [], edges: [] })
    }
  })

  it('accepts an object without nodes/edges (or with non-array ones) as an empty canvas', () => {
    expect(parseCanvas('{}')).toEqual({ data: { nodes: [], edges: [] }, valid: true })
    const { data, valid } = parseCanvas('{"nodes": 5, "edges": {"a": 1}}')
    expect(valid).toBe(true)
    expect(data.nodes).toEqual([])
    expect(data.edges).toEqual([])
  })

  it('skips node entries that are not objects', () => {
    const { data } = parseCanvas(JSON.stringify({ nodes: [null, 3, 'x', true, { id: 'a', type: 'text', x: 0, y: 0, width: 10, height: 10 }] }))
    expect(data.nodes.map((n) => n.id)).toEqual(['a'])
  })

  it('skips node entries that are arrays instead of turning them into junk nodes', () => {
    const { data } = parseCanvas(JSON.stringify({ nodes: [[1, 2], { id: 'a', type: 'text', x: 0, y: 0, width: 10, height: 10 }] }))
    expect(data.nodes.map((n) => n.id)).toEqual(['a'])
  })

  it('fills defaults for missing type, position and size', () => {
    const { data } = parseCanvas(JSON.stringify({ nodes: [{ id: 'a' }, { id: 'g', type: 'group' }, { id: 'c', type: 'code' }, { id: 'u', type: 'weird' }] }))
    const [a, g, c, u] = data.nodes
    expect(a).toEqual({ id: 'a', type: 'text', x: 0, y: 0, ...DEFAULT_SIZE.text })
    expect(g).toMatchObject({ type: 'group', ...DEFAULT_SIZE.group })
    expect(c).toMatchObject({ type: 'code', ...DEFAULT_SIZE.code })
    // unknown types keep their type and get the text default size
    expect(u).toMatchObject({ type: 'weird', ...DEFAULT_SIZE.text })
  })

  it('gives nodes whose type names an Object.prototype key the default text size (not NaN)', () => {
    const { data } = parseCanvas(JSON.stringify({ nodes: [{ id: 'a', type: 'toString' }, { id: 'b', type: 'constructor' }] }))
    for (const n of data.nodes) expect(n).toMatchObject({ width: DEFAULT_SIZE.text.width, height: DEFAULT_SIZE.text.height })
  })

  it('coerces numeric strings and rejects non-numeric geometry', () => {
    const { data } = parseCanvas(JSON.stringify({ nodes: [{ id: 'a', x: '12', y: ' 7 ', width: 'wide', height: null }] }))
    expect(data.nodes[0]).toMatchObject({ x: 12, y: 7, width: DEFAULT_SIZE.text.width, height: DEFAULT_SIZE.text.height })
    const blank = parseCanvas(JSON.stringify({ nodes: [{ id: 'b', x: '', y: true }] })).data.nodes[0]
    expect(blank).toMatchObject({ x: 0, y: 0 })
  })

  it('clamps zero and negative sizes to at least 1', () => {
    const { data } = parseCanvas(JSON.stringify({ nodes: [{ id: 'a', x: 0, y: 0, width: 0, height: -40 }] }))
    expect(data.nodes[0]).toMatchObject({ width: 1, height: 1 })
  })

  it('assigns 16-hex ids to nodes without a usable id', () => {
    const { data } = parseCanvas(JSON.stringify({ nodes: [{ x: 0 }, { id: '' }, { id: 12 }] }))
    expect(data.nodes).toHaveLength(3)
    for (const n of data.nodes) expect(n.id).toMatch(/^[0-9a-f]{16}$/)
    expect(new Set(data.nodes.map((n) => n.id)).size).toBe(3)
  })

  it('gives duplicate node ids a fresh id while keeping the first one', () => {
    const { data } = parseCanvas(JSON.stringify({ nodes: [{ id: 'dup', text: 'first' }, { id: 'dup', text: 'second' }] }))
    expect(data.nodes[0]).toMatchObject({ id: 'dup', text: 'first' })
    expect(data.nodes[1].id).not.toBe('dup')
    expect(data.nodes[1].text).toBe('second')
  })

  it('gives an edge whose id collides with a node id a fresh id', () => {
    const { data } = parseCanvas(
      JSON.stringify({ nodes: [{ id: 'a' }, { id: 'b' }], edges: [{ id: 'a', fromNode: 'a', toNode: 'b' }, { id: 'e', fromNode: 'a', toNode: 'b' }, { id: 'e', fromNode: 'b', toNode: 'a' }] })
    )
    const ids = data.edges.map((e) => e.id)
    expect(ids[0]).not.toBe('a')
    expect(ids[1]).toBe('e')
    expect(ids[2]).not.toBe('e')
    expect(new Set([...ids, 'a', 'b']).size).toBe(5)
  })

  it('drops edges without string endpoints', () => {
    const { data } = parseCanvas(
      JSON.stringify({ nodes: [{ id: 'a' }], edges: [{ id: 'e1', fromNode: 'a' }, { id: 'e2', fromNode: 1, toNode: 'a' }, null, 'edge', { id: 'e3', fromNode: 'a', toNode: 'a' }] })
    )
    expect(data.edges.map((e) => e.id)).toEqual(['e3'])
  })

  it('keeps dangling edges (endpoints missing) so they survive a round-trip', () => {
    const { data } = parseCanvas(JSON.stringify({ nodes: [{ id: 'a' }], edges: [{ id: 'e', fromNode: 'a', toNode: 'ghost' }] }))
    expect(data.edges).toEqual([{ id: 'e', fromNode: 'a', toNode: 'ghost' }])
    expect(geometryForEdge(data.edges[0], byId(data.nodes))).toBeNull()
  })

  it('removes invalid edge sides but keeps valid ones', () => {
    const { data } = parseCanvas(
      JSON.stringify({ nodes: [{ id: 'a' }, { id: 'b' }], edges: [{ id: 'e', fromNode: 'a', fromSide: 'middle', toNode: 'b', toSide: 'left' }] })
    )
    expect(data.edges[0]).not.toHaveProperty('fromSide')
    expect(data.edges[0].toSide).toBe('left')
  })

  it('preserves unknown fields at top level, on nodes and on edges', () => {
    const src = {
      nodes: [{ id: 'a', type: 'text', x: 1, y: 2, width: 3, height: 4, text: 'hi', color: '3', custom: { deep: [1, 2] } }],
      edges: [{ id: 'e', fromNode: 'a', toNode: 'a', fromEnd: 'arrow', label: 'self', weight: 7 }],
      metadata: { version: '1.0' },
      plugin: 'x'
    }
    const { data, valid } = parseCanvas(JSON.stringify(src))
    expect(valid).toBe(true)
    expect(data).toEqual(src)
  })

  it('round-trips through serializeCanvas without changing the data', () => {
    const src = JSON.stringify({
      nodes: [
        { id: 'a', type: 'file', file: 'Note.md', subpath: '#Head', x: -10, y: 5, width: 400, height: 400, extra: true },
        { id: 'g', type: 'group', label: 'G', background: 'bg.png', backgroundStyle: 'cover', x: -100, y: -100, width: 800, height: 800 }
      ],
      edges: [{ id: 'e', fromNode: 'a', fromSide: 'right', toNode: 'g', toSide: 'left', toEnd: 'none', color: '#ff0000' }],
      zzz: 1
    })
    const first = parseCanvas(src).data
    const text = serializeCanvas(first)
    expect(parseCanvas(text).data).toEqual(first)
    expect(serializeCanvas(parseCanvas(text).data)).toBe(text)
  })

  it('serializes with tab indentation like Obsidian', () => {
    expect(serializeCanvas({ nodes: [], edges: [] })).toBe('{\n\t"nodes": [],\n\t"edges": []\n}')
  })
})

describe('views/canvas/model colorCss', () => {
  it('maps presets "1".."6" to theme variables', () => {
    expect(colorCss('1')).toBe('var(--color-red)')
    expect(colorCss('6')).toBe('var(--color-purple)')
  })
  it('passes hex colors through', () => {
    expect(colorCss('#abc')).toBe('#abc')
    expect(colorCss('#AABBCCDD')).toBe('#AABBCCDD')
  })
  it('rejects anything else', () => {
    for (const c of [undefined, null, 3, '', '7', 'red', '#ggg', '#12', 'url(x)']) expect(colorCss(c), String(c)).toBeUndefined()
  })
})

describe('views/canvas/model geometry', () => {
  it('snaps to the grid', () => {
    expect(snap(29)).toBe(20)
    expect(snap(31)).toBe(40)
    expect(snap(-29)).toBe(-20)
    expect(snap(7, 5)).toBe(5)
  })

  it('computes the bounding box of rects, or null for none', () => {
    expect(boundsOf([])).toBeNull()
    expect(
      boundsOf([
        { x: 0, y: 0, width: 10, height: 10 },
        { x: -5, y: 20, width: 5, height: 5 }
      ])
    ).toEqual({ x: -5, y: 0, width: 15, height: 25 })
  })

  it('tests containment inclusively on edges', () => {
    const outer = { x: 0, y: 0, width: 100, height: 100 }
    expect(contains(outer, { x: 0, y: 0, width: 100, height: 100 })).toBe(true)
    expect(contains(outer, { x: 10, y: 10, width: 91, height: 10 })).toBe(false)
  })

  it('tests intersection exclusively on touching edges', () => {
    const a = { x: 0, y: 0, width: 10, height: 10 }
    expect(intersects(a, { x: 5, y: 5, width: 10, height: 10 })).toBe(true)
    expect(intersects(a, { x: 10, y: 0, width: 10, height: 10 })).toBe(false)
    expect(intersects(a, { x: -20, y: -20, width: 5, height: 5 })).toBe(false)
  })

  it('normalizes a rect dragged in any direction', () => {
    expect(normRect({ x: 10, y: 20 }, { x: 0, y: 5 })).toEqual({ x: 0, y: 5, width: 10, height: 15 })
  })

  it('places side anchors at the middle of each side, with outward normals', () => {
    const r = { x: 0, y: 0, width: 100, height: 50 }
    expect(sidePoint(r, 'top')).toEqual({ x: 50, y: 0 })
    expect(sidePoint(r, 'right')).toEqual({ x: 100, y: 25 })
    expect(sidePoint(r, 'bottom')).toEqual({ x: 50, y: 50 })
    expect(sidePoint(r, 'left')).toEqual({ x: 0, y: 25 })
    expect(sideNormal('top')).toEqual({ x: 0, y: -1 })
    expect(sideNormal('right')).toEqual({ x: 1, y: 0 })
    expect(oppositeSide('top')).toBe('bottom')
    expect(oppositeSide('left')).toBe('right')
    expect(oppositeSide('right')).toBe('left')
    expect(oppositeSide('bottom')).toBe('top')
  })

  it('picks the nearest side relative to the aspect ratio', () => {
    const wide = { x: 0, y: 0, width: 200, height: 20 }
    expect(nearestSide(wide, { x: 150, y: 19 })).toBe('bottom')
    expect(nearestSide(wide, { x: 199, y: 12 })).toBe('right')
    expect(nearestSide(wide, { x: 0, y: 10 })).toBe('left')
    expect(nearestSide(wide, { x: 100, y: -5 })).toBe('top')
  })

  it('does not divide by zero for zero-size nodes', () => {
    expect(nearestSide({ x: 0, y: 0, width: 0, height: 0 }, { x: 5, y: 1 })).toBe('right')
  })

  it('auto-picks facing sides between two nodes', () => {
    const a = { x: 0, y: 0, width: 100, height: 100 }
    expect(autoSides(a, { x: 300, y: 0, width: 100, height: 100 })).toEqual(['right', 'left'])
    expect(autoSides(a, { x: -300, y: 20, width: 100, height: 100 })).toEqual(['left', 'right'])
    expect(autoSides(a, { x: 0, y: 300, width: 100, height: 100 })).toEqual(['bottom', 'top'])
    expect(autoSides(a, { x: 20, y: -300, width: 100, height: 100 })).toEqual(['top', 'bottom'])
  })

  it('builds a bezier path with arrow heads only where requested', () => {
    const g = edgeGeometry({ x: 0, y: 0 }, 'right', { x: 200, y: 0 }, 'left', false, true)
    expect(g.path.startsWith('M 0 0 C')).toBe(true)
    // the curve stops short of the target to leave room for the arrow head
    expect(g.path.endsWith('186 0')).toBe(true)
    expect(g.fromArrow).toBeUndefined()
    expect(g.toArrow?.startsWith('200,0 ')).toBe(true)
    expect(g.mid.x).toBeCloseTo(93)
    expect(g.mid.y).toBeCloseTo(0)
    expect(g.p1).toEqual({ x: 0, y: 0 })
    expect(g.p2).toEqual({ x: 200, y: 0 })
    const both = edgeGeometry({ x: 0, y: 0 }, 'right', { x: 200, y: 0 }, 'left', true, false)
    expect(both.fromArrow?.startsWith('0,0 ')).toBe(true)
    expect(both.toArrow).toBeUndefined()
  })

  it('points the arrow of a free (dragged) endpoint along the curve', () => {
    const g = edgeGeometry({ x: 0, y: 0 }, 'right', { x: 200, y: 0 }, null, false, true)
    expect(g.toArrow).toBeDefined()
    expect(g.toArrow).not.toMatch(/NaN/)
    expect(g.path.endsWith('200 0')).toBe(true)
  })

  it('resolves stored edges with default sides and a default arrow at the target', () => {
    const nodes = [node('a', 0, 0), node('b', 400, 0)]
    const g = geometryForEdge({ id: 'e', fromNode: 'a', toNode: 'b' }, byId(nodes))!
    expect(g.p1).toEqual({ x: 100, y: 25 })
    expect(g.p2).toEqual({ x: 400, y: 25 })
    expect(g.toArrow).toBeDefined()
    expect(g.fromArrow).toBeUndefined()
    const explicit = geometryForEdge({ id: 'e', fromNode: 'a', fromSide: 'bottom', fromEnd: 'arrow', toNode: 'b', toSide: 'top', toEnd: 'none' }, byId(nodes))!
    expect(explicit.p1).toEqual({ x: 50, y: 50 })
    expect(explicit.p2).toEqual({ x: 450, y: 0 })
    expect(explicit.fromArrow).toBeDefined()
    expect(explicit.toArrow).toBeUndefined()
  })

  it('returns null geometry when either endpoint is missing', () => {
    const nodes = byId([node('a', 0, 0)])
    expect(geometryForEdge({ id: 'e', fromNode: 'ghost', toNode: 'a' }, nodes)).toBeNull()
    expect(geometryForEdge({ id: 'e', fromNode: 'a', toNode: 'ghost' }, nodes)).toBeNull()
  })
})

describe('views/canvas/model nodesInsideGroups', () => {
  const g1 = node('g1', 0, 0, 1000, 1000, { type: 'group' })
  const g2 = node('g2', 100, 100, 400, 400, { type: 'group' })
  const inner = node('inner', 150, 150, 50, 50)
  const inG1 = node('inG1', 600, 600, 50, 50)
  const partial = node('partial', 950, 950, 100, 100)
  const outside = node('outside', 2000, 2000)
  const all = [g1, g2, inner, inG1, partial, outside]

  it('collects nodes fully inside a group, recursing into nested groups', () => {
    expect([...nodesInsideGroups(all, ['g1'])].sort()).toEqual(['g2', 'inG1', 'inner'])
  })

  it('excludes the selected groups themselves', () => {
    expect([...nodesInsideGroups(all, ['g1', 'g2'])].sort()).toEqual(['inG1', 'inner'])
  })

  it('ignores unknown group ids', () => {
    expect(nodesInsideGroups(all, ['nope']).size).toBe(0)
  })

  it('uses the container predicate to decide what to recurse into', () => {
    const notes = node('n', 0, 0, 1000, 1000, { type: 'note-box' })
    const res = nodesInsideGroups([notes, inner], ['n'], (n) => n.type === 'note-box')
    expect([...res]).toEqual(['inner'])
  })
})

describe('views/canvas/model misc helpers', () => {
  it('recognizes https and http(s) urls', () => {
    expect(isHttpsUrl(' https://x.y ')).toBe(true)
    expect(isHttpsUrl('http://x.y')).toBe(false)
    expect(looksLikeUrl('http://x.y/a?b')).toBe(true)
    expect(looksLikeUrl('https://x y')).toBe(false)
    expect(looksLikeUrl('x.y')).toBe(false)
  })

  it('clones nodes and internal edges with fresh ids and an offset', () => {
    const nodes = [node('a', 0, 0, 10, 10, { meta: { k: 1 } }), node('b', 50, 0)]
    const edges: CanvasEdge[] = [
      { id: 'e1', fromNode: 'a', toNode: 'b', label: 'x' },
      { id: 'e2', fromNode: 'a', toNode: 'outside' }
    ]
    const out = cloneWithNewIds(nodes, edges, 10, 20)
    expect(out.nodes).toHaveLength(2)
    expect(out.nodes[0]).toMatchObject({ x: 10, y: 20, meta: { k: 1 } })
    expect(out.nodes[0].id).not.toBe('a')
    expect(out.nodes[0].meta).not.toBe(nodes[0].meta)
    expect(out.edges).toHaveLength(1)
    expect(out.edges[0]).toMatchObject({ fromNode: out.nodes[0].id, toNode: out.nodes[1].id, label: 'x' })
    expect(out.edges[0].id).not.toBe('e1')
    expect(nodes[0].x).toBe(0)
  })

  it('toggles task checkboxes on the given line only', () => {
    const text = '- [ ] one\n  * [x] two\n3. [X] three\nplain'
    expect(toggleTaskLine(text, 0, true)).toBe('- [x] one\n  * [x] two\n3. [X] three\nplain')
    expect(toggleTaskLine(text, 1, false)).toBe('- [ ] one\n  * [ ] two\n3. [X] three\nplain')
    expect(toggleTaskLine(text, 2, false)).toBe('- [ ] one\n  * [x] two\n3. [ ] three\nplain')
    expect(toggleTaskLine(text, 3, true)).toBe(text)
  })

  it('ignores out-of-range task lines', () => {
    expect(toggleTaskLine('- [ ] a', -1, true)).toBe('- [ ] a')
    expect(toggleTaskLine('- [ ] a', 5, true)).toBe('- [ ] a')
  })
})
