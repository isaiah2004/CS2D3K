import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/views/formmap/fun/celebrate', () => ({ celebrate: vi.fn() }))

import { celebrate } from '@/views/formmap/fun/celebrate'
import {
  addCard,
  addCardToColumn,
  addField,
  addRelation,
  applyGroupFields,
  bestGroupFor,
  createBoard,
  deleteBoard,
  deleteField,
  deleteNodes,
  deleteTag,
  fieldUsage,
  groupIndex,
  groupsInOrder,
  moveOnBoard,
  moveToGroup,
  patchKanban,
  patchNode,
  removeEdge,
  renameField,
  renameTag,
  setField,
  setMeta,
  setRelation,
  setTagColor,
  setTags,
  tagUsage,
  toggleTag,
  updateBoard,
  updateFieldDef,
  vote,
  withField
} from '@/views/formmap/lenses/ops'
import { boardColumns } from '@/views/formmap/boards'
import { forms, groupAt, metaOf, type Board, type FormMapData, type FormMapEdge, type KanbanNode } from '@/views/formmap/schema'
import { card, doc, edge, fakeCtl, formById, group, kanban } from '../fixtures'

const REG = {
  phase: { type: 'select' as const, options: [{ value: 'mvp' }, { value: 'later' }] },
  status: { type: 'select' as const, options: [{ value: 'todo' }, { value: 'done' }] },
  done: { type: 'checkbox' as const }
}

/** MVP / Later / Questions groups plus a core group without assign. */
function map(extra: Parameters<typeof doc>[0] = [], meta: Parameters<typeof doc>[2] = {}): FormMapData {
  return doc(
    [
      group('core', { x: 0, y: 0, width: 2000, height: 300 }, { label: 'Core idea', order: 1, preset: 'note' }),
      group('mvp', { x: 0, y: 400, width: 700, height: 700 }, { label: 'MVP', order: 5, preset: 'feature', assign: { phase: 'mvp' } }),
      group('later', { x: 800, y: 400, width: 700, height: 700 }, { label: 'Later', order: 6, preset: 'feature', assign: { phase: 'later' } }),
      group('qs', { x: 1600, y: 400, width: 700, height: 700 }, { label: 'Questions', order: 7, preset: 'question' }),
      group('inbox', { x: -600, y: 400, width: 400, height: 700 }, { label: 'Inbox', preset: 'idea' }),
      ...extra
    ],
    [],
    {
      fields: REG,
      presets: [
        { id: 'feature', name: 'Feature', tags: ['feature'], fields: { status: 'todo' } },
        { id: 'idea', name: 'Idea', tags: ['idea'] }
      ],
      ...meta
    }
  )
}

beforeEach(() => {
  vi.mocked(celebrate).mockClear()
})

describe('formmap/lenses/ops geometry', () => {
  it('orders groups for pitch: ordered first (ascending), then top-to-bottom, left-to-right', () => {
    const d = doc([
      group('u2', { x: 50, y: 100, width: 10, height: 10 }),
      group('o2', { x: 0, y: 0, width: 10, height: 10 }, { order: 2 }),
      group('u1', { x: 0, y: 100, width: 10, height: 10 }),
      group('o1', { x: 0, y: 900, width: 10, height: 10 }, { order: 1 })
    ])
    expect(groupsInOrder(d).map((z) => z.id)).toEqual(['o1', 'o2', 'u1', 'u2'])
  })

  it('maps every card to its innermost group (or null)', () => {
    expect(groupIndex(map([card('in', { x: 100, y: 500 }), card('out', { x: 5000, y: 5000 })]))).toEqual(
      new Map([
        ['in', 'mvp'],
        ['out', null]
      ])
    )
  })

  it("moves a card into a group's free spot, applying its fields, in one undo step", () => {
    const f = fakeCtl(map([card('f', { x: 100, y: 500, fields: { phase: 'mvp' } })]))
    moveToGroup(f.ctl, 'f', 'later')
    const c = formById(f.data(), 'f')
    expect(groupAt(f.data(), c)?.id).toBe('later')
    expect(c.fields.phase).toBe('later')
    expect(f.updates).toHaveLength(1)
    // no-op when already there
    const before = f.data()
    moveToGroup(f.ctl, 'f', 'later')
    expect(f.data()).toBe(before)
    moveToGroup(f.ctl, 'f', null)
    expect(groupAt(f.data(), formById(f.data(), 'f'))).toBeNull()
  })

  it('never places a moved card on a nested group', () => {
    const outer = group('outer', { x: 0, y: 0, width: 700, height: 500 })
    const inner = group('inner', { x: 0, y: 0, width: 700, height: 300 })
    const f = fakeCtl(doc([outer, inner, card('c', { x: 5000, y: 0 })]))
    moveToGroup(f.ctl, 'c', 'outer')
    expect(groupAt(f.data(), formById(f.data(), 'c'))?.id).toBe('outer')
  })
})

describe('formmap/lenses/ops fields + tags', () => {
  it('sets and clears a field on several cards, registering new fields', () => {
    const f = fakeCtl(map([card('a'), card('b', { fields: { owner: 'x' } })]))
    setField(f.ctl, ['a', 'b'], 'owner', 'Ana')
    expect([formById(f.data(), 'a').fields.owner, formById(f.data(), 'b').fields.owner]).toEqual(['Ana', 'Ana'])
    expect(metaOf(f.data()).fields?.owner).toEqual({ type: 'text' })
    setField(f.ctl, 'a', 'owner', undefined)
    expect('owner' in formById(f.data(), 'a').fields).toBe(false)
    expect(f.updates).toHaveLength(2)
  })

  it('moves a card to the group assigning the new value when its group assigned another', () => {
    const d = map([card('f', { x: 100, y: 500, fields: { phase: 'mvp' } })])
    const moved = withField(d, formById(d, 'f'), 'phase', 'later')
    expect(groupAt(d, moved)?.id).toBe('later')
    // clearing doesn't move it
    expect(withField(d, formById(d, 'f'), 'phase', undefined)).toMatchObject({ x: 100, y: 500, fields: {} })
    // a field the group doesn't assign doesn't move it
    expect(withField(d, formById(d, 'f'), 'status', 'done')).toMatchObject({ x: 100, y: 500 })
  })

  it('celebrates a ticked done checkbox or a done value, not other edits', () => {
    const f = fakeCtl(map([card('a')]))
    setField(f.ctl, 'a', 'status', 'todo')
    expect(celebrate).not.toHaveBeenCalled()
    setField(f.ctl, 'a', 'done', true, { clientX: 1, clientY: 2 })
    expect(celebrate).toHaveBeenCalledWith(1, 2)
    setField(f.ctl, 'a', 'status', 'done')
    expect(celebrate).toHaveBeenCalledTimes(1) // already done (checkbox)
  })

  it('celebrates a card reaching the last column of a groups board', () => {
    const board: Board = { id: 'b', name: 'B', source: { mode: 'groups', groupIds: ['mvp', 'later'] } }
    const f = fakeCtl(map([card('a', { x: 100, y: 500 })], { boards: [board] }))
    moveToGroup(f.ctl, 'a', 'later')
    expect(celebrate).toHaveBeenCalledTimes(1)
  })

  it('adds and removes tags (registering new ones with a color), toggles a tag', () => {
    const f = fakeCtl(map([card('a', { tags: ['x'] }), card('b')]))
    setTags(f.ctl, ['a', 'b'], { add: ['#new', 'x'] })
    expect(formById(f.data(), 'a').tags).toEqual(['x', 'new'])
    expect(formById(f.data(), 'b').tags).toEqual(['new', 'x'])
    expect(metaOf(f.data()).tags?.new?.color).toBeTruthy()
    setTags(f.ctl, 'a', { remove: ['x'] })
    expect(formById(f.data(), 'a').tags).toEqual(['new'])
    toggleTag(f.ctl, 'a', 'new')
    expect(formById(f.data(), 'a').tags).toEqual([])
    expect(tagUsage(f.data())).toEqual(new Map([['new', 1], ['x', 1]]))
  })

  it('votes up and down, never below zero', () => {
    const f = fakeCtl(map([card('a')]))
    vote(f.ctl, 'a', 1)
    vote(f.ctl, 'a', 1)
    vote(f.ctl, 'a', -5)
    expect(formById(f.data(), 'a').votes).toBeUndefined()
    expect(f.updates.every((u) => (u as { history: string }).history === 'vote:a')).toBe(true)
  })

  it("re-applies groups' fields (coach fix)", () => {
    const f = fakeCtl(map([card('a', { x: 100, y: 500, fields: { phase: 'later' } })]))
    applyGroupFields(f.ctl, ['a'])
    expect(formById(f.data(), 'a').fields.phase).toBe('mvp')
  })
})

describe('formmap/lenses/ops adding + deleting', () => {
  it('adds a card from a preset into the group that uses that preset', () => {
    const f = fakeCtl(map())
    const id = addCard(f.ctl, { title: 'New', preset: 'feature' })
    const c = formById(f.data(), id)
    expect(c).toMatchObject({ title: 'New', tags: ['feature'], fields: { status: 'todo', phase: 'mvp' } })
    expect(groupAt(f.data(), c)?.id).toBe('mvp')
  })

  it('picks the group whose assign agrees with the fields, or an explicit group, or none', () => {
    const f = fakeCtl(map())
    const where = (id: string): string | null => groupAt(f.data(), formById(f.data(), id))?.id ?? null
    expect(where(addCard(f.ctl, { fields: { phase: 'later' } }))).toBe('later')
    expect(where(addCard(f.ctl, { groupId: 'qs' }))).toBe('qs')
    expect(where(addCard(f.ctl, { groupId: null, preset: 'feature' }))).toBeNull()
    expect(where(addCard(f.ctl, {}))).toBeNull()
    expect(bestGroupFor(f.data(), card('x', { fields: { phase: 'mvp' } }), undefined, 'phase')).toBeNull()
  })

  it('places new cards without overlapping existing ones', () => {
    const f = fakeCtl(map())
    const ids = Array.from({ length: 6 }, () => addCard(f.ctl, { preset: 'feature' }))
    const cs = ids.map((i) => formById(f.data(), i))
    for (let i = 0; i < cs.length; i++) for (let j = i + 1; j < cs.length; j++) expect(cs[i].x === cs[j].x && cs[i].y === cs[j].y).toBe(false)
  })

  it('deletes nodes with their edges, and boards forget deleted groups', () => {
    const board: Board = { id: 'b', name: 'B', source: { mode: 'groups', groupIds: ['mvp', 'later'] } }
    const f = fakeCtl(map([card('a'), card('b')], { boards: [board] }))
    f.ctl.doc.update((d) => ({ ...d, edges: [edge('a', 'b', 'serves')] }))
    deleteNodes(f.ctl, ['a', 'later'])
    expect(forms(f.data()).map((x) => x.id)).toEqual(['b'])
    expect(f.data().edges).toEqual([])
    expect(metaOf(f.data()).boards?.[0].source).toEqual({ mode: 'groups', groupIds: ['mvp'] })
  })

  it('patches nodes (undefined removes a key), kanban nodes and the meta', () => {
    const f = fakeCtl(map([kanban('k', [])]))
    patchNode(f.ctl, 'mvp', { label: 'MVP!', order: undefined })
    expect(f.data().nodes.find((n) => n.id === 'mvp')).toMatchObject({ label: 'MVP!' })
    expect('order' in f.data().nodes.find((n) => n.id === 'mvp')!).toBe(false)
    patchKanban(f.ctl, 'k', (k) => ({ ...k, title: 'Bugs' }))
    expect((f.data().nodes.find((n) => n.id === 'k') as KanbanNode).title).toBe('Bugs')
    setMeta(f.ctl, { title: 'T', hudBoard: undefined })
    expect(metaOf(f.data())).toMatchObject({ title: 'T' })
    expect('hudBoard' in metaOf(f.data())).toBe(false)
  })
})

describe('formmap/lenses/ops field registry', () => {
  const setup = (): ReturnType<typeof fakeCtl> => {
    const board: Board = { id: 'b', name: 'B', source: { mode: 'field', field: 'status' }, filter: { tags: ['x'], fields: { status: 'todo' } } }
    return fakeCtl(
      map(
        [card('a', { x: 100, y: 500, fields: { status: 'todo', phase: 'mvp' } }), kanban('k', [{ id: 'c', title: 'C', cards: [{ id: 'kc', title: 'K', fields: { status: 'done' } }] }])],
        {
          boards: [board],
          presets: [{ id: 'p', name: 'P', fields: { status: 'todo' } }],
          checks: [{ id: 'c1', type: 'field', match: { fields: { status: 'todo' } }, field: 'status', title: 't' }]
        }
      )
    )
  }

  it('adds a field once', () => {
    const f = fakeCtl(map())
    expect(addField(f.ctl, ' Owner ', { type: 'text' })).toBe(true)
    expect(addField(f.ctl, 'Owner', { type: 'number' })).toBe(false)
    expect(metaOf(f.data()).fields?.Owner).toEqual({ type: 'text' })
  })

  it('renames a field on every card, kanban card, preset, board and check, keeping its registry position', () => {
    const f = setup()
    expect(renameField(f.ctl, 'status', 'State')).toBe(true)
    const d = f.data()
    expect(Object.keys(metaOf(d).fields!)).toEqual(['phase', 'State', 'done'])
    expect(formById(d, 'a').fields).toEqual({ State: 'todo', phase: 'mvp' })
    expect((d.nodes.find((n) => n.id === 'k') as KanbanNode).columns[0].cards[0].fields).toEqual({ State: 'done' })
    expect(metaOf(d).presets![0].fields).toEqual({ State: 'todo' })
    expect(metaOf(d).boards![0]).toMatchObject({ source: { field: 'State' }, filter: { fields: { State: 'todo' } } })
    expect(metaOf(d).checks![0]).toMatchObject({ field: 'State', match: { fields: { State: 'todo' } } })
    expect(renameField(f.ctl, 'State', 'phase')).toBe(false)
    expect(renameField(f.ctl, 'nope', 'x')).toBe(false)
  })

  it('also renames a field in group assigns', () => {
    const f = fakeCtl(map())
    renameField(f.ctl, 'phase', 'Stage')
    expect(f.data().nodes.find((n) => n.id === 'mvp')).toMatchObject({ assign: { Stage: 'mvp' } })
  })

  it('deletes a field everywhere: values, assigns, presets, boards split by it and checks about it', () => {
    const f = setup()
    deleteField(f.ctl, 'status')
    const d = f.data()
    expect(metaOf(d).fields?.status).toBeUndefined()
    expect(formById(d, 'a').fields).toEqual({ phase: 'mvp' })
    expect(fieldUsage(d, 'status')).toBe(0)
    expect(metaOf(d).boards).toEqual([])
    expect(metaOf(d).checks).toEqual([])
    expect(metaOf(d).presets![0].fields).toEqual({})
    deleteField(f.ctl, 'phase')
    expect(d.nodes.find((n) => n.id === 'mvp')!.assign).toEqual({ phase: 'mvp' })
    expect(f.data().nodes.find((n) => n.id === 'mvp')!.assign).toBeUndefined()
  })

  it('changes a field type, converting values and growing select options from values in use', () => {
    const f = fakeCtl(doc([card('a', { fields: { n: '3', who: 'Ana', ok: 'yes' } }), card('b', { fields: { n: 'x', who: 'Ben', ok: 'no' } })], [], { fields: { n: { type: 'text' }, who: { type: 'text' }, ok: { type: 'text' } } }))
    updateFieldDef(f.ctl, 'n', { type: 'number' })
    updateFieldDef(f.ctl, 'who', { type: 'select' })
    updateFieldDef(f.ctl, 'ok', { type: 'checkbox' })
    expect(formById(f.data(), 'a').fields).toEqual({ n: 3, who: 'Ana', ok: true })
    expect(formById(f.data(), 'b').fields).toEqual({ n: 'x', who: 'Ben' })
    expect(metaOf(f.data()).fields?.who.options?.map((o) => o.value)).toEqual(['Ana', 'Ben'])
    updateFieldDef(f.ctl, 'who', { hidden: true, label: undefined })
    expect(metaOf(f.data()).fields?.who).toMatchObject({ type: 'select', hidden: true })
  })

  it('counts a field’s usage on cards and kanban cards', () => {
    expect(fieldUsage(setup().data(), 'status')).toBe(2)
  })
})

describe('formmap/lenses/ops tag registry', () => {
  it('recolors, renames (merging) and deletes tags everywhere', () => {
    const f = fakeCtl(
      map([card('a', { tags: ['bug', 'ui'] }), card('b', { tags: ['ui'] }), kanban('k', [{ id: 'c', title: 'C', cards: [{ id: 'x', title: 'X', tags: ['bug'] }] }])], {
        tags: { bug: { color: 'red' }, ui: { color: 'blue' } },
        relationRules: [{ from: 'bug', relation: 'blocks' }],
        boards: [{ id: 'b', name: 'B', source: { mode: 'field', field: 'status' }, filter: { tags: ['bug'] } }]
      })
    )
    setTagColor(f.ctl, 'ui', 'pink')
    expect(metaOf(f.data()).tags?.ui.color).toBe('pink')
    expect(renameTag(f.ctl, 'bug', '#defect')).toBe(true)
    let d = f.data()
    expect(formById(d, 'a').tags).toEqual(['defect', 'ui'])
    expect((d.nodes.find((n) => n.id === 'k') as KanbanNode).columns[0].cards[0].tags).toEqual(['defect'])
    expect(metaOf(d).tags?.defect.color).toBe('red')
    expect(metaOf(d).tags?.bug).toBeUndefined()
    expect(metaOf(d).relationRules?.[0].from).toBe('defect')
    expect(metaOf(d).boards?.[0].filter?.tags).toEqual(['defect'])
    // merge into an existing tag
    renameTag(f.ctl, 'ui', 'defect')
    expect(formById(f.data(), 'a').tags).toEqual(['defect'])
    deleteTag(f.ctl, 'defect')
    d = f.data()
    expect(forms(d).every((c) => !c.tags?.length)).toBe(true)
    expect(metaOf(d).tags?.defect).toBeUndefined()
    expect(metaOf(d).relationRules).toEqual([])
  })
})

describe('formmap/lenses/ops boards', () => {
  const groupsBoard: Board = { id: 'B', name: 'Roadmap', source: { mode: 'groups', groupIds: ['inbox', 'later', 'mvp'] } }

  it('creates, updates and deletes boards (the HUD forgets a deleted board)', () => {
    const f = fakeCtl(map())
    createBoard(f.ctl, groupsBoard)
    updateBoard(f.ctl, 'B', { name: 'Plan' })
    setMeta(f.ctl, { hudBoard: 'B' })
    expect(metaOf(f.data()).boards?.[0].name).toBe('Plan')
    deleteBoard(f.ctl, 'B')
    expect(metaOf(f.data()).boards).toEqual([])
    expect(metaOf(f.data()).hudBoard).toBeUndefined()
  })

  it('moves a card between group columns geometrically (applying fields) and saves the column order, in one undo step', () => {
    const f = fakeCtl(map([card('x', { x: 50, y: 500, fields: { phase: 'mvp' } }), card('y', { x: 850, y: 500, fields: { phase: 'later' } }), card('z', { x: 850, y: 700, fields: { phase: 'later' } })], { boards: [groupsBoard] }))
    moveOnBoard(f.ctl, 'B', 'x', 'later', 1)
    const d = f.data()
    expect(f.updates).toHaveLength(1)
    expect(groupAt(d, formById(d, 'x'))?.id).toBe('later')
    expect(formById(d, 'x').fields.phase).toBe('later')
    const cols = boardColumns(d, metaOf(d).boards![0])
    expect(cols.find((c) => c.key === 'later')!.cards.map((c) => c.id)).toEqual(['y', 'x', 'z'])
    expect(metaOf(d).boards![0].order).toEqual({ later: ['y', 'x', 'z'] })
    // reorder within a column
    moveOnBoard(f.ctl, 'B', 'z', 'later', 0)
    expect(boardColumns(f.data(), metaOf(f.data()).boards![0])[1].cards.map((c) => c.id)).toEqual(['z', 'y', 'x'])
    // the last column is the "done" one
    moveOnBoard(f.ctl, 'B', 'z', 'mvp', 0)
    expect(celebrate).toHaveBeenCalledTimes(1)
  })

  it('moves a card between field columns by setting the field (or clearing it)', () => {
    const board: Board = { id: 'F', name: 'Status', source: { mode: 'field', field: 'status' } }
    const f = fakeCtl(map([card('x', { x: 5000, fields: { status: 'todo' } }), card('y', { x: 5000, y: 300 })], { boards: [board] }))
    moveOnBoard(f.ctl, 'F', 'x', 'done', 0, { clientX: 3, clientY: 4 })
    expect(formById(f.data(), 'x').fields.status).toBe('done')
    expect(celebrate).toHaveBeenCalledWith(3, 4)
    moveOnBoard(f.ctl, 'F', 'x', '__none', 0)
    expect('status' in formById(f.data(), 'x').fields).toBe(false)
    // "other values" is not a drop target
    const before = f.data()
    moveOnBoard(f.ctl, 'F', 'x', '__other', 0)
    expect(f.data()).toBe(before)
  })

  it('adds a card to a column: into the group (with its preset) or with the field value, at the end', () => {
    const f = fakeCtl(map([card('y', { x: 850, y: 450 })], { boards: [groupsBoard, { id: 'F', name: 'S', source: { mode: 'field', field: 'status' }, filter: { tags: ['t'] } }] }))
    const b = metaOf(f.data()).boards!
    const later = boardColumns(f.data(), b[0]).find((c) => c.key === 'later')!
    const id = addCardToColumn(f.ctl, b[0], later, 'New later')
    const c = formById(f.data(), id)
    expect(groupAt(f.data(), c)?.id).toBe('later')
    expect(c).toMatchObject({ title: 'New later', tags: ['feature'], fields: { phase: 'later', status: 'todo' } })
    expect(metaOf(f.data()).boards![0].order?.later).toEqual(['y', id])
    const done = boardColumns(f.data(), b[1]).find((x) => x.key === 'done')!
    const id2 = addCardToColumn(f.ctl, b[1], done, 'Shipped')
    expect(formById(f.data(), id2)).toMatchObject({ tags: ['t'], fields: { status: 'done' } })
  })
})

describe('formmap/lenses/ops relations', () => {
  it('adds a relation once, changes it (custom names too) and removes it', () => {
    const f = fakeCtl(map([card('a'), card('b')]))
    addRelation(f.ctl, 'a', 'b', 'serves')
    addRelation(f.ctl, 'a', 'b', 'serves')
    addRelation(f.ctl, 'a', 'a', 'serves')
    expect(f.data().edges).toHaveLength(1)
    const e = f.data().edges[0] as FormMapEdge
    expect(e).toMatchObject({ fromNode: 'a', toNode: 'b', relation: 'serves', toEnd: 'arrow' })
    setRelation(f.ctl, e.id, ' blocks ')
    expect((f.data().edges[0] as FormMapEdge).relation).toBe('blocks')
    setRelation(f.ctl, e.id, '  ')
    expect((f.data().edges[0] as FormMapEdge).relation).toBe('blocks')
    removeEdge(f.ctl, e.id)
    expect(f.data().edges).toEqual([])
  })
})
