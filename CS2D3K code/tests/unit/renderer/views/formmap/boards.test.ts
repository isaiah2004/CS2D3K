import { describe, expect, it } from 'vitest'
import { boardColumns, boardNameFor, boardProgress, boardScope, byPosition, columnOf, doneColumn, newFieldBoard, newGroupsBoard, NONE, orderCards, OTHER, reachedDone } from '@/views/formmap/boards'
import type { Board, FormMapData } from '@/views/formmap/schema'
import { card, doc, group } from './fixtures'

const sprint = (): FormMapData =>
  doc(
    [
      group('sprint', { x: 0, y: 0, width: 1400, height: 800 }, { label: 'Sprint' }),
      group('todo', { x: 20, y: 40, width: 400, height: 700 }, { label: 'To do', emoji: '📝', color: '2' }),
      group('doing', { x: 440, y: 40, width: 400, height: 700 }, { label: 'Doing' }),
      group('done', { x: 860, y: 40, width: 400, height: 700 }, { label: 'Done' }),
      group('nested', { x: 40, y: 400, width: 300, height: 300 }, { label: 'Blocked (inside To do)' }),
      card('a', { x: 40, y: 80, tags: ['task'], fields: { prio: 'high' } }),
      card('b', { x: 40, y: 200, tags: ['bug'], fields: { prio: 'low', done: true } }),
      card('c', { x: 60, y: 450, tags: ['task'] }),
      card('d', { x: 460, y: 80, tags: ['task'], fields: { prio: 'high', points: 3 } }),
      card('e', { x: 880, y: 80, tags: ['task'], fields: { prio: 'mid' } }),
      card('outside', { x: 3000, y: 0, fields: { prio: 'high' } })
    ],
    [],
    {
      fields: {
        prio: { type: 'select', options: [{ value: 'high', label: 'High', color: 'red' }, { value: 'low', label: 'Low' }] },
        done: { type: 'checkbox' },
        points: { type: 'number' },
        stars: { type: 'rating', max: 3 }
      }
    }
  )
const groupsBoard: Board = { id: 'b1', name: 'Sprint', source: { mode: 'groups', groupIds: ['todo', 'doing', 'done'] } }
const keys = (cols: ReturnType<typeof boardColumns>): [string, string[]][] => cols.map((c) => [c.key, c.cards.map((x) => x.id)])

describe('formmap/boards groups mode', () => {
  it('makes a column per group, in board order, with the group label, emoji, color and hint', () => {
    const cols = boardColumns(sprint(), groupsBoard)
    expect(cols.map((c) => c.label)).toEqual(['To do', 'Doing', 'Done'])
    expect(cols[0]).toMatchObject({ key: 'todo', groupId: 'todo', emoji: '📝', color: 'var(--color-orange)' })
  })

  it('puts a card in the innermost board group containing it (cards in a nested non-column group count for its parent)', () => {
    expect(keys(boardColumns(sprint(), groupsBoard))).toEqual([
      ['todo', ['a', 'b', 'c']],
      ['doing', ['d']],
      ['done', ['e']]
    ])
    // the nested group as a column of its own takes its card
    expect(keys(boardColumns(sprint(), { ...groupsBoard, source: { mode: 'groups', groupIds: ['todo', 'nested'] } }))).toEqual([
      ['todo', ['a', 'b']],
      ['nested', ['c']]
    ])
  })

  it('skips missing groups and duplicate ids; filters by tags', () => {
    expect(boardColumns(sprint(), { ...groupsBoard, source: { mode: 'groups', groupIds: ['gone', 'doing', 'doing'] } }).map((c) => c.key)).toEqual(['doing'])
    expect(keys(boardColumns(sprint(), { ...groupsBoard, filter: { tags: ['bug'] } }))).toEqual([
      ['todo', ['b']],
      ['doing', []],
      ['done', []]
    ])
  })

  it('orders cards by the stored order, then map reading order', () => {
    const b = { ...groupsBoard, order: { todo: ['c', 'gone', 'a'] } }
    expect(boardColumns(sprint(), b)[0].cards.map((c) => c.id)).toEqual(['c', 'a', 'b'])
    expect(orderCards([card('y', { x: 0, y: 100 }), card('x', { x: 50, y: 0 })]).map((c) => c.id)).toEqual(['x', 'y'])
    expect(byPosition({ x: 100, y: 0 }, { x: 0, y: 10 })).toBeGreaterThan(0)
  })

  it('reports WIP limits on columns', () => {
    expect(boardColumns(sprint(), { ...groupsBoard, wip: { doing: 2 } })[1].wip).toBe(2)
  })
})

describe('formmap/boards field mode', () => {
  it('splits the whole map by a select field: a "no value" column first (when used), options, then other values', () => {
    const cols = boardColumns(sprint(), { id: 'f', name: 'F', source: { mode: 'field', field: 'prio' } })
    expect(keys(cols)).toEqual([
      [NONE, ['c']],
      ['high', ['outside', 'a', 'd']],
      ['low', ['b']],
      [OTHER, ['e']]
    ])
    expect(cols[0]).toMatchObject({ label: 'No prio', value: undefined })
    expect(cols[1]).toMatchObject({ label: 'High', value: 'high', color: 'var(--color-red)' })
    expect(cols[3].locked).toBe(true)
  })

  it('scopes to a group (nested groups included) and shows only the listed values', () => {
    const cols = boardColumns(sprint(), { id: 'f', name: 'F', source: { mode: 'field', field: 'prio', groupId: 'todo', values: ['low'] } })
    expect(keys(cols)).toEqual([
      [NONE, ['c']],
      ['low', ['b']],
      [OTHER, ['a']]
    ])
    expect(boardScope(sprint(), { id: 'f', name: 'F', source: { mode: 'field', field: 'prio', groupId: 'sprint' } }).map((c) => c.id)).toEqual(['a', 'b', 'c', 'd', 'e'])
  })

  it('splits checkboxes into Not done / Done (always both)', () => {
    const cols = boardColumns(sprint(), { id: 'f', name: 'F', source: { mode: 'field', field: 'done' } })
    expect(cols.map((c) => [c.label, c.cards.length])).toEqual([
      ['Not done', 5],
      ['Done', 1]
    ])
    expect(cols[1].value).toBe(true)
  })

  it('splits ratings into star columns and free values into one column per distinct value', () => {
    expect(boardColumns(sprint(), { id: 'f', name: 'F', source: { mode: 'field', field: 'stars' } }).map((c) => c.label)).toEqual(['Unrated', '★', '★★', '★★★'])
    const d = doc([card('a', { fields: { who: 'Ben' } }), card('b', { fields: { who: 'Ana' } }), card('c', { fields: { who: 'Ben' } })], [], { fields: { who: { type: 'text' } } })
    expect(keys(boardColumns(d, { id: 'f', name: 'F', source: { mode: 'field', field: 'who' } }))).toEqual([
      ['Ana', ['b']],
      ['Ben', ['a', 'c']]
    ])
  })
})

describe('formmap/boards progress + names', () => {
  it("finds a card's column and the done column (the last real one)", () => {
    const cols = boardColumns(sprint(), groupsBoard)
    expect(columnOf(cols, 'd')?.key).toBe('doing')
    expect(columnOf(cols, 'outside')).toBeNull()
    expect(doneColumn(cols)?.key).toBe('done')
    expect(doneColumn(boardColumns(sprint(), { id: 'f', name: 'F', source: { mode: 'field', field: 'prio' } }))?.key).toBe('low')
  })

  it('measures progress as cards in the done column over cards on the board', () => {
    expect(boardProgress(sprint(), groupsBoard)).toMatchObject({ done: 1, total: 5 })
  })

  it('notices cards that newly reach the done column of any board', () => {
    const before = { ...sprint(), formmap: { version: 2, boards: [groupsBoard] } }
    const after = { ...before, nodes: before.nodes.map((n) => (n.id === 'd' ? { ...n, x: 880, y: 300 } : n)) }
    expect(reachedDone(before, after, ['d'])).toBe(true)
    expect(reachedDone(before, before, ['e'])).toBe(false)
    expect(reachedDone(after, before, ['d'])).toBe(false)
  })

  it('names a groups board after the common parent group, else the column names', () => {
    expect(boardNameFor(sprint(), ['todo', 'doing'])).toBe('Sprint')
    const flat = doc([group('x', { x: 0, y: 0, width: 10, height: 10 }, { label: 'X' }), group('y', { x: 50, y: 0, width: 10, height: 10 }, { label: 'Y' })])
    expect(boardNameFor(flat, ['x', 'y'])).toBe('X / Y')
    expect(boardNameFor(flat, [])).toBe('Board')
  })

  it('creates boards: groups left to right, field boards named after the field', () => {
    const b = newGroupsBoard(sprint(), ['done', 'todo', 'doing'])
    expect(b.source).toEqual({ mode: 'groups', groupIds: ['todo', 'doing', 'done'] })
    expect(b.name).toBe('Sprint')
    expect(b.id).toMatch(/^[0-9a-f]{16}$/)
    expect(newFieldBoard(sprint(), 'prio')).toMatchObject({ name: 'By prio', source: { mode: 'field', field: 'prio' } })
    expect(newFieldBoard(sprint(), 'prio', 'todo')).toMatchObject({ name: 'To do by prio', source: { groupId: 'todo' } })
  })
})
