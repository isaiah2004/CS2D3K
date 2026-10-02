import { describe, expect, it } from 'vitest'
import {
  addKanbanColumn,
  deleteKanbanCard,
  deleteKanbanColumn,
  findKanbanCard,
  formIntoKanban,
  formToKanbanCard,
  groupsToKanban,
  insertKanbanCard,
  kanbanCardAcross,
  kanbanCardOut,
  kanbanCount,
  kanbanSize,
  kanbanToGroups,
  moveKanbanCard,
  moveKanbanColumn,
  newKanban,
  parseTags,
  registerUsage,
  updateKanban,
  updateKanbanCard,
  updateKanbanColumn
} from '@/views/formmap/kanban'
import { boardColumns } from '@/views/formmap/boards'
import { forms, groupChain, groups, kanbans, metaOf, type KanbanNode } from '@/views/formmap/schema'
import { card, doc, edge, formById, group, kanban } from './fixtures'

const k3 = (): KanbanNode =>
  kanban('k', [
    { id: 'todo', title: 'To do', cards: [{ id: 'a', title: 'A' }, { id: 'b', title: 'B' }, { id: 'c', title: 'C' }] },
    { id: 'doing', title: 'Doing', cards: [{ id: 'd', title: 'D', tags: ['bug'], fields: { prio: 'high' } }] },
    { id: 'done', title: 'Done', color: 'green', cards: [] }
  ])
const ids = (k: KanbanNode): string[][] => k.columns.map((c) => c.cards.map((x) => x.id))

describe('formmap/kanban node edits', () => {
  it('creates a To do / Doing / Done board centered on a point', () => {
    const k = newKanban({ x: 500, y: 300 })
    expect(k.columns.map((c) => c.title)).toEqual(['To do', 'Doing', 'Done'])
    expect(k.x + k.width / 2).toBeCloseTo(500, -2)
    expect(kanbanCount(k)).toBe(0)
    expect(kanbanSize(4).width).toBeGreaterThan(kanbanSize(3).width)
  })

  it('moves cards within a column (index = position without the card) and across columns', () => {
    expect(ids(moveKanbanCard(k3(), 'a', 'todo', 2))).toEqual([['b', 'c', 'a'], ['d'], []])
    expect(ids(moveKanbanCard(k3(), 'c', 'todo', 0))).toEqual([['c', 'a', 'b'], ['d'], []])
    expect(ids(moveKanbanCard(k3(), 'b', 'done', 0))).toEqual([['a', 'c'], ['d'], ['b']])
    expect(ids(moveKanbanCard(k3(), 'b', 'doing', 99))).toEqual([['a', 'c'], ['d', 'b'], []])
    const k = k3()
    expect(moveKanbanCard(k, 'a', 'todo', 0)).toBe(k)
    expect(moveKanbanCard(k, 'nope', 'todo', 0)).toBe(k)
    expect(moveKanbanCard(k, 'a', 'nope', 0)).toBe(k)
  })

  it('inserts, updates and deletes cards', () => {
    expect(ids(insertKanbanCard(k3(), 'done', { id: 'n', title: 'N' }))).toEqual([['a', 'b', 'c'], ['d'], ['n']])
    expect(ids(insertKanbanCard(k3(), 'todo', { id: 'n', title: 'N' }, 1))).toEqual([['a', 'n', 'b', 'c'], ['d'], []])
    expect(findKanbanCard(updateKanbanCard(k3(), 'd', { done: true, title: 'D2' }), 'd')?.card).toMatchObject({ title: 'D2', done: true, tags: ['bug'] })
    expect(ids(deleteKanbanCard(k3(), 'b'))).toEqual([['a', 'c'], ['d'], []])
    expect(findKanbanCard(k3(), 'd')).toMatchObject({ index: 0, col: { id: 'doing' } })
  })

  it('adds, renames, recolors, collapses, reorders and deletes columns', () => {
    const { node, id } = addKanbanColumn(k3(), 'Review', 2)
    expect(node.columns.map((c) => c.title)).toEqual(['To do', 'Doing', 'Review', 'Done'])
    expect(node.columns[2]).toMatchObject({ id, cards: [] })
    expect(updateKanbanColumn(k3(), 'done', { title: 'Shipped', collapsed: true }).columns[2]).toMatchObject({ title: 'Shipped', collapsed: true, color: 'green' })
    expect(moveKanbanColumn(k3(), 'done', 0).columns.map((c) => c.id)).toEqual(['done', 'todo', 'doing'])
    expect(moveKanbanColumn(k3(), 'todo', 5).columns.map((c) => c.id)).toEqual(['doing', 'done', 'todo'])
    expect(deleteKanbanColumn(k3(), 'doing').columns.map((c) => c.id)).toEqual(['todo', 'done'])
  })

  it('replaces only the targeted node (same data when nothing changes)', () => {
    const d = doc([k3(), card('x')])
    expect(updateKanban(d, 'x', (k) => ({ ...k, title: 'no' }))).toBe(d)
    expect(updateKanban(d, 'k', (k) => k)).toBe(d)
    expect((updateKanban(d, 'k', (k) => ({ ...k, title: 'T' })).nodes[0] as KanbanNode).title).toBe('T')
  })

  it('parses typed tags', () => {
    expect(parseTags('#a, b  c,,#a')).toEqual(['a', 'b', 'c', 'a'])
  })
})

describe('formmap/kanban ↔ canvas cards', () => {
  const later = group('later', { x: 1000, y: 0, width: 600, height: 600 }, { assign: { phase: 'later' } })

  it('pops a card out onto the canvas at a point, keeping its fields and applying the drop group', () => {
    const d = doc([k3(), later], [], { fields: { prio: { type: 'select', options: [{ value: 'high' }] } } })
    const { data, id } = kanbanCardOut(d, 'k', 'd', { x: 1300, y: 300 })
    const f = formById(data, id!)
    expect(id).toBe('d')
    expect(f).toMatchObject({ type: 'form', title: 'D', tags: ['bug'], fields: { prio: 'high', phase: 'later' } })
    expect(f.x + f.width / 2).toBeCloseTo(1300, -2)
    expect(ids(data.nodes[0] as KanbanNode)).toEqual([['a', 'b', 'c'], [], []])
    // new tags / fields are registered
    expect(metaOf(data).tags?.bug).toBeDefined()
    expect(metaOf(data).fields?.phase).toEqual({ type: 'text' })
  })

  it('gives a done kanban card a done checkbox, and a fresh id when its id is taken', () => {
    const k = kanban('k', [{ id: 'c', title: 'C', cards: [{ id: 'x', title: 'Done thing', done: true }] }])
    const { data, id } = kanbanCardOut(doc([k, card('x', { x: 5000 })]), 'k', 'x', { x: 0, y: 0 })
    expect(id).not.toBe('x')
    expect(formById(data, id!).fields).toEqual({ done: true })
    expect(metaOf(data).fields?.done).toEqual({ type: 'checkbox' })
  })

  it('moves a canvas card into a column (keeping id, text, tags, fields, votes, color) and drops its relations', () => {
    const f = card('f', { title: 'F', text: 'notes', tags: ['x'], fields: { done: true }, votes: 2, color: '3' })
    const d = doc([k3(), f, card('g')], [edge('f', 'g', 'serves'), edge('g', 'f'), edge('g', 'k')], { fields: { done: { type: 'checkbox' } } })
    const { data, removedEdges } = formIntoKanban(d, 'f', 'k', 'doing', 0)
    expect(removedEdges).toBe(2)
    expect(data.edges.map((e) => e.id)).toEqual(['g->k'])
    expect(forms(data).map((x) => x.id)).toEqual(['g'])
    expect(findKanbanCard(data.nodes[0] as KanbanNode, 'f')).toMatchObject({ col: { id: 'doing' }, index: 0, card: { title: 'F', text: 'notes', tags: ['x'], fields: { done: true }, votes: 2, color: '3', done: true } })
    expect(formIntoKanban(d, 'f', 'k', 'nope', 0).data).toBe(d)
    expect(formIntoKanban(d, 'g', 'f', 'doing', 0).data).toBe(d)
  })

  it('round-trips a card canvas → kanban → canvas without losing data', () => {
    const f = card('f', { title: 'F', text: 'notes', tags: ['x'], fields: { prio: 'high' }, votes: 2 })
    const k = formToKanbanCard(f)
    const back = kanbanCardOut(doc([kanban('k', [{ id: 'c', title: 'C', cards: [k] }])]), 'k', 'f', { x: 0, y: 0 })
    expect(formById(back.data, 'f')).toMatchObject({ title: 'F', text: 'notes', tags: ['x'], fields: { prio: 'high' }, votes: 2 })
  })

  it('moves a card between kanban nodes (and within one)', () => {
    const other = kanban('k2', [{ id: 'x', title: 'X', cards: [{ id: 'z', title: 'Z' }] }])
    const d = doc([k3(), other])
    const out = kanbanCardAcross(d, 'k', 'a', 'k2', 'x', 0)
    expect(ids(out.nodes[0] as KanbanNode)).toEqual([['b', 'c'], ['d'], []])
    expect(ids(out.nodes[1] as KanbanNode)).toEqual([['a', 'z']])
    expect(ids(kanbanCardAcross(d, 'k', 'a', 'k', 'done', 0).nodes[0] as KanbanNode)).toEqual([['b', 'c'], ['d'], ['a']])
  })

  it('registers new fields and tags only once', () => {
    const d = doc([], [], { fields: { a: { type: 'text' } }, tags: { t: { color: 'red' } } })
    expect(registerUsage(d, [{ tags: ['t'], fields: { a: 'x' } }])).toBe(d)
    const n = registerUsage(d, [{ tags: ['u'], fields: { n: 3 } }])
    expect(metaOf(n).fields).toEqual({ a: { type: 'text' }, n: { type: 'number' } })
    expect(Object.keys(metaOf(n).tags!)).toEqual(['t', 'u'])
  })
})

describe('formmap/kanban ↔ groups', () => {
  it('lays the columns out as groups (inside a parent group) with their cards, and saves a board over them', () => {
    const k = { ...k3(), title: 'Sprint', x: 100, y: 100 }
    const d = doc([k, card('other', { x: 5000 })], [], { boards: [] })
    const { data, groupIds, boardId } = kanbanToGroups(d, 'k')
    expect(kanbans(data)).toHaveLength(0)
    const gs = groups(data)
    expect(gs.map((g) => g.label)).toEqual(['Sprint', 'To do', 'Doing', 'Done'])
    expect(groupIds).toEqual(gs.slice(1).map((g) => g.id))
    expect(gs[3].color).toBe('green')
    // every card sits in its column group
    for (const [i, g] of gs.slice(1).entries()) {
      const inside = forms(data).filter((f) => groupChain(data, f).at(-1)?.id === g.id).map((f) => f.id)
      expect(inside).toEqual(ids(k)[i])
    }
    // nested inside the parent
    expect(groupChain(data, gs[1]).filter((g) => g.id !== gs[1].id).map((g) => g.label)).toEqual(['Sprint'])
    const board = metaOf(data).boards!.find((b) => b.id === boardId)!
    expect(board.name).toBe('Sprint')
    expect(boardColumns(data, board).map((c) => [c.label, c.cards.map((x) => x.id)])).toEqual([
      ['To do', ['a', 'b', 'c']],
      ['Doing', ['d']],
      ['Done', []]
    ])
    expect(formById(data, 'd')).toMatchObject({ tags: ['bug'], fields: { prio: 'high' } })
  })

  it('turns groups back into a kanban node (a parent group converts its child groups), round trip', () => {
    const k = { ...k3(), title: 'Sprint' }
    const { data, groupIds, boardId } = kanbanToGroups(doc([k]), 'k')
    const parent = groups(data).find((g) => g.label === 'Sprint')!
    const back = groupsToKanban(data, [parent.id])
    expect(groups(back.data)).toHaveLength(0)
    expect(forms(back.data)).toHaveLength(0)
    const k2 = kanbans(back.data)[0]
    expect(back.id).toBe(k2.id)
    expect(k2.title).toBe('Sprint')
    expect(k2.columns.map((c) => [c.title, c.cards.map((x) => x.title)])).toEqual([
      ['To do', ['A', 'B', 'C']],
      ['Doing', ['D']],
      ['Done', []]
    ])
    expect(k2.columns[1].cards[0]).toMatchObject({ tags: ['bug'], fields: { prio: 'high' } })
    // the saved board lost its groups: it is removed
    expect(metaOf(back.data).boards?.some((b) => b.id === boardId)).toBe(false)
    expect(groupIds).toHaveLength(3)
  })

  it('converts selected groups left to right, keeps other nodes on the canvas and removes relations of moved cards', () => {
    const d = doc(
      [
        group('b', { x: 600, y: 0, width: 400, height: 400 }, { label: 'B' }),
        group('a', { x: 0, y: 0, width: 400, height: 400 }, { label: 'A', color: '1' }),
        card('a1', { x: 20, y: 200 }),
        card('a0', { x: 20, y: 40 }),
        card('b1', { x: 620, y: 40 }),
        { id: 'note', type: 'text', text: 'stays', x: 20, y: 300, width: 100, height: 40 },
        card('free', { x: 3000, y: 0 })
      ],
      [edge('a0', 'free', 'serves'), edge('free', 'b1'), edge('free', 'note')]
    )
    const r = groupsToKanban(d, ['b', 'a'])
    const k = kanbans(r.data)[0]
    expect(k.columns.map((c) => [c.title, c.cards.map((x) => x.id)])).toEqual([
      ['A', ['a0', 'a1']],
      ['B', ['b1']]
    ])
    expect(k.columns[0].color).toBe('1')
    expect(r.removedEdges).toBe(2)
    expect(r.leftovers).toBe(1)
    expect(r.data.nodes.map((n) => n.id).sort()).toEqual(['free', 'note', k.id].sort())
    expect(r.data.edges.map((e) => e.id)).toEqual(['free->note'])
    expect([k.x, k.y]).toEqual([0, 0])
  })

  it('does nothing for no groups', () => {
    const d = doc([card('a')])
    expect(groupsToKanban(d, ['nope']).data).toBe(d)
    expect(kanbanToGroups(d, 'a').data).toBe(d)
  })
})

