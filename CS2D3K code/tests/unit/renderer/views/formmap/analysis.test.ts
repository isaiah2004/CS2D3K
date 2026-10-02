import { describe, expect, it } from 'vitest'
import { coachChecks, features, isOpenQuestion, mapStats, mvpStats, relationsOf, whyTrace, type CoachCheck } from '@/views/formmap/analysis'
import { effortPoints, forms, type FormMapData } from '@/views/formmap/schema'
import { card, doc, edge, loadSample } from './fixtures'

const check = (d: FormMapData, id: string): CoachCheck | undefined => coachChecks(d).find((c) => c.id === id)
const sorted = (a: string[]): string[] => [...a].sort()

describe('formmap/analysis whyTrace', () => {
  it('returns just the card itself when it has no relations', () => {
    expect(whyTrace(doc([card('a', 'idea')]), 'a')).toEqual(['a'])
  })

  it('follows serves / because / depends / refines chains upstream, with the edges', () => {
    const d = doc(
      [card('idea', 'idea'), card('feat', 'feature'), card('base', 'feature'), card('goal', 'goal'), card('appr', 'approach'), card('pr', 'principle')],
      [edge('idea', 'feat', 'refines'), edge('feat', 'base', 'depends'), edge('base', 'goal', 'serves'), edge('feat', 'appr', 'depends'), edge('appr', 'pr', 'because')]
    )
    expect(sorted(whyTrace(d, 'idea'))).toEqual(
      sorted(['idea', 'feat', 'base', 'goal', 'appr', 'pr', 'idea->feat', 'feat->base', 'base->goal', 'feat->appr', 'appr->pr'])
    )
  })

  it('follows chains downstream too (what serves this card)', () => {
    const d = doc([card('f1', 'feature'), card('f2', 'feature'), card('g', 'goal')], [edge('f1', 'g', 'serves'), edge('f2', 'f1', 'depends')])
    expect(sorted(whyTrace(d, 'g'))).toEqual(sorted(['g', 'f1', 'f2', 'f1->g', 'f2->f1']))
  })

  it('does not wander sideways: siblings serving the same goal are not part of a feature trace', () => {
    const d = doc([card('f1', 'feature'), card('f2', 'feature'), card('g', 'goal')], [edge('f1', 'g', 'serves'), edge('f2', 'g', 'serves')])
    expect(sorted(whyTrace(d, 'f1'))).toEqual(sorted(['f1', 'g', 'f1->g']))
  })

  it('ignores relates, contradicts and untyped edges', () => {
    const d = doc(
      [card('a', 'feature'), card('b', 'feature'), card('c', 'feature'), card('d', 'feature')],
      [edge('a', 'b', 'relates'), edge('a', 'c', 'contradicts'), edge('a', 'd')]
    )
    expect(whyTrace(d, 'a')).toEqual(['a'])
  })

  it('terminates on cycles and includes every edge of the cycle', () => {
    const d = doc([card('a', 'feature'), card('b', 'feature'), card('c', 'feature')], [edge('a', 'b', 'depends'), edge('b', 'c', 'depends'), edge('c', 'a', 'depends')])
    expect(sorted(whyTrace(d, 'a'))).toEqual(sorted(['a', 'b', 'c', 'a->b', 'b->c', 'c->a']))
    const self = doc([card('s', 'feature')], [edge('s', 's', 'depends')])
    expect(sorted(whyTrace(self, 's'))).toEqual(sorted(['s', 's->s']))
  })

  // regression: an edge into an already-reached card was left out, so the map dimmed it between two lit cards
  it('includes both edges of a diamond (two paths to the same goal)', () => {
    const d = doc(
      [card('f', 'feature'), card('x', 'approach'), card('y', 'approach'), card('g', 'goal')],
      [edge('f', 'x', 'depends'), edge('f', 'y', 'depends'), edge('x', 'g', 'serves'), edge('y', 'g', 'serves')]
    )
    expect(sorted(whyTrace(d, 'f'))).toEqual(sorted(['f', 'x', 'y', 'g', 'f->x', 'f->y', 'x->g', 'y->g']))
    expect(sorted(whyTrace(d, 'g'))).toEqual(sorted(['f', 'x', 'y', 'g', 'f->x', 'f->y', 'x->g', 'y->g']))
  })

  it('returns no duplicates', () => {
    const d = doc([card('a', 'feature'), card('b', 'goal')], [edge('a', 'b', 'serves', 'e1'), edge('a', 'b', 'serves', 'e2')])
    const t = whyTrace(d, 'a')
    expect(new Set(t).size).toBe(t.length)
    expect(sorted(t)).toEqual(['a', 'b', 'e1', 'e2'])
  })
})

describe('formmap/analysis relationsOf', () => {
  it('lists outgoing and incoming relations with the other end, defaulting to relates', () => {
    const d = doc([card('a', 'feature'), card('g', 'goal'), card('b', 'feature'), card('n', 'note')], [edge('a', 'g', 'serves'), edge('b', 'a', 'depends'), edge('a', 'n'), edge('b', 'g', 'serves')])
    expect(relationsOf(d, 'a')).toEqual([
      { relation: 'serves', other: 'g', edgeId: 'a->g', dir: 'out' },
      { relation: 'depends', other: 'b', edgeId: 'b->a', dir: 'in' },
      { relation: 'relates', other: 'n', edgeId: 'a->n', dir: 'out' }
    ])
    expect(relationsOf(d, 'zzz')).toEqual([])
  })

  it('reports a self-loop once, as outgoing', () => {
    const d = doc([card('a', 'feature')], [edge('a', 'a', 'depends')])
    expect(relationsOf(d, 'a')).toEqual([{ relation: 'depends', other: 'a', edgeId: 'a->a', dir: 'out' }])
  })
})

describe('formmap/analysis features + stats', () => {
  const d = doc(
    [
      card('m1', 'feature', { fields: { phase: 'mvp', effort: 'm', status: 'done' } }),
      card('m2', 'feature', { fields: { phase: 'mvp', effort: 'l' } }),
      card('m3', 'feature', { fields: { phase: 'mvp', effort: 'xl', status: 'cut' } }),
      card('m4', 'feature', { fields: { phase: 'mvp' } }),
      card('l1', 'feature', { fields: { phase: 'later', effort: 'xl' } }),
      card('u1', 'feature'),
      card('i1', 'idea', { fields: { phase: 'mvp' } })
    ],
    [],
    { version: 1, mvpBudget: 10 }
  )

  it('features() returns feature cards, optionally of one phase', () => {
    expect(features(d).map((f) => f.id)).toEqual(['m1', 'm2', 'm3', 'm4', 'l1', 'u1'])
    expect(features(d, 'mvp').map((f) => f.id)).toEqual(['m1', 'm2', 'm3', 'm4'])
    expect(features(d, 'someday')).toEqual([])
  })

  it('mvpStats counts live MVP features, done ones and their effort points against the budget', () => {
    expect(mvpStats(d)).toEqual({ total: 3, done: 1, points: 3 + 5, budget: 10 })
  })

  it('mvpStats reports no budget when it is missing, zero, negative or not a number', () => {
    for (const mvpBudget of [undefined, 0, -5, '20']) {
      const x = { ...d, formmap: { version: 1, mvpBudget } } as unknown as FormMapData
      expect(mvpStats(x).budget).toBeNull()
    }
    expect(mvpStats(doc([])).budget).toBeNull()
  })

  it('mapStats counts open questions, decisions (decided questions + accepted approaches) and votes', () => {
    const m = doc([
      card('q1', 'question'),
      card('q2', 'question', { fields: { status: 'open' }, votes: 2 }),
      card('q3', 'question', { fields: { status: 'decided' } }),
      card('q4', 'question', { fields: { status: 'parked' } }),
      card('a1', 'approach', { fields: { status: 'accepted' }, votes: 3 }),
      card('a2', 'approach', { fields: { status: 'proposed' } }),
      card('f', 'feature', { fields: { status: 'done' }, votes: 1 })
    ])
    expect(mapStats(m)).toEqual({ openQuestions: 2, decisions: 2, votes: 6 })
  })

  it('isOpenQuestion is true for questions without status or with status open only', () => {
    expect(isOpenQuestion(card('q', 'question'))).toBe(true)
    expect(isOpenQuestion(card('q', 'question', { fields: { status: 'open' } }))).toBe(true)
    expect(isOpenQuestion(card('q', 'question', { fields: { status: 'parked' } }))).toBe(false)
    expect(isOpenQuestion(card('i', 'idea'))).toBe(false)
  })
})

describe('formmap/analysis coachChecks on crafted maps', () => {
  it('suggests starting with the core idea on an empty map', () => {
    const c = coachChecks(doc([]))
    expect(c.map((x) => x.id)).toEqual(['empty'])
    expect(c[0].level).toBe('info')
  })

  it('warns about a feature that serves no goal (singular wording)', () => {
    const d = doc([card('f', 'feature', { title: 'Search' }), card('g', 'goal'), card('o', 'feature')], [edge('o', 'g', 'serves')])
    expect(check(d, 'feature-no-goal')).toMatchObject({ level: 'warn', title: '1 feature serves no goal', nodes: ['f'] })
    expect(check(d, 'feature-no-goal')?.detail).toContain('“Search”')
  })

  it('pluralises and abbreviates long lists of offending cards', () => {
    const d = doc(['a', 'b', 'c', 'd', 'e'].map((id) => card(id, 'feature')))
    const c = check(d, 'feature-no-goal')!
    expect(c.title).toBe('5 features serve no goal')
    expect(c.detail).toMatch(/^“a”, “b”, “c” and 2 more\./)
    expect(c.nodes).toEqual(['a', 'b', 'c', 'd', 'e'])
  })

  it('only counts serves edges that point at a goal', () => {
    const d = doc([card('f', 'feature'), card('f2', 'feature'), card('g', 'goal')], [edge('f', 'f2', 'serves'), edge('f2', 'g', 'relates')])
    expect(check(d, 'feature-no-goal')?.nodes).toEqual(['f', 'f2'])
  })

  it('ignores cut features when looking for orphans', () => {
    const d = doc([card('f', 'feature', { fields: { status: 'cut' } }), card('g', 'goal'), card('o', 'feature')], [edge('o', 'g', 'serves')])
    expect(check(d, 'feature-no-goal')).toMatchObject({ level: 'good', nodes: [] })
  })

  it('warns about goals that no feature serves, and praises when all are served', () => {
    const d = doc([card('g1', 'goal'), card('g2', 'goal'), card('f', 'feature'), card('a', 'approach')], [edge('f', 'g1', 'serves'), edge('a', 'g2', 'serves')])
    expect(check(d, 'goal-no-features')).toMatchObject({ level: 'warn', title: '1 goal with no features', nodes: ['g2'] })
    const ok = doc([card('g1', 'goal'), card('f', 'feature')], [edge('f', 'g1', 'serves')])
    expect(check(ok, 'goal-no-features')?.level).toBe('good')
    expect(check(ok, 'feature-no-goal')?.level).toBe('good')
  })

  // regression: a goal served only by a cut feature counted as served
  it('treats a goal served only by cut features as having no features', () => {
    const d = doc([card('g', 'goal'), card('f', 'feature', { fields: { status: 'cut' } })], [edge('f', 'g', 'serves')])
    expect(check(d, 'goal-no-features')).toMatchObject({ level: 'warn', nodes: ['g'] })
  })

  it('warns when the MVP is over its effort budget, listing the MVP features', () => {
    const d = doc(
      [card('a', 'feature', { fields: { phase: 'mvp', effort: 'xl' } }), card('b', 'feature', { fields: { phase: 'mvp', effort: 'l' } }), card('c', 'feature', { fields: { phase: 'later', effort: 'xl' } })],
      [],
      { version: 1, mvpBudget: 10 }
    )
    const c = check(d, 'mvp-budget')!
    expect(c).toMatchObject({ level: 'warn', title: 'MVP is over budget: 13 / 10 pts', nodes: ['a', 'b'] })
    expect(c.detail).toContain('Move 3+ points')
  })

  it('says the MVP fits when points equal the budget, and skips the check without a budget or MVP', () => {
    const fits = doc([card('a', 'feature', { fields: { phase: 'mvp', effort: 'l' } })], [], { version: 1, mvpBudget: 5 })
    expect(check(fits, 'mvp-budget')).toMatchObject({ level: 'good', title: 'MVP fits the budget (5 / 5 pts)' })
    expect(check({ ...fits, formmap: { version: 1 } }, 'mvp-budget')).toBeUndefined()
    expect(check(doc([card('a', 'feature', { fields: { phase: 'later', effort: 'xl' } })], [], { version: 1, mvpBudget: 1 }), 'mvp-budget')).toBeUndefined()
  })

  it('does not count cut MVP features against the budget', () => {
    const d = doc([card('a', 'feature', { fields: { phase: 'mvp', effort: 's' } }), card('b', 'feature', { fields: { phase: 'mvp', effort: 'xl', status: 'cut' } })], [], { version: 1, mvpBudget: 2 })
    expect(check(d, 'mvp-budget')?.level).toBe('good')
  })

  it('points out MVP features without an effort estimate', () => {
    const d = doc([card('a', 'feature', { fields: { phase: 'mvp' } }), card('b', 'feature', { fields: { phase: 'mvp', effort: 's' } })])
    expect(check(d, 'mvp-unsized')).toMatchObject({ level: 'info', title: '1 MVP feature without an effort estimate', nodes: ['a'] })
  })

  it('points out principles no decision relies on (via because)', () => {
    const d = doc([card('p1', 'principle'), card('p2', 'principle'), card('a', 'approach')], [edge('a', 'p1', 'because'), edge('a', 'p2', 'relates')])
    expect(check(d, 'unused-principles')).toMatchObject({ level: 'info', title: '1 principle nobody relies on', nodes: ['p2'] })
    const ok = doc([card('p1', 'principle'), card('a', 'approach')], [edge('a', 'p1', 'because')])
    expect(check(ok, 'unused-principles')?.level).toBe('good')
  })

  it('points out approaches that are still proposed (or have no status)', () => {
    const d = doc([card('a1', 'approach'), card('a2', 'approach', { fields: { status: 'proposed' } }), card('a3', 'approach', { fields: { status: 'accepted' } }), card('a4', 'approach', { fields: { status: 'superseded' } })])
    expect(check(d, 'approaches-proposed')).toMatchObject({ level: 'info', title: '2 approaches still proposed', nodes: ['a1', 'a2'] })
    expect(check(doc([card('a3', 'approach', { fields: { status: 'accepted' } })]), 'approaches-proposed')?.level).toBe('good')
  })

  it('reports open questions as info, and as a warning when there are more than three', () => {
    const qs = (n: number): FormMapData => doc(Array.from({ length: n }, (_, i) => card(`q${i}`, 'question')))
    expect(check(qs(1), 'open-questions')).toMatchObject({ level: 'info', title: '1 open question' })
    expect(check(qs(3), 'open-questions')?.level).toBe('info')
    expect(check(qs(4), 'open-questions')).toMatchObject({ level: 'warn', title: '4 open questions' })
    expect(check(doc([card('q', 'question', { fields: { status: 'decided' } }), card('p', 'question', { fields: { status: 'parked' } })]), 'open-questions')?.level).toBe('good')
  })

  it('warns about contradictions until one side is settled', () => {
    const live = doc([card('a', 'approach'), card('b', 'approach')], [edge('a', 'b', 'contradicts')])
    expect(check(live, 'contradictions')).toMatchObject({ level: 'warn', title: '1 unresolved contradiction' })
    expect(sorted(check(live, 'contradictions')!.nodes)).toEqual(['a', 'a->b', 'b'])
    for (const status of ['superseded', 'cut', 'decided', 'parked', 'dropped', 'merged']) {
      const settled = doc([card('a', 'approach'), card('b', 'feature', { fields: { status } })], [edge('a', 'b', 'contradicts')])
      expect(check(settled, 'contradictions')).toBeUndefined()
    }
    // an edge to a missing card is not a live contradiction
    expect(check(doc([card('a', 'approach')], [edge('a', 'gone', 'contradicts')]), 'contradictions')).toBeUndefined()
  })

  it('points out MVP features without acceptance criteria', () => {
    const d = doc([card('a', 'feature', { fields: { phase: 'mvp', acceptance: [] } }), card('b', 'feature', { fields: { phase: 'mvp', acceptance: [{ text: 'works', done: false }] } })])
    expect(check(d, 'mvp-no-acceptance')).toMatchObject({ level: 'info', nodes: ['a'] })
    expect(check(doc([card('b', 'feature', { fields: { phase: 'mvp', acceptance: [{ text: 'x', done: true }] } })]), 'mvp-no-acceptance')?.level).toBe('good')
  })

  it('points out raw ideas waiting in the inbox', () => {
    const d = doc([card('i1', 'idea'), card('i2', 'idea', { fields: { status: 'raw' } }), card('i3', 'idea', { fields: { status: 'refined' } })])
    expect(check(d, 'raw-ideas')).toMatchObject({ level: 'info', title: '2 raw ideas waiting in the inbox', nodes: ['i1', 'i2'] })
  })

  it('sorts warnings first, then info, then good news', () => {
    const d = doc([card('f', 'feature', { fields: { phase: 'mvp' } }), card('g', 'goal'), card('p', 'principle'), card('a', 'approach', { fields: { status: 'accepted' } })], [edge('a', 'p', 'because')])
    const levels = coachChecks(d).map((c) => c.level)
    expect(levels).toEqual([...levels].sort((a, b) => ['warn', 'info', 'good'].indexOf(a) - ['warn', 'info', 'good'].indexOf(b)))
    expect(levels).toContain('warn')
    expect(levels).toContain('info')
    expect(levels).toContain('good')
  })

  it('ignores plain canvas nodes', () => {
    const d = doc([{ id: 't', type: 'text', x: 0, y: 0, width: 10, height: 10, text: 'feature' }])
    expect(coachChecks(d).map((c) => c.id)).toEqual(['empty'])
  })
})

describe('formmap/analysis on the sample definition', () => {
  const d = loadSample()
  const ids = new Set([...d.nodes.map((n) => n.id), ...d.edges.map((e) => e.id)])

  it('loads as a form-map with zones, cards of every core kind and typed edges', () => {
    const kinds = new Set(forms(d).map((f) => f.kind))
    for (const k of ['principle', 'approach', 'goal', 'feature', 'question', 'idea'] as const) expect(kinds.has(k)).toBe(true)
    expect(d.edges.every((e) => typeof e.relation === 'string')).toBe(true)
  })

  it('produces coach checks with unique ids that only reference existing cards and edges, sorted by level', () => {
    const checks = coachChecks(d)
    expect(checks.length).toBeGreaterThan(0)
    expect(new Set(checks.map((c) => c.id)).size).toBe(checks.length)
    for (const c of checks) for (const n of c.nodes) expect(ids.has(n)).toBe(true)
    const rank = checks.map((c) => ['warn', 'info', 'good'].indexOf(c.level))
    expect(rank).toEqual([...rank].sort((a, b) => a - b))
    expect(checks.some((c) => c.id === 'empty')).toBe(false)
  })

  it('keeps the coach consistent with the MVP stats', () => {
    const s = mvpStats(d)
    const live = features(d, 'mvp').filter((f) => f.fields.status !== 'cut')
    expect(s.total).toBe(live.length)
    expect(s.points).toBe(live.reduce((sum, f) => sum + effortPoints(f.fields.effort), 0))
    expect(s.done).toBeLessThanOrEqual(s.total)
    expect(s.budget).toBe(d.formmap?.mvpBudget)
    expect(check(d, 'mvp-budget')?.level).toBe(s.points > s.budget! ? 'warn' : 'good')
  })

  it('every feature in the definition serves a goal, and every goal is served', () => {
    expect(check(d, 'feature-no-goal')?.level).toBe('good')
    expect(check(d, 'goal-no-features')?.level).toBe('good')
  })

  it('flags exactly the open questions on the map', () => {
    const open = forms(d).filter(isOpenQuestion).map((f) => f.id)
    expect(sorted(check(d, 'open-questions')?.nodes ?? [])).toEqual(sorted(open))
    expect(mapStats(d).openQuestions).toBe(open.length)
  })

  it('traces every MVP feature up to at least one goal, using only existing ids', () => {
    for (const f of features(d, 'mvp')) {
      const t = whyTrace(d, f.id)
      for (const id of t) expect(ids.has(id)).toBe(true)
      expect(t.some((id) => forms(d).find((x) => x.id === id)?.kind === 'goal')).toBe(true)
    }
  })
})

// regression: coachChecks / whyTrace ran nested scans (goals × serves × features, nodes × edges) — on a 3000-card map
// that cost ~0.5 s per change, i.e. per drag move. They are linear now.
describe('formmap/analysis at scale', () => {
  const big = (n: number): FormMapData => {
    const kinds = ['goal', 'feature', 'feature', 'principle', 'approach', 'question'] as const
    const nodes = Array.from({ length: n }, (_, i) => card(`c${i}`, kinds[i % kinds.length], kinds[i % kinds.length] === 'feature' ? { fields: { phase: 'mvp' } } : {}))
    const edges = Array.from({ length: n }, (_, i) => edge(`c${i}`, `c${(i * 7 + 3) % n}`, i % 3 ? 'serves' : 'because'))
    return doc(nodes, edges)
  }

  it('checks a 6000-card map quickly', () => {
    const d = big(6000)
    const t0 = performance.now()
    const checks = coachChecks(d)
    whyTrace(d, 'c0')
    expect(performance.now() - t0).toBeLessThan(500)
    expect(checks.length).toBeGreaterThan(0)
  })

  it('finds the same orphans / lonely goals as the definition of the checks', () => {
    const d = big(600)
    const all = forms(d)
    const serves = d.edges.filter((e) => e.relation === 'serves')
    const feats = all.filter((f) => f.kind === 'feature' && f.fields.status !== 'cut')
    const goals = all.filter((f) => f.kind === 'goal')
    const orphans = feats.filter((f) => !serves.some((e) => e.fromNode === f.id && all.find((x) => x.id === e.toNode)?.kind === 'goal')).map((f) => f.id)
    const lonely = goals.filter((g) => !serves.some((e) => e.toNode === g.id && feats.some((f) => f.id === e.fromNode))).map((g) => g.id)
    expect(check(d, 'feature-no-goal')?.nodes ?? []).toEqual(orphans)
    expect(check(d, 'goal-no-features')?.nodes ?? []).toEqual(lonely)
  })
})
