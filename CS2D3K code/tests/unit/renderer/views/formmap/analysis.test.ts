import { describe, expect, it } from 'vitest'
import { checklistCards, coachChecks, fmt, mapStats, relationsOf, runRule, whyTrace, type CoachCheck } from '@/views/formmap/analysis'
import type { FormMapData } from '@/views/formmap/schema'
import { card, doc, edge, group, loadSample, loadSprint } from './fixtures'

const sorted = (a: string[]): string[] => [...a].sort()

describe('formmap/analysis whyTrace', () => {
  it('returns just the card itself when it has no relations', () => {
    expect(whyTrace(doc([card('a')]), 'a')).toEqual(['a'])
  })

  it('follows serves / because / depends / refines chains upstream, with the edges', () => {
    const d = doc(
      [card('idea'), card('feat'), card('base'), card('goal'), card('appr'), card('pr')],
      [edge('idea', 'feat', 'refines'), edge('feat', 'base', 'depends'), edge('base', 'goal', 'serves'), edge('feat', 'appr', 'depends'), edge('appr', 'pr', 'because')]
    )
    expect(sorted(whyTrace(d, 'idea'))).toEqual(
      sorted(['idea', 'feat', 'base', 'goal', 'appr', 'pr', 'idea->feat', 'feat->base', 'base->goal', 'feat->appr', 'appr->pr'])
    )
  })

  it('follows chains downstream too (what serves this card)', () => {
    const d = doc([card('f1'), card('f2'), card('g')], [edge('f1', 'g', 'serves'), edge('f2', 'f1', 'depends')])
    expect(sorted(whyTrace(d, 'g'))).toEqual(sorted(['g', 'f1', 'f2', 'f1->g', 'f2->f1']))
  })

  it('does not wander sideways: siblings serving the same goal are not part of a feature trace', () => {
    const d = doc([card('f1'), card('f2'), card('g')], [edge('f1', 'g', 'serves'), edge('f2', 'g', 'serves')])
    expect(sorted(whyTrace(d, 'f1'))).toEqual(sorted(['f1', 'g', 'f1->g']))
  })

  it('ignores relates, contradicts and untyped edges', () => {
    const d = doc(
      [card('a'), card('b'), card('c'), card('d')],
      [edge('a', 'b', 'relates'), edge('a', 'c', 'contradicts'), edge('a', 'd')]
    )
    expect(whyTrace(d, 'a')).toEqual(['a'])
  })

  it('terminates on cycles and includes every edge of the cycle', () => {
    const d = doc([card('a'), card('b'), card('c')], [edge('a', 'b', 'depends'), edge('b', 'c', 'depends'), edge('c', 'a', 'depends')])
    expect(sorted(whyTrace(d, 'a'))).toEqual(sorted(['a', 'b', 'c', 'a->b', 'b->c', 'c->a']))
    const self = doc([card('s')], [edge('s', 's', 'depends')])
    expect(sorted(whyTrace(self, 's'))).toEqual(sorted(['s', 's->s']))
  })

  // regression: an edge into an already-reached card was left out, so the map dimmed it between two lit cards
  it('includes both edges of a diamond (two paths to the same goal)', () => {
    const d = doc(
      [card('f'), card('x'), card('y'), card('g')],
      [edge('f', 'x', 'depends'), edge('f', 'y', 'depends'), edge('x', 'g', 'serves'), edge('y', 'g', 'serves')]
    )
    expect(sorted(whyTrace(d, 'f'))).toEqual(sorted(['f', 'x', 'y', 'g', 'f->x', 'f->y', 'x->g', 'y->g']))
    expect(sorted(whyTrace(d, 'g'))).toEqual(sorted(['f', 'x', 'y', 'g', 'f->x', 'f->y', 'x->g', 'y->g']))
  })

  it('returns no duplicates', () => {
    const d = doc([card('a'), card('b')], [edge('a', 'b', 'serves', 'e1'), edge('a', 'b', 'serves', 'e2')])
    const t = whyTrace(d, 'a')
    expect(new Set(t).size).toBe(t.length)
    expect(sorted(t)).toEqual(['a', 'b', 'e1', 'e2'])
  })
})

describe('formmap/analysis relationsOf', () => {
  it('lists outgoing and incoming relations with the other end, defaulting to relates', () => {
    const d = doc([card('a'), card('g'), card('b'), card('n')], [edge('a', 'g', 'serves'), edge('b', 'a', 'depends'), edge('a', 'n'), edge('b', 'g', 'serves')])
    expect(relationsOf(d, 'a')).toEqual([
      { relation: 'serves', other: 'g', edgeId: 'a->g', dir: 'out' },
      { relation: 'depends', other: 'b', edgeId: 'b->a', dir: 'in' },
      { relation: 'relates', other: 'n', edgeId: 'a->n', dir: 'out' }
    ])
    expect(relationsOf(d, 'zzz')).toEqual([])
  })

  it('reports a self-loop once, as outgoing', () => {
    const d = doc([card('a')], [edge('a', 'a', 'depends')])
    expect(relationsOf(d, 'a')).toEqual([{ relation: 'depends', other: 'a', edgeId: 'a->a', dir: 'out' }])
  })

  it('keeps custom relation names', () => {
    const d = doc([card('a'), card('b')], [edge('a', 'b', 'blocks')])
    expect(relationsOf(d, 'b')).toEqual([{ relation: 'blocks', other: 'a', edgeId: 'a->b', dir: 'in' }])
  })
})

describe('formmap/analysis fmt', () => {
  it('fills counts, titles and singular / plural choices', () => {
    expect(fmt('{n} {n|card|cards} {n|serves|serve} no goal', { n: 1 })).toBe('1 card serves no goal')
    expect(fmt('{n} {n|card|cards} {n|serves|serve} no goal', { n: 3 })).toBe('3 cards serve no goal')
    expect(fmt('{titles}. Fix {n|it|them}.', { n: 2, titles: '“A”, “B”' })).toBe('“A”, “B”. Fix them.')
    expect(fmt('{missing} stays', {})).toBe('{missing} stays')
  })
})

describe('formmap/analysis declarative rules', () => {
  const d = doc(
    [
      card('f1', { title: 'F1', tags: ['feature'], fields: { phase: 'mvp', effort: 'm' } }),
      card('f2', { title: 'F2', tags: ['feature'], fields: { phase: 'mvp', effort: 'xl', status: 'cut' } }),
      card('f3', { title: 'F3', tags: ['feature'], fields: { phase: 'mvp' } }),
      card('g1', { title: 'G1', tags: ['goal'] }),
      card('g2', { title: 'G2', tags: ['goal'] }),
      card('q1', { title: 'Q1', tags: ['question'], fields: { status: 'open' } }),
      card('q2', { title: 'Q2', tags: ['question'] }),
      card('q3', { title: 'Q3', tags: ['question'], fields: { status: 'decided' } })
    ],
    [edge('f1', 'g1', 'serves'), edge('f2', 'g2', 'serves'), edge('q1', 'f1', 'serves')],
    { fields: { effort: { type: 'select', options: [{ value: 'm', points: 3 }, { value: 'xl', points: 8 }] } } }
  )
  const live = { tags: ['feature'], notFields: { status: 'cut' } }

  it('relation (out): flags matching cards without the relation to a matching target', () => {
    const c = runRule(d, { id: 'r', type: 'relation', match: live, relation: 'serves', target: { tags: ['goal'] }, level: 'warn', title: '{n} {n|feature|features} serve no goal', detail: '{titles}.', good: 'All good' })
    expect(c).toMatchObject({ id: 'r', level: 'warn', title: '1 feature serve no goal', detail: '“F3”.', nodes: ['f3'] })
  })

  it('relation (in): flags targets nothing points at (only from matching cards)', () => {
    const c = runRule(d, { id: 'r', type: 'relation', dir: 'in', match: { tags: ['goal'] }, relation: 'serves', target: live, title: '{n} lonely' })
    // g2 is only served by a cut feature
    expect(c).toMatchObject({ level: 'info', title: '1 lonely', nodes: ['g2'] })
  })

  it('field: flags matching cards with an empty field; good when none', () => {
    expect(runRule(d, { id: 'r', type: 'field', match: live, field: 'effort', title: '{n} unsized' })?.nodes).toEqual(['f3'])
    expect(runRule(d, { id: 'r', type: 'field', match: { tags: ['goal'] }, field: 'title', title: 'x', good: 'fine' })).toMatchObject({ level: 'info', nodes: ['g1', 'g2'] })
    expect(runRule(d, { id: 'r', type: 'field', match: { tags: ['question'], fields: { status: 'decided' } }, field: 'status', title: 'x', good: 'All set' })).toMatchObject({ level: 'good', title: 'All set' })
    expect(runRule(d, { id: 'r', type: 'field', match: { tags: ['nobody'] }, field: 'x', title: 'x', good: 'All set' })).toBeNull()
  })

  it('count: flags matching cards, raising the level above a threshold', () => {
    const rule = { id: 'r', type: 'count' as const, match: { tags: ['question'], fields: { status: [null, 'open'] } }, title: '{n} open' }
    expect(runRule(d, rule)).toMatchObject({ level: 'info', title: '2 open', nodes: ['q1', 'q2'] })
    expect(runRule(d, { ...rule, warnAbove: 1 })?.level).toBe('warn')
  })

  it('sum: adds option points over matching cards against a budget', () => {
    const rule = { id: 'b', type: 'sum' as const, match: live, field: 'effort', label: 'MVP', unit: 'pts' }
    expect(runRule(d, { ...rule, max: 5 })).toMatchObject({ level: 'good', title: 'MVP fits the budget (3 / 5 pts)', sum: { value: 3, max: 5 } })
    expect(runRule(d, { ...rule, max: 2 })).toMatchObject({ level: 'warn', title: 'MVP is over budget: 3 / 2 pts', nodes: ['f1', 'f3'] })
    expect(runRule(d, rule)).toMatchObject({ level: 'info', title: 'MVP: 3 pts' })
  })
})

describe('formmap/analysis generic checks', () => {
  const check = (data: FormMapData, id: string): CoachCheck | undefined => coachChecks(data).find((c) => c.id === id)

  it('flags broken relations', () => {
    expect(check(doc([card('a')], [edge('a', 'gone')]), 'dangling')).toMatchObject({ level: 'warn', title: '1 broken relation', nodes: ['a'] })
  })

  it('flags contradictions between open cards (not once one side is done or cut)', () => {
    const reg = { status: { type: 'select' as const } }
    const open = doc([card('a'), card('b')], [edge('a', 'b', 'contradicts')], { fields: reg })
    expect(check(open, 'contradictions')).toMatchObject({ level: 'warn', nodes: ['a', 'b', 'a->b'] })
    const settled = doc([card('a', { fields: { status: 'cut' } }), card('b')], [edge('a', 'b', 'contradicts')], { fields: reg })
    expect(check(settled, 'contradictions')).toBeUndefined()
  })

  it("flags cards whose fields disagree with their group's assign, offering a fix", () => {
    const g = group('g', { x: 0, y: 0, width: 1000, height: 1000 }, { assign: { phase: 'later' } })
    const d = doc([g, card('ok', { fields: { phase: 'later' } }), card('bad', { fields: { phase: 'mvp' } }), card('none')])
    expect(check(d, 'group-mismatch')).toMatchObject({ level: 'info', nodes: ['bad', 'none'], fix: 'apply-groups', title: "2 cards don't match their groups" })
  })

  it('flags cards a field board cannot place', () => {
    const d = doc([card('a', { fields: { s: 'x' } }), card('b')], [], { fields: { s: { type: 'select', options: [{ value: 'x' }] } }, boards: [{ id: 'B', name: 'Status', source: { mode: 'field', field: 's' } }] })
    expect(check(d, 'board-field:B')).toMatchObject({ title: '1 card without s on “Status”', nodes: ['b'] })
  })

  it('flags cards outside groups and empty groups (a group holding groups is not empty)', () => {
    const d = doc([group('outer', { x: 0, y: 0, width: 1000, height: 1000 }), group('inner', { x: 10, y: 10, width: 300, height: 300 }), group('empty', { x: 2000, y: 0, width: 300, height: 300 }), card('in', { x: 20, y: 20 }), card('out', { x: 5000, y: 0 })])
    expect(check(d, 'no-group')?.nodes).toEqual(['out'])
    expect(check(d, 'empty-groups')?.nodes).toEqual(['empty'])
    expect(check(doc([card('a')]), 'no-group')).toBeUndefined()
  })

  it('flags untagged cards once the map uses tags, open checklists and duplicate titles', () => {
    const d = doc([card('a', { tags: ['x'], title: 'Same' }), card('b', { title: 'same ' }), card('c', { title: 'C', fields: { todo: [{ text: 'x', done: false }] } })], [], { fields: { todo: { type: 'checklist' } } })
    expect(check(d, 'untagged')?.nodes).toEqual(['b', 'c'])
    expect(check(d, 'open-checklists')?.nodes).toEqual(['c'])
    expect(check(d, 'duplicates')).toMatchObject({ title: '1 duplicate title', nodes: ['a', 'b'] })
    expect(check(doc([card('a')]), 'untagged')).toBeUndefined()
  })

  it('suggests a start on an empty map, and sorts warnings, then info, then good news', () => {
    expect(check(doc([]), 'empty')).toBeDefined()
    const levels = coachChecks(loadSample()).map((c) => c.level)
    expect(levels).toEqual([...levels].sort((a, b) => ['warn', 'info', 'good'].indexOf(a) - ['warn', 'info', 'good'].indexOf(b)))
  })

  it('survives a broken rule', () => {
    const d = doc([card('a')], [], { checks: [{ id: 'x', type: 'field', match: null, field: 'f', title: 't' } as never] })
    expect(() => coachChecks(d)).not.toThrow()
  })
})

describe('formmap/analysis on the sample definition', () => {
  const d = loadSample()
  const checks = coachChecks(d)

  it('runs the product-definition rules of the example pack', () => {
    expect(checks.map((c) => c.title)).toEqual([
      '4 open questions',
      '2 principles nobody relies on',
      '2 approaches still proposed',
      '6 MVP features without acceptance criteria',
      '3 raw ideas waiting in the inbox',
      'Every feature serves a goal',
      'Every goal has features serving it',
      'MVP fits the budget (21 / 24 pts)'
    ])
    expect(checks.find((c) => c.id === 'unused-principles')?.detail).toContain("“1. Don't read all the agent's code”, “6. Prompts are code”")
    expect(checks.find((c) => c.id === 'open-questions')?.level).toBe('warn')
  })

  it('counts cards, groups, boards, kanbans, votes and checklist items', () => {
    expect(mapStats(d)).toEqual({ cards: 38, groups: 8, boards: 2, kanbans: 0, votes: 33, checklist: { done: 0, total: 0 } })
    expect(mapStats(loadSprint())).toMatchObject({ cards: 9, kanbans: 1, checklist: { done: 1, total: 2 } })
    expect(checklistCards(loadSprint())).toHaveLength(1)
  })
})
